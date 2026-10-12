"""Grid penalties from race control messages (fallback when the FIA documents have nothing).

Race control sometimes posts stewards' grid decisions, e.g.
"FIA STEWARDS: 5 PLACE GRID PENALTY FOR CAR 3 (VER) - CAUSING A COLLISION". Messages come from
three places, whichever has the weekend first: the FastF1 table (ff1_race_control), the OpenF1
table (openf1_race_control) and the raw live timing archive (RaceControlMessages.jsonStream).
Messages about investigations, notes or reviews never count.
"""

from __future__ import annotations

import json
import re
from datetime import timedelta

import pandas as pd

from f1p.paths import PROCESSED_DIR, RAW_DIR

IGNORE = re.compile(r"UNDER INVESTIGATION|NOTED|NO FURTHER|WILL BE INVESTIGATED|REVIEWED|SUMMON")
PLACES = re.compile(r"(\d+)\s*-?\s*PLACE GRID (?:PENALTY|DROP)\b[^.]*?\bCARS?\s+(\d+)")
PIT_LANE = re.compile(r"(?:PIT ?LANE START|START\w*\b[^.]{0,30}?FROM THE PIT ?LANE)")
BACK_OF_GRID = re.compile(r"BACK OF THE GRID")
CAR = re.compile(r"\bCARS?\s+(\d+)")
WEEKEND_BEFORE_RACE = timedelta(days=4)
AFTER_RACE = timedelta(hours=8)
COLUMNS = ["season", "round", "session", "timeUtc", "message"]


def weekend_messages(races: pd.DataFrame, season: int, round_number: int) -> pd.DataFrame:
    """Every known race control message of one weekend (session "R" marks the race)."""
    race = races[(races["season"] == season) & (races["round"] == round_number)].iloc[0]
    fastf1 = _fastf1_messages(season, round_number)
    openf1 = _openf1_messages(race)
    archive = _archive_messages(race)
    combined = pd.concat([fastf1, openf1, archive], ignore_index=True)
    if not len(combined):
        return pd.DataFrame(columns=COLUMNS)
    combined["message"] = combined["message"].astype(str).str.upper().str.strip()
    return combined.drop_duplicates(["session", "message"]).reset_index(drop=True)


def parse_message(message: str) -> dict | None:
    """{carNumber, kind, places, appliesTo} for a grid penalty message, else None."""
    text = message.upper()
    about_grid = "GRID" in text or "PIT LANE" in text or "PITLANE" in text
    if IGNORE.search(text) or not about_grid:
        return None
    applies_to = "sprint" if re.search(r"\bSPRINT\b(?! (?:QUALIFYING|SHOOTOUT))", text) else "race"
    places = PLACES.search(text)
    if places:
        return {"carNumber": int(places.group(2)), "kind": "places",
                "places": int(places.group(1)), "appliesTo": applies_to}
    car = CAR.search(text)
    if car is None:
        return None
    if PIT_LANE.search(text):
        return {"carNumber": int(car.group(1)), "kind": "pit_lane", "places": None,
                "appliesTo": applies_to}
    if BACK_OF_GRID.search(text):
        return {"carNumber": int(car.group(1)), "kind": "back_of_grid", "places": None,
                "appliesTo": applies_to}
    return None


# ----------------------------------------------------------------------------------------------
# helpers


def _fastf1_messages(season: int, round_number: int) -> pd.DataFrame:
    path = PROCESSED_DIR / "ff1_race_control.parquet"
    if not path.exists():
        return pd.DataFrame(columns=COLUMNS)
    table = pd.read_parquet(path, columns=COLUMNS)
    rows = table[(table["season"] == season) & (table["round"] == round_number)]
    return rows[COLUMNS]


def _openf1_messages(race: pd.Series) -> pd.DataFrame:
    path = PROCESSED_DIR / "openf1_race_control.parquet"
    if not path.exists():
        return pd.DataFrame(columns=COLUMNS)
    table = pd.read_parquet(path, columns=["date", "session_name", "message"])
    times = pd.to_datetime(table["date"], utc=True).dt.tz_localize(None)
    race_utc = pd.Timestamp(race["raceUtc"])
    inside = (times >= race_utc - WEEKEND_BEFORE_RACE) & (times <= race_utc + AFTER_RACE)
    rows = table[inside]
    session = rows["session_name"].map(lambda name: "R" if name == "Race" else str(name))
    return pd.DataFrame({"season": race["season"], "round": race["round"], "session": session,
                         "timeUtc": times[inside], "message": rows["message"]})


def _archive_messages(race: pd.Series) -> pd.DataFrame:
    """Messages from the raw live timing archive folder of the weekend (named by race date)."""
    season = int(race["season"])
    race_day = pd.Timestamp(race["raceUtc"]).strftime("%Y-%m-%d")
    root = RAW_DIR / "livetiming" / str(season)
    rows = []
    for event_dir in root.glob(f"{race_day}_*"):
        for session_dir in event_dir.iterdir():
            stream = session_dir / "RaceControlMessages.jsonStream"
            if not stream.exists():
                continue
            label = session_dir.name[11:]
            session = "R" if label == "Race" else label
            for utc, message in _stream_messages(stream):
                rows.append((season, int(race["round"]), session, utc, message))
    return pd.DataFrame(rows, columns=COLUMNS)


def _stream_messages(path) -> list[tuple]:
    found = []
    with open(path, encoding="utf-8-sig") as handle:
        for line in handle:
            brace = line.find("{")
            if brace < 0:
                continue
            try:
                patch = json.loads(line[brace:])
            except json.JSONDecodeError:
                continue
            messages = patch.get("Messages")
            items = messages.values() if isinstance(messages, dict) else messages or []
            for item in items:
                if isinstance(item, dict) and item.get("Message"):
                    found.append((item.get("Utc"), item["Message"]))
    return found
