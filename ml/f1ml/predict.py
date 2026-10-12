"""Forecast the next race and write data/predictions/next.json and fantasy.json.

    uv run python -m f1ml.predict              # rebuild features, auto-detect race and stage
    uv run python -m f1ml.predict --stage pre-weekend --no-features

Idempotent: re-run after every session this weekend. The stage is the latest whose inputs
exist (practice laps from F1DB / FastF1 / OpenF1 / the live timing archive, sprint results,
qualifying). The model bundle is the one in models/latest.json (`f1ml.train`).
"""

from __future__ import annotations

import argparse
import json
import time
import warnings

import numpy as np
import pandas as pd

from f1ml import (backtest, export, fantasy, forecast, paths, penalties, points_calibration,
                  simulate)
from f1ml import bundle as bundle_module
from f1ml import features as feat
from f1ml.features import History

HORIZON_ROUNDS = 3
HORIZON_SIMS = 4000


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", choices=feat.STAGES, default=None)
    parser.add_argument("--sims", type=int, default=20000)
    parser.add_argument("--no-features", action="store_true", help="reuse cache/features")
    args = parser.parse_args()
    warnings.filterwarnings("ignore", category=RuntimeWarning)
    paths.ensure_dirs()
    started = time.time()
    if not args.no_features:
        table = feat.build_feature_table()
        table.to_parquet(paths.FEATURES_PATH, index=False)
    features = pd.read_parquet(paths.FEATURES_PATH)
    payload, fantasy_payload = run(features, args.stage, args.sims)
    export.write_json(paths.PREDICTIONS_DIR / "next.json", payload)
    if fantasy_payload is not None:
        export.write_json(paths.PREDICTIONS_DIR / "fantasy.json", fantasy_payload)
    race = payload["race"]
    print(f"{race['season']} R{race['round']} {race['raceName']} stage {race['stage']} "
          f"inputs {race['inputsUsed']} ({time.time() - started:.1f}s)")
    for driver in payload["drivers"][:10]:
        print(f"  {driver['code']}  E[pos] {driver['expectedPosition']:5.2f}  "
              f"win {driver['pWin']:.3f}  podium {driver['pPodium']:.3f}  "
              f"points {driver['pPoints']:.3f}  dnf {driver['pDnf']:.3f}")


def run(features: pd.DataFrame, stage: str | None, sims: int):
    history = History.load()
    trained, meta = load_latest()
    pending = features[features["y_finish"].isna()]
    if not len(pending):
        raise SystemExit("no upcoming race in the feature table")
    race_id = int(pending["raceId"].min())
    frame = features[features["raceId"] == race_id].reset_index(drop=True)
    available = feat.stage_available(frame)
    chosen = stage or available[-1]
    if chosen not in available:
        print(f"warning: stage {chosen} requested but inputs only allow {available}")
    if trained.cutoff <= int(features[features["y_finish"].notna()]["raceId"].max()):
        print("warning: model bundle is older than the latest results; run f1ml.train")
    season = race_id // 100
    round_number = race_id % 100
    extras = fantasy.fit_extras(race_id)
    standings = backtest.standings_before(history, frame, race_id)
    announced = penalties.load(race_id)
    for record in announced.itertuples(index=False):
        print(f"grid penalty: {record.driverId} {record.kind} {record.places} "
              f"({record.appliesTo}, {record.source})")
    result = forecast.forecast_race(trained, frame, chosen, extras, history=history,
                                    sims=sims, seed=race_id, standings=standings,
                                    announced=announced)
    points_calibration.calibrate_expected_points(result.summary, chosen, race_id)
    assets = export.AssetBook(season, round_number)
    backtest_block = backtest_summary_block()
    model_meta = {"version": meta["version"], "trainedAt": meta["trainedAt"],
                  "notes": model_notes(meta)}
    payload = export.race_payload(result, trained, model_meta, history, assets, backtest_block)
    horizon = fantasy_horizon(trained, history, result, assets, extras)
    rules = export.fantasy_rules_block()
    fantasy_payload = export.fantasy_payload(result, assets, rules, horizon, history)
    return payload, fantasy_payload


def load_latest():
    latest_path = paths.MODELS_DIR / "latest.json"
    if not latest_path.exists():
        raise SystemExit("no trained model: run `uv run python -m f1ml.train` first")
    latest = json.loads(latest_path.read_text(encoding="utf-8"))
    folder = paths.ML_DIR / latest["path"]
    trained = bundle_module.Bundle.load(folder / "bundle.pkl")
    meta = json.loads((folder / "meta.json").read_text(encoding="utf-8"))
    return trained, meta


def backtest_summary_block() -> dict:
    """The model.backtest block of next.json, from data/predictions/backtest.json."""
    path = paths.PREDICTIONS_DIR / "backtest.json"
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    stages = data["summary"]["stages"]
    baselines = data["summary"]["baselines"]
    published = stages["post-qualifying"]
    block = {
        "seasons": data["seasons"],
        "stage": "post-qualifying",
        "winnerAccuracy": round(published["winnerCorrect"], 4),
        "podiumHitRate": round(published["podiumHits"], 4),
        "spearman": round(published["spearman"], 4),
        "brier": round(published["brierWin"], 5),
        "logLossWin": round(published["logLossWin"], 4),
        "mae": round(published["mae"], 3),
        "baseline": {"name": "grid order", "spearman": round(baselines["grid"]["spearman"], 4),
                     "winnerAccuracy": round(baselines["grid"]["winnerCorrect"], 4),
                     "podiumHitRate": round(baselines["grid"]["podiumHits"], 4)},
        "byStage": {name: {"winnerAccuracy": round(values["winnerCorrect"], 4),
                           "podiumHitRate": round(values["podiumHits"], 4),
                           "spearman": round(values["spearman"], 4),
                           "brier": round(values["brierWin"], 5)}
                    for name, values in stages.items()},
        "otherBaselines": {name: {"spearman": round(baselines[name]["spearman"], 4),
                                  "winnerAccuracy": round(baselines[name]["winnerCorrect"], 4)}
                           for name in ("championship", "form3")},
    }
    return block


def model_notes(meta: dict) -> str:
    use_nn = meta.get("useNN", True)
    parts = "XGBoost (GPU) pairwise/LambdaRank rankers + DNF classifiers per stage"
    if use_nn:
        parts += " blended with a set transformer trained with a Plackett-Luce loss"
    return (f"{parts}; blend weights and temperature fitted on held out races; 20,000 GPU "
            f"Monte Carlo runs (Plackett-Luce with retirements). Trained through race "
            f"{meta['trainedThroughRaceId']}.")


def fantasy_horizon(trained, history, result, assets, extras) -> list[dict]:
    """Expected fantasy points and price changes for the next rounds after this race.

    Prices follow a chained simulation: this race's simulated points feed the price window of
    the next round, and so on, so the horizon price changes reflect the real 3-round rule.
    """
    frame = result.frame
    race_id = result.race_id
    season = race_id // 100
    entrants = frame[["driverId", "constructorId", "number"]]
    targets = [t for t in history.future_targets(race_id, entrants) if t.race_id > race_id]
    targets = targets[:HORIZON_ROUNDS]
    asset_keys = [("driver", d) for d in frame["driverId"]]
    asset_keys += [("constructor", t) for t in result.fantasy_sims.teams]
    current = np.concatenate([result.fantasy_sims.driver_points[:HORIZON_SIMS],
                              result.fantasy_sims.constructor_points[:HORIZON_SIMS]], axis=1)
    prices, windows = _price_state(assets, asset_keys, len(current))
    _, prices, windows = _advance_prices(prices, windows, current, season)
    horizon = []
    if not targets:
        return horizon
    future = history.features(targets)
    prediction = trained.predict(future, "pre-weekend")
    future = future.reset_index(drop=True)
    prediction = prediction.reset_index(drop=True)
    for target in targets:
        rows = future.index[future["raceId"] == target.race_id]
        race_frame = future.loc[rows].reset_index(drop=True)
        race_prediction = prediction.loc[rows].reset_index(drop=True)
        inputs = simulate.WeekendInputs(
            race_strength=race_prediction["race_strength"].to_numpy(),
            p_dnf=race_prediction["p_dnf"].to_numpy(),
            quali_strength=race_prediction["quali_strength"].to_numpy(),
            has_sprint=bool(race_frame["has_sprint"].iloc[0]),
            race_schedule=trained.schedule("pre-weekend", "race"),
            quali_schedule=trained.schedule("pre-weekend", "quali"),
        )
        weekend = simulate.simulate_weekend(inputs, sims=HORIZON_SIMS, seed=target.race_id)
        abs_change = float(race_frame["c_abs_change"].iloc[0])
        scored = fantasy.score_weekend(weekend, race_frame[["driverId", "constructorId"]],
                                       season, extras, abs_change, seed=target.race_id)
        points = np.concatenate([scored.driver_points, scored.constructor_points], axis=1)
        changes, prices, windows = _advance_prices(prices, windows, points, season)
        race = history.races.loc[target.race_id]
        expected_points = {}
        expected_change = {}
        for j, (kind, asset_id) in enumerate(asset_keys):
            expected_points[asset_id] = round(float(points[:, j].mean()), 2)
            column = changes[:, j]
            expected_change[asset_id] = None if np.isnan(column).all() else round(
                float(np.nanmean(column)), 3)
        horizon.append({"round": int(race["round"]), "raceName": race["raceName"],
                        "hasSprint": bool(race["hasSprint"]),
                        "expectedPoints": expected_points,
                        "expectedPriceChange": expected_change})
    return horizon


def _price_state(assets, asset_keys, sims: int):
    prices = np.full((sims, len(asset_keys)), np.nan)
    windows = np.full((sims, len(asset_keys), 2), np.nan)
    for j, (kind, asset_id) in enumerate(asset_keys):
        info = assets.lookup(kind, asset_id)
        if info is None:
            continue
        prices[:, j] = info["price"]
        previous = info["previous"][-2:]
        for k, value in enumerate(previous):
            windows[:, j, 2 - len(previous) + k] = value
    return prices, windows


def _advance_prices(prices, windows, points, season):
    changes = np.full(prices.shape, np.nan)
    new_prices = prices.copy()
    new_windows = windows.copy()
    for j in range(prices.shape[1]):
        if np.isnan(prices[0, j]):
            continue
        change, window = fantasy.price_path_step(prices[:, j], windows[:, j, :], points[:, j],
                                                 season)
        changes[:, j] = change
        new_prices[:, j] = np.round(prices[:, j] + change, 1)
        new_windows[:, j, :] = window
    return changes, new_prices, new_windows


if __name__ == "__main__":
    main()
