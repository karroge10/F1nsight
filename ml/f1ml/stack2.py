"""Model v2: a second-level Plackett-Luce stack over out-of-sample GBM race scores.

v1 turns the base models' race scores into strengths with blend weights and a temperature
schedule fitted on a short recent window, plus a small pole bonus. v2 keeps the v1 base models
(GBM rankers per stage, the DNF logit, the quali blend) and replaces that last layer with one
joint likelihood fit over many seasons of out-of-sample scores:

    pick k of race r chooses among the remaining finishers with
    softmax( T_k * m_r * (s_i + sum_t beta_t x_ti) + [k = 1] * sum_t delta_t f_ti )

- s: the stage's GBM ranker score, from a model trained only on races before it (`oos_scores`).
- x (driver terms, centred within the race): grid and qualifying position (log), grid times
  the circuit's overtaking difficulty, grid times a wet qualifying, sprint result, long-run
  pace, and rain times the driver's wet-weather skill.
- m_r = exp(sum_t gamma_t z_tr) scales how decisive pace is in race r: circuit safety car
  rate, forecast rain, the first rounds of a season.
- f (first pick only): pole and front row bonus.
- T_k = b + (a - b) exp(-(k - 1) / tau): the v1 position dependent temperature.

Everything is fitted by penalised maximum likelihood (torch, L-BFGS) on classified finishers of
the last `window` seasons, with race weights decaying per season. The grid-only Plackett-Luce
model is a special case (s weight absorbed by T), so the stack can lean on the grid as hard as
history says it should. Weather inputs follow `weather.forecast_rain`: archived forecasts with
the stage's lead time for 2024+ test races, the live forecast for the next race, and ERA5
actuals only for training rows (past races).
"""

from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass, field
from functools import lru_cache

import numpy as np
import pandas as pd
import torch

from f1ml import chaos, gbm, longrun, paths, weather
from f1ml import features as feat

VERSION = "v2"
OOS_DIR = paths.CACHE_DIR / "v2"
SEASON_BLOCK_UNTIL = 2019
OOS_FIRST_SEASON = 2008
RACE_BLOCK = 3
WET_MM = 1.0
WET_SKILL_SHRINK = 4.0
GRID_OD_CENTRE = 0.75

STAGE_TERMS = {
    "pre-weekend": {"x": ["wet_skill"], "z": ["chaos", "rain", "early", "lead", "spread"], "f": []},
    "post-practice": {"x": ["sprint", "longrun", "wet_skill"], "z": ["chaos", "rain", "early", "lead", "spread"],
                      "f": []},
    "post-qualifying": {"x": ["grid", "quali", "grid_od", "grid_wetq", "sprint", "longrun",
                              "wet_skill"],
                        "z": ["chaos", "rain", "early", "lead", "spread"], "f": ["pole", "front_row"]},
}


@dataclass
class StackConfig:
    window: int = 10
    decay: float = 0.8
    l2: float = 0.01
    first_weight: float = 1.0
    terms: dict = field(default_factory=lambda: json.loads(json.dumps(STAGE_TERMS)))
    use_forecast: bool = True


@dataclass
class StageStack:
    stage: str
    schedule: list
    beta: dict
    gamma: dict
    delta: dict
    races: int
    nll: float


def oos_scores(features: pd.DataFrame, params: dict, until_race: int | None = None,
               verbose: bool = True) -> pd.DataFrame:
    """Out-of-sample GBM race scores and DNF probabilities for every race since 2008.

    Seasons before 2019 are scored by a model trained on all earlier seasons; from 2019 each
    block of 3 rounds is scored by a model trained on every race before the block (the v1
    backtest's retrain cadence), and the pending race by a model trained on everything.
    Cached per parameter set in cache/v2/oos_<hash>.parquet; only missing blocks are computed.
    """
    OOS_DIR.mkdir(parents=True, exist_ok=True)
    key = _params_hash(params)
    path = OOS_DIR / f"oos_{key}.parquet"
    cached = pd.read_parquet(path) if path.exists() else None
    blocks = _blocks(features, until_race)
    done = set() if cached is None else set(cached["blockStart"].unique())
    frames = [] if cached is None else [cached]
    labelled = features[features["y_finish"].notna() | features["y_dnf"].notna()]
    for block_start, race_ids in blocks:
        signature = _block_signature(block_start, race_ids, features)
        if signature in done:
            continue
        started = time.time()
        train = labelled[labelled["raceId"] < block_start]
        target = features[features["raceId"].isin(race_ids)]
        scored = _score_block(train, target, params)
        scored["blockStart"] = signature
        frames.append(scored)
        if verbose:
            print(f"  oos block {block_start} ({len(race_ids)} races) {time.time() - started:.1f}s")
    table = pd.concat(frames, ignore_index=True)
    valid_signatures = {_block_signature(b, r, features) for b, r in blocks}
    table = table[table["blockStart"].isin(valid_signatures)]
    table = table.drop_duplicates(["raceId", "driverId", "stage"], keep="last")
    table.to_parquet(path, index=False)
    return table


def race_context(features: pd.DataFrame) -> pd.DataFrame:
    """Per (raceId, driverId): chaos, weather and wet-skill inputs of the stack (point in time)."""
    frame = features[["raceId", "driverId", "circuitId", "round", "season"]].copy()
    races = frame.drop_duplicates("raceId")[["raceId", "circuitId"]]
    chaos_rows = []
    for race_id, circuit_id in zip(races["raceId"], races["circuitId"]):
        rate, prior = chaos.circuit_rate(int(race_id), circuit_id)
        chaos_rows.append((int(race_id), rate - prior, rate))
    chaos_frame = pd.DataFrame(chaos_rows, columns=["raceId", "chaos", "sc_rate"])
    frame = frame.merge(chaos_frame, on="raceId", how="left")
    table = _weather_table()
    keep = ["raceId", "rain_actual", "rain_quali", "rain_fc1", "rain_fc2", "rain_fc4",
            "rain_live", "rain_live_quali"]
    for column in keep:
        if column not in table:
            table[column] = np.nan
    frame = frame.merge(table[keep], on="raceId", how="left")
    skills = wet_skill(frame[["raceId", "driverId"]])
    frame = frame.merge(skills, on=["raceId", "driverId"], how="left")
    frame["wet_skill"] = frame["wet_skill"].fillna(0.0)
    runs = longrun.race_long_runs()[["raceId", "driverId", "lr2_gap", "lr2_team_gap"]]
    frame = frame.merge(runs, on=["raceId", "driverId"], how="left")
    frame["lr2_mix"] = 0.5 * (frame["lr2_gap"] + frame["lr2_team_gap"])
    return frame


def fit_stage(stage: str, oos: pd.DataFrame, context: pd.DataFrame, features: pd.DataFrame,
              before: int, config: StackConfig) -> StageStack:
    """Fit the stage's stack on out-of-sample races before raceId `before`."""
    first_season = before // 100 - config.window
    rows = oos[(oos["stage"] == stage) & (oos["raceId"] < before)
               & (oos["raceId"] >= first_season * 100)]
    frame = _assemble(rows, features, context, stage, config, training=True)
    frame = frame[frame["y_classified"] == 1]
    terms = config.terms[stage]
    tensors = _tensors(frame, terms, before // 100, config.decay)
    result = _fit(tensors, terms, config)
    return StageStack(stage=stage, races=int(tensors["races"]), **result)


def stage_strengths(stack: StageStack, frame: pd.DataFrame, score: np.ndarray,
                    context: pd.DataFrame, config: StackConfig) -> dict:
    """Strengths (m_r * u_i), first pick bonus and schedule for one race frame at a stage."""
    rows = frame[["raceId", "driverId"]].copy()
    rows["stage"] = stack.stage
    rows["score"] = score
    assembled = _assemble(rows, frame, context, stack.stage, config, training=False)
    terms = config.terms[stack.stage]
    x = _driver_matrix(assembled, terms["x"])
    z = _race_vector(assembled, terms["z"])
    f = _driver_matrix(assembled, terms["f"])
    beta = np.array([stack.beta[t] for t in terms["x"]], dtype=float)
    gamma = np.array([stack.gamma[t] for t in terms["z"]], dtype=float)
    delta = np.array([stack.delta[t] for t in terms["f"]], dtype=float)
    centred_score = score - np.mean(score)
    utility = centred_score + (x @ beta if len(beta) else 0.0)
    multiplier = float(np.exp(z @ gamma)) if len(gamma) else 1.0
    bonus = f @ delta if len(delta) else np.zeros(len(frame))
    return {"strength": utility * multiplier, "bonus": bonus,
            "schedule": np.asarray(stack.schedule, dtype=float), "multiplier": multiplier}


def wet_skill(keys: pd.DataFrame) -> pd.DataFrame:
    """Driver wet-weather skill before each race: team-mate finish delta in wet races versus all
    races, shrunk towards 0 (positive = better in the wet). Wet = ERA5 rain >= 1 mm in the race
    window."""
    history = _teammate_history()
    rows = []
    for driver_id, group in keys.groupby("driverId"):
        past = history.get(driver_id)
        for race_id in group["raceId"]:
            if past is None:
                rows.append((race_id, driver_id, 0.0))
                continue
            race_ids, delta, wet = past
            count = int(np.searchsorted(race_ids, race_id, side="left"))
            if count == 0:
                rows.append((race_id, driver_id, 0.0))
                continue
            all_mean = float(delta[:count].mean())
            wet_mask = wet[:count]
            wet_n = int(wet_mask.sum())
            if wet_n == 0:
                rows.append((race_id, driver_id, 0.0))
                continue
            wet_mean = float(delta[:count][wet_mask].mean())
            shrink = wet_n / (wet_n + WET_SKILL_SHRINK)
            skill = -(wet_mean - all_mean) * shrink / 5.0
            rows.append((race_id, driver_id, skill))
    return pd.DataFrame(rows, columns=["raceId", "driverId", "wet_skill"])


def wetness(mm) -> np.ndarray:
    """Rain in the race window (mm) to a 0..1 wetness: 1 - exp(-mm / WET_MM)."""
    values = np.nan_to_num(np.asarray(mm, dtype=float), nan=0.0)
    return 1.0 - np.exp(-np.clip(values, 0.0, None) / WET_MM)


# ----------------------------------------------------------------------------------------------
# helpers


def _params_hash(params: dict) -> str:
    wanted = {"rank": params["rank"], "dnf": params["dnf"]}
    text = json.dumps(wanted, sort_keys=True, default=float)
    digest = hashlib.sha1(text.encode("utf-8")).hexdigest()
    return digest[:10]


def _blocks(features: pd.DataFrame, until_race: int | None) -> list[tuple[int, list]]:
    """(training cutoff raceId, race ids scored by that model)."""
    race_frame = features.drop_duplicates("raceId")[["raceId", "season", "y_finish"]]
    labelled_ids = set(features.loc[features["y_finish"].notna(), "raceId"].unique())
    blocks = []
    for season, rows in race_frame.groupby("season"):
        if season < OOS_FIRST_SEASON:
            continue
        ids = sorted(int(r) for r in rows["raceId"].unique())
        if until_race is not None:
            ids = [r for r in ids if r <= until_race]
        done_ids = [r for r in ids if r in labelled_ids]
        pending = [r for r in ids if r not in labelled_ids]
        if season < SEASON_BLOCK_UNTIL:
            if done_ids:
                blocks.append((int(season) * 100, done_ids))
            continue
        for i in range(0, len(done_ids), RACE_BLOCK):
            chunk = done_ids[i:i + RACE_BLOCK]
            blocks.append((chunk[0], chunk))
        for race_id in pending:
            blocks.append((race_id, [race_id]))
    return blocks


def _block_signature(block_start: int, race_ids: list, features: pd.DataFrame) -> str:
    labelled = features[features["y_finish"].notna()]
    trained_through = int(labelled.loc[labelled["raceId"] < block_start, "raceId"].max())
    return f"{block_start}:{trained_through}:{','.join(str(r) for r in race_ids)}"


def _score_block(train: pd.DataFrame, target: pd.DataFrame, params: dict) -> pd.DataFrame:
    rank_params = params["rank"]
    decay = params["dnf"].get("decay", 0.85)
    dnf_pre = gbm.DnfLogit(with_grid=False, decay=decay).fit(train)
    dnf_quali = gbm.DnfLogit(with_grid=True, decay=decay).fit(train)
    frames = []
    for stage in feat.STAGES:
        columns = feat.stage_columns(stage)
        stage_params = rank_params.get(stage, rank_params["default"])
        gated_train = feat.stage_frame(train, stage)
        gated_target = feat.stage_frame(target, stage)
        ranker = gbm.train_ranker(gated_train, columns, "y_finish", stage_params)
        scored = target[["raceId", "driverId"]].copy()
        scored["stage"] = stage
        scored["score"] = gbm.predict(ranker, gated_target, columns)
        dnf_model = dnf_quali if stage == "post-qualifying" else dnf_pre
        scored["p_dnf"] = dnf_model.predict(gated_target)
        frames.append(scored)
    return pd.concat(frames, ignore_index=True)


def _assemble(rows: pd.DataFrame, features: pd.DataFrame, context: pd.DataFrame, stage: str,
              config: StackConfig, training: bool) -> pd.DataFrame:
    """Join scores with gated weekend inputs and context; build every stack term column."""
    columns = ["raceId", "driverId", "grid", "q_pos", "c_grid_corr", "sp_fin", "sprint_pre_q",
               "lr_gap", "round", "season", "field", "y_finish", "y_classified"]
    base = features[[c for c in columns if c in features]]
    merged = rows.merge(base, on=["raceId", "driverId"], how="left")
    gated = feat.stage_frame(merged.assign(**{c: np.nan for c in _missing_cols(merged)}), stage)
    merged["grid"] = gated["grid"]
    merged["q_pos"] = gated["q_pos"]
    merged["sp_fin"] = gated["sp_fin"]
    merged["lr_gap"] = gated["lr_gap"]
    ctx_cols = ["raceId", "driverId", "chaos", "wet_skill", "rain_actual", "rain_quali",
                "rain_fc1", "rain_fc2", "rain_fc4", "rain_live", "rain_live_quali", "lr2_mix"]
    merged = merged.merge(context[ctx_cols], on=["raceId", "driverId"], how="left")
    if stage == "pre-weekend":
        merged["lr2_mix"] = np.nan
    merged["rain_mm"] = _rain_input(merged, stage, config, training)
    merged["quali_rain_mm"] = merged["rain_quali"].fillna(merged["rain_live_quali"])
    return _term_columns(merged)


def _missing_cols(frame: pd.DataFrame) -> list[str]:
    needed = feat.PRACTICE_COLS + feat.SPRINT_COLS + feat.QUALI_COLS
    return [c for c in needed if c not in frame]


def _rain_input(frame: pd.DataFrame, stage: str, config: StackConfig, training: bool):
    """Training rows use what happened (ERA5); forecast rows only what was forecast."""
    if training:
        return frame["rain_actual"]
    if not config.use_forecast:
        return pd.Series(np.nan, index=frame.index)
    lead = weather.LEAD_BY_STAGE[stage]
    forecast = frame["rain_live"].fillna(frame[f"rain_fc{lead}"])
    return forecast


def _term_columns(frame: pd.DataFrame) -> pd.DataFrame:
    field = frame["field"].fillna(frame.groupby("raceId")["driverId"].transform("count"))
    grid = frame["grid"].where(frame["grid"] > 0, field)
    frame["t_grid"] = -np.log(grid.clip(lower=1))
    frame["t_quali"] = -np.log(frame["q_pos"].clip(lower=1))
    od = frame["c_grid_corr"].fillna(GRID_OD_CENTRE) - GRID_OD_CENTRE
    frame["t_grid_od"] = frame["t_grid"] * od * 10.0
    frame["t_grid_wetq"] = frame["t_grid"] * wetness(frame["quali_rain_mm"])
    frame["t_sprint"] = -np.log(frame["sp_fin"].clip(lower=1))
    frame["t_longrun"] = -frame["lr2_mix"].clip(upper=feat.GAP_CLIP)
    race_wet = wetness(frame["rain_mm"])
    frame["t_wet_skill"] = frame["wet_skill"].fillna(0.0) * race_wet
    frame["z_chaos"] = frame["chaos"].fillna(0.0) * 4.0
    frame["z_rain"] = race_wet
    frame["z_early"] = np.exp(-(frame["round"].fillna(10) - 1) / 3.0)
    frame["z_lead"], frame["z_spread"] = _score_shape(frame)
    frame["f_pole"] = (grid == 1).astype(float)
    frame["f_front_row"] = (grid <= 2).astype(float)
    driver_terms = ["t_grid", "t_quali", "t_grid_od", "t_grid_wetq", "t_sprint", "t_longrun",
                    "t_wet_skill"]
    for column in driver_terms:
        present = frame[column].notna()
        means = frame[column].where(present).groupby(frame["raceId"]).transform("mean")
        frame[column] = (frame[column] - means).where(present, 0.0).fillna(0.0)
    return frame


def _score_shape(frame: pd.DataFrame) -> tuple[pd.Series, pd.Series]:
    """Per race: the favourite's lead over the second best score and the log spread of all
    scores, both in units of the race's score standard deviation. They let the stack learn
    that a model which sees one dominant car is usually too sure of it."""
    grouped = frame.groupby("raceId")["score"]
    spread = grouped.transform("std").fillna(1.0).clip(lower=1e-6)
    top = grouped.transform("max")
    second = grouped.transform(lambda values: values.nlargest(2).iloc[-1])
    lead = (top - second) / spread - 1.0
    log_spread = np.log(spread) - np.log(0.2)
    return lead, log_spread


def _driver_matrix(frame: pd.DataFrame, names: list[str]) -> np.ndarray:
    if not names:
        return np.zeros((len(frame), 0))
    prefixed = [f"f_{n}" if f"f_{n}" in frame else f"t_{n}" for n in names]
    return frame[prefixed].to_numpy(dtype=float)


def _race_vector(frame: pd.DataFrame, names: list[str]) -> np.ndarray:
    if not names:
        return np.zeros(0)
    return frame[[f"z_{n}" for n in names]].iloc[0].to_numpy(dtype=float)


def _tensors(frame: pd.DataFrame, terms: dict, season_now: int, decay: float) -> dict:
    """Padded per-race tensors ordered by finishing position (finishers only)."""
    frame = frame[frame["y_finish"].notna()].sort_values(["raceId", "y_finish"])
    groups = [g for _, g in frame.groupby("raceId", sort=True) if len(g) >= 2]
    width = max(len(g) for g in groups)
    count = len(groups)
    x_names = terms["x"]
    z_names = terms["z"]
    f_names = terms["f"]
    score = np.zeros((count, width))
    valid = np.zeros((count, width), dtype=bool)
    x = np.zeros((count, width, len(x_names)))
    f = np.zeros((count, width, len(f_names)))
    z = np.zeros((count, len(z_names)))
    weights = np.zeros(count)
    for r, group in enumerate(groups):
        n = len(group)
        values = group["score"].to_numpy(dtype=float)
        score[r, :n] = values - values.mean()
        valid[r, :n] = True
        if x_names:
            x[r, :n] = _driver_matrix(group, x_names)
        if f_names:
            f[r, :n] = _driver_matrix(group, f_names)
        if z_names:
            z[r] = _race_vector(group, z_names)
        age = season_now - int(group["season"].iloc[0])
        weights[r] = decay ** age
    return {"score": score, "valid": valid, "x": x, "f": f, "z": z, "weights": weights,
            "races": count}


def _fit(tensors: dict, terms: dict, config: StackConfig) -> dict:
    dtype = torch.float64
    score = torch.as_tensor(tensors["score"], dtype=dtype)
    valid = torch.as_tensor(tensors["valid"])
    x = torch.as_tensor(tensors["x"], dtype=dtype)
    f = torch.as_tensor(tensors["f"], dtype=dtype)
    z = torch.as_tensor(tensors["z"], dtype=dtype)
    weights = torch.as_tensor(tensors["weights"], dtype=dtype)
    weights = weights / weights.sum()
    count, width = score.shape
    steps = torch.arange(width, dtype=dtype)
    later = steps[None, :] >= steps[:, None]
    alive = later[None, :, :] & valid[:, None, :]
    step_valid = valid & torch.cat([valid[:, 1:], torch.zeros((count, 1), dtype=torch.bool)],
                                   dim=1)
    log_schedule = torch.tensor(np.log([2.0, 1.0, 3.0]), dtype=dtype, requires_grad=True)
    beta = torch.zeros(x.shape[2], dtype=dtype, requires_grad=True)
    gamma = torch.zeros(z.shape[1], dtype=dtype, requires_grad=True)
    delta = torch.zeros(f.shape[2], dtype=dtype, requires_grad=True)
    first_weight = torch.ones(width, dtype=dtype)
    first_weight[0] = config.first_weight
    variables = [log_schedule, beta, gamma, delta]
    optimizer = torch.optim.LBFGS(variables, lr=0.5, max_iter=300, tolerance_grad=1e-7,
                                  tolerance_change=1e-10, line_search_fn="strong_wolfe")

    def objective():
        first, last, tau = torch.exp(log_schedule)
        temperatures = last + (first - last) * torch.exp(-steps / tau)
        utility = score + (x @ beta if x.shape[2] else 0.0)
        multiplier = torch.exp(z @ gamma) if z.shape[1] else torch.ones(count, dtype=dtype)
        logits = temperatures[None, :, None] * multiplier[:, None, None] * utility[:, None, :]
        if f.shape[2]:
            bonus = f @ delta
            first_row = logits[:, 0, :] + bonus
            logits = torch.cat([first_row[:, None, :], logits[:, 1:, :]], dim=1)
        masked = torch.where(alive, logits, torch.full_like(logits, -1e30))
        normaliser = torch.logsumexp(masked, dim=2)
        picked = torch.diagonal(logits, dim1=1, dim2=2)
        terms_ll = torch.where(step_valid, (picked - normaliser) * first_weight[None, :],
                               torch.zeros_like(picked))
        nll = -(terms_ll.sum(dim=1) * weights).sum()
        penalty = config.l2 * ((beta ** 2).sum() + (gamma ** 2).sum() + (delta ** 2).sum())
        return nll + penalty, nll

    def closure():
        optimizer.zero_grad()
        loss, _ = objective()
        loss.backward()
        return loss

    for _ in range(3):
        optimizer.step(closure)
    with torch.no_grad():
        _, nll = objective()
    schedule = torch.exp(log_schedule).detach().numpy().tolist()
    return {
        "schedule": [float(v) for v in schedule],
        "beta": {name: float(v) for name, v in zip(terms["x"], beta.detach().numpy())},
        "gamma": {name: float(v) for name, v in zip(terms["z"], gamma.detach().numpy())},
        "delta": {name: float(v) for name, v in zip(terms["f"], delta.detach().numpy())},
        "nll": float(nll),
    }


@lru_cache(maxsize=1)
def _weather_table() -> pd.DataFrame:
    table = weather.race_weather()
    return table


@lru_cache(maxsize=1)
def _teammate_history() -> dict:
    """driverId -> (raceIds, team-mate finish delta, wet flag), chronological, since 2000."""
    results = pd.read_parquet(paths.processed("results"),
                              columns=["raceId", "season", "driverId", "constructorId",
                                       "position"])
    results = results[results["season"] >= 2000].copy()
    results["finish"] = results["position"].astype(float)
    grouped = results.groupby(["raceId", "constructorId"])["finish"]
    total = grouped.transform("sum")
    count = grouped.transform("count")
    mate = (total - results["finish"]) / (count - 1)
    results["delta"] = (results["finish"] - mate).where(count == 2)
    results = results.dropna(subset=["delta"])
    table = _weather_table()
    wet_ids = set(table.loc[table["rain_actual"] >= WET_MM, "raceId"].astype(int))
    results["wet"] = results["raceId"].isin(wet_ids)
    history = {}
    for driver_id, rows in results.sort_values("raceId").groupby("driverId"):
        history[driver_id] = (rows["raceId"].to_numpy(), rows["delta"].to_numpy(dtype=float),
                              rows["wet"].to_numpy(dtype=bool))
    return history
