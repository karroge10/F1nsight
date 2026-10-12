"""Per circuit reference for estimating car positions from the free timing feed.

Without an F1TV token the live hub sends no car positions, but every car still produces about
20 to 30 timestamped checkpoints a lap: each mini-sector (`TimingData` ... `Segments[j].Status`)
flips when the car completes it. A `CircuitReference` holds what is needed to turn those
checkpoints back into a moving car:

  polyline     the racing line of one clean lap with cumulative distance, starting at the
               timing line (the end of the last mini-sector)
  profile      the median fraction of a lap's time spent to reach each distance (a normalised
               speed profile, so a car can be advanced between checkpoints at its own pace)
  checkpoints  the distance of the end of every mini-sector, in feed order
  pit          the pit lane polyline, speed limit pace, box distance per team, and where the pit
               lane leaves and rejoins the track
  grid         grid slot coordinates by starting position (races only)

It is built from any recorded session at the same circuit in the free static archive (which
includes `Position.z` for past sessions): the timing checkpoints are matched with where the car
really was `TIMING_LAG_MS` before each flip was published. Distances and coordinates are in the
feed's units (decimetres).
"""

import json
import logging
import math
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from f1live import config
from f1live.decode import FeedMessage
from f1live.state import SessionState
from f1live.stores import PositionStore
from f1live.track import outline_from_positions

log = logging.getLogger(__name__)

REFERENCE_VERSION = 5
# Status of a mini-sector driven in the pit lane: not a timed pass on the track.
PIT_LANE_SEGMENT = 2064
VERTEX_SPACING_DM = 20
COARSE_STEP = 8
PROFILE_STEP_DM = 50
# A clean lap for the speed profile: within this factor of the best lap, no pit, green or yellow.
CLEAN_LAP_FACTOR = 1.12
GREEN_TRACK_CODES = {"1", "2"}
MAX_SPEED_DM_PER_MS = 1.0  # 100 m/s
PIT_STOP_MAX_MS = 60_000
PIT_VISIT_MAX_MS = 30 * 60_000
EXIT_BATCH_WINDOW_MS = 30_000
PIT_SPEED_DEFAULT = 0.22  # 80 km/h
PIT_SPEED_MAX = 0.28  # 100 km/h
RACE_STOP_MS = 2_500
PIT_STOP_LOSS_MS = 4_000  # braking into the box and accelerating out of it
STATIONARY_DM_PER_MS = 0.01  # below 1 m/s
GRID_SLOT_SPACING_DM = 80
MAX_REPEATED_SHARE = 0.1
MIN_PROFILE_LAPS = 10


class Polyline:
    """Closed polyline with cumulative distance. `point_at` and `project` are the two lookups."""

    def __init__(self, xs: np.ndarray, ys: np.ndarray, closed: bool = True) -> None:
        self.xs = np.asarray(xs, dtype=np.float64)
        self.ys = np.asarray(ys, dtype=np.float64)
        self.closed = closed
        dx = np.diff(self.xs)
        dy = np.diff(self.ys)
        steps = np.hypot(dx, dy)
        self.ss = np.concatenate([[0.0], np.cumsum(steps)])
        closing = math.hypot(self.xs[0] - self.xs[-1], self.ys[0] - self.ys[-1]) if closed else 0.0
        self.length = float(self.ss[-1] + closing)

    @classmethod
    def densified(cls, points: list[list[float]], spacing: float = VERTEX_SPACING_DM, closed: bool = True) -> "Polyline":
        raw = np.asarray(points, dtype=np.float64)
        if closed:
            raw = np.vstack([raw, raw[:1]])
        xs = [raw[0, 0]]
        ys = [raw[0, 1]]
        for (x0, y0), (x1, y1) in zip(raw[:-1], raw[1:]):
            gap = math.hypot(x1 - x0, y1 - y0)
            pieces = max(1, math.ceil(gap / spacing))
            for piece in range(1, pieces + 1):
                ratio = piece / pieces
                xs.append(x0 + (x1 - x0) * ratio)
                ys.append(y0 + (y1 - y0) * ratio)
        if closed:
            xs.pop()
            ys.pop()
        return cls(np.array(xs), np.array(ys), closed)

    def point_at(self, s: float) -> tuple[float, float]:
        if self.closed:
            s = s % self.length
        else:
            s = min(max(s, 0.0), float(self.ss[-1]))
        index = int(np.searchsorted(self.ss, s, side="right")) - 1
        index = max(0, index)
        last = len(self.xs) - 1
        if index >= last:
            if not self.closed:
                return float(self.xs[-1]), float(self.ys[-1])
            span = self.length - self.ss[last]
            ratio = (s - self.ss[last]) / span if span > 0 else 0.0
            x = self.xs[last] + (self.xs[0] - self.xs[last]) * ratio
            y = self.ys[last] + (self.ys[0] - self.ys[last]) * ratio
            return float(x), float(y)
        span = self.ss[index + 1] - self.ss[index]
        ratio = (s - self.ss[index]) / span if span > 0 else 0.0
        x = self.xs[index] + (self.xs[index + 1] - self.xs[index]) * ratio
        y = self.ys[index] + (self.ys[index + 1] - self.ys[index]) * ratio
        return float(x), float(y)

    def project(self, xs: np.ndarray, ys: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Nearest vertex distance along the line and the gap to it, for many points at once."""
        xs = np.asarray(xs, dtype=np.float32)
        ys = np.asarray(ys, dtype=np.float32)
        vx = self.xs.astype(np.float32)
        vy = self.ys.astype(np.float32)
        count = len(vx)
        # Coarse pass on every COARSE_STEP-th vertex, then the exact vertex in a window around it.
        coarse_x = vx[::COARSE_STEP]
        coarse_y = vy[::COARSE_STEP]
        offsets = np.arange(-COARSE_STEP - 4, COARSE_STEP + 5)
        nearest = np.empty(len(xs), dtype=np.int64)
        gaps = np.empty(len(xs), dtype=np.float64)
        chunk = max(1, 4_000_000 // max(1, len(coarse_x)))
        for start in range(0, len(xs), chunk):
            px = xs[start:start + chunk, None]
            py = ys[start:start + chunk, None]
            squared = (px - coarse_x) ** 2 + (py - coarse_y) ** 2
            rough = np.argmin(squared, axis=1) * COARSE_STEP
            window = rough[:, None] + offsets
            window = window % count if self.closed else np.clip(window, 0, count - 1)
            fine = (px - vx[window]) ** 2 + (py - vy[window]) ** 2
            best = np.argmin(fine, axis=1)
            rows = np.arange(len(best))
            nearest[start:start + chunk] = window[rows, best]
            gaps[start:start + chunk] = np.sqrt(fine[rows, best])
        return self.ss[nearest], gaps

    def project_near(self, x: float, y: float, hint: float, window: float) -> float:
        """Nearest vertex within `window` of the distance `hint` (keeps the right branch at crossings)."""
        low = hint - window
        high = hint + window
        offsets = np.arange(len(self.ss))
        if self.closed:
            relative = (self.ss - low) % self.length
            mask = relative <= high - low
        else:
            mask = (self.ss >= low) & (self.ss <= high)
        candidates = offsets[mask]
        if len(candidates) == 0:
            return hint
        squared = (self.xs[candidates] - x) ** 2 + (self.ys[candidates] - y) ** 2
        best = candidates[int(np.argmin(squared))]
        return float(self.ss[best])

    def as_points(self) -> list[list[int]]:
        return [[round(x), round(y)] for x, y in zip(self.xs, self.ys)]


@dataclass
class PitLane:
    line: Polyline
    entry_s: float          # track distance where the pit lane leaves the track
    exit_s: float           # track distance where it rejoins
    speed: float            # dm per ms while moving in the pit lane
    stop_ms: float          # median stationary time at the box
    lane_ms: float          # median pit lane time of a race stop, entry to exit
    boxes: dict[str, float] = field(default_factory=dict)  # team name to distance along the lane
    default_box: float = 0.0
    # Where the car is when the out-lap's pit lane mini-sectors (status 2064) are published.
    exit_batch_s: float | None = None
    # Stop and lane times measured on race stops (otherwise derived from the lane length).
    from_race: bool = False

    def box_for(self, team: str | None) -> float:
        if team and team in self.boxes:
            return self.boxes[team]
        return self.default_box


@dataclass
class CircuitReference:
    circuit_key: int
    source: str
    built_at: float
    line: Polyline
    profile_s: np.ndarray
    profile_tau: np.ndarray
    lap_ms: float
    layout: list[int]
    checkpoints: list[float]
    pit: PitLane | None = None
    grid: list[list[float]] = field(default_factory=list)
    grid_s: list[float] = field(default_factory=list)
    stats: dict = field(default_factory=dict)

    @property
    def length(self) -> float:
        return self.line.length

    @property
    def segment_count(self) -> int:
        return len(self.checkpoints)

    def tau(self, s: float) -> float:
        """Fraction of the reference lap time needed to reach distance `s` from the line."""
        return float(np.interp(s % self.length, self.profile_s, self.profile_tau))

    def tau_inverse(self, phase: float) -> float:
        return float(np.interp(phase, self.profile_tau, self.profile_s))

    def phase_of(self, progress: float) -> float:
        """Absolute progress (laps * length + s) to reference laps (laps + tau)."""
        laps = math.floor(progress / self.length)
        return laps + self.tau(progress - laps * self.length)

    def progress_of(self, phase: float) -> float:
        laps = math.floor(phase)
        return laps * self.length + self.tau_inverse(phase - laps)

    def checkpoints_for(self, layout: list[int]) -> list[float]:
        """Checkpoint distances for a live layout; maps a different mini-sector count by sector."""
        if layout == self.layout:
            return self.checkpoints
        return _remap_checkpoints(self, layout)

    def to_json(self) -> dict:
        pit = None
        if self.pit is not None:
            pit = {
                "outline": self.pit.line.as_points(),
                "entryS": self.pit.entry_s,
                "exitS": self.pit.exit_s,
                "speed": self.pit.speed,
                "stopMs": self.pit.stop_ms,
                "laneMs": self.pit.lane_ms,
                "exitBatchS": self.pit.exit_batch_s,
                "fromRace": self.pit.from_race,
                "boxes": self.pit.boxes,
                "defaultBox": self.pit.default_box,
            }
        return {
            "version": REFERENCE_VERSION,
            "circuitKey": self.circuit_key,
            "source": self.source,
            "builtAt": self.built_at,
            "outline": self.line.as_points(),
            "profileTau": [round(value, 5) for value in self.profile_tau.tolist()],
            "profileStep": PROFILE_STEP_DM,
            "lapMs": self.lap_ms,
            "layout": self.layout,
            "checkpoints": [round(value, 1) for value in self.checkpoints],
            "pit": pit,
            "grid": self.grid,
            "gridS": self.grid_s,
            "stats": self.stats,
        }

    @classmethod
    def from_json(cls, raw: dict) -> "CircuitReference":
        line = Polyline.densified(raw["outline"])
        tau = np.asarray(raw["profileTau"], dtype=np.float64)
        profile_s = _profile_grid(line.length, len(tau))
        pit = None
        if raw.get("pit"):
            item = raw["pit"]
            pit_line = Polyline.densified(item["outline"], closed=False)
            pit = PitLane(
                pit_line, item["entryS"], item["exitS"], item["speed"], item["stopMs"], item["laneMs"],
                item.get("boxes") or {}, item.get("defaultBox") or 0.0, item.get("exitBatchS"),
                bool(item.get("fromRace")),
            )
        return cls(
            circuit_key=raw["circuitKey"],
            source=raw["source"],
            built_at=raw.get("builtAt", 0.0),
            line=line,
            profile_s=profile_s,
            profile_tau=tau,
            lap_ms=raw["lapMs"],
            layout=raw["layout"],
            checkpoints=raw["checkpoints"],
            pit=pit,
            grid=raw.get("grid") or [],
            grid_s=raw.get("gridS") or [],
            stats=raw.get("stats") or {},
        )


def build_reference(
    messages: list[FeedMessage],
    positions: PositionStore,
    state: SessionState,
    circuit_key: int,
    source: str,
    lag_ms: int = config.TIMING_LAG_MS,
) -> CircuitReference | None:
    """Build a reference from a recorded session: timing messages plus its car positions."""
    started = time.perf_counter()
    repeated = repeated_share(positions)
    if repeated > MAX_REPEATED_SHARE:
        log.warning("reference: %s repeats %.0f%% of moving samples, not usable", source, repeated * 100)
        return None
    shape = outline_from_positions(positions, state)
    if shape is None:
        return None
    line = Polyline.densified(shape["outline"])
    timeline = _TimingTimeline.from_messages(messages, lag_ms)
    if timeline.layout is None:
        return None
    progress = {}
    for number in positions.numbers():
        track = _track_car(line, positions, number)
        if track is not None:
            progress[number] = track
    raw_checkpoints = _calibrate_checkpoints(line, timeline, progress)
    if raw_checkpoints is None:
        return None
    # Start the line at the end of the last mini-sector, so a lap is exactly one turn of it.
    shift = raw_checkpoints[-1] % line.length
    line = _rotated(line, shift)
    checkpoints = [(value - shift) % line.length for value in raw_checkpoints]
    checkpoints = _monotonic_checkpoints(checkpoints, line.length)
    for track in progress.values():
        track.p -= shift
    profile_s, profile_tau, lap_ms, laps_used = _speed_profile(line.length, timeline, progress)
    if laps_used < MIN_PROFILE_LAPS:
        log.warning("reference: only %s clean laps in %s", laps_used, source)
        return None
    is_race = state.session_info().get("Type") == "Race"
    pit, stops_used = _pit_lane(line, timeline, positions, progress, is_race)
    grid, grid_s = _grid_slots(line, timeline, positions, state)
    stats = {
        "lapsInProfile": laps_used,
        "checkpointSamples": timeline.pass_count,
        "pitStopsUsed": stops_used,
        "repeatedSamples": round(repeated, 4),
        "buildSeconds": round(time.perf_counter() - started, 1),
    }
    return CircuitReference(
        circuit_key=circuit_key,
        source=source,
        built_at=time.time(),
        line=line,
        profile_s=profile_s,
        profile_tau=profile_tau,
        lap_ms=lap_ms,
        layout=timeline.layout,
        checkpoints=checkpoints,
        pit=pit,
        grid=grid,
        grid_s=grid_s,
        stats=stats,
    )


def repeated_share(positions: PositionStore) -> float:
    """Share of samples that repeat the previous position although the car was moving.

    Healthy archives repeat almost none (0.1 %); the 2026 Hungarian GP weekend repeats about half
    of them and has impossible jumps, which makes it useless as a reference or as ground truth.
    """
    repeated = 0
    moving = 0
    for number in positions.numbers():
        rows = positions.window(number, 0, 2**62)
        if len(rows) < 3:
            continue
        xs = np.array([row[1] for row in rows], dtype=np.float64)
        ys = np.array([row[2] for row in rows], dtype=np.float64)
        dx = np.diff(xs)
        dy = np.diff(ys)
        steps = np.hypot(dx, dy)
        was_moving = steps[:-1] > 50
        moving += int(was_moving.sum())
        repeated += int((was_moving & (steps[1:] == 0)).sum())
    return repeated / moving if moving else 0.0


def reference_path(circuit_key: int) -> Path:
    return config.ESTIMATOR_CACHE_DIR / f"reference_{circuit_key}.json"


def load_reference(circuit_key: int | None) -> CircuitReference | None:
    if not circuit_key:
        return None
    path = reference_path(circuit_key)
    if not path.exists():
        return None
    try:
        text = path.read_text(encoding="utf-8")
        raw = json.loads(text)
        if raw.get("version") != REFERENCE_VERSION:
            return None
        return CircuitReference.from_json(raw)
    except (OSError, ValueError, KeyError):
        log.warning("unreadable estimator reference %s", path)
        return None


def save_reference(reference: CircuitReference) -> None:
    path = reference_path(reference.circuit_key)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = reference.to_json()
    text = json.dumps(payload)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(text, encoding="utf-8")
    temporary.replace(path)


# Pass detection, shared by the builder and the live estimator.


def segment_layout(messages: list[FeedMessage]) -> list[int] | None:
    """Mini-sector count per sector, from the highest segment index any TimingData update uses.

    The first full TimingData object has no segments; they appear later as index-keyed deltas.
    """
    highest: dict[int, int] = {}
    for message in messages:
        if message.topic != "TimingData":
            continue
        for line in (message.data.get("Lines") or {}).values():
            if isinstance(line, dict):
                note_segment_indexes(line, highest)
    if not highest or len(highest) < 3:
        return None
    return [highest.get(sector, -1) + 1 for sector in range(max(highest) + 1)]


def note_segment_indexes(line: dict, highest: dict[int, int]) -> None:
    """Record the highest segment index per sector used by one TimingData line delta."""
    for sector_index, segments in _segment_containers(line):
        if isinstance(segments, dict):
            indexes = [int(key) for key in segments]
        else:
            indexes = [len(segments) - 1] if segments else []
        if indexes:
            current = highest.get(sector_index, -1)
            highest[sector_index] = max(current, max(indexes))


def segment_statuses(line: dict, offsets: list[int]) -> list[tuple[int, int]]:
    """(flat mini-sector index, status) for every segment status in a TimingData line delta."""
    found = []
    for sector_index, segments in _segment_containers(line):
        if sector_index >= len(offsets):
            continue
        if isinstance(segments, dict):
            segment_items = [(int(key), value) for key, value in segments.items()]
        else:
            segment_items = list(enumerate(segments))
        for segment_index, segment in segment_items:
            if isinstance(segment, dict) and "Status" in segment:
                flat = offsets[sector_index] + segment_index
                found.append((flat, int(segment.get("Status") or 0)))
    return found


def segment_offsets(layout: list[int]) -> list[int]:
    offsets = []
    total = 0
    for count in layout:
        offsets.append(total)
        total += count
    return offsets


def _segment_containers(line: dict) -> list[tuple[int, dict | list]]:
    sectors = line.get("Sectors")
    if isinstance(sectors, dict):
        sector_items = [(int(key), value) for key, value in sectors.items()]
    elif isinstance(sectors, list):
        sector_items = list(enumerate(sectors))
    else:
        return []
    containers = []
    for sector_index, sector in sector_items:
        if not isinstance(sector, dict):
            continue
        segments = sector.get("Segments")
        if isinstance(segments, (dict, list)):
            containers.append((sector_index, segments))
    return containers


class PassCounter:
    """Turns mini-sector status updates of one car into passes with an absolute index.

    A pass at flat index `m` gets the smallest absolute index above the last pass that is `m`
    modulo the segment count, and is accepted only up to half a lap ahead, so a status that is
    re-sent or corrected (2051 then 2049) is not counted twice, while the lap reset (which sets
    the first segment and zeroes the rest in one message) still counts.
    """

    def __init__(self, segment_count: int) -> None:
        self.count = segment_count
        self.last: int | None = None
        self.statuses: dict[int, int] = {}
        self._pending: int | None = None

    def passes(self, updates: list[tuple[int, int]], base_lap: int = 0) -> list[tuple[int, int]]:
        """Accepted (absolute index, status) for the nonzero updates of one message."""
        updates = [(flat, status) for flat, status in updates if flat < self.count]
        is_reset = any(status == 0 for _, status in updates)
        fresh = []
        for flat, status in updates:
            previous = self.statuses.get(flat, 0)
            self.statuses[flat] = status
            # Only a segment going from unset to set is a pass. A set segment that changes colour
            # later (2048 to 2049 after a personal best) is not, unless the same message resets
            # the lap (it sets the first segment and zeroes the others).
            if status and (previous == 0 or is_reset):
                fresh.append((flat, status))
        if not fresh:
            return []
        if self.last is None:
            first_flat = min(flat for flat, _ in fresh)
            self.last = base_lap * self.count + first_flat - 1
        candidates = []
        rejected = []
        for flat, status in fresh:
            ahead = (flat - self.last) % self.count
            if ahead == 0:
                continue
            absolute = self.last + ahead
            behind = self.count - ahead
            if ahead <= self.count // 2:
                candidates.append((absolute, status))
            elif behind > self.count // 4:
                rejected.append((absolute, status))
            # Otherwise it is a late or out of order copy of a segment just passed (a pit lane
            # batch can arrive as 25, 22, 23, 24): ignore it.
        if not candidates and rejected:
            # Two consecutive mini-sectors far ahead of the last pass mean updates were missed
            # (a reconnect, a car leaving the garage): resynchronise instead of waiting forever.
            rejected.sort()
            first = rejected[0][0]
            if self._pending is not None and first == self._pending + 1:
                candidates = rejected
            self._pending = rejected[-1][0]
        candidates.sort()
        if candidates:
            self.last = candidates[-1][0]
            self._pending = None
        return candidates

    def seed(self, absolute: int) -> None:
        self.last = absolute
        self._pending = None


# Internals of the builder.


@dataclass
class _CarTrack:
    t: np.ndarray        # sample times (utc ms)
    p: np.ndarray        # unwrapped progress along the line (dm)
    gap: np.ndarray      # distance from the line (dm)

    def progress_at(self, utc: float) -> float | None:
        index = int(np.searchsorted(self.t, utc))
        if index <= 0 or index >= len(self.t):
            return None
        t0 = self.t[index - 1]
        t1 = self.t[index]
        if t1 - t0 > 2_000:
            return None
        ratio = (utc - t0) / (t1 - t0)
        return float(self.p[index - 1] + (self.p[index] - self.p[index - 1]) * ratio)


@dataclass
class _Pass:
    number: str
    absolute: int
    flat: int
    utc: int
    status: int


@dataclass
class _TimingTimeline:
    """Everything the builder needs from the timing feed, with times shifted back by the lag."""

    layout: list[int] | None
    passes: list[_Pass]
    pit_in: dict[str, list[int]]
    pit_out: dict[str, list[int]]
    track_changes: list[tuple[int, str]]
    started_utc: int | None
    teams: dict[str, str]
    exit_batches: list[tuple[str, int]] = field(default_factory=list)
    pass_count: int = 0

    @classmethod
    def from_messages(cls, messages: list[FeedMessage], lag_ms: int) -> "_TimingTimeline":
        layout = segment_layout(messages)
        offsets = segment_offsets(layout) if layout else []
        counters: dict[str, PassCounter] = {}
        in_pit: dict[str, bool] = {}
        passes = []
        pit_in: dict[str, list[int]] = {}
        pit_out: dict[str, list[int]] = {}
        track_changes = []
        started = None
        teams = {}
        exit_batches = []
        batch_seen: dict[str, int] = {}
        for message in messages:
            effective = message.utc - lag_ms
            if message.topic == "TrackStatus":
                code = str(message.data.get("Status", "1"))
                track_changes.append((effective, code))
                continue
            if message.topic == "SessionStatus":
                if message.data.get("Status") == "Started" and started is None:
                    started = effective
                continue
            if message.topic == "DriverList":
                for number, info in message.data.items():
                    if isinstance(info, dict) and info.get("TeamName"):
                        teams[number] = info["TeamName"]
                continue
            if message.topic != "TimingData":
                continue
            lines = message.data.get("Lines") or {}
            for number, line in lines.items():
                if not isinstance(line, dict):
                    continue
                if "InPit" in line:
                    now_in = bool(line["InPit"])
                    if now_in and not in_pit.get(number):
                        pit_in.setdefault(number, []).append(effective)
                    in_pit[number] = now_in
                if line.get("PitOut"):
                    pit_out.setdefault(number, []).append(effective)
                if layout is None:
                    continue
                updates = segment_statuses(line, offsets)
                counter = counters.get(number)
                if counter is None:
                    counter = PassCounter(sum(layout))
                    counters[number] = counter
                for absolute, status in counter.passes(updates):
                    flat = absolute % counter.count
                    timed = status != PIT_LANE_SEGMENT and not in_pit.get(number)
                    if timed:
                        passes.append(_Pass(number, absolute, flat, effective, status))
                    last_exit = (pit_out.get(number) or [None])[-1]
                    is_exit_batch = (
                        status == PIT_LANE_SEGMENT and not in_pit.get(number) and last_exit is not None
                        and effective - last_exit < EXIT_BATCH_WINDOW_MS and batch_seen.get(number) != last_exit
                    )
                    if is_exit_batch:
                        batch_seen[number] = last_exit
                        exit_batches.append((number, effective))
        timeline = cls(layout, passes, pit_in, pit_out, track_changes, started, teams, exit_batches)
        timeline.pass_count = len(passes)
        return timeline

    def track_code_at(self, utc: int) -> str:
        code = "1"
        for change_utc, change_code in self.track_changes:
            if change_utc > utc:
                break
            code = change_code
        return code

    def green_between(self, start: int, end: int) -> bool:
        if self.track_code_at(start) not in GREEN_TRACK_CODES:
            return False
        for change_utc, code in self.track_changes:
            if start < change_utc < end and code not in GREEN_TRACK_CODES:
                return False
        return True

    def in_pit_between(self, number: str, start: int, end: int) -> bool:
        for moment in self.pit_in.get(number, []) + self.pit_out.get(number, []):
            if start - 5_000 <= moment <= end + 5_000:
                return True
        return False


def _track_car(line: Polyline, positions: PositionStore, number: str) -> _CarTrack | None:
    samples = positions.window(number, 0, 2**62)
    if len(samples) < 50:
        return None
    times = np.array([row[0] for row in samples], dtype=np.int64)
    xs = np.array([row[1] for row in samples], dtype=np.float64)
    ys = np.array([row[2] for row in samples], dtype=np.float64)
    raw_s, gaps = line.project(xs, ys)
    unwrapped = _unwrap(line, times, xs, ys, raw_s)
    return _CarTrack(times, unwrapped, gaps)


def _unwrap(line: Polyline, times: np.ndarray, xs: np.ndarray, ys: np.ndarray, raw_s: np.ndarray) -> np.ndarray:
    """Continuous progress from nearest vertex distances; fixes jumps to the wrong branch."""
    length = line.length
    s = np.asarray(raw_s, dtype=np.float64).copy()
    elapsed = np.diff(times).astype(np.float64)
    limits = MAX_SPEED_DM_PER_MS * elapsed + 200
    raw_deltas = np.diff(s)
    deltas = _wrap(raw_deltas, length)
    implausible = ((deltas > limits) | (deltas < -200)) & (elapsed < 5_000)
    queue = (np.nonzero(implausible)[0] + 1).tolist()
    pointer = 0
    while pointer < len(queue):
        index = queue[pointer]
        pointer += 1
        delta = _wrap(s[index] - s[index - 1], length)
        limit = limits[index - 1]
        if not ((delta > limit or delta < -200) and elapsed[index - 1] < 5_000):
            continue
        s[index] = line.project_near(xs[index], ys[index], s[index - 1], limit + 400)
        following = index + 1
        # A fixed sample changes the next step too; check it even if it looked plausible before.
        if following < len(s) and (pointer >= len(queue) or queue[pointer] != following):
            queue.insert(pointer, following)
    raw_steps = np.diff(s)
    steps = _wrap(raw_steps, length)
    return s[0] + np.concatenate([[0.0], np.cumsum(steps)])


def _wrap(values, length: float):
    """Signed distance along a closed line, in (-length / 2, length / 2]."""
    return (values + length / 2) % length - length / 2


def _calibrate_checkpoints(line: Polyline, timeline: _TimingTimeline, progress: dict[str, _CarTrack]) -> list[float] | None:
    count = sum(timeline.layout)
    length = line.length
    by_flat: dict[int, list[float]] = {flat: [] for flat in range(count)}
    for item in timeline.passes:
        track = progress.get(item.number)
        if track is None:
            continue
        if not timeline.green_between(item.utc - 1_000, item.utc + 1_000):
            continue
        value = track.progress_at(item.utc)
        if value is None:
            continue
        by_flat[item.flat].append(value % length)
    if any(len(values) < 5 for values in by_flat.values()):
        missing = [flat for flat, values in by_flat.items() if len(values) < 5]
        log.warning("reference: too few samples for mini-sectors %s", missing)
        if len(missing) > count // 3:
            return None
    medians = []
    for flat in range(count):
        values = by_flat[flat]
        medians.append(_circular_median(values, length) if values else None)
    return _fill_missing(medians, length)


def _speed_profile(length: float, timeline: _TimingTimeline, progress: dict[str, _CarTrack]):
    grid_size = max(10, int(length // PROFILE_STEP_DM) + 1)
    grid = _profile_grid(length, grid_size)
    laps = []
    for number, track in progress.items():
        first_lap = math.ceil(track.p[0] / length)
        last_lap = math.floor(track.p[-1] / length)
        monotone = np.maximum.accumulate(track.p)
        crossings = []
        for lap in range(first_lap, last_lap + 1):
            utc = _crossing_time(track, monotone, lap * length)
            crossings.append((lap, utc))
        for (lap, start), (_, end) in zip(crossings[:-1], crossings[1:]):
            if start is None or end is None:
                continue
            duration = end - start
            if duration < 30_000 or duration > 400_000:
                continue
            laps.append((number, lap, start, end, duration))
    if not laps:
        return grid, grid / length, 90_000.0, 0
    best = min(item[4] for item in laps)
    profiles = []
    durations = []
    for number, lap, start, end, duration in laps:
        if duration > best * CLEAN_LAP_FACTOR:
            continue
        if not timeline.green_between(start, end) or timeline.in_pit_between(number, start, end):
            continue
        track = progress[number]
        window = (track.t >= start - 1_000) & (track.t <= end + 1_000)
        lap_s = track.p[window] - lap * length
        lap_t = track.t[window]
        if len(lap_s) < 40 or np.any(np.diff(lap_s) < -50):
            continue
        monotone_s = np.maximum.accumulate(lap_s)
        reach = np.interp(grid, monotone_s, lap_t)
        phase = (reach - start) / duration
        profiles.append(phase)
        durations.append(duration)
    if not profiles:
        return grid, grid / length, float(best), 0
    stacked = np.vstack(profiles)
    tau = np.median(stacked, axis=0)
    tau[0] = 0.0
    tau[-1] = 1.0
    tau = np.clip(tau, 0.0, 1.0)
    tau = np.maximum.accumulate(tau)
    # Strictly increasing so the inverse is defined everywhere.
    tau = tau + np.linspace(0.0, 1e-6, len(tau))
    tau = tau / tau[-1]
    lap_ms = float(np.median(durations))
    return grid, tau, lap_ms, len(profiles)


def _pit_lane(
    line: Polyline,
    timeline: "_TimingTimeline",
    positions: PositionStore,
    progress: dict[str, "_CarTrack"],
    is_race: bool,
) -> tuple[PitLane | None, int]:
    """Pit lane from every pit visit (race stops and garage visits): InPit to PitOut, moving samples."""
    visits = []
    for number, entries in timeline.pit_in.items():
        exits = timeline.pit_out.get(number, [])
        for entry in entries:
            exit_utc = next((moment for moment in exits if moment > entry), None)
            if exit_utc is None or exit_utc - entry > PIT_VISIT_MAX_MS:
                continue
            samples = positions.window(number, entry - 500, exit_utc + 500)
            visit = _pit_visit(number, entry, exit_utc, samples)
            if visit is not None:
                visits.append(visit)
    if not visits:
        return None, 0
    stops = [visit for visit in visits if visit["duration"] <= PIT_STOP_MAX_MS]
    pool = stops or visits
    lengths = sorted(visit["length"] for visit in pool)
    median_length = lengths[len(lengths) // 2]
    chosen = min(pool, key=lambda visit: abs(visit["length"] - median_length))
    pit_line = Polyline.densified(chosen["points"], closed=False)
    first = chosen["points"][0]
    last = chosen["points"][-1]
    entry_s, _ = line.project([first[0]], [first[1]])
    exit_s, _ = line.project([last[0]], [last[1]])
    box_by_team: dict[str, list[float]] = {}
    for visit in visits:
        team = timeline.teams.get(visit["number"])
        if team is None or visit["box"] is None:
            continue
        box_s, gap = pit_line.project([visit["box"][0]], [visit["box"][1]])
        if gap[0] < 300:
            box_by_team.setdefault(team, []).append(float(box_s[0]))
    boxes = {team: float(np.median(values)) for team, values in box_by_team.items()}
    all_boxes = [value for values in box_by_team.values() for value in values]
    default_box = float(np.median(all_boxes)) if all_boxes else pit_line.length / 2
    speeds = [visit["speed"] for visit in visits if visit["speed"]]
    stationary = [visit["still_ms"] for visit in stops]
    durations = [visit["duration"] for visit in stops]
    batch_s = []
    for number, moment in timeline.exit_batches:
        track = progress.get(number)
        value = track.progress_at(moment) if track is not None else None
        if value is not None:
            batch_s.append(value % line.length)
    speed = float(np.median(speeds)) if speeds else PIT_SPEED_DEFAULT
    from_race = is_race and len(stops) >= 3
    if from_race:
        stop_ms = float(np.median(stationary))
        lane_ms = float(np.median(durations))
    else:
        # Garage visits and queues in practice or qualifying say nothing about a race stop.
        stop_ms = RACE_STOP_MS
        lane_ms = pit_line.length / speed + RACE_STOP_MS + PIT_STOP_LOSS_MS
    pit = PitLane(
        line=pit_line,
        entry_s=float(entry_s[0]),
        exit_s=float(exit_s[0]),
        speed=speed,
        stop_ms=stop_ms,
        lane_ms=lane_ms,
        from_race=from_race,
        boxes=boxes,
        default_box=default_box,
        exit_batch_s=_circular_median(batch_s, line.length) if len(batch_s) >= 3 else None,
    )
    return pit, len(visits)


def _pit_visit(number: str, entry: int, exit_utc: int, samples: list) -> dict | None:
    """Path, speed limit pace and box (where the car stood or went silent) of one pit visit."""
    if len(samples) < 20:
        return None
    times = np.array([row[0] for row in samples], dtype=np.float64)
    xs = np.array([row[1] for row in samples], dtype=np.float64)
    ys = np.array([row[2] for row in samples], dtype=np.float64)
    dx = np.diff(xs)
    dy = np.diff(ys)
    steps = np.hypot(dx, dy)
    elapsed = np.diff(times)
    elapsed[elapsed <= 0] = 1
    rates = steps / elapsed
    moving = rates > STATIONARY_DM_PER_MS
    keep = np.concatenate([[True], moving])
    points = [[float(x), float(y)] for x, y in zip(xs[keep], ys[keep])]
    if len(points) < 10:
        return None
    still = ~moving
    box = None
    if still.any():
        indexes = np.nonzero(still)[0]
        middle = indexes[len(indexes) // 2]
        box = [float(xs[middle]), float(ys[middle])]
    else:
        widest = int(np.argmax(elapsed))
        if elapsed[widest] > 3_000:
            box = [float(xs[widest]), float(ys[widest])]
    cruising = rates[(rates > STATIONARY_DM_PER_MS * 5) & (rates < PIT_SPEED_MAX)]
    return {
        "number": number,
        "duration": exit_utc - entry,
        "points": points,
        "length": float(steps[moving].sum()),
        "box": box,
        # The speed limiter pace: a high percentile, since cars also crawl in and out of boxes.
        "speed": float(np.percentile(cruising, 80)) if len(cruising) else None,
        "still_ms": float(elapsed[still].sum()),
    }


def merge_missing(reference: CircuitReference, older: CircuitReference | None) -> CircuitReference:
    """Fill what a session cannot provide (grid slots outside races, a pit lane) from an older
    reference of the same circuit, re-projected onto the new line."""
    if older is None or older.circuit_key != reference.circuit_key:
        return reference
    if not reference.grid and older.grid:
        slots = [slot for slot in older.grid if slot]
        xs = [slot[0] for slot in slots]
        ys = [slot[1] for slot in slots]
        projected, _ = reference.line.project(xs, ys)
        values = iter(projected.tolist())
        reference.grid = older.grid
        reference.grid_s = [next(values) if slot else None for slot in older.grid]
        reference.stats["gridFrom"] = older.source
    if reference.pit is not None and not reference.pit.from_race and older.pit is not None and older.pit.from_race:
        reference.pit.stop_ms = older.pit.stop_ms
        reference.pit.lane_ms = older.pit.lane_ms
        reference.stats["pitTimesFrom"] = older.source
    if reference.pit is None and older.pit is not None:
        pit = older.pit
        entry_xy = pit.line.point_at(0.0)
        exit_xy = pit.line.point_at(pit.line.length)
        entry_s, _ = reference.line.project([entry_xy[0]], [entry_xy[1]])
        exit_s, _ = reference.line.project([exit_xy[0]], [exit_xy[1]])
        pit.entry_s = float(entry_s[0])
        pit.exit_s = float(exit_s[0])
        reference.pit = pit
        reference.stats["pitFrom"] = older.source
    return reference


def _grid_slots(line: Polyline, timeline: _TimingTimeline, positions: PositionStore, state: SessionState):
    """Grid slot coordinates by grid position, from where cars stood at the start."""
    if timeline.started_utc is None or state.session_info().get("Type") != "Race":
        return [], []
    moment = timeline.started_utc - 1_000
    order = _grid_order(state)
    slots = []
    for number in order:
        sample = positions.sample(number, moment)
        if sample is None or sample.age_ms > 5_000:
            slots.append(None)
            continue
        slots.append([round(sample.x), round(sample.y)])
    if not any(slots):
        return [], []
    xs = [slot[0] for slot in slots if slot]
    ys = [slot[1] for slot in slots if slot]
    s_values, _ = line.project(xs, ys)
    grid_s_known = iter(s_values.tolist())
    grid_s = []
    for slot in slots:
        grid_s.append(next(grid_s_known) if slot else None)
    _fill_grid(slots, grid_s, line)
    return slots, grid_s


def _grid_order(state: SessionState) -> list[str]:
    """Car numbers in starting order: the grid position the timing app holds for each car."""
    app_lines = state.app_lines()
    ordered = []
    for number, line in app_lines.items():
        grid = line.get("GridPos")
        if grid and str(grid).isdigit():
            ordered.append((int(grid), number))
    if ordered:
        ordered.sort()
        return [number for _, number in ordered]
    lines = state.timing_lines()
    by_line = sorted(lines, key=lambda number: lines[number].get("Line") or 99)
    return by_line


def _fill_grid(slots: list, grid_s: list, line: Polyline) -> None:
    """Slots of cars that did not start: extend from the nearest known slot."""
    length = line.length
    for index, slot in enumerate(slots):
        if slot is not None:
            continue
        known = [(abs(other - index), other) for other, value in enumerate(slots) if value is not None]
        if not known:
            return
        _, nearest = min(known)
        distance = grid_s[nearest] - (index - nearest) * GRID_SLOT_SPACING_DM
        grid_s[index] = distance % length
        x, y = line.point_at(distance)
        slots[index] = [round(x), round(y)]


def _remap_checkpoints(reference: CircuitReference, layout: list[int]) -> list[float]:
    """Spread a different number of mini-sectors over each reference sector, by reference time."""
    old_offsets = segment_offsets(reference.layout)
    sector_ends = []
    for sector, count in enumerate(reference.layout):
        sector_ends.append(reference.checkpoints[old_offsets[sector] + count - 1])
    checkpoints = []
    start = 0.0
    for sector, count in enumerate(layout):
        end = sector_ends[sector] if sector < len(sector_ends) else reference.length
        if sector == len(layout) - 1:
            end = reference.length
        start_phase = reference.tau(start)
        end_phase = 1.0 if end >= reference.length else reference.tau(end)
        for index in range(count):
            phase = start_phase + (end_phase - start_phase) * (index + 1) / count
            checkpoints.append(reference.tau_inverse(phase))
        start = end
    checkpoints[-1] = reference.length
    return checkpoints


def _rotated(line: Polyline, shift: float) -> Polyline:
    """The same closed line starting `shift` further along."""
    start_x, start_y = line.point_at(shift)
    index = int(np.searchsorted(line.ss, shift % line.length, side="right"))
    xs = np.concatenate([[start_x], line.xs[index:], line.xs[:index]])
    ys = np.concatenate([[start_y], line.ys[index:], line.ys[:index]])
    return Polyline(xs, ys)


def _monotonic_checkpoints(checkpoints: list[float], length: float) -> list[float]:
    out = []
    previous = 0.0
    for index, value in enumerate(checkpoints):
        if index == len(checkpoints) - 1:
            out.append(length)
            break
        value = value if value > previous else previous + 10.0
        out.append(value)
        previous = value
    return out


def _circular_median(values: list[float], length: float) -> float:
    angles = np.asarray(values) / length * 2 * math.pi
    mean_sin = np.sin(angles).mean()
    mean_cos = np.cos(angles).mean()
    centre = math.atan2(mean_sin, mean_cos)
    centre_s = (centre / (2 * math.pi) * length) % length
    relative = (np.asarray(values) - centre_s + length / 2) % length - length / 2
    return float((centre_s + np.median(relative)) % length)


def _fill_missing(medians: list[float | None], length: float) -> list[float]:
    known = [(index, value) for index, value in enumerate(medians) if value is not None]
    out = []
    for index, value in enumerate(medians):
        if value is not None:
            out.append(value)
            continue
        before = max((item for item in known if item[0] < index), default=known[-1])
        after = min((item for item in known if item[0] > index), default=known[0])
        span = (after[1] - before[1]) % length
        steps = (after[0] - before[0]) % len(medians)
        ratio = (index - before[0]) % len(medians) / steps if steps else 0.5
        out.append((before[1] + span * ratio) % length)
    return out


def _crossing_time(track: _CarTrack, monotone: np.ndarray, target: float) -> float | None:
    index = int(np.searchsorted(monotone, target))
    if index <= 0 or index >= len(monotone):
        return None
    p0 = monotone[index - 1]
    p1 = monotone[index]
    if p1 == p0:
        return None
    t0 = track.t[index - 1]
    t1 = track.t[index]
    if t1 - t0 > 2_000:
        return None
    return float(t0 + (t1 - t0) * (target - p0) / (p1 - p0))


def _profile_grid(length: float, size: int) -> np.ndarray:
    return np.linspace(0.0, length, size)
