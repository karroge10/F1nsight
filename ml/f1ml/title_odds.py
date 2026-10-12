"""Title odds backtest: score championship probabilities on past seasons and fit the drift.

    uv run python -m f1ml.title_odds --build     # walk-forward inputs per round (cached, ~30 min)
    uv run python -m f1ml.title_odds             # sweep drift sizes and the team shock, report

Before every round of every season a GBM-only bundle trained on earlier races (retrained every
`--retrain-every` rounds) gives pre-weekend strengths and retirement probabilities for that round
and every later round of the season, with the same entrants (as `forecast.championship` does).
These inputs are cached, so the sweep only re-runs the GPU championship simulation.

Scores per (season, round), averaged over rounds:
- titleLogLoss: -log P(eventual champion), smoothed (count + 0.5) / (sims + 1);
- crps: CRPS of each driver's realised remaining points against the simulated distribution
  (thousands of cases instead of a handful of titles), mean over drivers;
- coverage80: share of drivers whose realised remaining points fall inside the simulated 10-90%
  interval; pit: histogram of the probability integral transform (flat is right).

Drift sizes are chosen on the fit seasons only (default 2019-2023, by mean CRPS, title log loss
as the tie-break) and checked on 2024-2025. Caveat: realised points include the fastest lap
point (2019-2024) and 2021's 3-2-1 sprint points, which the simulator does not model.
"""

from __future__ import annotations

import argparse
import itertools
import json
import pickle
import time

import numpy as np
import pandas as pd

from f1ml import backtest, paths, simulate, train
from f1ml import bundle as bundle_module
from f1ml.features import History

TITLE_DIR = paths.REPORTS_DIR / "title"
INPUTS_PATH = TITLE_DIR / "inputs.pkl"
SIGMA_GRID = (0.0, 0.1, 0.25, 0.4, 0.6)
FIT_SEASONS = (2019, 2020, 2021, 2022, 2023)
CHECK_SEASONS = (2024, 2025)
SHOCK_SEASONS = (2014, 2023)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--build", action="store_true", help="rebuild the cached inputs")
    parser.add_argument("--seasons", type=int, nargs="+",
                        default=list(FIT_SEASONS + CHECK_SEASONS))
    parser.add_argument("--retrain-every", type=int, default=4)
    parser.add_argument("--sims", type=int, default=4000)
    args = parser.parse_args()
    TITLE_DIR.mkdir(parents=True, exist_ok=True)
    if args.build or not INPUTS_PATH.exists():
        inputs = build_inputs(args.seasons, args.retrain_every)
        with open(INPUTS_PATH, "wb") as handle:
            pickle.dump(inputs, handle)
    with open(INPUTS_PATH, "rb") as handle:
        inputs = pickle.load(handle)
    shock_estimate = estimate_team_shock(train.load_features(), SHOCK_SEASONS)
    shocks = (0.0, shock_estimate["shock"])
    report = sweep(inputs, args.sims, shocks)
    report["teamShockEstimate"] = shock_estimate
    write_report(report)
    print(markdown(report))


def build_inputs(seasons, retrain_every: int) -> list[dict]:
    """Per round: standings before it, entrants, every remaining round's strengths, outcome."""
    features = train.load_features()
    params = train.load_params()
    history = History.load()
    labelled = features[features["y_finish"].notna()]
    rounds = []
    for season in seasons:
        race_ids = sorted(labelled[labelled["season"] == season]["raceId"].unique())
        final = history.driver_standings[max(race_ids)]
        champion = str(final["points"].idxmax())
        trained = None
        for index, race_id in enumerate(race_ids):
            started = time.time()
            if trained is None or index % retrain_every == 0:
                train_rows = labelled[labelled["raceId"] < race_id]
                trained = bundle_module.fit_bundle(train_rows, params, use_nn=False)
            frame = features[features["raceId"] == race_id].reset_index(drop=True)
            entry = round_inputs(trained, history, frame, race_id, final)
            entry["champion"] = champion
            rounds.append(entry)
            print(f"  {race_id} inputs ({len(entry['rounds'])} rounds) "
                  f"{time.time() - started:.1f}s", flush=True)
    return rounds


def round_inputs(trained, history, frame: pd.DataFrame, race_id: int,
                 final: pd.DataFrame) -> dict:
    """Pre-weekend strengths of this and every later round, aligned with `frame` rows."""
    standings = backtest.standings_before(history, frame, race_id)
    entrants = frame[["driverId", "constructorId", "number"]]
    future = history.future_targets(race_id, entrants)
    future_frame = history.features(future).reset_index(drop=True)
    prediction = trained.predict(future_frame, "pre-weekend").reset_index(drop=True)
    future_frame["race_strength"] = prediction["race_strength"].to_numpy()
    future_frame["p_dnf"] = prediction["p_dnf"].to_numpy()
    schedule = trained.schedule("pre-weekend", "race")
    rounds = []
    for _, rows in future_frame.groupby("raceId", sort=True):
        ordered = rows.set_index("driverId").loc[frame["driverId"]]
        rounds.append({"race_strength": ordered["race_strength"].to_numpy(),
                       "p_dnf": ordered["p_dnf"].to_numpy(),
                       "has_sprint": bool(ordered["has_sprint"].iloc[0]),
                       "schedule": schedule})
    final_points = frame["driverId"].map(final["points"]).fillna(0.0).to_numpy(dtype=float)
    return {"raceId": int(race_id), "season": int(race_id // 100), "round": int(race_id % 100),
            "driverIds": frame["driverId"].tolist(),
            "teams": frame["constructorId"].to_numpy(),
            "points": standings["points"], "wins": standings["wins"], "rounds": rounds,
            "remaining": final_points - standings["points"]}


def sweep(inputs: list[dict], sims: int, shocks: tuple) -> dict:
    """Score every (team sigma, driver sigma, team shock) on every round; pick on fit seasons."""
    results = []
    for team_sigma, driver_sigma, shock in itertools.product(SIGMA_GRID, SIGMA_GRID, shocks):
        if driver_sigma > 0.4:
            continue
        rows = [score_round(entry, team_sigma, driver_sigma, shock, sims) for entry in inputs]
        frame = pd.DataFrame(rows)
        results.append({"teamSigma": team_sigma, "driverSigma": driver_sigma, "shock": shock,
                        "fit": _aggregate(frame[frame["season"].isin(FIT_SEASONS)]),
                        "check": _aggregate(frame[frame["season"].isin(CHECK_SEASONS)]),
                        "bySeason": {str(season): _aggregate(rows_season)
                                     for season, rows_season in frame.groupby("season")}})
        print(f"  team {team_sigma} driver {driver_sigma} shock {shock}: "
              f"fit {results[-1]['fit']} check {results[-1]['check']}", flush=True)
    current = _find(results, simulate.TEAM_SIGMA, simulate.DRIVER_SIGMA, 0.0)
    best = min(results, key=lambda r: (round(r["fit"]["crps"], 3), r["fit"]["titleLogLoss"]))
    return {"sims": sims, "rounds": len(inputs), "fitSeasons": list(FIT_SEASONS),
            "checkSeasons": list(CHECK_SEASONS), "current": current, "best": best,
            "grid": results}


def score_round(entry: dict, team_sigma: float, driver_sigma: float, shock: float,
                sims: int) -> dict:
    result = simulate.simulate_championship(entry["points"], entry["teams"], entry["rounds"],
                                            sims=sims, seed=entry["raceId"],
                                            team_sigma=team_sigma, driver_sigma=driver_sigma,
                                            wins=entry["wins"], team_shock=shock,
                                            keep_totals=True)
    remaining_sims = result["totals"] - entry["points"][None, :]
    realised = entry["remaining"]
    driver_ids = entry["driverIds"]
    champion_counts = result["driver_title"] * sims
    title_loss = np.nan
    p_champion = np.nan
    if entry["champion"] in driver_ids:
        champion_index = driver_ids.index(entry["champion"])
        smoothed = (champion_counts[champion_index] + 0.5) / (sims + 1)
        title_loss = float(-np.log(smoothed))
        p_champion = float(champion_counts[champion_index] / sims)
    low = np.percentile(remaining_sims, 10, axis=0)
    high = np.percentile(remaining_sims, 90, axis=0)
    inside = (realised >= low) & (realised <= high)
    pit = (remaining_sims < realised[None, :]).mean(axis=0)
    ties = (remaining_sims == realised[None, :]).mean(axis=0)
    pit = pit + 0.5 * ties
    return {"season": entry["season"], "round": entry["round"], "titleLogLoss": title_loss,
            "pChampion": p_champion,
            "crps": float(np.mean(crps_samples(remaining_sims, realised))),
            "coverage80": float(inside.mean()),
            "pit": np.histogram(pit, bins=10, range=(0, 1))[0].tolist()}


def crps_samples(samples: np.ndarray, observed: np.ndarray) -> np.ndarray:
    """CRPS per column from samples (sims, n): E|X - y| - 0.5 E|X - X'| (sorted formula)."""
    count = samples.shape[0]
    first = np.abs(samples - observed[None, :]).mean(axis=0)
    ordered = np.sort(samples, axis=0)
    weights = (2 * np.arange(1, count + 1) - count - 1)[:, None]
    spread = (weights * ordered).sum(axis=0) / (count * count)
    return first - spread


def estimate_team_shock(features: pd.DataFrame, seasons: tuple) -> dict:
    """Rate of a common team retirement beyond the race-level rate (both cars out together).

    Both-out rate per team-race minus the rate expected if the two cars retired independently
    at their race's overall rate, divided by (1 - p)^2 (the shock only adds where neither car
    would have retired on its own).
    """
    rows = features[features["season"].between(*seasons) & features["y_classified"].notna()]
    rows = rows.assign(retired=1.0 - rows["y_classified"])
    race_rate = rows.groupby("raceId")["retired"].transform("mean")
    rows = rows.assign(race_rate=race_rate)
    teams = rows.groupby(["raceId", "constructorId"]).agg(
        cars=("retired", "size"), out=("retired", "sum"), rate=("race_rate", "first"))
    teams = teams[teams["cars"] == 2]
    both = float((teams["out"] == 2).mean())
    independent = float((teams["rate"] ** 2).mean())
    overall = float(rows["retired"].mean())
    shock = max(both - independent, 0.0) / (1.0 - overall) ** 2
    return {"seasons": list(seasons), "teamRaces": int(len(teams)), "bothOut": round(both, 4),
            "independent": round(independent, 4), "shock": round(shock, 4)}


def write_report(report: dict) -> None:
    text = json.dumps(report, indent=2, default=float)
    (TITLE_DIR / "title_odds.json").write_text(text, encoding="utf-8")
    (TITLE_DIR / "title_odds.md").write_text(markdown(report), encoding="utf-8")


def markdown(report: dict) -> str:
    lines = ["# Title odds backtest", "",
             f"{report['rounds']} rounds, {report['sims']} simulated seasons per round. "
             f"Fit on {report['fitSeasons']}, checked on {report['checkSeasons']}.", "",
             "| team sigma | driver sigma | shock | fit CRPS | fit title log loss | fit cov80 "
             "| check CRPS | check title log loss | check cov80 |",
             "|---|---|---|---|---|---|---|---|---|"]
    for row in report["grid"]:
        fit = row["fit"]
        check = row["check"]
        lines.append(f"| {row['teamSigma']} | {row['driverSigma']} | {row['shock']} "
                     f"| {fit['crps']:.3f} | {fit['titleLogLoss']:.3f} | {fit['coverage80']:.3f} "
                     f"| {check['crps']:.3f} | {check['titleLogLoss']:.3f} "
                     f"| {check['coverage80']:.3f} |")
    best = report["best"]
    lines += ["", f"Chosen on the fit seasons: team {best['teamSigma']}, driver "
              f"{best['driverSigma']}, shock {best['shock']}."]
    if "teamShockEstimate" in report:
        lines.append(f"Team shock estimate: {report['teamShockEstimate']}.")
    return "\n".join(lines) + "\n"


# ----------------------------------------------------------------------------------------------
# helpers


def _aggregate(frame: pd.DataFrame) -> dict:
    if not len(frame):
        return {"crps": np.nan, "titleLogLoss": np.nan, "coverage80": np.nan, "pit": []}
    pit = np.sum(np.stack(frame["pit"].to_numpy()), axis=0)
    share = pit / max(pit.sum(), 1)
    return {"rounds": int(len(frame)), "crps": float(frame["crps"].mean()),
            "titleLogLoss": float(frame["titleLogLoss"].mean()),
            "pChampionMean": float(frame["pChampion"].mean()),
            "coverage80": float(frame["coverage80"].mean()),
            "pit": [round(float(v), 3) for v in share]}


def _find(results: list, team_sigma: float, driver_sigma: float, shock: float) -> dict | None:
    for row in results:
        if (row["teamSigma"], row["driverSigma"], row["shock"]) == (team_sigma, driver_sigma,
                                                                     shock):
            return row
    return None


if __name__ == "__main__":
    main()
