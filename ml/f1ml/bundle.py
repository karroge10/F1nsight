"""A trained model bundle: GBM rankers + DNF classifiers per stage, the set transformer, and
the stacking weights that turn their raw scores into calibrated Plackett-Luce strengths.

Stacking is fitted on held out races: base models are trained on all but the most recent
`val_races` races of the training window, their predictions on those races fit the blend
weights (which also act as the temperature), then the base models are refit on the full window.
"""

from __future__ import annotations

import io
import pickle
import time
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
import torch
import xgboost as xgb
from scipy.special import expit, logit
from sklearn.linear_model import LogisticRegression

from f1ml import features as feat
from f1ml import gbm, nn, plackett

QUALI_STAGES = ("pre-weekend", "post-practice")


@dataclass
class Bundle:
    params: dict
    cutoff: int
    race_models: dict = field(default_factory=dict)
    quali_models: dict = field(default_factory=dict)
    dnf_models: dict = field(default_factory=dict)
    set_model: nn.SetModel | None = None
    stack: dict = field(default_factory=dict)
    timings: dict = field(default_factory=dict)
    use_nn: bool = True

    def predict(self, frame: pd.DataFrame, stage: str) -> pd.DataFrame:
        """Per driver: race strength (log), quali strength (log), DNF probability, raw scores."""
        raw = self.raw_scores(frame, stage)
        weights = self.stack[stage]
        out = pd.DataFrame(index=frame.index)
        out["gbm_race"] = raw["gbm_race"]
        out["nn_race"] = raw["nn_race"]
        out["race_strength"] = _blend(raw, ("gbm_race", "nn_race"), weights["race"])
        if stage in QUALI_STAGES:
            out["quali_strength"] = _blend(raw, ("gbm_quali", "nn_quali"), weights["quali"])
        else:
            out["quali_strength"] = np.nan
        out["p_dnf"] = _dnf_probability(raw, weights["dnf"])
        return out

    def schedule(self, stage: str, kind: str = "race") -> np.ndarray | None:
        """Position dependent temperature (a, b, tau) for race or quali sampling."""
        key = f"{kind}_schedule"
        values = self.stack.get(stage, {}).get(key)
        if values is None:
            return None
        return np.asarray(values, dtype=float)

    def grid_bonus(self, stage: str, grid: np.ndarray) -> np.ndarray | None:
        """First pick bonus per driver from their grid slot (post-qualifying only)."""
        bonus = self.stack.get(stage, {}).get("first_pick_grid_bonus")
        if bonus is None:
            return None
        values = np.zeros(len(grid))
        for slot, amount in enumerate(bonus):
            values = values + amount * (grid == slot + 1)
        return values

    def raw_scores(self, frame: pd.DataFrame, stage: str) -> pd.DataFrame:
        gated = feat.stage_frame(frame, stage)
        columns = feat.stage_columns(stage)
        raw = pd.DataFrame(index=frame.index)
        raw["gbm_race"] = gbm.predict(self.race_models[stage], gated, columns)
        if stage in QUALI_STAGES:
            raw["gbm_quali"] = gbm.predict(self.quali_models[stage], gated, columns)
        dnf_key, _ = _dnf_key(stage)
        dnf_probability = self.dnf_models[dnf_key].predict(gated)
        clipped = np.clip(dnf_probability, 1e-4, 1 - 1e-4)
        raw["gbm_dnf"] = logit(clipped)
        if self.use_nn and self.set_model is not None:
            nn_out = self.set_model.predict(frame, stage)
            raw["nn_race"] = nn_out["race"]
            raw["nn_quali"] = nn_out["quali"]
            raw["nn_dnf"] = nn_out["dnf"]
        else:
            raw["nn_race"] = 0.0
            raw["nn_quali"] = 0.0
            raw["nn_dnf"] = 0.0
        return raw

    def save(self, path) -> None:
        with open(path, "wb") as handle:
            pickle.dump(self, handle)

    @staticmethod
    def load(path) -> "Bundle":
        """Load a bundle on this machine's device: one trained on the GPU also runs on a CPU."""
        with open(path, "rb") as handle:
            unpickler = _DeviceUnpickler(handle)
            bundle = unpickler.load()
        bundle.to_device()
        return bundle

    def to_device(self) -> None:
        """Point the networks and the XGBoost boosters at CUDA when present, else the CPU."""
        if self.set_model is not None:
            device = nn.pick_device()
            for network in self.set_model.networks:
                network.to(device)
        boosters = [*self.race_models.values(), *self.quali_models.values(),
                    *self.dnf_models.values()]
        for booster in boosters:
            if isinstance(booster, (xgb.Booster, gbm.BoosterBag)):
                booster.set_param({"device": gbm.pick_device()})


LONG_WINDOW = 96
SEED_STRIDE = 1000
LONG_CHUNK = 24
FIRST_PICK_WINDOW = 48


def fit_bundle(train: pd.DataFrame, params: dict, val_races: int = 30, use_nn: bool = True,
               verbose: bool = False, stack: dict | None = None) -> Bundle:
    """Train every base model on `train`; fit stacking on its last `val_races` races.

    Blend weights and the DNF stack come from the recent window. The temperature schedule
    (how sharp the favourite is) is refitted on a long multi-season window, see
    `long_window_schedules`, because a schedule fitted on one dominant season is badly
    overconfident when the competitive order changes (2023 to 2024). When `stack` is given the
    inner validation is skipped and those weights are reused.
    """
    train = train[train["y_finish"].notna() | train["y_dnf"].notna()]
    cutoff = int(train["raceId"].max()) + 1
    if stack is None:
        race_ids = np.sort(train["raceId"].unique())
        val_ids = race_ids[-val_races:]
        inner_train = train[~train["raceId"].isin(val_ids)]
        inner_val = train[train["raceId"].isin(val_ids)]
        inner = _fit_base(inner_train, params, use_nn, verbose)
        stack = fit_stack(inner, inner_val)
        long_window_schedules(train, params, stack)
    bundle = _fit_base(train, params, use_nn, verbose)
    bundle.cutoff = cutoff
    bundle.stack = stack
    return bundle


def fit_stack(bundle: Bundle, validation: pd.DataFrame) -> dict:
    """Blend weights per stage for race and quali strengths, plus DNF stacking coefficients."""
    stack = {}
    for stage in feat.STAGES:
        raw = bundle.raw_scores(validation, stage)
        scored = pd.concat([validation[["raceId", "y_finish", "y_quali", "y_dnf"]], raw], axis=1)
        scored["y_finish"] = _finishers_only(validation)
        race_cols = ["gbm_race", "nn_race"] if bundle.use_nn else ["gbm_race"]
        race_groups = plackett.race_groups(scored, race_cols, "y_finish")
        race_weights = plackett.fit_blend(race_groups)
        entry = {"race": _pad_weights(race_weights)}
        entry["race_schedule"] = _fit_schedule(scored, race_cols, race_weights, "y_finish")
        if stage in QUALI_STAGES:
            quali_cols = ["gbm_quali", "nn_quali"] if bundle.use_nn else ["gbm_quali"]
            quali_groups = plackett.race_groups(scored, quali_cols, "y_quali")
            quali_weights = plackett.fit_blend(quali_groups)
            entry["quali"] = _pad_weights(quali_weights)
            entry["quali_schedule"] = _fit_schedule(scored, quali_cols, quali_weights,
                                                    "y_quali")
        entry["dnf"] = _fit_dnf_stack(scored, bundle.use_nn)
        entry["race_gbm_ratio"] = _spread_ratio(scored, race_cols, race_weights, "gbm_race")
        if stage in QUALI_STAGES:
            entry["quali_gbm_ratio"] = _spread_ratio(scored, quali_cols, quali_weights,
                                                     "gbm_quali")
        stack[stage] = entry
    return stack


def long_window_schedules(train: pd.DataFrame, params: dict, stack: dict) -> None:
    """Refit race and quali temperature schedules on the last LONG_WINDOW races, in place.

    The window is split into chunks; each chunk is scored by GBM rankers trained only on
    races before it (out of sample). The tail of the race schedule comes from the full-order
    likelihood over the whole window; the first pick (who wins) is refitted on the winner
    likelihood of the last FIRST_PICK_WINDOW races, which selection on 2019-2023 showed to be
    the best calibrated choice for win probabilities. GBM scores are mapped onto the blended strength scale
    with the spread ratio measured on the recent validation window. The recent-window
    schedules are kept as *_schedule_recent for reference.
    """
    race_ids = np.sort(train["raceId"].unique())
    window = race_ids[-LONG_WINDOW:]
    chunks = [window[i:i + LONG_CHUNK] for i in range(0, len(window), LONG_CHUNK)]
    rank_params = params["rank"]
    collected = {stage: [] for stage in feat.STAGES}
    for chunk in chunks:
        before = train[train["raceId"] < chunk.min()]
        target = train[train["raceId"].isin(chunk)]
        for stage in feat.STAGES:
            columns = feat.stage_columns(stage)
            gated_before = feat.stage_frame(before, stage)
            gated_target = feat.stage_frame(target, stage)
            stage_params = rank_params.get(stage, rank_params["default"])
            ranker = _train_ranker(gated_before, columns, "y_finish", stage_params, params)
            scored = target[["raceId", "y_finish", "y_quali", "grid"]].copy()
            scored["y_finish"] = _finishers_only(target)
            scored["race"] = gbm.predict(ranker, gated_target, columns)
            if stage in QUALI_STAGES:
                quali_params = rank_params.get("quali", rank_params["default"])
                quali_ranker = _train_ranker(gated_before, columns, "y_quali", quali_params,
                                             params)
                scored["quali"] = gbm.predict(quali_ranker, gated_target, columns)
            collected[stage].append(scored)
    for stage in feat.STAGES:
        scored = pd.concat(collected[stage], ignore_index=True)
        entry = stack[stage]
        entry["race_schedule_recent"] = entry["race_schedule"]
        scale = entry["race"][0] * entry["race_gbm_ratio"]
        frame = scored[["raceId", "y_finish"]].assign(strength=scored["race"] * scale)
        groups = plackett.race_groups(frame, ["strength"], "y_finish")
        schedule = [float(v) for v in plackett.fit_schedule(groups)]
        recent_ids = window[-FIRST_PICK_WINDOW:]
        recent = frame[frame["raceId"].isin(recent_ids)]
        recent_groups = plackett.race_groups(recent, ["strength"], "y_finish")
        entry["race_first_pick_full_fit"] = schedule[0]
        if stage == "post-qualifying":
            recent_frame = recent.assign(grid=scored.loc[recent.index, "grid"])
            first_pick, bonus = plackett.fit_first_pick_grid(recent_frame)
            schedule[0] = first_pick
            entry["first_pick_grid_bonus"] = bonus
        else:
            schedule[0] = plackett.fit_first_pick(recent_groups)
        entry["race_schedule"] = schedule
        if stage in QUALI_STAGES:
            entry["quali_schedule_recent"] = entry["quali_schedule"]
            quali_scale = entry["quali"][0] * entry["quali_gbm_ratio"]
            quali_frame = scored[["raceId", "y_quali"]].assign(
                strength=scored["quali"] * quali_scale)
            quali_groups = plackett.race_groups(quali_frame, ["strength"], "y_quali")
            entry["quali_schedule"] = [float(v) for v in plackett.fit_schedule(quali_groups)]
        entry["schedule_window"] = int(len(window))


# ----------------------------------------------------------------------------------------------
# helpers


def _fit_base(train: pd.DataFrame, params: dict, use_nn: bool, verbose: bool) -> Bundle:
    bundle = Bundle(params=params, cutoff=int(train["raceId"].max()) + 1, use_nn=use_nn)
    started = time.time()
    rank_params = params["rank"]
    for stage in feat.STAGES:
        stage_params = rank_params.get(stage, rank_params["default"])
        gated = feat.stage_frame(train, stage)
        columns = feat.stage_columns(stage)
        bundle.race_models[stage] = _train_ranker(gated, columns, "y_finish", stage_params,
                                                  params)
        if stage in QUALI_STAGES:
            quali_params = rank_params.get("quali", rank_params["default"])
            bundle.quali_models[stage] = _train_ranker(gated, columns, "y_quali", quali_params,
                                                       params)
    dnf_params = params["dnf"]
    decay = dnf_params.get("decay", 0.85)
    pre_model = gbm.DnfLogit(with_grid=False, decay=decay)
    bundle.dnf_models["pre"] = pre_model.fit(train)
    quali_model = gbm.DnfLogit(with_grid=True, decay=decay)
    bundle.dnf_models["quali"] = quali_model.fit(train)
    bundle.timings["gbm_seconds"] = time.time() - started
    if use_nn:
        nn_params = dict(params["nn"], seed=_seed_base(params))
        set_model = nn.train_set_model(train, nn_params, verbose=verbose)
        bundle.set_model = set_model
        bundle.timings["nn_seconds"] = set_model.train_seconds
    if verbose:
        print(f"    base models trained: {bundle.timings}")
    return bundle


def _train_ranker(gated: pd.DataFrame, columns: list, order_col: str, stage_params: dict,
                  params: dict):
    """A ranker (bagged when params["gbm_bags"] > 1) seeded from the run's seed."""
    seed = _seed_base(params)
    bags = int(params.get("gbm_bags", 1))
    return gbm.train_ranker(gated, columns, order_col, stage_params, seed=seed, bags=bags)


def _seed_base(params: dict) -> int:
    """First seed of every random source in a fit; seeds of one run never meet another's."""
    return int(params.get("seed", 0)) * SEED_STRIDE


def _fit_dnf_stack(scored: pd.DataFrame, use_nn: bool) -> dict:
    usable = scored[scored["y_dnf"].notna()]
    columns = ["gbm_dnf", "nn_dnf"] if use_nn else ["gbm_dnf"]
    features = usable[columns].to_numpy(dtype=float)
    labels = usable["y_dnf"].to_numpy(dtype=int)
    model = LogisticRegression(C=1.0)
    model.fit(features, labels)
    coefficients = model.coef_[0].tolist()
    if not use_nn:
        coefficients.append(0.0)
    return {"intercept": float(model.intercept_[0]), "coef": coefficients}


def _fit_schedule(scored: pd.DataFrame, columns: list, weights, order_col: str) -> list[float]:
    """Fit the temperature schedule on the blended strength of held out races."""
    blended = np.zeros(len(scored))
    for column, weight in zip(columns, weights):
        blended = blended + weight * scored[column].to_numpy(dtype=float)
    frame = scored[["raceId", order_col]].assign(blended=blended)
    groups = plackett.race_groups(frame, ["blended"], order_col)
    params = plackett.fit_schedule(groups)
    return [float(value) for value in params]


def _finishers_only(frame: pd.DataFrame) -> pd.Series:
    """Finishing order of classified cars only.

    Retired cars are classified at the back in an order unrelated to pace; the simulation
    draws retirements separately, so every order likelihood here is fitted on finishers.
    Including retirements forced the tail temperature to zero and leaked points from the
    midfield front runners to the back of the grid.
    """
    return frame["y_finish"].where(frame["y_classified"] == 1)


def _spread_ratio(scored: pd.DataFrame, columns: list, weights, gbm_column: str) -> float:
    """std(blended strength) / std(weight_gbm * gbm score), both demeaned within race."""
    blended = np.zeros(len(scored))
    for column, weight in zip(columns, weights):
        blended = blended + weight * scored[column].to_numpy(dtype=float)
    gbm_part = weights[0] * scored[gbm_column].to_numpy(dtype=float)
    frame = pd.DataFrame({"raceId": scored["raceId"].to_numpy(), "blend": blended,
                          "gbm": gbm_part})
    centred = frame[["blend", "gbm"]] - frame.groupby("raceId")[["blend", "gbm"]].transform(
        "mean")
    gbm_std = float(centred["gbm"].std())
    if gbm_std < 1e-9:
        return 1.0
    return float(centred["blend"].std() / gbm_std)


def _dnf_key(stage: str) -> tuple[str, list[str]]:
    if stage == "post-qualifying":
        return "quali", gbm.DNF_QUALI_COLUMNS
    return "pre", gbm.DNF_COLUMNS


def _blend(raw: pd.DataFrame, columns: tuple, weights) -> np.ndarray:
    total = np.zeros(len(raw))
    for column, weight in zip(columns, weights):
        values = raw[column].to_numpy(dtype=float)
        total = total + weight * values
    return total


def _dnf_probability(raw: pd.DataFrame, stack: dict) -> np.ndarray:
    gbm_part = stack["coef"][0] * raw["gbm_dnf"].to_numpy(dtype=float)
    nn_part = stack["coef"][1] * raw["nn_dnf"].to_numpy(dtype=float)
    logits = stack["intercept"] + gbm_part + nn_part
    return expit(logits)


def _pad_weights(weights: np.ndarray) -> list[float]:
    values = [float(w) for w in weights]
    while len(values) < 2:
        values.append(0.0)
    return values


class _DeviceUnpickler(pickle.Unpickler):
    """Maps pickled torch tensors onto the current device (CUDA tensors load on a CPU box)."""

    def find_class(self, module: str, name: str):
        if module == "torch.storage" and name == "_load_from_bytes":
            return _load_tensor_bytes
        return super().find_class(module, name)


def _load_tensor_bytes(data: bytes):
    buffer = io.BytesIO(data)
    device = nn.pick_device()
    return torch.load(buffer, map_location=device, weights_only=False)
