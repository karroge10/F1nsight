from __future__ import annotations

import json

import numpy as np
import pandas as pd
from scipy.optimize import minimize
from scipy.special import logsumexp

from f1ml import paths

COLS = ["dp_driver", "dp_team", "dp_total", "dp_sd"]
RESETS = (2014, 2017, 2022, 2026)
PARAMS_PATH = paths.REPORTS_DIR / "exp" / "dynpl" / "hyperparameters.json"
DEFAULT_PARAMS = {"driver_variance": 0.005, "team_variance": 0.03,
                  "reset_multiplier": 4.0, "prior_variance": 1.0}


def load_params() -> dict:
    if not PARAMS_PATH.exists():
        return DEFAULT_PARAMS.copy()
    text = PARAMS_PATH.read_text(encoding="utf-8")
    return json.loads(text)["chosen"]


def tune(events: pd.DataFrame) -> dict:
    past = events[events["season"] <= 2023]
    trials = []
    for driver_var in (0.005, 0.02):
        for team_var in (0.03, 0.12):
            for reset_multiplier in (4.0, 16.0):
                params = {"driver_variance": driver_var, "team_variance": team_var,
                          "reset_multiplier": reset_multiplier, "prior_variance": 1.0}
                state = Filter(past, params)
                score = state.tuning_nll
                trials.append({"params": params, "nll": score})
                print(f"dynpl tuning {params}: {score:.6f}", flush=True)
    best = min(trials, key=lambda trial: trial["nll"])
    result = {"chosen": best["params"], "trials": trials,
              "method": "Lowest pre-update classified-order mean NLL on 2019-2023; earlier races warm up the filter. Diagonal Laplace posterior, fixed initial variance 1.0. Reset variance multiplier applies to both components at the first race of reset years."}
    PARAMS_PATH.parent.mkdir(parents=True, exist_ok=True)
    output = json.dumps(result, indent=2)
    PARAMS_PATH.write_text(output, encoding="utf-8")
    return result


class Filter:
    def __init__(self, events: pd.DataFrame, params: dict):
        self.params = params
        self.snapshots = {}
        self.race_ids = []
        means = {}
        variances = {}
        losses = []
        previous_season = None
        for race_id, race in events.groupby("raceId", sort=True):
            season = int(race["season"].iloc[0])
            reset = season in RESETS and season != previous_season
            multiplier = params["reset_multiplier"] if reset else 1.0
            for key in means:
                kind = "driver_variance" if key[0] == "d" else "team_variance"
                variances[key] += params[kind] * multiplier
            integer_id = int(race_id)
            self.race_ids.append(integer_id)
            ordered = race[race["classified"] == 1].sort_values("finish")
            keys, design = _design(ordered)
            prior_values = [means.get(key, 0.0) for key in keys]
            spread_values = [variances.get(key, params["prior_variance"]) for key in keys]
            prior = np.array(prior_values)
            spread = np.array(spread_values)
            if len(ordered) >= 2:
                logits = design @ prior
                loss = _order_loss(logits)
                if 2019 <= season <= 2023:
                    losses.append(loss)
                posterior, curvature = _update(prior, spread, design)
                for index, key in enumerate(keys):
                    means[key] = float(posterior[index])
                    variances[key] = float(1.0 / curvature[index])
            self.snapshots[integer_id] = (means.copy(), variances.copy())
            previous_season = season
        self.final = (means, variances)
        self.race_ids = np.array(self.race_ids)
        mean_loss = np.mean(losses) if losses else None
        self.tuning_nll = float(mean_loss) if losses else None

    def features(self, entrants: pd.DataFrame, cutoff: int) -> pd.DataFrame:
        insertion = np.searchsorted(self.race_ids, cutoff, side="left")
        index = int(insertion) - 1
        if index >= 0:
            race_id = int(self.race_ids[index])
            means, variances = self.snapshots[race_id]
        else:
            race_id = None
            means, variances = {}, {}
        season = cutoff // 100
        previous_season = race_id // 100 if race_id is not None else None
        reset = season in RESETS and season != previous_season
        multiplier = self.params["reset_multiplier"] if reset else 1.0
        rows = []
        for driver, team in zip(entrants["driverId"], entrants["team"]):
            driver_key = ("d", driver)
            team_key = ("t", team)
            driver_mean = means.get(driver_key, 0.0)
            team_mean = means.get(team_key, 0.0)
            driver_var = variances.get(driver_key, self.params["prior_variance"])
            team_var = variances.get(team_key, self.params["prior_variance"])
            if driver_key in variances:
                driver_var += self.params["driver_variance"] * multiplier
            if team_key in variances:
                team_var += self.params["team_variance"] * multiplier
            sd = np.sqrt(driver_var + team_var)
            row = [driver_mean, team_mean, driver_mean + team_mean, float(sd)]
            rows.append(row)
        return pd.DataFrame(rows, columns=COLS, index=entrants.index)


def _design(ordered: pd.DataFrame) -> tuple[list, np.ndarray]:
    drivers = [("d", driver) for driver in ordered["driverId"]]
    teams = [("t", team) for team in ordered["team"]]
    unique = dict.fromkeys(drivers + teams)
    keys = list(unique)
    lookup = {key: index for index, key in enumerate(keys)}
    shape = (len(ordered), len(keys))
    design = np.zeros(shape)
    pairs = zip(drivers, teams)
    for index, (driver, team) in enumerate(pairs):
        design[index, lookup[driver]] = 1.0
        design[index, lookup[team]] = 1.0
    return keys, design


def _order_loss(logits: np.ndarray) -> float:
    reversed_logits = logits[::-1]
    normalisers = np.logaddexp.accumulate(reversed_logits)[::-1]
    loss = (normalisers - logits).sum()
    return float(loss)


def _update(prior: np.ndarray, variance: np.ndarray, design: np.ndarray):
    precision = 1.0 / variance

    def objective(values):
        delta = values - prior
        logits = design @ values
        loss = _order_loss(logits)
        count = len(logits)
        gradient = np.zeros(count)
        for step in range(count - 1):
            remaining = logits[step:]
            normaliser = logsumexp(remaining)
            probabilities = np.exp(remaining - normaliser)
            gradient[step:] += probabilities
            gradient[step] -= 1.0
        squared = (delta * delta * precision).sum()
        penalty = 0.5 * float(squared)
        jacobian = design.T @ gradient + precision * delta
        return loss + penalty, jacobian

    result = minimize(objective, prior, jac=True, method="L-BFGS-B")
    if not result.success:
        raise RuntimeError(f"dynpl MAP failed: {result.message}")
    logits = design @ result.x
    curvature = precision.copy()
    steps = len(logits) - 1
    for step in range(steps):
        remaining = logits[step:]
        normaliser = logsumexp(remaining)
        probabilities = np.exp(remaining - normaliser)
        remaining_design = design[step:]
        average = probabilities @ remaining_design
        second = probabilities @ (remaining_design * remaining_design)
        curvature += second - average * average
    return result.x, curvature
