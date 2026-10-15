"""Cache the lock-stage simulation inputs of the walk-forward backtest, one season per run.

    uv run python -m scripts.exp_dispersion.cache --season 2026

Same schedule as `f1ml.backtest` (bundle retrained every 3 rounds on races before the round),
but only the team-lock forecast (post-practice on `forecast.lock_frame`) is built, and its
`WeekendInputs` are pickled to ml/reports/exp_dispersion/inputs/<raceId>.pkl so the fantasy
variants in `variants.py` can re-simulate and re-score without retraining.
"""

from __future__ import annotations

import argparse
import pickle
import time
import warnings

from f1ml import bundle as bundle_module
from f1ml import features as feat
from f1ml import forecast, paths, train

OUT_DIR = paths.ML_DIR / "reports" / "exp_dispersion" / "inputs"
STAGES_DIR = paths.ML_DIR / "reports" / "exp_dispersion" / "inputs_stages"
RETRAIN_EVERY = 3
STAGE = "post-practice"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--season", type=int, required=True)
    parser.add_argument("--all-stages", action="store_true",
                        help="also cache pre-weekend, post-practice and post-qualifying")
    args = parser.parse_args()
    warnings.filterwarnings("ignore", category=RuntimeWarning)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    STAGES_DIR.mkdir(parents=True, exist_ok=True)
    started = time.time()
    features = train.load_features()
    params = train.load_params()
    labelled = features[features["y_finish"].notna()]
    race_ids = sorted(labelled[labelled["season"] == args.season]["raceId"].unique())
    trained = None
    for index, race_id in enumerate(race_ids):
        if trained is None or index % RETRAIN_EVERY == 0:
            train_rows = labelled[labelled["raceId"] < race_id]
            trained = bundle_module.fit_bundle(train_rows, params, use_nn=True)
        cache_race(trained, features, int(race_id))
        if args.all_stages:
            cache_stages(trained, features, int(race_id))
        print(f"  {race_id} cached ({time.time() - started:.0f}s)", flush=True)
    print(f"season {args.season} done in {time.time() - started:.0f}s")


def cache_race(trained, features, race_id: int) -> None:
    frame = features[features["raceId"] == race_id].reset_index(drop=True)
    locked = forecast.lock_frame(frame)
    prediction = trained.predict(locked, STAGE)
    inputs = forecast.weekend_inputs(trained, locked, STAGE, prediction)
    entry = {
        "raceId": race_id,
        "inputs": inputs,
        "entrants": frame[["driverId", "constructorId"]].copy(),
        "absChange": float(frame["c_abs_change"].iloc[0]),
        "seed": race_id + 7,
    }
    target = OUT_DIR / f"{race_id}.pkl"
    with open(target, "wb") as handle:
        pickle.dump(entry, handle)


def cache_stages(trained, features, race_id: int) -> None:
    """Inputs of the three published stages (seed race_id, as in f1ml.backtest)."""
    frame = features[features["raceId"] == race_id].reset_index(drop=True)
    stages = {}
    for stage in feat.STAGES:
        prediction = trained.predict(frame, stage)
        stages[stage] = forecast.weekend_inputs(trained, frame, stage, prediction)
    entry = {
        "raceId": race_id,
        "stages": stages,
        "entrants": frame[["driverId", "constructorId"]].copy(),
        "absChange": float(frame["c_abs_change"].iloc[0]),
        "seed": race_id,
    }
    with open(STAGES_DIR / f"{race_id}.pkl", "wb") as handle:
        pickle.dump(entry, handle)


if __name__ == "__main__":
    main()
