"""PositionEstimator: car positions reconstructed from the anonymous timing feed.

The live hub gives every timing topic without a token. Each car flips about 20 to 30
mini-sectors a lap, each flip published about TIMING_LAG_MS after the car got there. With a
`CircuitReference` (the racing line, where each mini-sector ends, and a normalised speed
profile) every flip becomes an anchor: the car was at distance d at time t. Between anchors the
car is moved along the line at the reference speed profile, scaled to its own pace:

- when the next anchor is already known (the map is drawn behind the feed), interpolate
  between the two anchors in reference time, so the car follows the reference speed shape;
- otherwise extrapolate: the next mini-sector is expected to take what this car needed for the
  same mini-sector on its previous lap, scaled by its recent pace ratio (which absorbs safety
  car and VSC slowdowns after one or two mini-sectors), with a soft clamp so it never passes the
  next checkpoint before the feed says so;
- when a new anchor arrives the change is blended in over BLEND_MS instead of teleporting.

Pit lane: `InPit` is an anchor at the pit entry, the car follows the reference pit lane polyline
at the speed limit, waits at its team's box, and `PitOut` is an anchor at the pit exit. Before
a race start the cars hold their grid slots; the start (SessionStatus Started) launches them
with a standing start. `Stopped` and `Retired` freeze the car where it was.

Everything is in feed coordinates (decimetres) and UTC milliseconds.
"""

import math
from bisect import bisect_right
from dataclasses import dataclass, field

from f1live import config
from f1live.decode import FeedMessage
from f1live.stores import PositionStore
from f1live.reference import (
    PIT_LANE_SEGMENT,
    CircuitReference,
    PassCounter,
    note_segment_indexes,
    segment_offsets,
    segment_statuses,
)

BLEND_MS = 1_500
# Cars leave the grid about 1 s before SessionStatus "Started" is published (2026 races).
START_LAG_MS = 1_000
CLAMP_START = 0.9
CLAMP_ROOM = 0.09
RECENT_RATIOS = 3
RATIO_MAX_AGE_MS = 45_000
STANDING_START_ACCEL = 1.0e-4  # dm per ms squared (10 m/s2)
FORMATION_ACCEL = 2.0e-5  # 2 m/s2 when leaving the grid for the formation lap
MAX_SPEED = 0.95  # dm per ms (95 m/s)
PIT_EXIT_HOLD_DM = 50
# A car still in the pit this long after a usual stop would have ended is in its garage.
GARAGE_AFTER_MS = 15_000
PIT_QUEUE_SPACING_DM = 90
STUCK_PIT_MS = 20_000
EXIT_BATCH_WINDOW_MS = 30_000
# Learning from delayed real positions.
TRUTH_MARGIN_MS = 2_000
TRUTH_MAX_AGE_MS = 1_000
TRUTH_MAX_GAP_DM = 300
TRUTH_RESIDUALS = 30
TRUTH_MIN_RESIDUALS = 3
TRUTH_MAX_OFFSET_DM = 3_000
# Expected pace change when the track status flips after the last anchor (lap time factor).
NEUTRALISED_FACTOR = 1.4
NEUTRALISED_CODES = {"4", "6", "7"}
RED_CODE = "5"


@dataclass(slots=True)
class EstimatedSample:
    x: float
    y: float
    status: str          # onTrack, pit, stopped, retired, grid
    progress: float      # absolute progress along the line (dm)
    on_line: bool        # False when the car is on the pit lane or a grid slot


@dataclass(slots=True)
class _Anchor:
    t: int
    kind: str            # pass, pitEntry, pitExit, grid, seed
    k: int               # absolute index of the last checkpoint at or before this point
    s: float | None      # track distance of the anchor when it is not a checkpoint


@dataclass
class _Car:
    counter: PassCounter
    anchors: list[_Anchor] = field(default_factory=list)
    anchor_times: list[int] = field(default_factory=list)
    previous_span: dict[int, float] = field(default_factory=dict)
    recent_ratios: list[tuple[int, float]] = field(default_factory=list)
    reference_ratios: list[tuple[int, float]] = field(default_factory=list)
    pit_entries: list[int] = field(default_factory=list)
    pit_exits: list[int] = field(default_factory=list)
    in_pit: bool = False
    stopped_at: int | None = None
    retired_at: int | None = None
    frozen: EstimatedSample | None = None
    corrections: list[tuple[int, float]] = field(default_factory=list)
    laps: int | None = None
    team: str | None = None
    grid_position: int | None = None


class PositionEstimator:
    def __init__(
        self,
        reference: CircuitReference | None = None,
        lag_ms: int = config.TIMING_LAG_MS,
        render_delay_ms: int = config.LIVE_RENDER_DELAY_MS,
    ) -> None:
        self.lag_ms = lag_ms
        self.render_delay_ms = render_delay_ms
        self.reference: CircuitReference | None = None
        self.layout: list[int] | None = None
        self.checkpoints: list[float] = []
        self._offsets: list[int] = []
        self._cars: dict[str, _Car] = {}
        self._race_like = False
        self._started_at: int | None = None
        self._track_changes: list[tuple[int, str]] = []
        self._highest_segment: dict[int, int] = {}
        self._observed_layout: list[int] | None = None
        # Per mini-sector corrections of the reference distances, learnt from delayed real positions.
        self._flat_offsets: dict[int, float] = {}
        self._truth_residuals: dict[int, list[float]] = {}
        self._truth_checked: dict[str, int] = {}
        self.feed_utc = 0
        if reference is not None:
            self.set_reference(reference)

    @property
    def ready(self) -> bool:
        return self.reference is not None and self.layout is not None

    def set_reference(self, reference: CircuitReference) -> None:
        """Use a (new) circuit reference; anchors are kept as checkpoint indexes and re-mapped."""
        self.reference = reference
        self._flat_offsets.clear()
        layout = self._observed_layout or reference.layout
        self._apply_layout(layout)

    def ingest(self, message: FeedMessage, replace: bool = False) -> None:
        topic = message.topic
        data = message.data
        if not isinstance(data, dict):
            return
        self.feed_utc = max(self.feed_utc, message.utc)
        effective = message.utc - self.lag_ms
        if topic == "TimingData":
            self._ingest_timing(data, effective, replace)
        elif topic == "TrackStatus":
            code = str(data.get("Status", "1"))
            self._track_changes.append((effective, code))
        elif topic == "SessionStatus":
            self._ingest_session_status(data, message.utc - START_LAG_MS)
        elif topic == "SessionInfo":
            self._race_like = data.get("Type") == "Race" or self._race_like
        elif topic == "DriverList":
            self._ingest_drivers(data)
        elif topic == "TimingAppData":
            self._ingest_grid(data)

    def sample(self, number: str, render_utc: int) -> EstimatedSample | None:
        """Estimated position of one car at `render_utc` (blended)."""
        car = self._cars.get(number)
        if car is None or not self.ready:
            return None
        frozen = self._frozen_sample(number, car, render_utc)
        if frozen is not None:
            return frozen
        base = self._model_sample(car, render_utc)
        if base is None or not base.on_line:
            return base
        offset = _correction(car, render_utc)
        if offset == 0.0:
            return base
        progress = base.progress + offset
        x, y = self.reference.line.point_at(progress)
        return EstimatedSample(x, y, base.status, progress, True)

    def numbers(self) -> list[str]:
        return list(self._cars)

    def apply_truth(self, truth: PositionStore) -> int:
        """Learn from delayed real positions (the static archive of the running session).

        Every timed pass the truth covers tells where that mini-sector really ends; the median
        residual per mini-sector corrects the reference distances. A stopped or retired car is
        put where the truth last saw it. Returns how many passes were used.
        """
        if not self.ready:
            return 0
        used = 0
        length = self.reference.length
        for number, car in self._cars.items():
            covered_until = truth.latest_utc_of(number)
            if covered_until is None:
                continue
            checked = self._truth_checked.get(number, 0)
            for anchor in car.anchors:
                if anchor.kind != "pass" or anchor.t <= checked or anchor.t > covered_until - TRUTH_MARGIN_MS:
                    continue
                real = truth.sample(number, anchor.t)
                if real is None or real.age_ms > TRUTH_MAX_AGE_MS:
                    continue
                projected, gap = self.reference.line.project([real.x], [real.y])
                if gap[0] > TRUTH_MAX_GAP_DM:
                    continue
                flat = anchor.k % self._segment_count()
                expected = self.checkpoints[flat] % length
                residual = (projected[0] - expected + length / 2) % length - length / 2
                residuals = self._truth_residuals.setdefault(flat, [])
                residuals.append(float(residual))
                del residuals[:-TRUTH_RESIDUALS]
                used += 1
            self._truth_checked[number] = max(checked, covered_until - TRUTH_MARGIN_MS)
            self._freeze_from_truth(car, truth, number, covered_until)
        for flat, residuals in self._truth_residuals.items():
            if len(residuals) >= TRUTH_MIN_RESIDUALS:
                ordered = sorted(residuals)
                median = ordered[len(ordered) // 2]
                if abs(median) < TRUTH_MAX_OFFSET_DM:
                    self._flat_offsets[flat] = median
        return used

    def describe(self) -> dict | None:
        if self.reference is None:
            return None
        return {
            "reference": self.reference.source,
            "circuitKey": self.reference.circuit_key,
            "layout": self.layout,
            "referenceLayout": self.reference.layout,
            "cars": len(self._cars),
            "truthCorrections": len(self._flat_offsets),
        }

    # Feed handling.

    def _ingest_timing(self, data: dict, effective: int, replace: bool) -> None:
        lines = data.get("Lines") or {}
        for number, line in lines.items():
            if not isinstance(line, dict) or not number.isdigit():
                continue
            self._watch_layout(line)
            car = self._car(number)
            self._ingest_line(number, car, line, effective, replace)

    def _ingest_line(self, number: str, car: _Car, line: dict, effective: int, replace: bool) -> None:
        if isinstance(line.get("NumberOfLaps"), int):
            car.laps = line["NumberOfLaps"]
        if "InPit" in line:
            self._set_in_pit(number, car, bool(line["InPit"]), effective)
        if line.get("PitOut"):
            self._pit_exit(number, car, effective)
        if line.get("Stopped") and car.stopped_at is None:
            car.stopped_at = effective
        elif line.get("Stopped") is False and not line.get("Retired"):
            car.stopped_at = None
            car.frozen = None
        if line.get("Retired") and car.retired_at is None:
            car.retired_at = effective
        if not self.ready:
            return
        updates = segment_statuses(line, self._offsets)
        if not updates:
            return
        if replace:
            self._seed_from_snapshot(number, car, updates, effective)
            return
        base_lap = car.laps or 0
        for absolute, status in car.counter.passes(updates, base_lap):
            if status == PIT_LANE_SEGMENT and not car.in_pit:
                self._maybe_exit_batch(number, car, effective)
            stuck_in_pit = car.in_pit and car.pit_entries and effective - car.pit_entries[-1] > STUCK_PIT_MS
            if status != PIT_LANE_SEGMENT and stuck_in_pit:
                # Timed mini-sectors well after the pit entry: the car is out, the flag is stale.
                self._pit_exit(number, car, effective)
            if status == PIT_LANE_SEGMENT or car.in_pit:
                continue
            anchor = _Anchor(effective, "pass", absolute, None)
            self._add_anchor(number, car, anchor)

    def _seed_from_snapshot(self, number: str, car: _Car, updates: list[tuple[int, int]], effective: int) -> None:
        passed = [flat for flat, status in updates if status]
        if not passed:
            return
        last_flat = max(passed)
        laps = car.laps or 0
        if last_flat == self._segment_count() - 1:
            laps = max(0, laps - 1)
        absolute = laps * self._segment_count() + last_flat
        car.counter.seed(absolute)
        car.counter.statuses = dict(updates)
        if car.in_pit:
            return
        anchor = _Anchor(effective, "seed", absolute, None)
        self._add_anchor(number, car, anchor)

    def _set_in_pit(self, number: str, car: _Car, in_pit: bool, effective: int) -> None:
        if not in_pit and car.in_pit:
            # Leaving the garage before a race start clears InPit without a PitOut flag.
            self._pit_exit(number, car, effective)
        if in_pit and not car.in_pit:
            car.pit_entries.append(effective)
            last = car.anchors[-1] if car.anchors else None
            if last is not None and self.reference is not None and self.reference.pit is not None:
                entry_s = self.reference.pit.entry_s
                anchor = _Anchor(effective, "pitEntry", last.k, entry_s)
                self._add_anchor(number, car, anchor)
        car.in_pit = in_pit

    def _pit_exit(self, number: str, car: _Car, effective: int) -> None:
        last_entry = car.pit_entries[-1] if car.pit_entries else None
        if last_entry is None:
            return
        if car.pit_exits and car.pit_exits[-1] >= last_entry:
            return
        car.pit_exits.append(effective)
        car.in_pit = False
        if self.reference is None or self.reference.pit is None:
            return
        last_k = car.anchors[-1].k if car.anchors else car.counter.last or 0
        exit_s = self.reference.pit.exit_s
        anchor = _Anchor(effective, "pitExit", last_k, exit_s)
        self._add_anchor(number, car, anchor)

    def _maybe_exit_batch(self, number: str, car: _Car, effective: int) -> None:
        """The out-lap's pit lane mini-sectors are published when the car reaches a known point."""
        pit = self.reference.pit
        if pit is None or pit.exit_batch_s is None or not car.anchors:
            return
        last = car.anchors[-1]
        if last.kind != "pitExit" or effective - last.t > EXIT_BATCH_WINDOW_MS:
            return
        anchor = _Anchor(effective, "pitBatch", last.k, pit.exit_batch_s)
        self._add_anchor(number, car, anchor)

    def _ingest_session_status(self, data: dict, effective: int) -> None:
        if data.get("Status") != "Started" or self._started_at is not None:
            return
        self._started_at = effective
        if not self._race_like or self.reference is None or not self.reference.grid_s:
            return
        for number, car in self._cars.items():
            if car.in_pit or car.grid_position is None:
                continue
            grid_s = self._grid_distance(car)
            if grid_s is None:
                continue
            last_k = car.anchors[-1].k if car.anchors else (car.counter.last if car.counter.last is not None else -1)
            anchor = _Anchor(effective, "grid", last_k, grid_s)
            self._add_anchor(number, car, anchor)

    def _ingest_drivers(self, data: dict) -> None:
        for number, info in data.items():
            if isinstance(info, dict) and number.isdigit():
                car = self._car(number)
                if info.get("TeamName"):
                    car.team = info["TeamName"]
                if car.grid_position is None and isinstance(info.get("Line"), int) and self._started_at is None:
                    car.grid_position = info["Line"]

    def _ingest_grid(self, data: dict) -> None:
        for number, line in (data.get("Lines") or {}).items():
            if not isinstance(line, dict) or not number.isdigit():
                continue
            grid = line.get("GridPos")
            if grid and str(grid).isdigit():
                car = self._car(number)
                car.grid_position = int(grid)

    def _watch_layout(self, line: dict) -> None:
        """Switch layout when the live feed has a different mini-sector count than the reference."""
        before = dict(self._highest_segment)
        note_segment_indexes(line, self._highest_segment)
        if self._highest_segment == before:
            return
        # The lap reset message lists every segment of every sector, which reveals the layout.
        sectors = line.get("Sectors")
        full_reset = isinstance(sectors, dict) and len(sectors) >= 3
        sector_count = max(self._highest_segment) + 1
        observed = [self._highest_segment.get(index, -1) + 1 for index in range(sector_count)]
        grew = self.layout is not None and any(seen > known for seen, known in zip(observed, self.layout))
        if (full_reset and all(observed)) or grew:
            self._observed_layout = observed
        if self._observed_layout and self.reference is not None and self._observed_layout != self.layout:
            self._apply_layout(self._observed_layout)
            self._forget_anchors()

    def _forget_anchors(self) -> None:
        for car in self._cars.values():
            count = self._segment_count()
            car.counter = PassCounter(count)
            car.anchors.clear()
            car.anchor_times.clear()
            car.previous_span.clear()
            car.recent_ratios.clear()
            car.corrections.clear()

    def _apply_layout(self, layout: list[int]) -> None:
        self.layout = list(layout)
        self._offsets = segment_offsets(self.layout)
        self.checkpoints = self.reference.checkpoints_for(self.layout) if self.reference else []
        for car in self._cars.values():
            car.counter.count = self._segment_count()

    def _car(self, number: str) -> _Car:
        car = self._cars.get(number)
        if car is None:
            count = self._segment_count() or 1
            car = _Car(PassCounter(count))
            self._cars[number] = car
        return car

    def _add_anchor(self, number: str, car: _Car, anchor: _Anchor) -> None:
        render_now = self.feed_utc - self.render_delay_ms
        before = self._model_sample(car, render_now) if car.anchors else None
        if car.anchors and anchor.t < car.anchors[-1].t:
            anchor.t = car.anchors[-1].t
        previous = car.anchors[-1] if car.anchors else None
        car.anchors.append(anchor)
        car.anchor_times.append(anchor.t)
        if anchor.kind == "pass" and previous is not None:
            self._learn_span(car, previous, anchor)
        if before is None or not before.on_line:
            return
        after = self._model_sample(car, render_now)
        if after is None or not after.on_line:
            return
        offset = before.progress - after.progress
        if 0 < abs(offset) < self.reference.length / 4:
            car.corrections.append((render_now, offset))
            _prune_corrections(car, render_now)

    def _learn_span(self, car: _Car, previous: _Anchor, anchor: _Anchor) -> None:
        if previous.kind != "pass" or anchor.k != previous.k + 1:
            return
        duration = anchor.t - previous.t
        if duration <= 0:
            return
        flat = anchor.k % self._segment_count()
        prior = car.previous_span.get(flat)
        if prior:
            ratio = duration / prior
            if 0.3 < ratio < 4.0:
                car.recent_ratios.append((anchor.t, ratio))
                del car.recent_ratios[:-RECENT_RATIOS]
        car.previous_span[flat] = duration
        reference_ms = self._reference_span_ms(previous.k, anchor.k)
        if reference_ms > 0:
            car.reference_ratios.append((anchor.t, duration / reference_ms))
            del car.reference_ratios[:-RECENT_RATIOS * 2]

    # Model.

    def _model_sample(self, car: _Car, utc: int) -> EstimatedSample | None:
        pit_state = self._pit_state(car, utc)
        if pit_state is not None:
            return pit_state
        index = bisect_right(car.anchor_times, utc) - 1
        if index < 0:
            return self._before_first_anchor(car, utc)
        anchor = car.anchors[index]
        if anchor.kind == "pitEntry":
            # Entered the pit but the exit is not known yet: _pit_state handles it.
            return None
        following = car.anchors[index + 1] if index + 1 < len(car.anchors) else None
        if self._before_start(utc):
            held = self._grid_hold(car, anchor, following, utc)
            if held is not None:
                return held
        if following is not None and following.kind in ("pass", "pitEntry", "pitBatch"):
            progress = self._interpolate(anchor, following, utc)
        else:
            progress = self._extrapolate(car, anchor, utc)
        x, y = self.reference.line.point_at(progress)
        return EstimatedSample(x, y, "onTrack", progress, True)

    def _interpolate(self, anchor: _Anchor, following: _Anchor, utc: int) -> float:
        start = self._progress(anchor)
        end = self._progress(following)
        duration = following.t - anchor.t
        if duration <= 0 or end <= start:
            return end
        ratio = (utc - anchor.t) / duration
        if anchor.kind == "grid":
            return start + (end - start) * ratio * ratio
        reference = self.reference
        start_phase = reference.phase_of(start)
        end_phase = reference.phase_of(end)
        phase = start_phase + (end_phase - start_phase) * ratio
        return reference.progress_of(phase)

    def _extrapolate(self, car: _Car, anchor: _Anchor, utc: int) -> float:
        reference = self.reference
        start = self._progress(anchor)
        next_k = anchor.k + 1
        target = self._checkpoint_progress(next_k)
        while target <= start + 1:
            next_k += 1
            target = self._checkpoint_progress(next_k)
        pit = reference.pit
        if anchor.kind == "pitExit" and pit is not None and pit.exit_batch_s is not None:
            target = start + (pit.exit_batch_s - start) % reference.length
        elapsed = utc - anchor.t
        if anchor.kind == "grid":
            travelled = 0.5 * STANDING_START_ACCEL * elapsed * elapsed
            travelled = min(travelled, MAX_SPEED * elapsed)
            limit = (target - start) * (CLAMP_START + CLAMP_ROOM)
            return start + min(travelled, limit)
        expected = self._expected_ms(car, anchor, next_k, start, target)
        fraction = _soft_clamp(elapsed / expected) if expected > 0 else 0.0
        start_phase = reference.phase_of(start)
        end_phase = reference.phase_of(target)
        phase = start_phase + (end_phase - start_phase) * fraction
        return reference.progress_of(phase)

    def _expected_ms(self, car: _Car, anchor: _Anchor, next_k: int, start: float, target: float) -> float:
        """How long this car should need from the anchor to the next checkpoint."""
        reference = self.reference
        flat = next_k % self._segment_count()
        prior = car.previous_span.get(flat)
        factor = self._status_factor(car, anchor.t)
        if anchor.kind == "pass" and next_k == anchor.k + 1 and prior:
            ratio = _recent_median(car.recent_ratios, anchor.t)
            return prior * (ratio if ratio is not None else 1.0) * factor
        phase_span = reference.phase_of(target) - reference.phase_of(start)
        ratio = _recent_median(car.reference_ratios, anchor.t)
        lap_ms = reference.lap_ms * (ratio if ratio is not None else 1.05)
        if anchor.kind == "pitExit":
            lap_ms = max(lap_ms, reference.lap_ms * 1.1)
        return phase_span * lap_ms * factor

    def _status_factor(self, car: _Car, since: int) -> float:
        """Lap time factor for a track status change between the pace sample and now."""
        newest_ratio = car.recent_ratios[-1][0] if car.recent_ratios else since
        before = self._track_code_at(newest_ratio - 1)
        now = self._track_code_at(self.feed_utc - self.lag_ms)
        was_slow = before in NEUTRALISED_CODES
        is_slow = now in NEUTRALISED_CODES
        if is_slow and not was_slow:
            return NEUTRALISED_FACTOR
        if was_slow and not is_slow:
            return 1 / NEUTRALISED_FACTOR
        return 1.0

    def _before_first_anchor(self, car: _Car, utc: int) -> EstimatedSample | None:
        if self._race_like and self._before_start(utc) and car.grid_position is not None and not car.in_pit:
            return self._grid_sample(car)
        if car.in_pit and self.reference.pit is not None:
            return self._box_sample(car)
        return None

    def _grid_hold(self, car: _Car, anchor: _Anchor, following: _Anchor | None, utc: int) -> EstimatedSample | None:
        """Before the start a car rolling up to its grid slot stops there, and leaves it for the
        formation lap just in time to reach the next checkpoint with a gentle acceleration."""
        grid_s = self._grid_distance(car)
        if grid_s is None or anchor.kind == "grid":
            return None
        start = self._progress(anchor)
        slot = start + (grid_s - start) % self.reference.length
        free = self._extrapolate(car, anchor, utc)
        if following is not None:
            end = self._progress(following)
            if not start <= slot < end:
                return None
            departure = following.t - math.sqrt(2 * (end - slot) / FORMATION_ACCEL)
            if utc >= departure:
                rolled = 0.5 * FORMATION_ACCEL * (utc - departure) ** 2
                progress = min(slot + rolled, end)
                x, y = self.reference.line.point_at(progress)
                return EstimatedSample(x, y, "onTrack", progress, True)
        elif free < slot and slot - start > self.reference.length / 2:
            return None
        if free < slot:
            x, y = self.reference.line.point_at(free)
            return EstimatedSample(x, y, "onTrack", free, True)
        return self._grid_sample(car)

    def _grid_sample(self, car: _Car) -> EstimatedSample | None:
        reference = self.reference
        index = (car.grid_position or 0) - 1
        if not reference.grid or not 0 <= index < len(reference.grid):
            return None
        slot = reference.grid[index]
        if slot is None:
            return None
        return EstimatedSample(slot[0], slot[1], "grid", reference.grid_s[index] or 0.0, False)

    def _grid_distance(self, car: _Car) -> float | None:
        reference = self.reference
        index = (car.grid_position or 0) - 1
        if not reference.grid_s or not 0 <= index < len(reference.grid_s):
            return None
        return reference.grid_s[index]

    def _pit_state(self, car: _Car, utc: int) -> EstimatedSample | None:
        """Position on the pit lane while the car is between pit entry and pit exit."""
        if not car.pit_entries:
            return None
        index = bisect_right(car.pit_entries, utc) - 1
        if index < 0:
            return None
        entry = car.pit_entries[index]
        exit_utc = next((moment for moment in car.pit_exits if moment > entry), None)
        if exit_utc is not None and utc >= exit_utc:
            return None
        pit = self.reference.pit
        if pit is None:
            return None
        lane = pit.line.length
        box = min(pit.box_for(car.team), lane - PIT_EXIT_HOLD_DM)
        elapsed = utc - entry
        to_box = box / pit.speed
        from_box = (lane - box) / pit.speed
        leave_after = None
        if exit_utc is not None:
            leave_after = max(to_box, (exit_utc - entry) - from_box)
        elif self._race_like and self._started_at is not None:
            if self._is_red(utc) or elapsed < pit.lane_ms + GARAGE_AFTER_MS:
                # A race stop takes the usual pit lane time; under a red flag cars queue at the exit.
                leave_after = max(to_box, pit.lane_ms - from_box)
        if elapsed <= to_box:
            distance = pit.speed * elapsed
        elif leave_after is None or elapsed < leave_after:
            distance = box
        else:
            # Cars waiting at the exit (red flag) queue in the order they came in.
            queue = self._pit_queue_position(car, entry, utc)
            hold = max(box, lane - PIT_EXIT_HOLD_DM - queue * PIT_QUEUE_SPACING_DM)
            distance = min(hold, box + pit.speed * (elapsed - leave_after))
        x, y = pit.line.point_at(distance)
        return EstimatedSample(x, y, "pit", distance, False)

    def _pit_queue_position(self, car: _Car, entry: int, utc: int) -> int:
        """How many cars entered the pit before this one and are still waiting in it."""
        ahead = 0
        for other in self._cars.values():
            if other is car:
                continue
            index = bisect_right(other.pit_entries, utc) - 1
            if index < 0 or other.pit_entries[index] >= entry:
                continue
            other_entry = other.pit_entries[index]
            left = any(other_entry < moment <= utc for moment in other.pit_exits)
            if not left:
                ahead += 1
        return ahead

    def _box_sample(self, car: _Car) -> EstimatedSample:
        pit = self.reference.pit
        box = pit.box_for(car.team)
        x, y = pit.line.point_at(box)
        return EstimatedSample(x, y, "pit", box, False)

    def _freeze_from_truth(self, car: _Car, truth: PositionStore, number: str, covered_until: int) -> None:
        moments = [moment for moment in (car.stopped_at, car.retired_at) if moment is not None]
        if not moments or covered_until < min(moments) + TRUTH_MARGIN_MS:
            return
        real = truth.sample(number, covered_until)
        if real is None:
            return
        projected, _ = self.reference.line.project([real.x], [real.y])
        car.frozen = EstimatedSample(real.x, real.y, "stopped", float(projected[0]), False)

    def _frozen_sample(self, number: str, car: _Car, utc: int) -> EstimatedSample | None:
        moments = [moment for moment in (car.stopped_at, car.retired_at) if moment is not None]
        if not moments:
            return None
        moment = min(moments)
        if utc < moment:
            return None
        if car.frozen is None:
            sample = self._model_sample(car, moment)
            if sample is None:
                return None
            car.frozen = sample
        status = "retired" if car.retired_at is not None and utc >= car.retired_at else "stopped"
        frozen = car.frozen
        return EstimatedSample(frozen.x, frozen.y, status, frozen.progress, frozen.on_line)

    # Geometry helpers.

    def _progress(self, anchor: _Anchor) -> float:
        base = self._checkpoint_progress(anchor.k)
        if anchor.s is None:
            return base
        length = self.reference.length
        return base + (anchor.s - base) % length

    def _checkpoint_progress(self, absolute: int) -> float:
        count = self._segment_count()
        laps, flat = divmod(absolute, count)
        offset = self._flat_offsets.get(flat, 0.0)
        return float(laps * self.reference.length + self.checkpoints[flat] + offset)

    def _reference_span_ms(self, start_k: int, end_k: int) -> float:
        reference = self.reference
        start = self._checkpoint_progress(start_k)
        end = self._checkpoint_progress(end_k)
        return (reference.phase_of(end) - reference.phase_of(start)) * reference.lap_ms

    def _segment_count(self) -> int:
        return sum(self.layout) if self.layout else 0

    def _before_start(self, utc: int) -> bool:
        return self._race_like and (self._started_at is None or utc < self._started_at)

    def _track_code_at(self, utc: int) -> str:
        code = "1"
        for moment, value in self._track_changes:
            if moment > utc:
                break
            code = value
        return code

    def _is_red(self, utc: int) -> bool:
        return self._track_code_at(utc) == RED_CODE


def _soft_clamp(fraction: float) -> float:
    """Linear up to CLAMP_START, then easing towards CLAMP_START + CLAMP_ROOM, never reaching 1."""
    if fraction <= CLAMP_START:
        return max(0.0, fraction)
    excess = (fraction - CLAMP_START) / CLAMP_ROOM
    return CLAMP_START + CLAMP_ROOM * (1 - math.exp(-excess))


def _recent_median(values: list[tuple[int, float]], now: int) -> float | None:
    fresh = sorted(ratio for moment, ratio in values if now - moment <= RATIO_MAX_AGE_MS)
    if not fresh:
        return None
    return fresh[len(fresh) // 2]


def _correction(car: _Car, utc: int) -> float:
    total = 0.0
    for moment, offset in car.corrections:
        if utc < moment:
            # A frame rendered just before the anchor arrived must still show the pre-anchor
            # position; skipping the offset here made the car jump ahead for one frame.
            if moment - utc < BLEND_MS:
                total += offset
            continue
        total += offset * math.exp(-(utc - moment) / BLEND_MS)
    return total


def _prune_corrections(car: _Car, now: int) -> None:
    car.corrections = [(moment, offset) for moment, offset in car.corrections if now - moment < BLEND_MS * 6]
