"""Documented corrections for known errors in the Jolpica race calendar.

Applied to the processed `races` table after the dump and the live API schedule are merged, so
both sources get the same fix. Every correction prints a note when the source already carries
the corrected value; once a fix has reported that for both the dump and the API it can be
dropped from this file.

All times are UTC. Sources for the corrected values: the official F1 timetable, cross-checked
against F1DB (`races.csv`, session times since 2024) and FastF1's event schedule
(`data/raw/fastf1/<season>/expected.json`).
"""

from __future__ import annotations

from zoneinfo import ZoneInfo

import pandas as pd

SESSION_COLUMNS = ["fp1Utc", "fp2Utc", "fp3Utc", "qualifyingUtc", "sprintQualifyingUtc",
                   "sprintUtc", "raceUtc"]

# raceId -> corrected columns. Session times are UTC, `timezone` is an IANA name.
RACE_FIXES: dict[int, dict[str, str]] = {
    # 2023 Las Vegas: the dump has FP1 to qualifying one day early (it took the local US date
    # with the UTC clock). FP1 was Thu 16 Nov 20:30 PST, qualifying Fri 17 Nov 24:00 PST.
    202321: {
        "fp1Utc": "2023-11-17 04:30", "fp2Utc": "2023-11-17 08:00",
        "fp3Utc": "2023-11-18 04:30", "qualifyingUtc": "2023-11-18 08:00",
    },
    # 2024 Las Vegas: every session one day early in the dump (race was Sat 23 Nov 22:00 PST).
    202422: {
        "fp1Utc": "2024-11-22 02:30", "fp2Utc": "2024-11-22 06:00",
        "fp3Utc": "2024-11-23 02:30", "qualifyingUtc": "2024-11-23 06:00",
        "raceUtc": "2024-11-24 06:00",
    },
    # 2024 Sao Paulo: rain moved qualifying to Sunday 07:30 local and the race forward to
    # 12:30 local; the dump keeps the original Saturday 15:00 / Sunday 14:00 timetable.
    202421: {"qualifyingUtc": "2024-11-03 10:30", "raceUtc": "2024-11-03 15:30"},
    # 2026 Miami: the race was brought forward three hours (storm forecast) to 13:00 EDT.
    202604: {"raceUtc": "2026-05-03 17:00"},
    # 2026 Monaco: the dump tags the race session with America/New_York.
    202606: {"timezone": "Europe/Monaco"},
}

# Seasons whose race start is stored as the local wall clock with a UTC label (2005 Australia
# reads 14:00 UTC, which is 01:00 Monday in Melbourne). The anchor race and its true UTC start
# tell whether the source has been fixed upstream.
LOCAL_CLOCK_SEASONS: dict[int, tuple[int, str]] = {
    2005: (200501, "2005-03-06 03:00"),
    2006: (200601, "2006-03-12 11:30"),
}


def apply_race_fixes(races: pd.DataFrame) -> pd.DataFrame:
    """Return `races` with the documented corrections applied; prints one line per fix."""
    fixed = races.copy()
    touched: set[int] = set()
    for season, (anchor_id, anchor_utc) in LOCAL_CLOCK_SEASONS.items():
        season_ids = _fix_local_clock_season(fixed, season, anchor_id, anchor_utc)
        touched |= season_ids
    for race_id, values in RACE_FIXES.items():
        if _fix_race(fixed, race_id, values):
            touched.add(race_id)
    _refresh_race_date_and_time(fixed, touched)
    return fixed


def _fix_local_clock_season(races: pd.DataFrame, season: int, anchor_id: int,
                            anchor_utc: str) -> set[int]:
    anchor = races.loc[races["raceId"] == anchor_id, "raceUtc"]
    anchor_value = pd.Timestamp(anchor_utc)
    if anchor.empty or pd.to_datetime(anchor.iloc[0]) == anchor_value:
        print(f"  race time fix {season} local clock: source already matches, drop the fix")
        return set()
    rows = races.index[(races["season"] == season) & races["raceUtc"].notna()]
    for index in rows:
        local_clock = pd.to_datetime(races.at[index, "raceUtc"])
        zone = ZoneInfo(races.at[index, "timezone"])
        races.at[index, "raceUtc"] = _local_to_utc(local_clock, zone)
    print(f"  race time fix {season}: {len(rows)} race starts read as local time")
    return set(races.loc[rows, "raceId"])


def _fix_race(races: pd.DataFrame, race_id: int, values: dict[str, str]) -> bool:
    rows = races.index[races["raceId"] == race_id]
    if rows.empty:
        return False
    index = rows[0]
    changed = []
    for column, value in values.items():
        corrected = value if column == "timezone" else pd.Timestamp(value)
        current = races.at[index, column]
        if column != "timezone":
            current = pd.to_datetime(current)
        if current == corrected:
            print(f"  race fix {race_id} {column}: source already matches, drop the fix")
            continue
        races.at[index, column] = corrected
        changed.append(column)
    if changed:
        print(f"  race fix {race_id}: {', '.join(changed)}")
    return bool(changed)


def _refresh_race_date_and_time(races: pd.DataFrame, race_ids: set[int]) -> None:
    """Keep `date` (UTC date of the start) and `time` in line with a corrected raceUtc."""
    rows = races.index[races["raceId"].isin(race_ids) & races["raceUtc"].notna()]
    for index in rows:
        start = pd.to_datetime(races.at[index, "raceUtc"])
        races.at[index, "date"] = start.normalize()
        races.at[index, "time"] = start.strftime("%H:%M:%S")


def _local_to_utc(local_clock: pd.Timestamp, zone: ZoneInfo) -> pd.Timestamp:
    localized = local_clock.tz_localize(zone)
    in_utc = localized.tz_convert("UTC")
    return in_utc.tz_localize(None)
