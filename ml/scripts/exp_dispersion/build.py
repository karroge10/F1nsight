"""Build a team-lock history from the cached inputs with a given sharpness rule and seed offset.

    uv run python -m scripts.exp_dispersion.build --name D --k 1.5 --from-season 2025 --build 2

k applies from --from-season on (earlier seasons k = 1); --k-constructor sets a separate
constructor k. Build b re-simulates every race with seed race + 7 + b x 1,000,003, so two builds
of the same variant differ only in simulation noise (the rebuild drift evaluate.ts measures).
Writes ml/reports/exp_dispersion/builds/<name>_b<build>/ (a copy of data/predictions/history
with fantasyAtLock replaced).
"""

from __future__ import annotations

import argparse
import json
import shutil
import time

import numpy as np

from f1ml import export, fantasy, paths, simulate
from scripts.exp_dispersion import variants as base_round

BUILD_DIR = base_round.EXP_DIR / "builds"
SEED_STRIDE = 1_000_003


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--name", required=True)
    parser.add_argument("--k", type=float, default=1.0)
    parser.add_argument("--k-constructor", type=float, default=None)
    parser.add_argument("--from-season", type=int, default=2025)
    parser.add_argument("--build", type=int, default=0)
    args = parser.parse_args()
    started = time.time()
    target = BUILD_DIR / f"{args.name}_b{args.build}"
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(paths.HISTORY_DIR, target)
    for entry in base_round.load_entries():
        build_race(entry, target, args)
    print(f"{target.name} built in {time.time() - started:.0f}s")


def build_race(entry: dict, target, args) -> None:
    race_id = entry["raceId"]
    season, round_number = race_id // 100, race_id % 100
    use = season >= args.from_season
    k_driver = args.k if use else 1.0
    k_constructor = (args.k_constructor or args.k) if use else 1.0
    seed = entry["seed"] + args.build * SEED_STRIDE
    extras = fantasy.fit_extras(race_id)
    driver_sims = score(entry, extras, k_driver, seed, season)
    team_sims = driver_sims if k_constructor == k_driver else score(entry, extras, k_constructor,
                                                                    seed, season)
    path = target / f"{season}-{round_number:02d}.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    lock = payload["fantasyAtLock"]
    assets = export.AssetBook(season, round_number)
    for i, driver_id in enumerate(entry["entrants"]["driverId"]):
        info = assets.lookup("driver", driver_id)
        lock["drivers"][driver_id] = export._fantasy_summary(driver_sims.driver_points[:, i], info,
                                                             season)
    for t, team in enumerate(team_sims.teams):
        info = assets.lookup("constructor", team)
        lock["constructors"][team] = export._fantasy_summary(team_sims.constructor_points[:, t],
                                                             info, season)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                    encoding="utf-8")


def score(entry: dict, extras, k: float, seed: int, season: int):
    inputs = base_round.sharpened(entry["inputs"], k)
    weekend = simulate.simulate_weekend(inputs, sims=base_round.SIMS, seed=int(np.int64(seed)))
    return fantasy.score_weekend(weekend, entry["entrants"], season, extras, entry["absChange"],
                                 seed=seed)


if __name__ == "__main__":
    main()
