"""Walk-forward evaluation of the v2 race stack, 2019 to 2026, without touching published files.

    uv run python -m f1ml.evaluate --tag v2                       # full v2, 2019-2026
    uv run python -m f1ml.evaluate --tag no_weather --drop rain wet_skill grid_wetq

Before every block of 3 rounds the stack of each stage is refitted on out-of-sample races before
the block (`stack2.oos_scores`: base models never saw the races they score). Each race is
forecast at all three stages with 20,000 simulations (retirements from the out-of-sample DNF
logit). Outputs per race records and per driver rows to reports/v2/eval_<tag>.json/.parquet;
`f1ml.compare` turns them into tables with bootstrap confidence intervals.

Baselines are computed walk-forward too: the grid-order slot table uses the 10 seasons before
the test season (v1's table used 2014-2023, which leaks into 2019-2023).
"""

from __future__ import annotations

import argparse
import json
import time
import warnings

import numpy as np
import pandas as pd
import torch

from f1ml import metrics, paths, simulate, stack2, train
from f1ml import features as feat

OUT_DIR = paths.REPORTS_DIR / "v2"
DEFAULT_SEASONS = (2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", default="v2")
    parser.add_argument("--seasons", type=int, nargs="+", default=list(DEFAULT_SEASONS))
    parser.add_argument("--sims", type=int, default=20000)
    parser.add_argument("--drop", nargs="*", default=[], help="stack terms to leave out")
    parser.add_argument("--window", type=int, default=10)
    parser.add_argument("--decay", type=float, default=0.8)
    parser.add_argument("--l2", type=float, default=0.01)
    parser.add_argument("--first-weight", type=float, default=1.0)
    parser.add_argument("--no-forecast", action="store_true")
    args = parser.parse_args()
    warnings.filterwarnings("ignore", category=RuntimeWarning)
    config = stack2.StackConfig(window=args.window, decay=args.decay, l2=args.l2,
                                first_weight=args.first_weight,
                                use_forecast=not args.no_forecast)
    config.terms = drop_terms(config.terms, args.drop)
    started = time.time()
    result = run(args.seasons, config, args.sims)
    result["config"] = {"window": config.window, "decay": config.decay, "l2": config.l2,
                        "firstWeight": config.first_weight, "terms": config.terms,
                        "useForecast": config.use_forecast, "seconds": time.time() - started}
    save(result, args.tag)
    print_summary(result["races"])


def run(seasons, config: stack2.StackConfig, sims: int, features: pd.DataFrame | None = None,
        oos: pd.DataFrame | None = None, context: pd.DataFrame | None = None) -> dict:
    features = train.load_features() if features is None else features
    params = train.load_params()
    if oos is None:
        oos = stack2.oos_scores(features, params)
    if context is None:
        context = stack2.race_context(features)
    labelled = features[features["y_finish"].notna()]
    races = []
    driver_rows = []
    stacks_log = []
    for season in seasons:
        race_ids = sorted(labelled.loc[labelled["season"] == season, "raceId"].unique())
        slot_table = metrics.empirical_slot_table(labelled, "grid", (season - 10, season - 1))
        stacks = None
        for index, race_id in enumerate(race_ids):
            if stacks is None or index % stack2.RACE_BLOCK == 0:
                stacks = {stage: stack2.fit_stage(stage, oos, context, features, int(race_id),
                                                  config) for stage in feat.STAGES}
                stacks_log.append({"before": int(race_id), "stacks": {
                    stage: {"schedule": s.schedule, "beta": s.beta, "gamma": s.gamma,
                            "delta": s.delta, "races": s.races} for stage, s in stacks.items()}})
            record, rows = evaluate_race(int(race_id), stacks, features, oos, context, config,
                                         slot_table, sims)
            races.append(record)
            driver_rows.extend(rows)
            quali = record["stages"]["post-qualifying"]
            pre = record["stages"]["pre-weekend"]
            print(f"  {race_id} pre sp {pre['spearman']:.3f} w {pre['winnerCorrect']:.0f} | "
                  f"post-q sp {quali['spearman']:.3f} w {quali['winnerCorrect']:.0f} "
                  f"ll {quali['logLossWin']:.2f}")
    return {"races": races, "driverRows": driver_rows, "stacks": stacks_log}


def evaluate_race(race_id: int, stacks: dict, features: pd.DataFrame, oos: pd.DataFrame,
                  context: pd.DataFrame, config: stack2.StackConfig, slot_table: pd.DataFrame,
                  sims: int) -> tuple[dict, list]:
    frame = features[features["raceId"] == race_id].reset_index(drop=True)
    actual = frame["y_finish"].to_numpy(dtype=float)
    dnf = frame["y_dnf"].fillna(0).to_numpy(dtype=float)
    actual_points = championship_points(frame)
    record = {"raceId": race_id, "season": race_id // 100, "round": race_id % 100,
              "circuitId": frame["circuitId"].iloc[0], "hasSprint": bool(frame["has_sprint"].iloc[0]),
              "stages": {}, "baselines": {}, "multipliers": {}}
    rows = []
    race_oos = oos[oos["raceId"] == race_id]
    for stage in feat.STAGES:
        stage_oos = race_oos[race_oos["stage"] == stage].set_index("driverId")
        score = frame["driverId"].map(stage_oos["score"]).to_numpy(dtype=float)
        p_dnf = frame["driverId"].map(stage_oos["p_dnf"]).to_numpy(dtype=float)
        out = stack2.stage_strengths(stacks[stage], frame, score, context, config)
        summary = simulate_stage(frame, stage, out, p_dnf, sims, seed=race_id)
        stage_metrics = metrics.race_metrics(summary["expectedPosition"], summary["pWin"],
                                             summary["pPodium"], summary["pPoints"],
                                             summary["pDnf"], actual, dnf)
        stage_metrics["pointsMae"] = float(np.abs(summary["expectedPoints"]
                                                  - actual_points).mean())
        record["stages"][stage] = stage_metrics
        record["multipliers"][stage] = out["multiplier"]
        for i, driver_id in enumerate(frame["driverId"]):
            rows.append({"raceId": race_id, "season": race_id // 100, "stage": stage,
                         "driverId": driver_id, "pWin": summary["pWin"][i],
                         "pPodium": summary["pPodium"][i], "pPoints": summary["pPoints"][i],
                         "pDnf": summary["pDnf"][i],
                         "expectedPosition": summary["expectedPosition"][i],
                         "expectedPoints": summary["expectedPoints"][i], "actual": actual[i],
                         "dnf": dnf[i], "actualPoints": actual_points[i]})
    record["baselines"]["grid"] = grid_baseline(frame, actual, slot_table)
    return record, rows


def simulate_stage(frame: pd.DataFrame, stage: str, out: dict, p_dnf: np.ndarray, sims: int,
                   seed: int) -> dict:
    """Race (and sprint when not yet known) simulation from stack strengths, on the GPU."""
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    generator = torch.Generator(device=device)
    generator.manual_seed(int(seed))
    drivers = len(frame)
    shape = (sims, drivers)
    strength = torch.as_tensor(out["strength"], dtype=torch.float32, device=device).expand(shape)
    dnf = torch.as_tensor(np.nan_to_num(p_dnf, nan=0.15), dtype=torch.float32, device=device)
    retired = torch.rand(shape, generator=generator, device=device) < dnf
    bonus = torch.as_tensor(out["bonus"], dtype=torch.float32, device=device)
    race = simulate.sample_order(strength, out["schedule"], retired, generator, bonus)
    race_np = race.cpu().numpy()
    classified = (~retired).cpu().numpy()
    race_table = simulate._points_lookup(simulate.RACE_POINTS, drivers)
    points = race_table[race_np - 1] * classified
    if bool(frame["has_sprint"].iloc[0]):
        points = points + sprint_points(frame, stage, strength, out, dnf, generator)
    distribution = np.zeros((drivers, drivers))
    for position in range(drivers):
        distribution[:, position] = (race_np == position + 1).mean(axis=0)
    positions = np.arange(1, drivers + 1)
    return {"expectedPosition": distribution @ positions, "pWin": distribution[:, 0],
            "pPodium": distribution[:, :3].sum(axis=1),
            "pPoints": distribution[:, :10].sum(axis=1),
            "pDnf": 1.0 - classified.mean(axis=0), "expectedPoints": points.mean(axis=0)}


def sprint_points(frame: pd.DataFrame, stage: str, strength, out: dict, dnf, generator):
    """Known sprint points when the stage can see the sprint, else simulated (v1 semantics)."""
    visible = stage == "post-qualifying" or (stage == "post-practice"
                                             and frame["sprint_pre_q"].iloc[0] == 1)
    drivers = len(frame)
    table = simulate._points_lookup(simulate.SPRINT_POINTS, drivers)
    if visible and frame["sp_fin"].notna().sum() >= drivers // 2:
        finish = frame["sp_fin"].fillna(99).astype(int).clip(upper=drivers).to_numpy()
        classified = frame["sp_dnf"].fillna(0).to_numpy() < 0.5
        return table[finish - 1] * classified
    sprint_dnf = dnf * simulate.SPRINT_DNF_FACTOR
    retired = torch.rand(strength.shape, generator=generator, device=strength.device) < sprint_dnf
    sprint = simulate.sample_order(strength, out["schedule"], retired, generator)
    return table[sprint.cpu().numpy() - 1] * (~retired).cpu().numpy()


def championship_points(frame: pd.DataFrame) -> np.ndarray:
    """Race plus sprint points actually scored (as in the v1 backtest)."""
    from f1ml import data

    sprint = data.load_core()["sprint_results"]
    race_id = int(frame["raceId"].iloc[0])
    sprint_points_map = sprint[sprint["raceId"] == race_id].set_index("driverId")["points"]
    race_points = frame["y_points"].fillna(0).to_numpy(dtype=float)
    extra = frame["driverId"].map(sprint_points_map).fillna(0).to_numpy(dtype=float)
    return race_points + extra


def grid_baseline(frame: pd.DataFrame, actual: np.ndarray, slot_table: pd.DataFrame) -> dict:
    from f1ml import forecast

    grid_rank = forecast._ranks(frame["grid"])
    result = metrics.order_metrics(grid_rank, actual)
    win = metrics.slot_probabilities(slot_table, grid_rank, "pWin")
    total = win.sum()
    if total > 0:
        win = win / total
    winner = actual == 1
    clipped = np.clip(win, 1e-6, 1 - 1e-6)
    result["brierWin"] = float(((win - winner) ** 2).mean())
    result["logLossWin"] = float(-np.log(clipped[winner]).sum())
    return result


def drop_terms(terms: dict, names: list[str]) -> dict:
    result = {}
    for stage, groups in terms.items():
        result[stage] = {kind: [t for t in values if t not in names]
                         for kind, values in groups.items()}
    return result


def save(result: dict, tag: str) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    payload = {"races": result["races"], "stacks": result["stacks"],
               "config": result.get("config")}
    text = json.dumps(payload, default=float)
    (OUT_DIR / f"eval_{tag}.json").write_text(text, encoding="utf-8")
    rows = pd.DataFrame(result["driverRows"])
    rows.to_parquet(OUT_DIR / f"eval_{tag}_rows.parquet", index=False)


def print_summary(races: list[dict]) -> None:
    frame = pd.DataFrame([{"season": r["season"], "stage": stage, **values}
                          for r in races for stage, values in r["stages"].items()])
    frame["period"] = np.where(frame["season"] >= 2024, "2024-26", "2019-23")
    columns = ["winnerCorrect", "podiumHits", "spearman", "mae", "brierWin", "logLossWin",
               "pointsMae"]
    print(frame.groupby(["period", "stage"])[columns].mean().round(4).to_string())


if __name__ == "__main__":
    main()
