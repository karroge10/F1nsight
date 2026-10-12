"""Free fallback: best laps and qualifying from the F1 static live timing archive.

`v2/live` caches finished sessions from `livetiming.formula1.com/static/...` under
`data/raw/livetiming/<season>/<date>_<Event>/<date>_<Session>/<Topic>.jsonStream`. Each
stream line is `HH:MM:SS.mmm{json patch}`; merging the patches gives the final state.

- TimingStats -> PersonalBestLapTime per car (practice, sprint qualifying);
- TimingData  -> final Position and BestLapTimes per segment (qualifying).
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd

from f1ml import paths

ROOT = paths.RAW_DIR / "livetiming"
SESSION_NAMES = {"Practice_1": "FP1", "Practice_2": "FP2", "Practice_3": "FP3",
                 "Sprint_Qualifying": "SQ", "Sprint_Shootout": "SQ", "Qualifying": "Q"}


def best_laps(races: pd.DataFrame, numbers: pd.DataFrame) -> pd.DataFrame:
    """raceId, driverId, session, timeMs, position, source for FP1-3 and SQ sessions."""
    rows = []
    for race_id, session, folder in _session_folders(races):
        if session == "Q":
            continue
        state = _final_state(folder / "TimingStats.jsonStream")
        lines = state.get("Lines", {}) if state else {}
        for number, line in lines.items():
            value = _nested(line, "PersonalBestLapTime", "Value")
            millis = _lap_ms(value)
            if millis is not None:
                rows.append((race_id, int(number), session, millis))
    frame = pd.DataFrame(rows, columns=["raceId", "number", "session", "timeMs"])
    return _attach_driver(frame, numbers, ["raceId", "driverId", "session", "timeMs",
                                           "position", "source"])


def qualifying(races: pd.DataFrame, numbers: pd.DataFrame) -> pd.DataFrame:
    """raceId, driverId, position, q1Ms, q2Ms, q3Ms from the qualifying TimingData stream."""
    rows = []
    for race_id, session, folder in _session_folders(races):
        if session != "Q":
            continue
        state = _final_state(folder / "TimingData.jsonStream")
        lines = state.get("Lines", {}) if state else {}
        for number, line in lines.items():
            position = line.get("Position")
            best = line.get("BestLapTimes", {})
            segments = [_lap_ms(_nested(best, str(k), "Value")) for k in range(3)]
            if position in (None, ""):
                continue
            rows.append((race_id, int(number), float(position), *segments))
    frame = pd.DataFrame(rows, columns=["raceId", "number", "position", "q1Ms", "q2Ms",
                                        "q3Ms"])
    return _attach_driver(frame, numbers, ["raceId", "driverId", "position", "q1Ms", "q2Ms",
                                           "q3Ms"])


def practice_laps(races: pd.DataFrame, numbers: pd.DataFrame) -> pd.DataFrame:
    """Every timed practice lap rebuilt from the TimingData / TimingAppData streams.

    A lap is recorded when a car's NumberOfLaps increases; its time is the LastLapTime of that
    moment. Pit in and out laps are flagged from InPit / PitOut, the compound and tyre age come
    from the TimingAppData stints. Columns follow the ff1_laps practice subset.
    """
    frames = []
    for race_id, session, folder in _session_folders(races):
        if not session.startswith("FP"):
            continue
        laps = _session_laps(folder)
        if not len(laps):
            continue
        laps["raceId"] = race_id
        laps["session"] = session
        frames.append(laps)
    columns = ["season", "round", "raceId", "session", "driverId", "lapNumber", "lapTimeS",
               "pitInS", "pitOutS", "stint", "compound", "tyreLife", "trackStatus", "deleted"]
    if not frames:
        return pd.DataFrame(columns=columns)
    laps = pd.concat(frames, ignore_index=True)
    laps["season"] = laps["raceId"] // 100
    laps["round"] = laps["raceId"] % 100
    merged = laps.merge(numbers, on=["season", "number"], how="left")
    merged = merged.dropna(subset=["driverId"])
    return merged[columns].reset_index(drop=True)


# ----------------------------------------------------------------------------------------------
# helpers


def _session_folders(races: pd.DataFrame):
    if not ROOT.exists():
        return []
    by_date = {}
    for race_id, date in zip(races["raceId"], pd.to_datetime(races["date"])):
        by_date[date.strftime("%Y-%m-%d")] = int(race_id)
    found = []
    for event in sorted(ROOT.glob("*/*")):
        if not event.is_dir():
            continue
        race_id = by_date.get(event.name[:10])
        if race_id is None:
            continue
        for session_dir in event.iterdir():
            label = session_dir.name[11:]
            session = SESSION_NAMES.get(label)
            if session is not None and session_dir.is_dir():
                found.append((race_id, session, session_dir))
    return found


def _session_laps(folder: Path) -> pd.DataFrame:
    """Laps of one session from the TimingData patches (see `practice_laps`)."""
    timing_path = folder / "TimingData.jsonStream"
    if not timing_path.exists():
        return pd.DataFrame()
    cars: dict = {}
    rows = []
    with open(timing_path, encoding="utf-8-sig") as handle:
        for line in handle:
            brace = line.find("{")
            if brace < 0:
                continue
            try:
                patch = json.loads(line[brace:])
            except json.JSONDecodeError:
                continue
            lines = patch.get("Lines")
            if not isinstance(lines, dict):
                continue
            for number, change in lines.items():
                if isinstance(change, dict):
                    _apply_car_patch(cars, rows, number, change)
    frame = pd.DataFrame(rows, columns=["number", "lapNumber", "lapTimeS", "pitInS", "pitOutS"])
    if not len(frame):
        return frame
    stints = _final_state(folder / "TimingAppData.jsonStream") or {}
    frame["stint"] = np.nan
    frame["compound"] = None
    frame["tyreLife"] = np.nan
    for number, line in (stints.get("Lines") or {}).items():
        _attach_stints(frame, int(number), line.get("Stints") or {})
    frame["trackStatus"] = "1"
    frame["deleted"] = False
    return frame


def _apply_car_patch(cars: dict, rows: list, number: str, change: dict) -> None:
    """The lap counter moves at the line; LastLapTime of that lap arrives with or after it, so
    the time is written into the newest lap still waiting for one."""
    car = cars.setdefault(number, {"laps": 0, "pending": None, "in_pit": False,
                                   "pit_out": False})
    if change.get("PitOut"):
        car["pit_out"] = True
    if "InPit" in change:
        car["in_pit"] = bool(change["InPit"])
    laps = change.get("NumberOfLaps")
    if laps is not None and int(laps) > car["laps"]:
        car["laps"] = int(laps)
        rows.append([int(number), int(laps) - 1, np.nan, 1.0 if car["in_pit"] else np.nan,
                     1.0 if car["pit_out"] else np.nan])
        car["pending"] = len(rows) - 1
        car["pit_out"] = False
    last = _nested(change, "LastLapTime", "Value")
    millis = _lap_ms(last)
    if millis and car["pending"] is not None:
        rows[car["pending"]][2] = millis / 1000.0
        car["pending"] = None


def _attach_stints(frame: pd.DataFrame, number: int, stints: dict) -> None:
    """Assign stint number, compound and tyre age by cumulative stint lap counts."""
    first_lap = 1
    ordered = sorted(stints.items(), key=lambda item: int(item[0]))
    for index, (_, stint) in enumerate(ordered):
        if not isinstance(stint, dict):
            continue
        total = int(stint.get("TotalLaps") or 0)
        start_age = int(stint.get("StartLaps") or 0)
        driven = max(total - start_age, 0)
        last_lap = first_lap + driven - 1
        rows = (frame["number"] == number) & frame["lapNumber"].between(first_lap, last_lap)
        frame.loc[rows, "stint"] = index + 1
        frame.loc[rows, "compound"] = stint.get("Compound")
        frame.loc[rows, "tyreLife"] = start_age + frame.loc[rows, "lapNumber"] - first_lap + 1
        first_lap = last_lap + 1


def _final_state(path: Path) -> dict | None:
    if not path.exists():
        return None
    return _merged(str(path), path.stat().st_mtime)


@lru_cache(maxsize=256)
def _merged(path_text: str, mtime: float) -> dict:
    state: dict = {}
    with open(path_text, encoding="utf-8-sig") as handle:
        for line in handle:
            brace = line.find("{")
            if brace < 0:
                continue
            try:
                patch = json.loads(line[brace:])
            except json.JSONDecodeError:
                continue
            _merge(state, patch)
    return state


def _merge(target: dict, patch: dict) -> None:
    for key, value in patch.items():
        current = target.get(key)
        if isinstance(value, dict) and isinstance(current, list):
            current = {str(i): item for i, item in enumerate(current)}
            target[key] = current
        if isinstance(value, list):
            value = {str(i): item for i, item in enumerate(value)}
        if isinstance(value, dict) and isinstance(current, dict):
            _merge(current, value)
        else:
            target[key] = value


def _nested(mapping, *keys):
    current = mapping
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def _lap_ms(text) -> float | None:
    if not text or not isinstance(text, str):
        return None
    try:
        if ":" in text:
            minutes, seconds = text.split(":")
            return (int(minutes) * 60 + float(seconds)) * 1000.0
        return float(text) * 1000.0
    except ValueError:
        return None


def _attach_driver(frame: pd.DataFrame, numbers: pd.DataFrame, columns: list) -> pd.DataFrame:
    if not len(frame):
        return pd.DataFrame(columns=columns)
    frame = frame.copy()
    frame["season"] = frame["raceId"] // 100
    merged = frame.merge(numbers, on=["season", "number"], how="left")
    merged = merged.dropna(subset=["driverId"])
    if "timeMs" in merged and "position" not in merged:
        merged["position"] = merged.groupby(["raceId", "session"])["timeMs"].rank(method="first")
    merged["source"] = "livetiming"
    for column in columns:
        if column not in merged:
            merged[column] = np.nan
    return merged[columns]
