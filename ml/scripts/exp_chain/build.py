"""Build a team-lock history from the chain cache, with or without the qualifying chain.

    uv run python -m scripts.exp_chain.build --name chain --build 2
    uv run python -m scripts.exp_chain.build --name base --no-chain --build 2

Build b re-simulates every race with seed race + 7 + b x 1,000,003 and, with the chain, uses the
chain cached for rebuild b (`scripts.exp_chain.cache`). Base and chain builds come from the same
cached inputs, so they differ only in the chain. Writes ml/reports/exp_chain/builds/<name>_b<b>/
(a copy of data/predictions/history with fantasyAtLock replaced), the input of
research/fantasy-backtest/evaluate.ts.
"""

from __future__ import annotations

import argparse
import json
import pickle
import shutil
import time

import numpy as np

from f1ml import export, fantasy, forecast, paths, simulate
from scripts.exp_chain import cache

BUILD_DIR = paths.ML_DIR / "reports" / "exp_chain" / "builds"
SIMS = 20000


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--name", required=True)
    parser.add_argument("--no-chain", action="store_true")
    parser.add_argument("--build", type=int, default=0)
    args = parser.parse_args()
    started = time.time()
    target = BUILD_DIR / f"{args.name}_b{args.build}"
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(paths.HISTORY_DIR, target)
    for path in sorted(cache.OUT_DIR.glob("*.pkl")):
        with open(path, "rb") as handle:
            entry = pickle.load(handle)
        build_race(entry, target, args)
    print(f"{target.name} built in {time.time() - started:.0f}s")


def build_race(entry: dict, target, args) -> None:
    race_id = entry["raceId"]
    season, round_number = race_id // 100, race_id % 100
    seed = int(np.int64(entry["seed"] + args.build * cache.SEED_STRIDE))
    extras = fantasy.fit_extras(race_id)
    inputs = entry["inputs"]
    weekend = simulate.simulate_weekend(inputs, sims=SIMS, seed=seed)
    if not args.no_chain:
        chain = entry["chains"][args.build]
        weekend = forecast.chained_weekend(chain, inputs, weekend, seed)
    sims = fantasy.score_weekend(weekend, entry["entrants"], season, extras, entry["absChange"],
                                 seed=seed)
    path = target / f"{season}-{round_number:02d}.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    lock = payload["fantasyAtLock"]
    assets = export.AssetBook(season, round_number)
    for i, driver_id in enumerate(entry["entrants"]["driverId"]):
        info = assets.lookup("driver", driver_id)
        lock["drivers"][driver_id] = export._fantasy_summary(sims.driver_points[:, i], info,
                                                             season)
    for t, team in enumerate(sims.teams):
        info = assets.lookup("constructor", team)
        lock["constructors"][team] = export._fantasy_summary(sims.constructor_points[:, t],
                                                             info, season)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                    encoding="utf-8")


if __name__ == "__main__":
    main()
