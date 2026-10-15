"""Cache the team-lock inputs and qualifying chains of the walk-forward backtest, one season
per run (round 8 of research/fantasy-model-log.md).

    uv run python -m scripts.exp_chain.cache --season 2026

Same schedule as `f1ml.backtest` (bundle retrained every 3 rounds on races before the round).
Per race: the lock forecast's `WeekendInputs` (as `scripts.exp_dispersion.cache`) and one
`forecast.RaceChain` per rebuild, its qualifying orders drawn with that rebuild's seed, so the
rebuilds of `scripts.exp_chain.build` carry the chain's sampling noise too. Written to
ml/reports/exp_chain/inputs/<raceId>.pkl.
"""

from __future__ import annotations

import argparse
import pickle
import time
import warnings

from f1ml import bundle as bundle_module
from f1ml import forecast, paths, train

OUT_DIR = paths.ML_DIR / "reports" / "exp_chain" / "inputs"
RETRAIN_EVERY = 3
STAGE = "post-practice"
BUILDS = 8
SEED_STRIDE = 1_000_003


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--season", type=int, required=True)
    args = parser.parse_args()
    warnings.filterwarnings("ignore", category=RuntimeWarning)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
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
        print(f"  {race_id} cached ({time.time() - started:.0f}s)", flush=True)
    print(f"season {args.season} done in {time.time() - started:.0f}s")


def cache_race(trained, features, race_id: int) -> None:
    frame = features[features["raceId"] == race_id].reset_index(drop=True)
    locked = forecast.lock_frame(frame)
    prediction = trained.predict(locked, STAGE)
    inputs = forecast.weekend_inputs(trained, locked, STAGE, prediction)
    seed = race_id + 7
    chains = []
    for build in range(BUILDS):
        build_seed = seed + build * SEED_STRIDE
        chain = forecast.race_chain(trained, locked, STAGE, inputs, build_seed)
        chains.append(chain)
    entry = {
        "raceId": race_id,
        "inputs": inputs,
        "chains": chains,
        "entrants": frame[["driverId", "constructorId"]].copy(),
        "absChange": float(frame["c_abs_change"].iloc[0]),
        "seed": seed,
    }
    target = OUT_DIR / f"{race_id}.pkl"
    with open(target, "wb") as handle:
        pickle.dump(entry, handle)


if __name__ == "__main__":
    main()
