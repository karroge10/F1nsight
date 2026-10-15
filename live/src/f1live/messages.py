"""Builders for the outgoing WebSocket messages (see "Live contract" in SPEC.md and README).

`t` in every message is milliseconds since `init.origin` (the scheduled session start, UTC).
"""

from collections.abc import Callable
from typing import Any

from f1live.decode import format_utc, local_to_utc_ms, parse_utc
from f1live.state import SessionState
from f1live.stores import TelemetryStore

# A tyre change within this window of a box time belongs to that stop.
PIT_PAIR_WINDOW_MS = 60000

TRACK_STATES = {
    "1": "green",
    "2": "yellow",
    "3": "green",
    "4": "sc",
    "5": "red",
    "6": "vsc",
    "7": "vscEnding",
}


def build_init(
    state: SessionState,
    origin: int,
    mode: str,
    track: dict | None,
    sources: dict,
    timeline: dict | None = None,
    positions_source: str | None = None,
) -> dict:
    return {
        "type": "init",
        "mode": mode,
        "positionsSource": positions_source,
        "origin": origin,
        "originUtc": format_utc(origin),
        "session": session_meta(state),
        "track": track or empty_track(),
        "drivers": driver_list(state),
        "sources": sources,
        "timeline": timeline,
    }


def build_timing(state: SessionState, t: int, now_utc: int, telemetry: TelemetryStore) -> dict:
    lap_count = state.topics.get("LapCount", {})
    lap = None
    if lap_count:
        lap = {"current": lap_count.get("CurrentLap"), "total": lap_count.get("TotalLaps")}
    timing_data = state.topics.get("TimingData", {})
    part = timing_data.get("SessionPart")
    rows = timing_rows(state, now_utc, telemetry)
    return {
        "type": "timing",
        "t": t,
        "lap": lap,
        "sessionPart": part,
        "clock": session_clock(state, now_utc),
        "rows": rows,
    }


def build_track_status(state: SessionState, t: int) -> dict:
    track = state.topics.get("TrackStatus", {})
    code = str(track.get("Status", "1"))
    session_status = state.topics.get("SessionStatus", {}).get("Status")
    return {
        "type": "trackStatus",
        "t": t,
        "code": code,
        "state": TRACK_STATES.get(code, "unknown"),
        "message": track.get("Message"),
        "sessionStatus": session_status,
    }


def build_weather(state: SessionState, t: int) -> dict:
    weather = state.topics.get("WeatherData", {})
    return {
        "type": "weather",
        "t": t,
        "airTemp": _to_float(weather.get("AirTemp")),
        "trackTemp": _to_float(weather.get("TrackTemp")),
        "humidity": _to_float(weather.get("Humidity")),
        "pressure": _to_float(weather.get("Pressure")),
        "windSpeed": _to_float(weather.get("WindSpeed")),
        "windDirection": _to_float(weather.get("WindDirection")),
        "rainfall": _to_float(weather.get("Rainfall")) not in (None, 0.0),
    }


def build_race_control(messages: list[dict], t: int, history: bool = False) -> dict:
    items = [race_control_item(message) for message in messages]
    return {"type": "raceControl", "t": t, "history": history, "messages": items}


def build_pit_history(state: SessionState, t: int, t_of: Callable[[int], int]) -> dict:
    """Every pit stop so far, oldest first, each box time paired with the tyre change made in it."""
    stops = [_history_stop(stop, t_of) for stop in state.pit_stops]
    for change in state.stint_changes:
        match = _unpaired_stop(stops, change["number"], t_of(change["utc"]))
        if match is not None:
            match["compound"] = change["compound"]
            match["previous"] = change["previous"]
            match["lap"] = match["lap"] if match["lap"] is not None else change.get("lap")
        elif _is_real_change(change) and change.get("lap") is not None:
            # A change before the car's first lap is a swap on the grid, not a pit stop.
            stops.append(_history_change(change, t_of))
    stops.sort(key=lambda stop: stop["t"])
    return {"type": "pitHistory", "t": t, "stops": stops}


def build_pit_stop(stop: dict, t: int) -> dict:
    return {
        "type": "pitStop",
        "t": t,
        "number": int(stop["number"]),
        "duration": _to_float(stop.get("duration")),
        "lap": _to_int(stop.get("lap")),
    }


def build_tyre_change(change: dict, t: int) -> dict:
    return {
        "type": "tyreChange",
        "t": t,
        "number": int(change["number"]),
        "stint": change["stint"],
        "compound": change["compound"],
        "previous": change["previous"],
        "tyresNotChanged": change["tyresNotChanged"],
        "lap": change.get("lap"),
    }


def _history_stop(stop: dict, t_of: Callable[[int], int]) -> dict:
    return {
        "t": t_of(stop["utc"]),
        "number": int(stop["number"]),
        "duration": _to_float(stop.get("duration")),
        "lap": _to_int(stop.get("lap")),
        "compound": None,
        "previous": None,
    }


def _history_change(change: dict, t_of: Callable[[int], int]) -> dict:
    return {
        "t": t_of(change["utc"]),
        "number": int(change["number"]),
        "duration": None,
        "lap": change.get("lap"),
        "compound": change["compound"],
        "previous": change["previous"],
    }


def _is_real_change(change: dict) -> bool:
    return not change["tyresNotChanged"] and change["compound"] != change["previous"]


def _unpaired_stop(stops: list[dict], number: str, t: int) -> dict | None:
    """The box time of the same car within a minute of the tyre change that has no compound yet."""
    for stop in stops:
        if stop["number"] == int(number) and stop["compound"] is None and abs(stop["t"] - t) < PIT_PAIR_WINDOW_MS:
            return stop
    return None


def session_meta(state: SessionState) -> dict:
    info = state.session_info()
    meeting = info.get("Meeting", {})
    circuit = meeting.get("Circuit", {})
    country = meeting.get("Country", {})
    path = info.get("Path") or ""
    start = state.session_start_utc()
    season = int(path[:4]) if path[:4].isdigit() else None
    end = None
    if info.get("EndDate"):
        end = local_to_utc_ms(info["EndDate"], info.get("GmtOffset"))
    is_testing = "testing" in (meeting.get("Name") or "").lower()
    return {
        "key": info.get("Key"),
        "season": season,
        "round": None if is_testing else meeting.get("Number"),
        "code": state.session_code(),
        "name": info.get("Name"),
        "type": info.get("Type"),
        "meeting": meeting.get("Name"),
        "officialName": meeting.get("OfficialName"),
        "location": meeting.get("Location"),
        "country": country.get("Name"),
        "circuit": circuit.get("ShortName"),
        "circuitKey": circuit.get("Key"),
        "start": format_utc(start) if start else None,
        "end": format_utc(end) if end else None,
        "gmtOffset": info.get("GmtOffset"),
        "path": path or None,
        "status": state.topics.get("SessionStatus", {}).get("Status") or info.get("SessionStatus"),
    }


def driver_list(state: SessionState) -> list[dict]:
    drivers = []
    for number, info in state.drivers().items():
        colour = info.get("TeamColour") or "888888"
        drivers.append({
            "number": int(number),
            "code": info.get("Tla"),
            "name": info.get("FullName") or info.get("BroadcastName"),
            "firstName": info.get("FirstName"),
            "lastName": info.get("LastName"),
            "team": info.get("TeamName"),
            "teamColor": "#" + colour.lstrip("#").upper(),
            "headshotUrl": info.get("HeadshotUrl"),
            "line": info.get("Line"),
        })
    drivers.sort(key=lambda driver: driver["line"] or 99)
    return drivers


def timing_rows(state: SessionState, now_utc: int, telemetry: TelemetryStore) -> list[dict]:
    lines = state.timing_lines()
    part = state.topics.get("TimingData", {}).get("SessionPart")
    known = set(lines) | set(state.drivers())
    best_laps = {number: lap_ms(line.get("BestLapTime", {}).get("Value")) for number, line in lines.items()}
    valid_bests = [value for value in best_laps.values() if value]
    overall_best = min(valid_bests) if valid_bests else None

    rows = []
    for number in known:
        if not number.isdigit():
            continue
        line = lines.get(number, {})
        row = timing_row(state, number, line, part, now_utc, telemetry)
        row["bestLap"]["ob"] = overall_best is not None and best_laps.get(number) == overall_best
        rows.append(row)
    rows.sort(key=_row_sort_key)
    for index, row in enumerate(rows):
        row["pos"] = index + 1
        row.pop("_sort", None)
    return rows


def timing_row(
    state: SessionState,
    number: str,
    line: dict,
    part: int | None,
    now_utc: int,
    telemetry: TelemetryStore,
) -> dict:
    stints = state.stints(number)
    current_stint = stints[-1] if stints else {}
    sectors = line.get("Sectors") or []
    if isinstance(sectors, dict):
        sectors = [sectors.get(str(index), {}) for index in range(3)]
    pit_count = line.get("NumberOfPitStops")
    if pit_count is None:
        pit_count = max(0, len(stints) - 1)
    best = line.get("BestLapTime") or {}
    last = line.get("LastLapTime") or {}
    reported = _to_int(line.get("Position"))
    return {
        "pos": reported,
        "number": int(number),
        "gap": _gap(line, part),
        "interval": _interval(line, part),
        "laps": line.get("NumberOfLaps"),
        "lastLap": _timed_value(last),
        "bestLap": {"value": best.get("Value") or None, "lap": best.get("Lap"), "ob": False},
        "s1": _timed_value(sectors[0] if len(sectors) > 0 else {}),
        "s2": _timed_value(sectors[1] if len(sectors) > 1 else {}),
        "s3": _timed_value(sectors[2] if len(sectors) > 2 else {}),
        "tyre": current_stint.get("Compound"),
        "tyreAge": current_stint.get("TotalLaps"),
        "tyreNew": _to_bool(current_stint.get("New")),
        "stint": len(stints) or None,
        "pits": pit_count,
        "inPit": bool(line.get("InPit")),
        "pitOut": bool(line.get("PitOut")),
        "retired": bool(line.get("Retired")),
        "stopped": bool(line.get("Stopped")),
        "knockedOut": bool(line.get("KnockedOut")),
        "drs": telemetry.drs_open(number, now_utc),
        "_sort": (reported or 999, line.get("Line") or 999),
    }


def session_clock(state: SessionState, now_utc: int) -> dict | None:
    clock = state.topics.get("ExtrapolatedClock")
    if not clock or not clock.get("Remaining"):
        return None
    hours, minutes, seconds = (int(part) for part in clock["Remaining"].split(":"))
    remaining = ((hours * 60 + minutes) * 60 + seconds) * 1000
    if clock.get("Extrapolating") and clock.get("Utc"):
        elapsed = now_utc - parse_utc(clock["Utc"])
        remaining = max(0, remaining - max(0, elapsed))
    return {"remainingMs": remaining, "running": bool(clock.get("Extrapolating"))}


def race_control_item(message: dict) -> dict:
    return {
        "utc": message.get("Utc"),
        "lap": message.get("Lap"),
        "category": message.get("Category"),
        "flag": message.get("Flag"),
        "scope": message.get("Scope"),
        "sector": message.get("Sector"),
        "driver": _to_int(message.get("RacingNumber")),
        "status": message.get("Status"),
        "mode": message.get("Mode"),
        "message": message.get("Message"),
    }


def empty_track() -> dict:
    return {"outline": [], "rotation": 0, "corners": [], "sectors": [], "source": None}


def lap_ms(value: str | None) -> int | None:
    """`"1:32.123"` or `"32.123"` to milliseconds."""
    if not value:
        return None
    try:
        if ":" in value:
            minutes, seconds = value.split(":")
            return int(round((int(minutes) * 60 + float(seconds)) * 1000))
        return int(round(float(value) * 1000))
    except ValueError:
        return None


def _gap(line: dict, part: int | None) -> str | None:
    if "GapToLeader" in line:
        return line.get("GapToLeader") or None
    stats = _part_stats(line, part)
    if stats:
        return stats.get("TimeDiffToFastest") or None
    return line.get("TimeDiffToFastest") or None


def _interval(line: dict, part: int | None) -> str | None:
    interval = line.get("IntervalToPositionAhead")
    if isinstance(interval, dict):
        return interval.get("Value") or None
    stats = _part_stats(line, part)
    if stats:
        return stats.get("TimeDifftoPositionAhead") or stats.get("TimeDiffToPositionAhead") or None
    return line.get("TimeDiffToPositionAhead") or None


def _part_stats(line: dict, part: int | None) -> dict | None:
    stats = line.get("Stats")
    if not stats or not part:
        return None
    if isinstance(stats, dict):
        return stats.get(str(part - 1))
    if len(stats) >= part:
        return stats[part - 1]
    return None


def _timed_value(raw: dict) -> dict:
    return {
        "value": raw.get("Value") or None,
        "pb": bool(raw.get("PersonalFastest")),
        "ob": bool(raw.get("OverallFastest")),
    }


def _row_sort_key(row: dict) -> tuple:
    return row["_sort"]


def _to_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _to_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _to_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.lower() == "true"
    return None
