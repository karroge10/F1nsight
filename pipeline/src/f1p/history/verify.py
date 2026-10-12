"""Sanity checks on the processed tables and the serve database; prints a short summary."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd

from f1p.history.corrections import SESSION_COLUMNS
from f1p.history.tables import ROUND_TABLES

PRACTICE_COLUMNS = ["fp1Utc", "fp2Utc", "fp3Utc"]
# Knockout qualifying (2006+): at most 10 cars reach Q3 and at most 17 reach Q2 (24 car grids
# of 2010 to 2012). More timed rows than that means a car was put in the wrong segment.
MAX_Q3_TIMES = 10
MAX_Q2_TIMES = 17

FACT_CHECKS = [
    ("Hamilton wins through 2024 = 105",
     "select count(*) from results where driverId = 'hamilton' and position = 1 "
     "and season <= 2024", 105),
    ("Hamilton poles through 2024 = 104",
     "select count(*) from race_poles where driverId = 'hamilton' and season <= 2024", 104),
    ("Verstappen poles through 2024 = 40",
     "select count(*) from race_poles where driverId = 'max_verstappen' and season <= 2024",
     40),
    ("Magnussen poles = 1 (2022 Brazil sprint weekend)",
     "select poles from driver_career where driverId = 'kevin_magnussen'", 1),
    ("Verstappen 2023 wins = 19",
     "select count(*) from results where driverId = 'max_verstappen' and position = 1 "
     "and season = 2023", 19),
    ("Verstappen 2023 points = 575",
     "select points from driver_standings where driverId = 'max_verstappen' and season = 2023 "
     "order by round desc limit 1", 575),
    ("1950 British GP winner = farina",
     "select driverId from results where season = 1950 and round = 1 and position = 1",
     "farina"),
    ("Schumacher wins = 91",
     "select wins from driver_career where driverId = 'michael_schumacher'", 91),
    ("Hamilton titles = 7", "select titles from driver_career where driverId = 'hamilton'", 7),
    ("Schumacher fastest laps = 77 (pre-2004 part from F1DB)",
     "select fastestLaps from driver_career where driverId = 'michael_schumacher'", 77),
    ("Hamilton fastest laps through 2024 = 67",
     "select count(distinct raceId) from results where driverId = 'hamilton' "
     "and fastestLapRank = 1 and season <= 2024", 67),
    ("finished races without qualifying rows = 0",
     "select count(*) from races r where r.hasResults = 1 "
     "and not exists (select 1 from qualifying q where q.raceId = r.raceId)", 0),
    ("Ferrari constructors titles through 2024 = 16",
     "select count(*) from season_final_constructor_standings where constructorId = 'ferrari' "
     "and position = 1 and isComplete = 1 and season <= 2024", 16),
    ("2026 teams with a race start = 11",
     "select count(distinct constructorId) from results where season = 2026", 11),
    ("2026 includes cadillac and audi",
     "select count(distinct constructorId) from results where season = 2026 "
     "and constructorId in ('cadillac', 'audi')", 2),
    ("all seasons before the current one complete",
     "select count(*) from season_summary where isComplete = 0 "
     "and season < (select season from v_current_season)", 0),
]


def verify(tables: dict[str, pd.DataFrame], db_path: Path) -> list[str]:
    """Run every check, print the summary and return the list of failures."""
    failures: list[str] = []
    _print_decade_counts(tables)
    failures += _check_integrity(tables)
    failures += _check_duplicates(tables)
    failures += _check_session_times(tables["races"])
    failures += _check_qualifying_segments(tables["qualifying"])
    failures += _check_facts(db_path)
    _print_coverage(tables)
    if failures:
        print(f"\nVERIFY: {len(failures)} problem(s)")
        for failure in failures:
            print(f"  - {failure}")
    else:
        print("\nVERIFY: all checks passed")
    return failures


def coverage(tables: dict[str, pd.DataFrame]) -> dict[str, dict]:
    """Per round table: first/last season, rows, races with data."""
    info = {}
    for name in [*ROUND_TABLES, "races"]:
        frame = tables[name]
        info[name] = {
            "rows": len(frame),
            "firstSeason": int(frame["season"].min()),
            "lastSeason": int(frame["season"].max()),
            "races": int(frame["raceId"].nunique()),
            "lastRaceId": int(frame["raceId"].max()),
        }
    return info


def _print_decade_counts(tables: dict[str, pd.DataFrame]) -> None:
    names = ["races", *ROUND_TABLES]
    columns = {}
    for name in names:
        frame = tables[name]
        decades = (frame["season"] // 10 * 10).astype(int)
        columns[name] = decades.value_counts().sort_index()
    summary = pd.DataFrame(columns).fillna(0).astype(int)
    summary.index.name = "decade"
    print("\nRows per table per decade:")
    summary_text = summary.to_string()
    print(summary_text)
    entity_counts = {name: len(tables[name]) for name in
                     ("seasons", "circuits", "drivers", "constructors", "season_entries",
                      "status")}
    print("Entity tables:", ", ".join(f"{name}={count}" for name, count in entity_counts.items()))


def _check_integrity(tables: dict[str, pd.DataFrame]) -> list[str]:
    failures = []
    race_ids = set(tables["races"]["raceId"])
    driver_ids = set(tables["drivers"]["driverId"])
    constructor_ids = set(tables["constructors"]["constructorId"])
    circuit_ids = set(tables["circuits"]["circuitId"])
    for name in ROUND_TABLES:
        frame = tables[name]
        failures += _missing(name, "raceId", frame["raceId"], race_ids)
        if "driverId" in frame:
            failures += _missing(name, "driverId", frame["driverId"], driver_ids)
        if "constructorId" in frame:
            failures += _missing(name, "constructorId", frame["constructorId"], constructor_ids)
    failures += _missing("races", "circuitId", tables["races"]["circuitId"], circuit_ids)
    entries = tables["season_entries"]
    failures += _missing("season_entries", "driverId", entries["driverId"], driver_ids)
    print(f"\nReferential integrity: {'ok' if not failures else 'FAILED'}")
    return failures


def _check_duplicates(tables: dict[str, pd.DataFrame]) -> list[str]:
    failures = []
    for name, key in ROUND_TABLES.items():
        duplicated = tables[name].duplicated(key).sum()
        if duplicated:
            failures.append(f"{name}: {duplicated} duplicate rows on {key}")
    for name in ("results", "sprint_results", "qualifying"):
        failures += _check_driver_duplicates(name, tables[name])
    return failures


def _check_driver_duplicates(name: str, frame: pd.DataFrame) -> list[str]:
    """(season, round, driverId) repeats only for 1950s/60s drivers who used two cars."""
    shared = frame[frame.duplicated(["season", "round", "driverId"], keep=False)]
    if shared.empty:
        print(f"Duplicate (season, round, driverId) in {name}: none")
        return []
    seasons = sorted(shared["season"].unique().tolist())
    print(f"Duplicate (season, round, driverId) in {name}: {len(shared)} rows, drivers in two "
          f"cars, seasons {seasons[0]} to {seasons[-1]} (unique with car number)")
    modern = shared[shared["season"] >= 1970]
    if modern.empty:
        return []
    return [f"{name}: {len(modern)} duplicate (season, round, driverId) rows after 1970"]


def _check_session_times(races: pd.DataFrame) -> list[str]:
    """Session order and local weekday plausibility for every round with session times.

    In local time at the circuit: the race is on a Saturday or Sunday; qualifying is on race
    day or the day before (up to two days before on sprint weekends) and, without a sprint,
    at most 30 hours before the race; FP1 opens the weekend, practice runs in order, every
    session starts before the race and none starts between 02:00 and 07:00 (rain delayed 2024
    Sao Paulo qualifying ran at 07:30). Catches the date line slips seen at Las Vegas and
    wrong timezones.
    """
    problems = []
    timed = races[races["raceUtc"].notna() & races["timezone"].notna()]
    for race in timed.itertuples(index=False):
        issues = _session_issues(race)
        if issues:
            problems.append(f"races {race.raceId} {race.raceName}: {'; '.join(issues)}")
    print(f"Session times plausible: {len(timed) - len(problems)} of {len(timed)} rounds")
    return problems


def _check_qualifying_segments(qualifying: pd.DataFrame) -> list[str]:
    knockout = qualifying[qualifying["season"] >= 2006]
    counts = knockout.groupby("raceId")[["q2Ms", "q3Ms"]].count()
    too_many = counts[(counts["q3Ms"] > MAX_Q3_TIMES) | (counts["q2Ms"] > MAX_Q2_TIMES)]
    print(f"Qualifying segment sizes: {len(too_many)} races over the limits")
    return [f"qualifying {race_id}: {row.q2Ms} Q2 times, {row.q3Ms} Q3 times"
            for race_id, row in too_many.iterrows()]


def _session_issues(race) -> list[str]:
    zone = ZoneInfo(race.timezone)
    local = {}
    for column in SESSION_COLUMNS:
        value = getattr(race, column)
        if pd.notna(value):
            local[column] = _to_local(value, zone)
    race_start = local["raceUtc"]
    issues = []
    if race_start.weekday() not in (5, 6):
        issues.append(f"race on a {race_start:%A}")
    issues += _qualifying_issues(local, race_start, bool(race.hasSprint))
    for column, start in local.items():
        if column != "raceUtc" and start >= race_start:
            issues.append(f"{column} not before the race")
        if 2 <= start.hour < 7:
            issues.append(f"{column} at {start:%H:%M} local")
    first_session = min(local.values())
    if "fp1Utc" in local and local["fp1Utc"] != first_session:
        issues.append("FP1 is not the first session")
    practice = [local[column] for column in PRACTICE_COLUMNS if column in local]
    if practice != sorted(practice):
        issues.append("practice sessions out of order")
    return issues


def _qualifying_issues(local: dict, race_start: pd.Timestamp, has_sprint: bool) -> list[str]:
    qualifying = local.get("qualifyingUtc")
    if qualifying is None:
        return []
    issues = []
    days_before = (race_start.date() - qualifying.date()).days
    allowed_days = (0, 1, 2) if has_sprint else (0, 1)
    if days_before not in allowed_days:
        issues.append(f"qualifying {days_before} days before the race")
    hours_before = (race_start - qualifying).total_seconds() / 3600
    if not has_sprint and hours_before > 30:
        issues.append(f"qualifying {hours_before:.0f} hours before the race")
    return issues


def _to_local(utc_value, zone: ZoneInfo) -> pd.Timestamp:
    start = pd.Timestamp(utc_value).tz_localize("UTC")
    return start.tz_convert(zone)


def _check_facts(db_path: Path) -> list[str]:
    failures = []
    con = sqlite3.connect(db_path)
    print("\nFact checks:")
    for label, sql, expected in FACT_CHECKS:
        row = con.execute(sql).fetchone()
        actual = row[0] if row else None
        is_ok = actual == expected
        print(f"  [{'ok' if is_ok else 'FAIL'}] {label} (got {actual})")
        if not is_ok:
            failures.append(f"fact check failed: {label}, got {actual}")
    con.close()
    return failures


def _print_coverage(tables: dict[str, pd.DataFrame]) -> None:
    print("\nCoverage:")
    for name, info in coverage(tables).items():
        print(f"  {name}: {info['firstSeason']}-{info['lastSeason']}, {info['rows']} rows, "
              f"{info['races']} races, last raceId {info['lastRaceId']}")


def _missing(table: str, column: str, values: pd.Series, known: set) -> list[str]:
    unknown = set(values.dropna()) - known
    if not unknown:
        return []
    sample = sorted(unknown)[:5]
    return [f"{table}.{column}: {len(unknown)} unknown ids, e.g. {sample}"]
