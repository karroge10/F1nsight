"""Accuracy of the position estimator against the real positions of a recorded session.

Only the anonymous timing topics of the recording go through `PositionEstimator` (exactly what a
live connection without a token receives); the recording's own `Position.z` is the ground truth.
Every `step_ms` of feed time the estimate drawn at `now - render_delay` is compared with the true
position at that moment.
"""

import math
from dataclasses import dataclass, field

import numpy as np

from f1live import config
from f1live.archive import Recording
from f1live.estimator import PositionEstimator
from f1live.reference import CircuitReference, _TimingTimeline, repeated_share

DM_PER_M = 10
NEAR_PAIR_M = 500
LAP_ONE_MS = 150_000
TRUTH_MAX_AGE_MS = 1_000
SLOW_CODES = {"4", "5", "6", "7"}
TRUTH_MISMATCH_M = 300
TRUTH_WINDOW_MS = 15_000


@dataclass
class Evaluation:
    errors: dict[str, list[float]] = field(default_factory=dict)
    pair_checks: int = 0
    pair_matches: int = 0
    order_checks: int = 0
    order_matches: int = 0
    missing: int = 0
    compared: int = 0
    inconsistent: int = 0
    truth_repeated: float = 0.0

    def add(self, category: str, error_m: float) -> None:
        self.errors.setdefault(category, []).append(error_m)
        self.errors.setdefault("all", []).append(error_m)

    def summary(self) -> dict:
        out = {}
        for category, values in sorted(self.errors.items()):
            array = np.asarray(values)
            out[category] = {
                "n": len(values),
                "median": round(float(np.median(array)), 1),
                "p95": round(float(np.percentile(array, 95)), 1),
                "within50": round(float(np.mean(array <= 50)), 3),
                "within100": round(float(np.mean(array <= 100)), 3),
            }
        out["neighbourOrder"] = round(self.pair_matches / self.pair_checks, 3) if self.pair_checks else None
        out["fullOrder"] = round(self.order_matches / self.order_checks, 3) if self.order_checks else None
        out["shown"] = round(self.compared / (self.compared + self.missing), 3) if self.compared + self.missing else None
        total = self.compared + self.missing + self.inconsistent
        out["truthInconsistent"] = round(self.inconsistent / total, 4) if total else None
        out["truthRepeated"] = round(self.truth_repeated, 4)
        return out


def evaluate(
    recording: Recording,
    reference: CircuitReference,
    render_delay_ms: int = config.LIVE_RENDER_DELAY_MS,
    step_ms: int = 1_000,
    lag_ms: int = config.TIMING_LAG_MS,
) -> Evaluation:
    estimator = PositionEstimator(reference, lag_ms=lag_ms, render_delay_ms=render_delay_ms)
    truth = recording.positions
    result = Evaluation()
    result.truth_repeated = repeated_share(truth)
    messages = recording.messages
    start = (recording.green_utc or recording.start_utc) - 10 * 60_000
    start = max(start, recording.start_utc)
    end = recording.end_utc
    cursor = 0
    track_code = "1"
    green = recording.green_utc
    line = reference.line
    unreliable = unreliable_truth(recording, reference, lag_ms)
    for now in range(start, end, step_ms):
        while cursor < len(messages) and messages[cursor].utc <= now:
            message = messages[cursor]
            estimator.ingest(message)
            if message.topic == "TrackStatus":
                track_code = str(message.data.get("Status", "1"))
            cursor += 1
        render = now - render_delay_ms
        rows = []
        for number in truth.numbers():
            real = truth.sample(number, render)
            if real is None or real.age_ms > TRUTH_MAX_AGE_MS:
                continue
            windows = unreliable.get(number)
            if _inside(windows, render):
                result.inconsistent += 1
                continue
            estimate = estimator.sample(number, render)
            if estimate is None:
                result.missing += 1
                continue
            result.compared += 1
            error = math.hypot(real.x - estimate.x, real.y - estimate.y) / DM_PER_M
            category = _category(estimate.status, track_code, green, render)
            result.add(category, error)
            if estimate.status == "onTrack" and real.status == "OnTrack":
                rows.append((number, real.x, real.y, estimate.progress))
        _order_checks(result, rows, line)
    return result


def unreliable_truth(recording: Recording, reference: CircuitReference, lag_ms: int) -> dict[str, list[tuple[int, int]]]:
    """Windows where the recorded Position.z contradicts the timing feed itself.

    Around some race starts the archived positions freeze or lag by 10 to 20 s while the
    mini-sectors keep flipping (2025 Canada). Where the true position at a timed mini-sector
    flip is more than TRUTH_MISMATCH_M from that mini-sector, the truth is skipped for
    TRUTH_WINDOW_MS around it and counted as inconsistent.
    """
    timeline = _TimingTimeline.from_messages(recording.messages, lag_ms)
    if timeline.layout != reference.layout:
        return {}
    length = reference.length
    windows: dict[str, list[tuple[int, int]]] = {}
    for item in timeline.passes:
        real = recording.positions.sample(item.number, item.utc)
        if real is None or real.age_ms > TRUTH_MAX_AGE_MS:
            continue
        projected, gap = reference.line.project([real.x], [real.y])
        expected = reference.checkpoints[item.flat] % length
        miss = abs((projected[0] - expected + length / 2) % length - length / 2)
        if miss > TRUTH_MISMATCH_M * DM_PER_M and gap[0] < 300:
            window = (item.utc - TRUTH_WINDOW_MS, item.utc + TRUTH_WINDOW_MS)
            windows.setdefault(item.number, []).append(window)
    return windows


def _inside(windows: list[tuple[int, int]] | None, moment: int) -> bool:
    if not windows:
        return False
    return any(start <= moment <= end for start, end in windows)


def _category(status: str, track_code: str, green: int | None, render: int) -> str:
    if status != "onTrack":
        return status
    if green is not None and render < green:
        return "beforeStart"
    if green is not None and render - green < LAP_ONE_MS:
        return "lapOne"
    if track_code in SLOW_CODES:
        return "neutralised"
    return "green"


def _order_checks(result: Evaluation, rows: list[tuple], line) -> None:
    """Does the estimate put nearby cars in the same order on track as reality?"""
    if len(rows) < 2:
        return
    xs = np.array([row[1] for row in rows])
    ys = np.array([row[2] for row in rows])
    true_s, gaps = line.project(xs, ys)
    length = line.length
    keep = gaps < 300
    estimated_s = np.array([row[3] % length for row in rows])
    true_s = true_s[keep]
    estimated_s = estimated_s[keep]
    if len(true_s) < 2:
        return
    order = np.argsort(true_s)
    true_sorted = true_s[order]
    estimated_sorted = estimated_s[order]
    count = len(order)
    all_match = True
    for index in range(count):
        following = (index + 1) % count
        true_gap = (true_sorted[following] - true_sorted[index]) % length
        if true_gap > NEAR_PAIR_M * DM_PER_M:
            continue
        estimated_gap = (estimated_sorted[following] - estimated_sorted[index] + length / 2) % length - length / 2
        result.pair_checks += 1
        if estimated_gap > 0:
            result.pair_matches += 1
        else:
            all_match = False
    result.order_checks += 1
    if all_match:
        result.order_matches += 1
