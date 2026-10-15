"""Qualifying first, then the race from that grid (round 8 of research/fantasy-model-log.md).

    uv run python -m scripts.exp_chain.pilot --season 2026
    uv run python -m scripts.exp_chain.pilot --merge

Per race, on the same bundles as `f1ml.backtest` (retrained every 3 rounds on earlier races):
the published pre-weekend, post-practice and lock forecasts (base) and the chained forecast
(chain). Chain: WORLDS qualifying orders from the stage's quali model; per order the race
strength, DNF chance and grid bonus come from the post-qualifying model given that grid, and
sims / WORLDS races are drawn from it. Quali and sprint draws are kept from the base worlds.

Per season the rows go to ml/reports/exp_chain/<season>_*.parquet; --merge writes scorecard
labels `chainbase` and `chain` (score with `python -m f1ml.scorecard chain --against chainbase`)
and a fantasy lock summary.
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import time
import warnings

import numpy as np
import pandas as pd
import torch
from scipy.special import logsumexp

from f1ml import backtest, fantasy, forecast, paths, scorecard, simulate, train
from f1ml import bundle as bundle_module
from f1ml import features as feat

OUT_DIR = paths.ML_DIR / "reports" / "exp_chain"
RETRAIN_EVERY = 3
WORLDS = 100
SIMS = 20000
POST_Q = "post-qualifying"
# 2026 round 17 onward is the protocol's holdout, scored once after the season
FIRST_HOLDOUT = 202617
CHAINED_STAGES = ("pre-weekend", "post-practice")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--season", type=int)
    parser.add_argument("--merge", action="store_true")
    parser.add_argument("--limit", type=int, default=0, help="first N races only (smoke test)")
    args = parser.parse_args()
    warnings.filterwarnings("ignore", category=RuntimeWarning)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    if args.merge:
        merge()
        return
    run_season(args.season, args.limit)


def run_season(season: int, limit: int) -> None:
    started = time.time()
    features = train.load_features()
    params = train.load_params()
    labelled = features[features["y_finish"].notna()]
    race_ids = sorted(labelled[labelled["season"] == season]["raceId"].unique())
    if limit:
        race_ids = race_ids[:limit]
    rows = {"base": {"cars": [], "races": [], "fantasy": []},
            "chain": {"cars": [], "races": [], "fantasy": []}}
    trained = None
    for index, race_id in enumerate(race_ids):
        if trained is None or index % RETRAIN_EVERY == 0:
            train_rows = labelled[labelled["raceId"] < race_id]
            trained = bundle_module.fit_bundle(train_rows, params, use_nn=True)
        race_rows = evaluate_race(trained, features, int(race_id))
        for variant, kinds in race_rows.items():
            for kind, values in kinds.items():
                rows[variant][kind].extend(values)
        print(f"  {race_id} done ({time.time() - started:.0f}s)", flush=True)
    suffix = "_smoke" if limit else ""
    for variant, kinds in rows.items():
        for kind, values in kinds.items():
            table = pd.DataFrame(values)
            table.to_parquet(OUT_DIR / f"{season}{suffix}_{variant}_{kind}.parquet", index=False)
    print(f"season {season} done in {time.time() - started:.0f}s")


def evaluate_race(trained, features: pd.DataFrame, race_id: int) -> dict:
    """Base and chained forecasts of one race: scorecard car and race rows, fantasy rows."""
    frame = features[features["raceId"] == race_id].reset_index(drop=True)
    season = race_id // 100
    extras = fantasy.fit_extras(race_id) if season >= 2023 else None
    actual_points = backtest.championship_points(frame, race_id)
    assets = backtest.export.AssetBook(season, race_id % 100)
    result = {"base": {"cars": [], "races": [], "fantasy": []},
              "chain": {"cars": [], "races": [], "fantasy": []}}
    runs = [(stage, frame, stage, race_id) for stage in CHAINED_STAGES]
    runs.append(("lock", forecast.lock_frame(frame), "post-practice", race_id + 7))
    for label, stage_input, stage, seed in runs:
        base = forecast.forecast_race(trained, stage_input, stage, extras, sims=SIMS, seed=seed)
        chained = chain_forecast(trained, base, extras, seed)
        if label != "lock":
            for variant, outcome in (("base", base), ("chain", chained)):
                cars, race = backtest.scorecard_rows(trained, outcome, frame, actual_points)
                if variant == "chain":
                    race["orderNll"] = outcome.extras["nll"]
                    race["dnfNll"] = 0.0
                result[variant]["cars"].extend(cars)
                result[variant]["races"].append(race)
        for variant, outcome in (("base", base), ("chain", chained)):
            fantasy_rows = backtest.fantasy_evaluation({label: outcome}, assets, race_id)
            for row in fantasy_rows:
                row.pop("changeProbs", None)
            result[variant]["fantasy"].extend(fantasy_rows)
    return result


def chain_forecast(trained, base: forecast.RaceForecast, extras, seed: int):
    """The base forecast with the Grand Prix drawn from the post-qualifying model per
    simulated qualifying order."""
    frame = base.frame
    stage = base.stage
    inputs = forecast.weekend_inputs(trained, frame, stage, base.prediction)
    device = simulate._device()
    generator = torch.Generator(device=device)
    generator.manual_seed(int(seed) + 1000)
    drivers = len(frame)
    quali_strength = simulate._tensor(inputs.quali_strength, device).expand((WORLDS, drivers))
    orders = simulate.sample_order(quali_strength, inputs.quali_schedule, None, generator)
    orders = orders.cpu().numpy()
    world_frames = grid_frames(frame, stage, orders)
    prediction = trained.predict(world_frames, POST_Q)
    strength = prediction["race_strength"].to_numpy().reshape(WORLDS, drivers)
    p_dnf = prediction["p_dnf"].to_numpy().reshape(WORLDS, drivers)
    bonus = np.stack([trained.grid_bonus(POST_Q, order) for order in orders])
    schedule = trained.schedule(POST_Q, "race")
    per_world = SIMS // WORLDS
    world_of_sim = np.repeat(np.arange(WORLDS), per_world)
    sim_strength = simulate._tensor(strength[world_of_sim], device)
    sim_dnf = simulate._tensor(p_dnf[world_of_sim], device)
    sim_bonus = simulate._tensor(bonus[world_of_sim], device)
    team_index = simulate._team_index(inputs.teams, device)
    shape = (len(world_of_sim), drivers)
    retired = simulate.draw_retirements(sim_dnf, shape, team_index, inputs.team_shock, generator)
    race = simulate.sample_order(sim_strength, schedule, retired, generator, sim_bonus)
    quali = orders[world_of_sim]
    weekend = dataclasses.replace(base.sims, quali=quali, grid=quali.copy(),
                                  race=race.cpu().numpy(), classified=(~retired).cpu().numpy())
    summary = simulate.summarize_positions(weekend)
    fantasy_sims = None
    season = int(frame["season"].iloc[0])
    if extras is not None and season >= 2023:
        abs_change = float(frame["c_abs_change"].iloc[0])
        entrants = frame[["driverId", "constructorId"]]
        fantasy_sims = fantasy.score_weekend(weekend, entrants, season, extras, abs_change,
                                             seed=seed)
    chained = dataclasses.replace(base, sims=weekend, summary=summary, fantasy_sims=fantasy_sims)
    chained.extras = {"nll": mixture_nll(frame, strength, p_dnf, bonus, schedule)}
    return chained


def grid_frames(frame: pd.DataFrame, stage: str, orders: np.ndarray) -> pd.DataFrame:
    """One copy of the stage-gated frame per qualifying order, with quali columns filled.

    Each copy gets its own raceId so the set model scores it as a separate race.
    """
    gated = feat.stage_frame(frame, stage)
    gaps = np.sort(proxy_gaps(gated))
    copies = []
    for world, order in enumerate(orders):
        modified = gated.copy()
        modified["raceId"] = int(frame["raceId"].iloc[0]) * 1000 + world
        modified["q_pos"] = order.astype(float)
        modified["grid"] = order.astype(float)
        modified["grid_pen"] = 0.0
        modified["pitlane"] = 0.0
        modified["q_gap"] = gaps[order - 1]
        modified["q_vs_form"] = modified["q_gap"] - modified["d_qgap_e3"]
        team_total = modified.groupby("team")["q_gap"].transform("sum")
        team_count = modified.groupby("team")["q_gap"].transform("count")
        mate = (team_total - modified["q_gap"]) / (team_count - 1)
        modified["q_tm_delta"] = (modified["q_gap"] - mate).where(team_count == 2)
        copies.append(modified)
    return pd.concat(copies, ignore_index=True)


def proxy_gaps(gated: pd.DataFrame) -> np.ndarray:
    """Qualifying gap stand-in from what the stage may see."""
    gaps = gated["sq_gap"].fillna(gated["fp_best_gap"]).fillna(gated["d_qgap_e3"])
    return gaps.fillna(gaps.median()).to_numpy(dtype=float)


def mixture_nll(frame: pd.DataFrame, strength: np.ndarray, p_dnf: np.ndarray,
                bonus: np.ndarray, schedule) -> float:
    """-log of the mean likelihood (order and retirements) over the qualifying orders."""
    actual = frame["y_finish"].to_numpy(dtype=float)
    classified = frame["y_classified"].fillna(0).to_numpy(dtype=float) > 0.5
    log_likelihoods = []
    for world in range(len(strength)):
        order_nll, dnf_nll = scorecard.order_log_likelihood(strength[world], schedule,
                                                            bonus[world], actual, classified,
                                                            p_dnf[world])
        log_likelihoods.append(-(order_nll + dnf_nll))
    return float(-(logsumexp(log_likelihoods) - np.log(len(strength))))


def merge() -> None:
    """Scorecard labels `chainbase` and `chain`, and the fantasy lock comparison."""
    scorecard.SCORECARD_DIR.mkdir(parents=True, exist_ok=True)
    tables = {}
    for variant, label in (("base", "chainbase"), ("chain", "chain")):
        for kind in ("cars", "races", "fantasy"):
            parts = sorted(OUT_DIR.glob(f"20??_{variant}_{kind}.parquet"))
            table = pd.concat([pd.read_parquet(part) for part in parts], ignore_index=True)
            table = table[table["raceId"] < FIRST_HOLDOUT].reset_index(drop=True)
            tables[(variant, kind)] = table
            table.to_parquet(scorecard.SCORECARD_DIR / f"{label}_{kind}.parquet", index=False)
    summary = fantasy_comparison(tables[("base", "fantasy")], tables[("chain", "fantasy")])
    target = OUT_DIR / "fantasy_summary.json"
    target.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


def fantasy_comparison(base: pd.DataFrame, chain: pd.DataFrame) -> dict:
    """MAE, bias and p10-p90 coverage per stage, kind and season, base vs chain."""
    result = {}
    for variant, table in (("base", base), ("chain", chain)):
        table = table.assign(error=(table["expected"] - table["actual"]).abs(),
                             signed=table["expected"] - table["actual"],
                             inside=(table["actual"] >= table["p10"])
                             & (table["actual"] <= table["p90"]))
        grouped = table.groupby(["stage", "kind", "season"])
        for (stage, kind, season), group in grouped:
            key = f"{stage}:{kind}:{season}"
            entry = result.setdefault(key, {})
            entry[variant] = {"mae": round(float(group["error"].mean()), 3),
                              "bias": round(float(group["signed"].mean()), 3),
                              "cover": round(float(group["inside"].mean()), 3),
                              "n": int(len(group))}
    return result


if __name__ == "__main__":
    main()
