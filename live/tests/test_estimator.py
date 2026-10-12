"""Estimated positions from the anonymous timing feed.

Synthetic tests use a circular track with 8 mini-sectors and a uniform speed profile, so every
expected position is known exactly. The archive tests run a recorded race through the estimator
with only the anonymous topics and compare with the race's real Position.z.
"""

import asyncio
import math

import httpx
import numpy as np
import pytest

from f1live.archive import ArchiveClient, build_recording
from f1live.decode import FeedMessage
from f1live.engine import ESTIMATED, SessionEngine
from f1live.estimator import PositionEstimator
from f1live.reference import CircuitReference, PassCounter, PitLane, Polyline, build_reference
from f1live.replay import ReplayPlayer
from f1live.stores import PositionStore
from f1live.validation import evaluate

LAG = 2_000
DELAY = 3_000
RADIUS = 6_000.0
LAYOUT = [3, 3, 2]
SPAN_MS = 10_000
T0 = 1_800_000_000_000
TOPICS = ["Heartbeat", "SessionInfo", "SessionStatus", "DriverList", "TimingData", "TimingAppData",
          "LapCount", "TrackStatus", "RaceControlMessages", "PitLaneTimeCollection", "Position.z"]


def test_pass_counter_counts_resets_and_ignores_recolours_and_late_copies():
    counter = PassCounter(26)
    for flat in range(26):
        assert counter.passes([(flat, 2048)]) == [(flat, 2048)]
    # Lap reset: the first segment set, everything else zeroed in the same message.
    reset = [(0, 2049)] + [(flat, 0) for flat in range(1, 26)]
    assert counter.passes(reset) == [(26, 2049)]
    # The same segment changing colour later is not a pass.
    assert counter.passes([(0, 2051)]) == []
    for flat in range(1, 21):
        counter.passes([(flat, 2048)])
    # A pit lane batch arriving out of order (25 first) is counted once, without a phantom lap.
    assert counter.passes([(25, 2064)]) == [(51, 2064)]
    for flat in (22, 23, 24):
        assert counter.passes([(flat, 2064)]) == []
    assert counter.passes([(0, 2064)] + [(flat, 0) for flat in range(1, 26)]) == [(52, 2064)]


def test_pass_counter_resynchronises_after_missed_updates():
    counter = PassCounter(26)
    counter.passes([(0, 2048)])
    # Updates were lost: two consecutive segments far ahead mean the car really is there.
    assert counter.passes([(15, 2048)]) == []
    assert counter.passes([(16, 2048)]) == [(16, 2048)]


def test_car_moves_between_checkpoints_and_waits_for_the_next_flip():
    reference = _circle_reference()
    estimator = PositionEstimator(reference, lag_ms=LAG, render_delay_ms=DELAY)
    messages = [_session_info("Practice")] + _laps("4", start_flat=0, count=12)
    feeder = _Feeder(estimator, messages)
    stop_at = T0 + 12 * SPAN_MS
    previous = None
    for now in range(T0, stop_at + 60_000, 125):
        feeder.until(now)
        sample = estimator.sample("4", now - DELAY)
        if sample is None:
            continue
        if previous is not None:
            # Never backwards, never a jump (a uniform lap is about 47 dm per 125 ms).
            assert sample.progress >= previous - 1
            assert sample.progress - previous < 120
        previous = sample.progress
    # The last flip was index 11 (second lap, flat 3): the car waits before the next one.
    next_checkpoint = reference.length + reference.checkpoints[4]
    assert previous < next_checkpoint
    assert previous > next_checkpoint - 0.2 * reference.length / 8


def test_known_flips_put_the_car_on_the_checkpoints():
    reference = _circle_reference()
    estimator = PositionEstimator(reference, lag_ms=LAG, render_delay_ms=DELAY)
    messages = [_session_info("Practice")] + _laps("4", start_flat=0, count=16)
    _Feeder(estimator, messages).until(T0 + 30 * SPAN_MS)
    for index in range(2, 15):
        moment = T0 + index * SPAN_MS - LAG + SPAN_MS
        sample = estimator.sample("4", moment)
        laps, flat = divmod(index, 8)
        expected = laps * reference.length + reference.checkpoints[flat]
        assert abs(sample.progress - expected) < 5


def test_pit_entry_lane_and_exit():
    reference = _circle_reference()
    estimator = PositionEstimator(reference, lag_ms=LAG, render_delay_ms=DELAY)
    messages = [_session_info("Practice"), _drivers({"4": "TeamA"})] + _laps("4", start_flat=0, count=7)
    entry = T0 + 8 * SPAN_MS
    messages.append(_line("4", {"InPit": True}, entry))
    messages.append(_line("4", {"InPit": False, "PitOut": True}, entry + 30_000))
    _Feeder(estimator, messages).until(entry + 60_000)
    in_lane = estimator.sample("4", entry - LAG + 3_000)
    at_box = estimator.sample("4", entry - LAG + 20_000)
    out = estimator.sample("4", entry - LAG + 30_500)
    assert in_lane.status == "pit" and at_box.status == "pit"
    box_x, box_y = reference.pit.line.point_at(reference.pit.boxes["TeamA"])
    assert math.hypot(at_box.x - box_x, at_box.y - box_y) < 20
    assert out.status == "onTrack"
    exit_x, exit_y = reference.line.point_at(reference.pit.exit_s)
    assert math.hypot(out.x - exit_x, out.y - exit_y) < 400


def test_stopped_car_stays_where_it_stopped():
    reference = _circle_reference()
    estimator = PositionEstimator(reference, lag_ms=LAG, render_delay_ms=DELAY)
    messages = [_session_info("Practice")] + _laps("4", start_flat=0, count=5)
    stopped = T0 + 5 * SPAN_MS + 4_000
    messages.append(_line("4", {"Stopped": True}, stopped))
    _Feeder(estimator, messages).until(stopped + 120_000)
    first = estimator.sample("4", stopped - LAG + 1_000)
    later = estimator.sample("4", stopped + 100_000)
    assert first.status == later.status == "stopped"
    assert (first.x, first.y) == (later.x, later.y)


def test_delayed_truth_corrects_the_mini_sector_distances():
    reference = _circle_reference()
    estimator = PositionEstimator(reference, lag_ms=LAG, render_delay_ms=DELAY)
    messages = [_session_info("Practice")] + _laps("4", start_flat=0, count=32)
    _Feeder(estimator, messages).until(T0 + 40 * SPAN_MS)
    # The real car reaches every checkpoint 300 dm later than the reference says.
    truth = PositionStore()
    for moment in range(T0 - SPAN_MS, T0 + 34 * SPAN_MS, 250):
        index = (moment - T0 + LAG) / SPAN_MS
        x, y = reference.line.point_at(index * reference.length / 8 + 300)
        truth.add("4", moment, {"X": round(x), "Y": round(y), "Z": 1})
    used = estimator.apply_truth(truth)
    assert used >= 24
    assert estimator.describe()["truthCorrections"] == 8
    assert all(abs(value - 300) < 30 for value in estimator._flat_offsets.values())


def test_engine_sends_estimated_frames_without_positions():
    reference = _circle_reference()
    estimator = PositionEstimator(reference, lag_ms=LAG, render_delay_ms=DELAY)
    engine = SessionEngine("live", render_delay_ms=DELAY, estimator=estimator)
    messages = [_session_info("Practice"), _drivers({"4": "TeamA", "7": "TeamB"})]
    messages += _laps("4", start_flat=0, count=8) + _laps("7", start_flat=0, count=8, delay_ms=3_000)
    messages.sort(key=lambda message: message.utc)
    out = []
    cursor = 0
    for now in range(T0, T0 + 9 * SPAN_MS, 125):
        while cursor < len(messages) and messages[cursor].utc <= now:
            engine.ingest(messages[cursor])
            cursor += 1
        out.extend(engine.tick(now))
    init = [message for message in out if message["type"] == "init"][-1]
    assert init["positionsSource"] == ESTIMATED
    assert init["sources"]["positionsAvailable"] is True
    frames = [message for message in out if message["type"] == "frame" and message["cars"]]
    assert frames and all(frame["source"] == ESTIMATED for frame in frames)
    assert {car["number"] for car in frames[-1]["cars"]} == {4, 7}


@pytest.fixture(scope="module")
def madring():
    """2026 R14 race (Madring) and a reference from its qualifying, the day before."""
    async def load():
        client = ArchiveClient()
        try:
            race_session = await client.find_session(2026, 14, "R")
            qualifying_session = await client.find_session(2026, 14, "Q")
            race_raw = await client.load_raw_feed(race_session, TOPICS)
            qualifying_raw = await client.load_raw_feed(qualifying_session, TOPICS)
            return race_raw, qualifying_raw
        finally:
            await client.close()

    try:
        race_raw, qualifying_raw = asyncio.run(load())
    except httpx.HTTPError as error:
        pytest.skip(f"F1 archive not reachable: {error}")
    race = build_recording(race_raw)
    qualifying = build_recording(qualifying_raw)
    reference = build_reference(
        qualifying.messages, qualifying.positions, qualifying.final_state,
        qualifying.session.circuit_key, qualifying.session.path,
    )
    assert reference is not None
    return {"race": race, "reference": reference}


def test_estimate_matches_the_real_positions_of_a_race(madring):
    result = evaluate(madring["race"], madring["reference"], render_delay_ms=DELAY, step_ms=5_000)
    summary = result.summary()
    assert summary["green"]["median"] < 15
    assert summary["green"]["p95"] < 150
    assert summary["all"]["median"] < 25
    assert summary["neighbourOrder"] > 0.85
    assert summary["shown"] > 0.95


def test_replay_can_show_the_estimate_instead_of_the_recorded_positions(madring):
    player = ReplayPlayer(madring["race"], speed=8, estimate_with=madring["reference"])
    snapshot = player.start()
    init = snapshot[0]
    assert init["positionsSource"] == ESTIMATED
    player.seek(player.origin + init["timeline"]["green"] + 600_000)
    frames = [message for message in player.tick() if message["type"] == "frame"]
    assert frames[-1]["source"] == ESTIMATED
    assert len(frames[-1]["cars"]) >= 18


# Synthetic circuit and feed.


def _circle_reference() -> CircuitReference:
    angles = np.linspace(0, 2 * math.pi, 720, endpoint=False)
    points = [[RADIUS * math.cos(angle), RADIUS * math.sin(angle)] for angle in angles]
    line = Polyline.densified(points)
    length = line.length
    count = sum(LAYOUT)
    checkpoints = [length * (index + 1) / count for index in range(count)]
    profile_s = np.linspace(0, length, 200)
    profile_tau = profile_s / length
    lane_points = [[RADIUS + 300, -800 + step * 16] for step in range(101)]
    lane = Polyline.densified(lane_points, closed=False)
    entry_s, _ = line.project([lane_points[0][0]], [lane_points[0][1]])
    exit_s, _ = line.project([lane_points[-1][0]], [lane_points[-1][1]])
    pit = PitLane(lane, float(entry_s[0]), float(exit_s[0]), 0.22, 2_500, 25_000, {"TeamA": 800.0}, 800.0)
    return CircuitReference(
        circuit_key=999, source="synthetic", built_at=0.0, line=line, profile_s=profile_s,
        profile_tau=profile_tau, lap_ms=SPAN_MS * count, layout=LAYOUT, checkpoints=checkpoints, pit=pit,
    )


def _laps(number: str, start_flat: int, count: int, delay_ms: int = 0) -> list[FeedMessage]:
    """A mini-sector flip every SPAN_MS, with the lap reset message at every new lap."""
    messages = []
    total = sum(LAYOUT)
    for index in range(count):
        flat = (start_flat + index) % total
        utc = T0 + delay_ms + index * SPAN_MS + SPAN_MS
        sector, segment = _sector_of(flat)
        sectors = {str(sector): {"Segments": {str(segment): {"Status": 2048}}}}
        if flat == 0 and index > 0:
            for other in range(1, total):
                other_sector, other_segment = _sector_of(other)
                segments = sectors.setdefault(str(other_sector), {"Segments": {}})["Segments"]
                segments[str(other_segment)] = {"Status": 0}
        messages.append(_line(number, {"Sectors": sectors}, utc))
    return messages


def _sector_of(flat: int) -> tuple[int, int]:
    for sector, size in enumerate(LAYOUT):
        if flat < size:
            return sector, flat
        flat -= size
    raise ValueError(flat)


def _line(number: str, line: dict, utc: int) -> FeedMessage:
    return FeedMessage("TimingData", {"Lines": {number: line}}, utc)


def _session_info(kind: str) -> FeedMessage:
    return FeedMessage("SessionInfo", {"Type": kind, "Name": kind, "Path": "synthetic/"}, T0 - 60_000)


def _drivers(teams: dict[str, str]) -> FeedMessage:
    data = {number: {"RacingNumber": number, "Tla": f"C{number}", "TeamName": team, "Line": index + 1}
            for index, (number, team) in enumerate(teams.items())}
    return FeedMessage("DriverList", data, T0 - 50_000)


class _Feeder:
    """Hands messages to the estimator in time order, each once."""

    def __init__(self, estimator: PositionEstimator, messages: list[FeedMessage]) -> None:
        self.estimator = estimator
        self.messages = sorted(messages, key=lambda item: item.utc)
        self.cursor = 0

    def until(self, now: int) -> None:
        while self.cursor < len(self.messages) and self.messages[self.cursor].utc <= now:
            self.estimator.ingest(self.messages[self.cursor])
            self.cursor += 1
