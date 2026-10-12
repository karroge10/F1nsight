"""When to refresh during a race weekend: one run after each session plus a retry later.

    uv run python -m f1p.weekend                    # next race weekend, as a table
    uv run python -m f1p.weekend --json             # same, for scripts/schedule-weekend.ps1
    uv run python -m f1p.weekend --season 2026 --round 17
    uv run python -m f1p.weekend --due              # the cloud refresh's gate, see due_runs

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

from f1p.paths import PROCESSED_DIR, V2_DIR

STATE_PATH = V2_DIR / "logs" / "refresh_state.json"

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
# The weekly forced refresh: Monday 06:00 UTC, the PC task's Monday 10:00 at UTC+4.
WEEKLY_WEEKDAY = 0
WEEKLY_HOUR_UTC = 6
FIRST_CHECK_LOOKBACK = timedelta(hours=1)


def main() -> int:
    args = _parse_args()
    now = datetime.now(timezone.utc)
    if args.due:
        return print_due(now)
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


def print_due(now: datetime) -> int:
    """Gate for the scheduled cloud refresh: which planned runs fell due since the last check.

    Prints one JSON line {"due": [...], "force": bool}. The check time is kept in
    logs/refresh_state.json and only moves forward when something was due, so a cloud run that
    dies before saving its state is simply due again on the next check.
    """
    state = _read_state()
    cloud = state.setdefault("cloud", {})
    checked = cloud.get("checkedThrough")
    since = datetime.fromisoformat(checked) if checked else now - FIRST_CHECK_LOOKBACK
    due = due_runs(since, now)
    force = any(task["name"] == f"{TASK_PREFIX}weekly" for task in due)
    if due:
        cloud["checkedThrough"] = now.isoformat(timespec="seconds")
        _write_state(state)
    names = [task["name"] for task in due]
    payload = {"since": since.isoformat(timespec="seconds"), "due": names, "force": force}
    print(json.dumps(payload))
    return 0


def due_runs(since: datetime, now: datetime) -> list[dict]:
    """Planned refreshes (the same plan the PC tasks follow, plus the weekly one) in (since, now]."""
    races = pd.read_parquet(PROCESSED_DIR / "races.parquet")
    # Every planned run of a race lies within about three days before and one day after its start.
    low = since.replace(tzinfo=None) - timedelta(days=1)
    high = now.replace(tzinfo=None) + timedelta(days=4)
    nearby = races[(races["raceUtc"] > low) & (races["raceUtc"] < high)]
    due = []
    for _, race in nearby.iterrows():
        plan = refresh_plan(race)
        for task in plan["tasks"]:
            run_at = datetime.fromisoformat(task["runAtIso"])
            if since < run_at <= now:
                due.append(task)
    weekly = _last_weekly_run(now)
    if since < weekly <= now:
        weekly_task = _task(f"{TASK_PREFIX}weekly", weekly, "weekly forced refresh")
        due.append(weekly_task)
    return due


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


def _last_weekly_run(now: datetime) -> datetime:
    days_back = (now.weekday() - WEEKLY_WEEKDAY) % 7
    day = now - timedelta(days=days_back)
    run_at = day.replace(hour=WEEKLY_HOUR_UTC, minute=0, second=0, microsecond=0)
    if run_at > now:
        run_at = run_at - timedelta(days=7)
    return run_at


def _read_state() -> dict:
    if not STATE_PATH.exists():
        return {}
    text = STATE_PATH.read_text(encoding="utf-8")
    return json.loads(text)


def _write_state(state: dict) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(state, indent=1)
    STATE_PATH.write_text(text, encoding="utf-8")


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--season", type=int)
    parser.add_argument("--round", type=int)
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--due", action="store_true",
                        help="print the planned runs due since the last check (cloud refresh gate)")
    return parser.parse_args()


if __name__ == "__main__":
    sys.exit(main())
