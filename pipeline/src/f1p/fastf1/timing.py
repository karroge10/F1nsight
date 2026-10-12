"""Timing tower tables for Race and Sprint replays.

`build_lap_timing` gives one row per driver per completed lap (position, gap, interval, sectors,
tyres, pits). `build_timing_stream` keeps the official live tower feed (position, gap to leader,
interval) at the moment each value changed, which is finer grained than once per lap.
"""

import re

import numpy as np
import pandas as pd

from fastf1 import _api as api

from f1p.fastf1.common import td_to_ms, td_to_seconds

# Search window for the timing-line crossing around each lap end (the timing feed lags).
LINE_SEARCH_BEFORE_MS = 20_000
LINE_SEARCH_AFTER_MS = 5_000
LINE_MAX_DISTANCE_DM = 600
_GAP_SECONDS = re.compile(r"^\+?(\d+(?:\.\d+)?)$")
_GAP_LAPS = re.compile(r"^\+?(\d+)\s*L(?:AP|APS)?$", re.IGNORECASE)


def build_lap_timing(session) -> pd.DataFrame:
    laps = pd.DataFrame(session.laps)
    if laps.empty:
        return pd.DataFrame()
    laps = laps.sort_values(["DriverNumber", "LapNumber"], kind="stable")
    laps["driverNumber"] = laps["DriverNumber"].astype(int)
    laps["lapEndMs"] = td_to_ms(laps["Time"])
    leader_end = _leader_lap_end_ms(laps)
    laps = laps.merge(leader_end, on="LapNumber", how="left")
    end_float = laps["lapEndMs"].astype("float64")
    laps["gapToLeaderS"] = (end_float - laps["leaderEndMs"]) / 1000.0
    laps["lapsDown"] = _laps_down(laps, leader_end)
    laps["intervalS"] = _intervals(laps)
    laps["pitIn"] = laps["PitInTime"].notna()
    laps["pitOut"] = laps["PitOutTime"].notna()
    pit_counts = laps.groupby("driverNumber")["pitIn"].cumsum()
    laps["pitStops"] = pit_counts.astype("int16")

    timing = pd.DataFrame({
        "driverNumber": laps["driverNumber"].astype("int16"),
        "code": laps["Driver"],
        "team": laps["Team"],
        "lap": laps["LapNumber"].astype("Int16"),
        "position": laps["Position"].astype("Int16"),
        "lapStartMs": td_to_ms(laps["LapStartTime"]),
        "lapEndMs": laps["lapEndMs"],
        "gapToLeaderS": laps["gapToLeaderS"].round(3),
        "lapsDown": laps["lapsDown"],
        "intervalS": laps["intervalS"].round(3),
        "lapTimeS": td_to_seconds(laps["LapTime"]),
        "s1S": td_to_seconds(laps["Sector1Time"]),
        "s2S": td_to_seconds(laps["Sector2Time"]),
        "s3S": td_to_seconds(laps["Sector3Time"]),
        "isPersonalBest": laps["IsPersonalBest"].astype("boolean"),
        "compound": laps["Compound"],
        "tyreAge": laps["TyreLife"].astype("Float32"),
        "freshTyre": laps["FreshTyre"].astype("boolean"),
        "stint": laps["Stint"].astype("Int16"),
        "pitIn": laps["pitIn"],
        "pitOut": laps["pitOut"],
        "pitInMs": td_to_ms(laps["PitInTime"]),
        "pitOutMs": td_to_ms(laps["PitOutTime"]),
        "pitStops": laps["pitStops"],
        "trackStatus": laps["TrackStatus"],
    })
    timing = timing.sort_values(["lap", "position", "driverNumber"], kind="stable")
    return timing.reset_index(drop=True)


def build_timing_stream(session) -> pd.DataFrame:
    """Official live tower values (cached by FastF1 during load, so no extra request)."""
    _, stream, _ = api._extended_timing_data(session.api_path)
    if stream is None or stream.empty:
        return pd.DataFrame()
    stream = stream.dropna(subset=["Time"])
    gap_parts = stream["GapToLeader"].map(_parse_gap)
    interval_parts = stream["IntervalToPositionAhead"].map(_parse_gap)
    gap_frame = pd.DataFrame(gap_parts.tolist(), columns=["gapToLeaderS", "gapLaps"], index=stream.index)
    interval_frame = pd.DataFrame(interval_parts.tolist(), columns=["intervalS", "intervalLaps"], index=stream.index)
    driver_numbers = stream["Driver"].astype(int)
    result = pd.DataFrame({
        "t": td_to_ms(stream["Time"]),
        "driverNumber": driver_numbers.astype("int16"),
        "position": stream["Position"].astype("Int16"),
        "gapToLeader": stream["GapToLeader"].astype("string"),
        "interval": stream["IntervalToPositionAhead"].astype("string"),
    })
    result = pd.concat([result, gap_frame, interval_frame], axis=1)
    result = result.sort_values(["t", "driverNumber"], kind="stable")
    return result.reset_index(drop=True)


def add_line_crossings(timing: pd.DataFrame, positions: pd.DataFrame, finish: tuple[float, float] | None) -> pd.DataFrame:
    """Add lineCrossMs: the 4 Hz tick where the car was closest to the timing line around lapEndMs.

    The timing feed sometimes lags the position feed by seconds; replays should place lap
    events at lineCrossMs when it is set. Empty when the car never came within 60 m of the line.
    """
    timing = timing.copy()
    timing["lineCrossMs"] = pd.array([pd.NA] * len(timing), dtype="Int64")
    if finish is None or positions.empty or timing.empty:
        return timing
    finish_x, finish_y = finish
    for number, driver_positions in positions.groupby("driverNumber"):
        rows = timing.index[(timing["driverNumber"] == number) & timing["lapEndMs"].notna()]
        if len(rows) == 0:
            continue
        ticks = driver_positions["t"].to_numpy()
        dx = driver_positions["x"].to_numpy() - finish_x
        dy = driver_positions["y"].to_numpy() - finish_y
        distance = np.hypot(dx, dy)
        lap_ends = timing.loc[rows, "lapEndMs"].to_numpy(dtype=np.int64)
        crossings = _closest_ticks(ticks, distance, lap_ends)
        timing.loc[rows, "lineCrossMs"] = pd.array(crossings, dtype="Int64")
    return timing


def _closest_ticks(ticks: np.ndarray, distance: np.ndarray, lap_ends: np.ndarray) -> list:
    crossings = []
    for lap_end in lap_ends:
        low = np.searchsorted(ticks, lap_end - LINE_SEARCH_BEFORE_MS, side="left")
        high = np.searchsorted(ticks, lap_end + LINE_SEARCH_AFTER_MS, side="right")
        if high <= low:
            crossings.append(pd.NA)
            continue
        window = distance[low:high]
        best = int(np.argmin(window))
        if window[best] > LINE_MAX_DISTANCE_DM:
            crossings.append(pd.NA)
            continue
        crossings.append(int(ticks[low + best]))
    return crossings


def _leader_lap_end_ms(laps: pd.DataFrame) -> pd.DataFrame:
    """Earliest completion time of each lap number, i.e. when the leader crossed the line."""
    timed = laps.dropna(subset=["lapEndMs"])
    first = timed.groupby("LapNumber")["lapEndMs"].min()
    leader = first.astype("float64")
    return leader.rename("leaderEndMs").reset_index()


def _laps_down(laps: pd.DataFrame, leader_end: pd.DataFrame) -> pd.Series:
    """How many more laps the leader had completed when this driver completed this lap."""
    ordered = leader_end.dropna().sort_values("leaderEndMs")
    leader_times = ordered["leaderEndMs"].to_numpy()
    leader_laps = ordered["LapNumber"].to_numpy()
    end_ms = laps["lapEndMs"].astype("float64")
    ends = end_ms.to_numpy()
    idx = np.searchsorted(leader_times, ends, side="right") - 1
    safe_idx = np.clip(idx, 0, max(len(leader_laps) - 1, 0))
    leader_lap = leader_laps[safe_idx] if len(leader_laps) else np.zeros_like(ends)
    own_lap = laps["LapNumber"].to_numpy()
    down = np.maximum(leader_lap - own_lap, 0)
    unknown = np.isnan(ends) | (idx < 0)
    series = pd.Series(down, index=laps.index).astype("Int16")
    series[unknown] = pd.NA
    return series


def _intervals(laps: pd.DataFrame) -> pd.Series:
    """Gap to the car ahead when both completed the same lap number."""
    ordered = laps.sort_values(["LapNumber", "lapEndMs"], kind="stable")
    end_ms = ordered["lapEndMs"].astype("float64")
    previous = end_ms.groupby(ordered["LapNumber"]).shift(1)
    interval = (end_ms - previous) / 1000.0
    return interval.reindex(laps.index)


def _parse_gap(value) -> tuple[float | None, int | None]:
    """'+1.234' -> (1.234, 0); '1L' / '+2 LAPS' -> (None, 2); leader 'LAP 12' -> (0.0, 0)."""
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return None, None
    text = str(value).strip()
    if not text:
        return None, None
    if text.upper().startswith("LAP"):
        return 0.0, 0
    seconds = _GAP_SECONDS.match(text)
    if seconds:
        return float(seconds.group(1)), 0
    laps = _GAP_LAPS.match(text)
    if laps:
        return None, int(laps.group(1))
    return None, None
