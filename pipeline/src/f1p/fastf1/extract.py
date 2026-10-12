"""Turn one loaded FastF1 session into the per-session files under data/raw/fastf1/<season>/<RR>_<code>/."""

import time
from datetime import datetime, timezone

import fastf1
import pandas as pd
from fastf1.mvapi import get_circuit_info as mv_circuit_info

from f1p.fastf1.common import (
    RACE_LIKE,
    SessionRef,
    logger,
    session_dir,
    td_to_ms,
    track_path,
    write_json,
    write_parquet,
)
from f1p.fastf1.positions import build_track, finish_line_point, reference_lap, resample_positions
from f1p.fastf1.timing import add_line_crossings, build_lap_timing, build_timing_stream

CIRCUIT_INFO_ATTEMPTS = 2
CIRCUIT_INFO_LOOKBACK = 3


def write_session(session, ref: SessionRef) -> dict:
    """Write every table for a loaded session and return the meta record (written last)."""
    out = session_dir(ref)
    out.mkdir(parents=True, exist_ok=True)
    t0_date = _t0_date_or_none(session)
    counts: dict[str, int] = {}

    laps = _frame_or_empty(session, "laps")
    counts["laps"] = _write(laps, out / "laps.parquet")
    results = _frame_or_empty(session, "results")
    counts["results"] = _write(results, out / "results.parquet")
    weather = _frame_or_empty(session, "weather_data")
    counts["weather"] = _write(weather, out / "weather.parquet")
    race_control = _race_control(session, t0_date)
    counts["race_control"] = _write(race_control, out / "race_control.parquet")
    track_status = _frame_or_empty(session, "track_status")
    counts["track_status"] = _write(track_status, out / "track_status.parquet")
    session_status = _frame_or_empty(session, "session_status")
    counts["session_status"] = _write(session_status, out / "session_status.parquet")

    window = None
    positions = None
    # Positions and the track outline are built from laps; without laps (2018 Italian GP race) skip them.
    if ref.wants_positions and not laps.empty and _has_positions(session):
        positions, window = resample_positions(session)
        counts["positions"] = _write(positions, out / "positions.parquet")
    if ref.code in RACE_LIKE and not laps.empty:
        lap_timing = build_lap_timing(session)
        if positions is not None:
            finish = finish_line_point(session)
            lap_timing = add_line_crossings(lap_timing, positions, finish)
        counts["timing"] = _write(lap_timing, out / "timing.parquet")
        stream = build_timing_stream(session)
        counts["timing_stream"] = _write(stream, out / "timing_stream.parquet")
    if ref.code == "R" and not laps.empty and _has_positions(session):
        write_track(session, ref)

    meta = _meta(session, ref, t0_date, counts, window)
    if positions is not None:
        meta["positionsCoverage"] = _positions_coverage(positions, window)
    write_json(out / "meta.json", meta)
    return meta


def write_track(session, ref: SessionRef) -> bool:
    """Write <season>/<RR>_track.json from a loaded session with telemetry. Returns success."""
    circuit_info, info_year = _circuit_info(session, ref)
    try:
        track = build_track(session, circuit_info, ref.code)
    except Exception as exc:
        logger.warning("%s: track outline failed (%s)", ref.key, exc)
        track = None
    if track is None:
        logger.warning("%s: no track outline written", ref.key)
        return False
    track["circuitInfoYear"] = info_year
    path = track_path(ref.season, ref.round)
    write_json(path, track)
    return True


def _circuit_info(session, ref: SessionRef):
    """MultiViewer corners/rotation, retried, falling back to earlier seasons of the circuit."""
    circuit = session.session_info["Meeting"]["Circuit"]
    circuit_key = circuit["Key"]
    if circuit_key == 149 and circuit.get("ShortName") == "Mugello":
        circuit_key = 146
    for year in range(ref.season, ref.season - CIRCUIT_INFO_LOOKBACK - 1, -1):
        attempts = CIRCUIT_INFO_ATTEMPTS if year == ref.season else 1
        info = _circuit_info_for_year(year, circuit_key, attempts)
        if info is None:
            continue
        reference = reference_lap(session.laps)
        try:
            info.add_marker_distance(reference_lap=reference[0])
        except Exception as exc:
            logger.warning("%s: corner distances unavailable (%s)", ref.key, exc)
        return info, year
    logger.warning("%s: circuit info unavailable for circuit key %s", ref.key, circuit_key)
    return None, None


def _circuit_info_for_year(year: int, circuit_key: int, attempts: int):
    for attempt in range(attempts):
        try:
            info = mv_circuit_info(year=year, circuit_key=circuit_key)
        except Exception:
            info = None
        if info is not None:
            return info
        if attempt + 1 < attempts:
            time.sleep(5 * (attempt + 1))
    return None


def _meta(session, ref: SessionRef, t0_date, counts: dict, window) -> dict:
    info = getattr(session, "session_info", {}) or {}
    meeting = info.get("Meeting", {})
    circuit = meeting.get("Circuit", {})
    drivers = list(getattr(session, "drivers", []) or [])
    start_time = _session_start_ms(session)
    now = datetime.now(timezone.utc)
    return {
        "key": ref.key,
        "season": ref.season,
        "round": ref.round,
        "session": ref.code,
        "sessionName": ref.name,
        "eventName": ref.event_name,
        "startUtc": ref.start_utc,
        "circuitKey": circuit.get("Key"),
        "circuitShortName": circuit.get("ShortName"),
        "sessionKey": info.get("Key"),
        "apiPath": getattr(session, "api_path", None),
        "t0Date": t0_date.isoformat() if t0_date is not None else None,
        "sessionStartMs": start_time,
        "drivers": drivers,
        "counts": counts,
        "replayWindow": window,
        "hasPositions": counts.get("positions", 0) > 0,
        "fastf1Version": fastf1.__version__,
        "writtenAt": now.isoformat(timespec="seconds"),
    }


def _positions_coverage(positions: pd.DataFrame, window: dict) -> float:
    """Share of replay ticks where at least half of the cars have a position."""
    if positions.empty or not window:
        return 0.0
    cars = positions["driverNumber"].nunique()
    per_tick = positions.groupby("t").size()
    good_ticks = (per_tick >= max(1, cars // 2)).sum()
    total_ticks = (window["endMs"] - window["startMs"]) // window["stepMs"] + 1
    return round(float(good_ticks) / max(total_ticks, 1), 3)


def _race_control(session, t0_date) -> pd.DataFrame:
    """Race control messages; adds sessionTimeMs when the session clock offset is known."""
    messages = _frame_or_empty(session, "race_control_messages")
    if messages.empty:
        return messages
    if t0_date is not None:
        offset = messages["Time"] - t0_date
        messages["sessionTimeMs"] = td_to_ms(offset)
    return messages


def _frame_or_empty(session, attribute: str) -> pd.DataFrame:
    """FastF1 raises DataNotLoadedError for missing parts; treat those as empty tables."""
    try:
        value = getattr(session, attribute)
    except Exception:
        return pd.DataFrame()
    if value is None:
        return pd.DataFrame()
    return pd.DataFrame(value).reset_index(drop=True)


def _write(df: pd.DataFrame, path) -> int:
    if df is None or df.empty:
        return 0
    write_parquet(df, path)
    return len(df)


def _has_positions(session) -> bool:
    try:
        pos_data = session.pos_data
    except Exception:
        return False
    return bool(pos_data)


def _t0_date_or_none(session):
    try:
        return session.t0_date
    except Exception:
        return None


def _session_start_ms(session) -> int | None:
    try:
        start = session.session_start_time
    except Exception:
        return None
    if start is None or pd.isna(start):
        return None
    seconds = start.total_seconds()
    return int(round(seconds * 1000.0))
