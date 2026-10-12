"""When to refresh during a race weekend: one run after each session plus a retry later.

    uv run python -m f1p.weekend                    # next race weekend, as a table
    uv run python -m f1p.weekend --json             # same, for scripts/schedule-weekend.ps1
    uv run python -m f1p.weekend --season 2026 --round 17

Session start times come from data/processed/races.parquet (Jolpica schedule). A refresh runs
REFRESH_AFTER_END after the session's nominal end, which is when the free sources (static live
timing archive for FastF1, OpenF1 history, Jolpica) normally have it, and again RETRY_AFTER later
for whatever was still missing. One more run, RaceMorning, comes RACE_MORNING_BEFORE the race
start: grid penalties announced overnight and the final grid are in the forecast before the race.
Keep these in step with f1p.fastf1.incremental.SESSION_LENGTH:
the first run must come after that module's "ended" time.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone

import pandas as pd

from f1p.paths import PROCESSED_DIR

# column, short task label, nominal length
SESSIONS = [
    ("fp1Utc", "FP1", timedelta(minutes=60)),
    ("fp2Utc", "FP2", timedelta(minutes=60)),
    ("fp3Utc", "FP3", timedelta(minutes=60)),
    ("sprintQualifyingUtc", "SQ", timedelta(minutes=45)),
    ("sprintUtc", "Sprint", timedelta(minutes=60)),
    ("qualifyingUtc", "Quali", timedelta(minutes=60)),
    ("raceUtc", "Race", timedelta(minutes=120)),
]
REFRESH_AFTER_END = {"Race": timedelta(minutes=75)}
DEFAULT_AFTER_END = timedelta(minutes=60)
RETRY_AFTER = timedelta(hours=3)
RACE_MORNING_BEFORE = timedelta(hours=3)
TASK_PREFIX = "F1nsight-refresh-"


def main() -> int:
    args = _parse_args()
    now = datetime.now(timezone.utc)
    race = find_race(args.season, args.round, now)
    if race is None:
        print("no upcoming race in data/processed/races.parquet", file=sys.stderr)
        return 1
    plan = refresh_plan(race)
    if args.json:
        text = json.dumps(plan, indent=1)
        print(text)
        return 0
    print(f"{plan['season']} R{plan['round']} {plan['raceName']}")
    for task in plan["tasks"]:
        print(f"  {task['name']:32s} {task['runAtUtc']} UTC  {task['runAtLocal']} local  ({task['note']})")
    return 0


def find_race(season: int | None, round_number: int | None, now: datetime) -> pd.Series | None:
    """The requested race, or the first race whose last session has not been refreshed yet."""
    races = pd.read_parquet(PROCESSED_DIR / "races.parquet")
    if season and round_number:
        match = races[(races["season"] == season) & (races["round"] == round_number)]
        return None if match.empty else match.iloc[0]
    cutoff = now.replace(tzinfo=None) - timedelta(hours=6)
    upcoming = races[races["raceUtc"] > cutoff].sort_values("raceUtc")
    return None if upcoming.empty else upcoming.iloc[0]


def refresh_plan(race: pd.Series) -> dict:
    tasks = []
    for column, label, length in SESSIONS:
        start = race.get(column)
        if start is None or pd.isna(start):
            continue
        start_utc = start.to_pydatetime().replace(tzinfo=timezone.utc)
        end_utc = start_utc + length
        first = end_utc + REFRESH_AFTER_END.get(label, DEFAULT_AFTER_END)
        retry = first + RETRY_AFTER
        end_text = end_utc.strftime("%H:%M")
        first_task = _task(f"{TASK_PREFIX}{label}", first, f"{label} ends about {end_text} UTC")
        retry_task = _task(f"{TASK_PREFIX}{label}-retry", retry, f"retry for {label}")
        tasks.extend([first_task, retry_task])
    race_start = race.get("raceUtc")
    if race_start is not None and not pd.isna(race_start):
        start_utc = race_start.to_pydatetime().replace(tzinfo=timezone.utc)
        morning = start_utc - RACE_MORNING_BEFORE
        start_text = start_utc.strftime("%H:%M")
        morning_task = _task(f"{TASK_PREFIX}RaceMorning", morning,
                             f"race day, race starts {start_text} UTC: late grid penalties")
        tasks.append(morning_task)
    tasks.sort(key=lambda task: task["runAtIso"])
    return {
        "season": int(race["season"]),
        "round": int(race["round"]),
        "raceName": str(race["raceName"]),
        "tasks": tasks,
    }


def _task(name: str, run_at: datetime, note: str) -> dict:
    local = run_at.astimezone()
    return {
        "name": name,
        "runAtUtc": run_at.strftime("%Y-%m-%d %H:%M"),
        "runAtLocal": local.strftime("%Y-%m-%d %H:%M"),
        "runAtIso": run_at.isoformat(),
        "note": note,
    }


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--season", type=int)
    parser.add_argument("--round", type=int)
    parser.add_argument("--json", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    sys.exit(main())
