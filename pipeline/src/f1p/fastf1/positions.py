"""Car positions on a common 4 Hz timeline and the track outline, for the live/replay map.

Coordinates are FastF1 X/Y in decimetres (1/10 m), session time in ms since `Session.t0_date`
(the same clock as lap `Time`, `PitInTime`, weather `Time` and track status `Time`).
"""

import numpy as np
import pandas as pd

from f1p.fastf1.common import session_info_or_empty

STEP_MS = 250
# Linear interpolation is only trusted across short holes in the feed.
MAX_GAP_MS = 2_000
# Longer holes are still bridged when the car has not moved (parked in the garage or on track).
STATIONARY_DM = 50.0
# Hold the first/last known sample this long beyond the edges of a driver's data.
EDGE_HOLD_MS = 1_000
# Replay window around the session clock (first "Started" to last "Finished"/"Finalised").
WINDOW_BEFORE_MS = 120_000
WINDOW_AFTER_MS = 300_000
OUTLINE_MAX_POINTS = 800
REFERENCE_LAP_CANDIDATES = 15
# Corner estimate when MultiViewer has no circuit data: a speed minimum within +-150 m that is
# at least 25 km/h below the fastest point within +-400 m.
CORNER_MIN_WINDOW_M = 150
CORNER_DROP_WINDOW_M = 400
CORNER_MIN_DROP_KMH = 25
# Feed glitches park a car at a bogus far-away point. Samples are kept only near "track cells":
# 25 m cells visited by at least 3 different cars, grown by 300 m (run-off areas, garages).
CELL_DM = 250
MIN_DRIVERS_PER_CELL = 3
NEAR_TRACK_DM = 3_000
STATUS_ON_TRACK = "OnTrack"
STATUS_OFF_TRACK = "OffTrack"
STATUS_IN_PIT = "InPit"
STATUS_RETIRED = "Retired"
RACE_SESSION_NAMES = {"Race", "Sprint"}


def resample_positions(session) -> tuple[pd.DataFrame, dict]:
    """Return (positions, window) with one row per driver per 250 ms tick that has data.

    Columns: t (int64 ms session time), driverNumber (int16), x, y (int32 dm),
    status (OnTrack / OffTrack / InPit / Retired). Ticks without trustworthy data are left out,
    so a missing row means "no position for this car right now".
    """
    window = replay_window(session)
    first_tick = window["startMs"] - window["startMs"] % STEP_MS
    grid = np.arange(first_tick, window["endMs"] + 1, STEP_MS, dtype=np.int64)
    pit_windows = _pit_events_by_driver(session.laps)
    retired_at = _retirement_ms(session)
    raws = {}
    for driver, telemetry in session.pos_data.items():
        raw = _clean_raw_positions(telemetry)
        if raw is not None:
            number = int(driver)
            raws[number] = raw
    raws = _drop_far_from_track(raws)
    frames = []
    for number, raw in raws.items():
        events = pit_windows.get(number)
        frame = _resample_driver(raw, grid, number, events, retired_at.get(number))
        if not frame.empty:
            frames.append(frame)
    if not frames:
        return _empty_positions(), window
    positions = pd.concat(frames, ignore_index=True)
    positions = positions.sort_values(["t", "driverNumber"], kind="stable")
    positions = positions.reset_index(drop=True)
    positions["status"] = positions["status"].astype("category")
    return positions, window


def replay_window(session) -> dict:
    """Session-clock window worth replaying, clipped to the available position data."""
    data_start, data_end = _position_data_range(session)
    start = data_start
    end = data_end
    status = _session_status_or_none(session)
    if status is not None and not status.empty:
        started = status.loc[status["Status"] == "Started", "Time"]
        finished = status.loc[status["Status"] == "Finished", "Time"]
        closed = status.loc[status["Status"].isin(["Finalised", "Ends"]), "Time"]
        if not started.empty:
            first_started = started.min()
            start_ms = first_started.total_seconds() * 1000.0
            start = max(data_start, int(start_ms) - WINDOW_BEFORE_MS)
        if not finished.empty or not closed.empty:
            reference = finished.max() if not finished.empty else closed.min()
            end_ms = reference.total_seconds() * 1000.0
            end = min(data_end, int(end_ms) + WINDOW_AFTER_MS)
    if end <= start:
        start, end = data_start, data_end
    return {"startMs": int(start), "endMs": int(end), "stepMs": STEP_MS}


def build_track(session, circuit_info, source_session: str) -> dict | None:
    """Track outline from the fastest lap, sector boundary points, rotation and corners."""
    reference = reference_lap(session.laps)
    if reference is None:
        return None
    lap, telemetry, points = reference
    outline = _downsample_outline(points)
    sectors = _sector_points(points, lap)
    xs = points["X"].to_numpy()
    ys = points["Y"].to_numpy()
    meeting = session_info_or_empty(session).get("Meeting", {})
    circuit = meeting.get("Circuit", {})
    lap_time = lap["LapTime"]
    lap_seconds = lap_time.total_seconds() if pd.notna(lap_time) else None
    track = {
        "season": int(session.event.year),
        "round": int(session.event["RoundNumber"]),
        "eventName": str(session.event["EventName"]),
        "circuitKey": circuit.get("Key"),
        "circuitShortName": circuit.get("ShortName"),
        "sourceSession": source_session,
        "referenceLap": {
            "driverNumber": int(lap["DriverNumber"]),
            "driver": str(lap["Driver"]),
            "lapNumber": int(lap["LapNumber"]),
            "lapTimeS": lap_seconds,
        },
        "units": "decimetres (FastF1 X/Y)",
        "bounds": {
            "xMin": float(xs.min()),
            "xMax": float(xs.max()),
            "yMin": float(ys.min()),
            "yMax": float(ys.max()),
        },
        "outline": outline,
        "sectors": sectors,
        "rotation": None,
        "corners": [],
        "marshalLights": [],
        "marshalSectors": [],
    }
    if circuit_info is not None:
        track["rotation"] = float(circuit_info.rotation)
        track["corners"] = _markers(circuit_info.corners)
        track["marshalLights"] = _markers(circuit_info.marshal_lights)
        track["marshalSectors"] = _markers(circuit_info.marshal_sectors)
    else:
        track["corners"] = _estimated_corners(telemetry)
        track["cornersEstimated"] = True
    return track


def finish_line_point(session) -> tuple[float, float] | None:
    """Where the reference (fastest) lap starts, i.e. the timing line, in decimetres."""
    reference = reference_lap(session.laps)
    if reference is None:
        return None
    points = reference[2]
    first = points.iloc[0]
    return float(first["X"]), float(first["Y"])


def reference_lap(laps):
    """(lap, telemetry, valid X/Y points) of the fastest lap that has position data.

    Only laps inside their driver's position data are considered: the feed sometimes stops
    early (2026 Monaco) or misses a driver entirely.
    """
    if laps is None or len(laps) == 0:
        return None
    timed = laps[laps["LapTime"].notna() & laps["LapStartTime"].notna() & laps["Time"].notna()]
    covered = _laps_with_positions(timed, laps.session)
    ordered = covered.sort_values("LapTime")
    candidates = [ordered.iloc[i] for i in range(min(len(ordered), REFERENCE_LAP_CANDIDATES))]
    for lap in candidates:
        try:
            telemetry = lap.get_telemetry()
        except Exception:
            continue
        if "X" not in telemetry or "Y" not in telemetry:
            continue
        points = telemetry[["X", "Y", "SessionTime"]].dropna()
        points = points[(points["X"] != 0) | (points["Y"] != 0)]
        if len(points) >= 50:
            return lap, telemetry, points
    return None


def _resample_driver(raw: pd.DataFrame, grid: np.ndarray, number: int, pit_events, retired_ms) -> pd.DataFrame:
    t = raw["t"].to_numpy()
    x = raw["X"].to_numpy()
    y = raw["Y"].to_numpy()
    count = len(t)
    idx = np.searchsorted(t, grid, side="right")
    left = np.clip(idx - 1, 0, count - 1)
    right = np.clip(idx, 0, count - 1)
    t_left = t[left]
    t_right = t[right]
    span = (t_right - t_left).astype(np.float64)
    safe_span = np.where(span > 0, span, 1.0)
    frac = np.where(span > 0, (grid - t_left) / safe_span, 0.0)
    frac = np.clip(frac, 0.0, 1.0)
    xi = x[left] + (x[right] - x[left]) * frac
    yi = y[left] + (y[right] - y[left]) * frac

    inside = (grid >= t[0]) & (grid <= t[-1])
    moved = np.hypot(x[right] - x[left], y[right] - y[left])
    bridged = (span <= MAX_GAP_MS) | (moved <= STATIONARY_DM)
    edge_distance = np.minimum(np.abs(grid - t_left), np.abs(grid - t_right))
    near_edge = ~inside & (edge_distance <= EDGE_HOLD_MS)
    valid = (inside & bridged) | near_edge
    if not valid.any():
        return pd.DataFrame()

    feed_status = raw["Status"].to_numpy()
    status = np.where(feed_status[left] == STATUS_OFF_TRACK, STATUS_OFF_TRACK, STATUS_ON_TRACK)
    if pit_events is not None:
        in_pit = _in_pit_mask(grid, pit_events)
        status = np.where(in_pit, STATUS_IN_PIT, status)
    if retired_ms is not None:
        status = np.where(grid > retired_ms, STATUS_RETIRED, status)

    x_out = np.rint(xi[valid])
    y_out = np.rint(yi[valid])
    frame = pd.DataFrame({
        "t": grid[valid],
        "driverNumber": np.full(valid.sum(), number, dtype=np.int16),
        "x": x_out.astype(np.int32),
        "y": y_out.astype(np.int32),
        "status": status[valid],
    })
    return frame


def _clean_raw_positions(telemetry) -> pd.DataFrame | None:
    """Drop the all-zero placeholder samples the feed sends when a car has no fix."""
    if telemetry is None or len(telemetry) == 0:
        return None
    df = pd.DataFrame(telemetry)[["SessionTime", "X", "Y", "Z", "Status"]]
    df = df.dropna(subset=["SessionTime", "X", "Y"])
    no_fix = (df["X"] == 0) & (df["Y"] == 0) & (df["Z"] == 0)
    df = df[~no_fix]
    if len(df) < 2:
        return None
    seconds = df["SessionTime"].dt.total_seconds()
    df["t"] = (seconds * 1000.0).round().astype(np.int64)
    df = df.sort_values("t", kind="stable")
    df = df.drop_duplicates("t", keep="last")
    return df.reset_index(drop=True)


def _retirement_ms(session) -> dict[int, int]:
    """Race/Sprint only: drivers not classified as finishers are 'Retired' after their last lap."""
    if session.name not in RACE_SESSION_NAMES:
        return {}
    try:
        results = session.results
        laps = session.laps
    except Exception:
        return {}
    if results is None or laps is None or len(laps) == 0:
        return {}
    retired = {}
    for _, row in results.iterrows():
        if _is_finisher(row):
            continue
        driver_laps = laps[laps["DriverNumber"] == row["DriverNumber"]]
        ends = driver_laps["Time"].dropna()
        if ends.empty:
            ends = driver_laps["LapStartTime"].dropna()
        number = int(row["DriverNumber"])
        if ends.empty:
            # Did not start: retired for the whole window.
            retired[number] = -1
            continue
        last_end = ends.max()
        retired[number] = int(last_end.total_seconds() * 1000.0)
    return retired


def _is_finisher(row) -> bool:
    """Took the flag: 'Finished', 'Lapped' or Ergast style '+1 Lap'. Without a status, trust the
    classification digit."""
    status = row.get("Status")
    if isinstance(status, str) and status.strip():
        return status in ("Finished", "Lapped") or status.startswith("+")
    classified = str(row.get("ClassifiedPosition", ""))
    return classified.isdigit()


def _drop_far_from_track(raws: dict[int, pd.DataFrame]) -> dict[int, pd.DataFrame]:
    if len(raws) < MIN_DRIVERS_PER_CELL:
        return raws
    cell_lists = []
    for raw in raws.values():
        cells = _cells(raw)
        unique_cells = np.unique(cells, axis=0)
        cell_lists.append(unique_cells)
    all_cells = np.concatenate(cell_lists)
    cells, drivers = np.unique(all_cells, axis=0, return_counts=True)
    track_cells = cells[drivers >= MIN_DRIVERS_PER_CELL]
    if len(track_cells) == 0:
        return raws
    near = _NearTrack(track_cells)
    kept = {}
    for number, raw in raws.items():
        raw_cells = _cells(raw)
        mask = near.contains(raw_cells)
        filtered = raw[mask].reset_index(drop=True)
        if len(filtered) >= 2:
            kept[number] = filtered
    return kept


def _cells(raw: pd.DataFrame) -> np.ndarray:
    xs = raw["X"].to_numpy()
    ys = raw["Y"].to_numpy()
    cx = np.floor_divide(xs, CELL_DM)
    cy = np.floor_divide(ys, CELL_DM)
    stacked = np.column_stack([cx, cy])
    return stacked.astype(np.int64)


class _NearTrack:
    """Boolean raster of cells within NEAR_TRACK_DM of a track cell."""

    def __init__(self, track_cells: np.ndarray):
        radius = NEAR_TRACK_DM // CELL_DM
        self.origin = track_cells.min(axis=0) - radius
        upper = track_cells.max(axis=0) + radius
        shape = upper - self.origin + 1
        seeds = np.zeros(shape, dtype=bool)
        local = track_cells - self.origin
        seeds[local[:, 0], local[:, 1]] = True
        grown = np.zeros_like(seeds)
        width, height = shape
        for dx in range(-radius, radius + 1):
            for dy in range(-radius, radius + 1):
                if dx * dx + dy * dy > radius * radius:
                    continue
                src_x = slice(max(0, -dx), width - max(0, dx))
                dst_x = slice(max(0, dx), width - max(0, -dx))
                src_y = slice(max(0, -dy), height - max(0, dy))
                dst_y = slice(max(0, dy), height - max(0, -dy))
                grown[dst_x, dst_y] |= seeds[src_x, src_y]
        self.grid = grown

    def contains(self, cells: np.ndarray) -> np.ndarray:
        local = cells - self.origin
        width, height = self.grid.shape
        inside = (local[:, 0] >= 0) & (local[:, 0] < width) & (local[:, 1] >= 0) & (local[:, 1] < height)
        result = np.zeros(len(cells), dtype=bool)
        hits = local[inside]
        result[inside] = self.grid[hits[:, 0], hits[:, 1]]
        return result


def _pit_events_by_driver(laps) -> dict[int, tuple[np.ndarray, np.ndarray]]:
    """Per driver: sorted event times (ms) and whether the car is in the pit after each one."""
    events: dict[int, tuple[np.ndarray, np.ndarray]] = {}
    if laps is None or len(laps) == 0:
        return events
    for driver, group in laps.groupby("DriverNumber"):
        pit_in = group["PitInTime"].dropna()
        pit_out = group["PitOutTime"].dropna()
        in_ms = pit_in.dt.total_seconds() * 1000.0
        out_ms = pit_out.dt.total_seconds() * 1000.0
        in_times = in_ms.to_numpy()
        out_times = out_ms.to_numpy()
        times = np.concatenate([in_times, out_times])
        if times.size == 0:
            continue
        flags = np.concatenate([np.ones(in_times.size, bool), np.zeros(out_times.size, bool)])
        order = np.argsort(times, kind="stable")
        number = int(driver)
        events[number] = (times[order], flags[order])
    return events


def _in_pit_mask(grid: np.ndarray, pit_events: tuple[np.ndarray, np.ndarray]) -> np.ndarray:
    times, flags = pit_events
    idx = np.searchsorted(times, grid, side="right") - 1
    before_first = idx < 0
    safe_idx = np.clip(idx, 0, len(times) - 1)
    state = flags[safe_idx]
    # Before the first event the car is in the garage if that first event is a pit exit.
    starts_in_pit = not flags[0]
    return np.where(before_first, starts_in_pit, state)


def _position_data_range(session) -> tuple[int, int]:
    starts = []
    ends = []
    for telemetry in session.pos_data.values():
        if len(telemetry) == 0:
            continue
        times = telemetry["SessionTime"].dropna()
        if times.empty:
            continue
        first = times.min()
        last = times.max()
        starts.append(first.total_seconds() * 1000.0)
        ends.append(last.total_seconds() * 1000.0)
    if not starts:
        return 0, 0
    data_start = min(starts)
    data_end = max(ends)
    return int(data_start), int(data_end)


def _session_status_or_none(session):
    try:
        return session.session_status
    except Exception:
        return None


def _laps_with_positions(laps, session):
    keep = pd.Series(False, index=laps.index)
    for driver, telemetry in session.pos_data.items():
        valid = telemetry[(telemetry["X"] != 0) | (telemetry["Y"] != 0)]
        times = valid["SessionTime"].dropna()
        if times.empty:
            continue
        first = times.min()
        last = times.max()
        inside = (laps["DriverNumber"] == driver) & (laps["LapStartTime"] >= first) & (laps["Time"] <= last)
        keep |= inside
    return laps[keep]


def _downsample_outline(points: pd.DataFrame) -> list[list[int]]:
    step = max(1, len(points) // OUTLINE_MAX_POINTS)
    sampled = points.iloc[::step]
    xs = np.rint(sampled["X"].to_numpy())
    ys = np.rint(sampled["Y"].to_numpy())
    outline = [[int(x), int(y)] for x, y in zip(xs, ys)]
    first = outline[0]
    outline.append(list(first))
    return outline


def _sector_points(points: pd.DataFrame, lap) -> list[dict]:
    """Coordinates where sector 1 and 2 end, plus the timing line (start of the lap)."""
    seconds = points["SessionTime"].dt.total_seconds()
    times = seconds.to_numpy()
    xs = points["X"].to_numpy()
    ys = points["Y"].to_numpy()
    result = [{"sector": 0, "label": "finish", "x": int(round(xs[0])), "y": int(round(ys[0]))}]
    for sector, column in ((1, "Sector1SessionTime"), (2, "Sector2SessionTime")):
        boundary = lap.get(column)
        if boundary is None or pd.isna(boundary):
            continue
        at = boundary.total_seconds()
        x_at = np.interp(at, times, xs)
        y_at = np.interp(at, times, ys)
        result.append({"sector": sector, "label": f"end of S{sector}", "x": int(round(x_at)), "y": int(round(y_at))})
    return result


def _estimated_corners(telemetry) -> list[dict]:
    """Corners as speed minima of the reference lap when MultiViewer has no data for a circuit."""
    lap = pd.DataFrame(telemetry)
    if "Distance" not in lap:
        lap = telemetry.add_distance()
    lap = lap.dropna(subset=["Speed", "X", "Y", "Distance"])
    lap = lap[(lap["X"] != 0) | (lap["Y"] != 0)]
    if lap.empty:
        return []
    rolling = lap["Speed"].rolling(5, center=True, min_periods=1)
    speed = rolling.median().to_numpy()
    distance = lap["Distance"].to_numpy()
    xs = lap["X"].to_numpy()
    ys = lap["Y"].to_numpy()
    corners = []
    last_distance = -np.inf
    lap_length = distance.max()
    for i in range(len(speed)):
        if distance[i] < CORNER_MIN_WINDOW_M or distance[i] > lap_length - CORNER_MIN_WINDOW_M:
            continue
        near = np.abs(distance - distance[i]) <= CORNER_MIN_WINDOW_M
        around = np.abs(distance - distance[i]) <= CORNER_DROP_WINDOW_M
        is_minimum = speed[i] <= speed[near].min()
        drop = speed[around].max() - speed[i]
        if not is_minimum or drop < CORNER_MIN_DROP_KMH or distance[i] - last_distance < CORNER_MIN_WINDOW_M:
            continue
        last_distance = distance[i]
        corners.append({
            "number": len(corners) + 1,
            "letter": "",
            "x": float(xs[i]),
            "y": float(ys[i]),
            "angle": 0.0,
            "distance": float(distance[i]),
        })
    return corners


def _markers(frame: pd.DataFrame) -> list[dict]:
    if frame is None or frame.empty:
        return []
    rows = []
    for _, marker in frame.iterrows():
        letter = marker.get("Letter")
        rows.append({
            "number": int(marker["Number"]),
            "letter": "" if letter is None or pd.isna(letter) else str(letter),
            "x": float(marker["X"]),
            "y": float(marker["Y"]),
            "angle": float(marker["Angle"]),
            "distance": None if pd.isna(marker.get("Distance")) else float(marker["Distance"]),
        })
    return rows


def _empty_positions() -> pd.DataFrame:
    return pd.DataFrame({
        "t": pd.Series(dtype=np.int64),
        "driverNumber": pd.Series(dtype=np.int16),
        "x": pd.Series(dtype=np.int32),
        "y": pd.Series(dtype=np.int32),
        "status": pd.Series(dtype="category"),
    })
