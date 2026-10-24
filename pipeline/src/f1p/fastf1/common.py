"""Shared helpers for the FastF1 downloader: cache setup, session list, folders, conversions."""

import json
import logging
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

import fastf1
import numpy as np
import pandas as pd

from f1p.paths import FASTF1_CACHE_DIR, raw_dir

FIRST_SEASON = 2018
# FastF1 session names (all formats since 2018) mapped to short folder codes.
SESSION_CODES = {
    "Practice 1": "FP1",
    "Practice 2": "FP2",
    "Practice 3": "FP3",
    "Sprint Shootout": "SQ",
    "Sprint Qualifying": "SQ",
    "Sprint": "S",
    "Qualifying": "Q",
    "Race": "R",
}
SESSION_ORDER = ["FP1", "FP2", "FP3", "SQ", "S", "Q", "R"]
RACE_LIKE = {"R", "S"}
QUALI_LIKE = {"Q", "SQ"}
# Qualifying positions are only stored for 2023 onwards (task scope, saves requests and disk).
QUALI_POSITIONS_FROM = 2023
# A session counts as completed (and its archive as published) this long after its start.
COMPLETED_AFTER = timedelta(hours=4)
MANIFEST_NAME = "manifest.jsonl"
_SCHEDULES: dict[int, pd.DataFrame] = {}


@dataclass(frozen=True)
class SessionRef:
    season: int
    round: int
    code: str
    name: str
    event_name: str
    start_utc: str

    @property
    def key(self) -> str:
        return f"{self.season}/{self.round:02d}_{self.code}"

    @property
    def wants_positions(self) -> bool:
        if self.code in RACE_LIKE:
            return True
        return self.code in QUALI_LIKE and self.season >= QUALI_POSITIONS_FROM


def setup_fastf1() -> None:
    """Enable the shared FastF1 cache (parsed data only, no raw HTTP cache to save disk)."""
    FASTF1_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_dir = str(FASTF1_CACHE_DIR)
    fastf1.Cache.enable_cache(cache_dir, use_requests_cache=False)
    fastf1.set_log_level("WARNING")


def fastf1_root() -> Path:
    return raw_dir("fastf1")


def session_dir(ref: SessionRef) -> Path:
    return fastf1_root() / str(ref.season) / f"{ref.round:02d}_{ref.code}"


def track_path(season: int, round_number: int) -> Path:
    return fastf1_root() / str(season) / f"{round_number:02d}_track.json"


def completed_sessions(season: int, now: datetime | None = None) -> list[SessionRef]:
    """All sessions of a season that started at least COMPLETED_AFTER ago, in weekend order."""
    now = now or datetime.now(timezone.utc)
    cutoff = now - COMPLETED_AFTER
    cutoff_naive = cutoff.replace(tzinfo=None)
    schedule = season_schedule(season)
    refs = []
    for _, event in schedule.iterrows():
        for slot in range(1, 6):
            ref = _ref_from_slot(season, event, slot, cutoff_naive)
            if ref is not None:
                refs.append(ref)
    return refs


def season_schedule(season: int):
    """Event schedule, fetched once per process (the HTTP cache is off, so avoid refetching)."""
    if season not in _SCHEDULES:
        _SCHEDULES[season] = fastf1.get_event_schedule(season, include_testing=False)
    return _SCHEDULES[season]


def get_session(ref: SessionRef):
    schedule = season_schedule(ref.season)
    event = schedule.get_event_by_round(ref.round)
    return event.get_session(ref.name)


def session_info_or_empty(session) -> dict:
    try:
        return session.session_info or {}
    except (AttributeError, fastf1.exceptions.DataNotLoadedError):
        return {}


def write_expected(season: int, refs: list[SessionRef]) -> None:
    """Remember which sessions a season should have, for progress reports without network."""
    path = fastf1_root() / str(season) / "expected.json"
    sessions = [asdict(ref) for ref in refs]
    write_json(path, {"season": season, "sessions": sessions})


def read_expected(season: int) -> list[SessionRef]:
    path = fastf1_root() / str(season) / "expected.json"
    if not path.exists():
        return []
    text = path.read_text(encoding="utf-8")
    payload = json.loads(text)
    return [SessionRef(**item) for item in payload["sessions"]]


def read_manifest() -> dict[str, dict]:
    """Latest manifest record per session key."""
    path = fastf1_root() / MANIFEST_NAME
    latest: dict[str, dict] = {}
    if not path.exists():
        return latest
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            record = json.loads(line)
            latest[record["key"]] = record
    return latest


def append_manifest(ref: SessionRef, status: str, **info) -> None:
    record = {"key": ref.key, "status": status, "at": _utc_now_iso(), **asdict(ref), **info}
    line = json.dumps(record, default=str)
    path = fastf1_root() / MANIFEST_NAME
    with path.open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")


def is_done(ref: SessionRef) -> bool:
    meta_path = session_dir(ref) / "meta.json"
    return meta_path.exists()


def write_json(path: Path, payload: dict) -> None:
    """Write JSON atomically (tmp file then rename) so a crash never leaves half a file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    text = json.dumps(payload, indent=1, default=str)
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


def write_parquet(df: pd.DataFrame, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".parquet.tmp")
    df.to_parquet(tmp, index=False, compression="zstd")
    tmp.replace(path)


def td_to_ms(values: pd.Series) -> pd.Series:
    """Timedelta series to nullable int64 milliseconds."""
    ms = values.dt.total_seconds() * 1000.0
    rounded = ms.round()
    return rounded.astype("Int64")


def td_to_seconds(values: pd.Series) -> pd.Series:
    seconds = values.dt.total_seconds()
    return seconds.astype("float64")


def season_range(text_values: list[str]) -> list[int]:
    """Parse ['2026', '2022-2024'] into [2026, 2024, 2023, 2022] (most recent first)."""
    seasons: set[int] = set()
    for text in text_values:
        if "-" in text:
            first, last = text.split("-", 1)
            low = int(first)
            high = int(last)
            span = range(min(low, high), max(low, high) + 1)
            seasons.update(span)
        else:
            seasons.add(int(text))
    return sorted(seasons, reverse=True)


def to_int_or_none(value) -> int | None:
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _ref_from_slot(season: int, event: pd.Series, slot: int, cutoff_naive: datetime) -> SessionRef | None:
    name = event.get(f"Session{slot}")
    code = SESSION_CODES.get(name)
    if code is None:
        return None
    start = event.get(f"Session{slot}DateUtc")
    if start is None or pd.isna(start) or start > cutoff_naive:
        return None
    round_number = int(event["RoundNumber"])
    return SessionRef(
        season=season,
        round=round_number,
        code=code,
        name=name,
        event_name=str(event["EventName"]),
        start_utc=start.isoformat(),
    )


def _utc_now_iso() -> str:
    now = datetime.now(timezone.utc)
    return now.isoformat(timespec="seconds")


logger = logging.getLogger("f1p.fastf1")
