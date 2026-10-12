"""OpenF1 practice laps (2023+, free historical API) as a second source for long-run pace.

    uv run python -m f1ml.openf1_laps          # fetch missing practice laps, print coverage

FastF1 laps are the primary source but its 2018 to 2024 download is still running. OpenF1 has
every lap of every practice session since 2023; this module fetches `laps` for Practice 1/2/3
into the existing raw layout (data/raw/openf1/<season>/<session_key>/laps.json, `[]` when
empty) and joins them with `stints` for compound and tyre age. The free tier allows 30
requests per minute; finished files are never fetched again.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from functools import lru_cache

import numpy as np
import pandas as pd

from f1ml import paths

RAW = paths.RAW_DIR / "openf1"
API = "https://api.openf1.org/v1"
PRACTICE_NAMES = {"Practice 1": "FP1", "Practice 2": "FP2", "Practice 3": "FP3"}
REQUEST_GAP_S = 2.2


def main() -> None:
    fetched = download()
    print(f"fetched {fetched} practice lap files")
    laps = practice_laps()
    coverage = laps.groupby("season")["raceId"].nunique().to_dict()
    print(f"{len(laps)} practice laps; races per season: {coverage}")


def download() -> int:
    fetched = 0
    for season_dir in sorted(RAW.glob("20*")):
        sessions_path = season_dir / "sessions.json"
        if not sessions_path.exists():
            continue
        sessions = json.loads(sessions_path.read_text(encoding="utf-8"))
        for session in sessions:
            if session.get("session_name") not in PRACTICE_NAMES or session.get("is_cancelled"):
                continue
            folder = season_dir / str(session["session_key"])
            target = folder / "laps.json"
            if target.exists() or not (folder / "drivers.json").exists():
                continue
            payload = _get(f"{API}/laps?session_key={session['session_key']}")
            folder.mkdir(parents=True, exist_ok=True)
            target.write_text(json.dumps(payload), encoding="utf-8")
            fetched += 1
            time.sleep(REQUEST_GAP_S)
    return fetched


@lru_cache(maxsize=1)
def practice_laps() -> pd.DataFrame:
    """Practice laps in the ff1_laps shape used by `data.long_run_pace`.

    Columns: season, round, raceId, session, driverId, lapNumber, lapTimeS, pitInS, pitOutS,
    stint, compound, tyreLife, trackStatus, deleted.
    """
    from f1ml import data

    frames = []
    for season_dir in sorted(RAW.glob("20*")):
        sessions_path = season_dir / "sessions.json"
        if not sessions_path.exists():
            continue
        sessions = json.loads(sessions_path.read_text(encoding="utf-8"))
        for session in sessions:
            name = PRACTICE_NAMES.get(session.get("session_name"))
            folder = season_dir / str(session["session_key"])
            laps_path = folder / "laps.json"
            if name is None or not laps_path.exists():
                continue
            frame = _session_frame(session, name, folder)
            if frame is not None:
                frames.append(frame)
    columns = ["season", "round", "raceId", "session", "driverId", "lapNumber", "lapTimeS",
               "pitInS", "pitOutS", "stint", "compound", "tyreLife", "trackStatus", "deleted"]
    if not frames:
        return pd.DataFrame(columns=columns)
    laps = pd.concat(frames, ignore_index=True)
    races = data.load_core()["races"][["raceId", "season", "date"]].copy()
    races["date"] = pd.to_datetime(races["date"])
    race_ids = []
    for season, day in zip(laps["season"], laps["day"]):
        race_ids.append(data._race_for_day(races, season, day))
    laps["raceId"] = race_ids
    laps = laps.dropna(subset=["raceId"])
    laps["raceId"] = laps["raceId"].astype(int)
    laps["round"] = laps["raceId"] % 100
    numbers = data._race_numbers()
    latest = data._season_numbers()
    merged = laps.merge(numbers, on=["season", "round", "number"], how="left")
    fallback = merged.merge(latest, on=["season", "number"], how="left",
                            suffixes=("", "_latest"))["driverId_latest"]
    merged["driverId"] = merged["driverId"].fillna(pd.Series(fallback.to_numpy(),
                                                             index=merged.index))
    merged = merged.dropna(subset=["driverId"])
    return merged[columns].reset_index(drop=True)


# ----------------------------------------------------------------------------------------------
# helpers


def _session_frame(session: dict, name: str, folder) -> pd.DataFrame | None:
    laps = json.loads((folder / "laps.json").read_text(encoding="utf-8"))
    if not laps:
        return None
    frame = pd.DataFrame(laps)
    if "lap_duration" not in frame:
        return None
    frame = frame.rename(columns={"driver_number": "number", "lap_number": "lapNumber",
                                  "lap_duration": "lapTimeS"})
    stints_path = folder / "stints.json"
    stints = json.loads(stints_path.read_text(encoding="utf-8")) if stints_path.exists() else []
    frame["stint"] = np.nan
    frame["compound"] = None
    frame["tyreLife"] = np.nan
    for stint in stints:
        start = stint.get("lap_start")
        end = stint.get("lap_end")
        if start is None or end is None:
            continue
        rows = (frame["number"] == stint["driver_number"]) & frame["lapNumber"].between(start,
                                                                                        end)
        frame.loc[rows, "stint"] = stint.get("stint_number")
        frame.loc[rows, "compound"] = stint.get("compound")
        age = stint.get("tyre_age_at_start") or 0
        frame.loc[rows, "tyreLife"] = age + frame.loc[rows, "lapNumber"] - start + 1
    pit_out = frame.get("is_pit_out_lap", pd.Series(False, index=frame.index)).fillna(False)
    frame["pitOutS"] = np.where(pit_out.astype(bool), 1.0, np.nan)
    next_lap = frame.sort_values(["number", "lapNumber"]).groupby("number")["is_pit_out_lap"]
    in_lap = next_lap.shift(-1).fillna(False).astype(bool)
    frame["pitInS"] = np.nan
    frame.loc[in_lap[in_lap].index, "pitInS"] = 1.0
    frame["trackStatus"] = _track_status(frame)
    frame["deleted"] = False
    frame["season"] = int(session["year"])
    day = pd.Timestamp(session["date_start"]).tz_convert(None).normalize()
    frame["day"] = day
    frame["session"] = name
    frame["number"] = frame["number"].astype(int)
    return frame


def _track_status(frame: pd.DataFrame) -> pd.Series:
    """'1' (green) unless a mini sector of the lap shows yellow (2048) or red/pit codes."""
    status = []
    for s1, s2, s3 in zip(frame.get("segments_sector_1", []), frame.get("segments_sector_2", []),
                          frame.get("segments_sector_3", [])):
        codes = []
        for segment in (s1, s2, s3):
            if isinstance(segment, list):
                codes.extend(code for code in segment if code is not None)
        status.append("2" if 2048 in codes else "1")
    if not status:
        return pd.Series("1", index=frame.index)
    return pd.Series(status, index=frame.index)


def _get(url: str, attempts: int = 5):
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(url, timeout=60) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return []
            wait = 20.0 * (attempt + 1)
        except Exception:
            wait = 10.0 * (attempt + 1)
        if attempt == attempts - 1:
            raise RuntimeError(f"OpenF1 request failed: {url}")
        time.sleep(wait)
    return []


if __name__ == "__main__":
    main()
