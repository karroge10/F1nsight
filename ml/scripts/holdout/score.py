"""Score the 2026 holdout (round 17 Singapore onward) once, after the season.

    uv run python scripts/holdout/score.py              # check, two backtests, scorecard
    uv run python scripts/holdout/score.py --dry-run    # check and print the commands only

Refuses to run while any holdout race on the calendar lacks results in the core data or labels
in the feature cache (rebuild with `uv run python -m f1ml.features`). Runs the walk-forward
backtest on the holdout races only, twice: label `holdout` with the published method
(F1ML_CHAIN=1 F1ML_GRIDTERM=1) and label `holdout_baseline` with the method before the
qualifying chain (F1ML_CHAIN=0 F1ML_GRIDTERM=0). Then writes
`ml/reports/scorecard/holdout.{json,md}` with the paired comparison.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

import pandas as pd

ML_DIR = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ML_DIR))

from f1ml import data, paths  # noqa: E402

SEASON = 2026
FIRST_RACE = 202617
RUNS = (
    ("holdout_baseline", {"F1ML_CHAIN": "0", "F1ML_GRIDTERM": "0"}),
    ("holdout", {"F1ML_CHAIN": "1", "F1ML_GRIDTERM": "1"}),
)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="check and print commands only")
    parser.add_argument("--sims", type=int, default=20000)
    args = parser.parse_args()
    missing = missing_holdout_races()
    if missing:
        print("holdout not complete, refusing to score. Races without results or labels:")
        for race_id, reason in missing:
            print(f"  {race_id}: {reason}")
        sys.exit(1)
    commands = build_commands(args.sims)
    for env, command in commands:
        flags = " ".join(f"{key}={value}" for key, value in env.items())
        print(f"{flags} {' '.join(command)}".strip())
    if args.dry_run:
        return
    for env, command in commands:
        run_env = dict(os.environ)
        run_env.update(env)
        subprocess.run(command, env=run_env, cwd=ML_DIR, check=True)


def missing_holdout_races() -> list[tuple[int, str]]:
    """Holdout races on the calendar with no race results or no labelled feature rows."""
    core = data.load_core()
    races = core["races"]
    holdout = races[(races["season"] == SEASON) & (races["raceId"] >= FIRST_RACE)]
    with_results = set(core["results"]["raceId"].unique())
    labelled = labelled_race_ids()
    missing = []
    for race_id in sorted(holdout["raceId"]):
        if race_id not in with_results:
            missing.append((int(race_id), "no race results"))
        elif race_id not in labelled:
            missing.append((int(race_id), "not labelled in the feature cache, run f1ml.features"))
    return missing


def build_commands(sims: int) -> list[tuple[dict, list[str]]]:
    backtest = [sys.executable, "-m", "f1ml.backtest", "--seasons", str(SEASON),
                "--first-race", str(FIRST_RACE), "--sims", str(sims)]
    commands = [(env, backtest + ["--label", label]) for label, env in RUNS]
    scorecard = [sys.executable, "-m", "f1ml.scorecard", "holdout", "--against",
                 "holdout_baseline"]
    commands.append(({}, scorecard))
    return commands


def labelled_race_ids() -> set:
    if not paths.FEATURES_PATH.exists():
        return set()
    features = pd.read_parquet(paths.FEATURES_PATH, columns=["raceId", "y_finish"])
    return set(features.loc[features["y_finish"].notna(), "raceId"].unique())


if __name__ == "__main__":
    main()
