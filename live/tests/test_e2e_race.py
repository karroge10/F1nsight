"""End to end: recorded races from the F1 archive fed through the live path and the replay path.

The live path test plays every archived line, in arrival order, as SignalR Core frame text into
the LiveHub (`parse_frames` -> SessionEngine), exactly like the upstream connection does.
Downloads are cached under data/raw/livetiming, so only the first run needs the network.
"""

import asyncio
from collections import defaultdict

import httpx
import pytest

from f1live.archive import ArchiveClient, RawFeed, build_recording
from f1live.hub import LiveHub, SimulatedFeed, SimulationOptions
from f1live.replay import ReplayPlayer

TICK_MS = 1000
# 2026 R16 (Bahrain GP held in Kuala Lumpur): wet start, red flag, safety car, VSC, 22 cars.
# 2025 R10 (Canada): late safety car, and the DRS channel still exists in 2025 car data.
RACES = [(2026, 16), (2025, 10)]


@pytest.fixture(scope="module", params=RACES, ids=lambda race: f"{race[0]}-R{race[1]}")
def race(request):
    season, round_number = request.param
    raw = _load_raw(season, round_number)
    options = SimulationOptions(season, round_number, "R")
    hub = LiveHub(None, None, options)
    feed = SimulatedFeed(raw, options, hub.on_text, raw.zero_utc)
    hub.sim_feed = feed
    outgoing: list[dict] = []
    feed.run_offline(TICK_MS, lambda now: outgoing.extend(hub.engine.tick(now)))
    return {"season": season, "raw": raw, "hub": hub, "messages": outgoing}


def test_every_car_gets_positions(race):
    frames = _of_type(race, "frame")
    numbers_seen = {car["number"] for frame in frames for car in frame["cars"]}
    assert len(numbers_seen) >= 20
    assert max(len(frame["cars"]) for frame in frames) >= 20
    moving = _cars_that_moved(frames)
    assert len(moving) >= 20


def test_timing_tower_positions_are_one_to_n_without_duplicates(race):
    timing = _of_type(race, "timing")
    final = timing[-1]
    positions = [row["pos"] for row in final["rows"]]
    assert positions == list(range(1, len(positions) + 1))
    assert len({row["number"] for row in final["rows"]}) == len(positions) >= 20
    # The feed's own positions (before the tower renumbers) must also be a clean 1..N.
    lines = race["hub"].engine.state.timing_lines()
    reported = sorted(int(line["Position"]) for line in lines.values())
    assert reported == list(range(1, len(reported) + 1))
    for message in timing[len(timing) // 2:]:
        mid_positions = [row["pos"] for row in message["rows"]]
        assert len(set(mid_positions)) == len(mid_positions)


def test_lap_count_progresses_to_the_total(race):
    laps = [message["lap"] for message in _of_type(race, "timing") if message["lap"]]
    currents = [lap["current"] for lap in laps if lap["current"] is not None]
    assert currents == sorted(currents)
    assert currents[-1] == laps[-1]["total"]
    assert currents[-1] >= 40


def test_pit_stops_and_tyre_changes_are_detected(race):
    stops = _of_type(race, "pitStop")
    assert len(stops) >= 10
    assert all(stop["duration"] and stop["duration"] > 0 for stop in stops)
    final_rows = _of_type(race, "timing")[-1]["rows"]
    assert sum(row["pits"] or 0 for row in final_rows) >= 10
    assert all(row["tyre"] for row in final_rows if not row["retired"])
    compounds_by_car = defaultdict(list)
    for message in _of_type(race, "timing"):
        for row in message["rows"]:
            history = compounds_by_car[row["number"]]
            if row["tyre"] and (not history or history[-1] != row["tyre"]):
                history.append(row["tyre"])
    cars_that_changed_compound = [number for number, history in compounds_by_car.items() if len(history) > 1]
    assert len(cars_that_changed_compound) >= 10
    assert len(_of_type(race, "tyreChange")) >= 10


def test_flags_and_safety_car_appear(race):
    states = {message["state"] for message in _of_type(race, "trackStatus")}
    assert "yellow" in states and "green" in states
    assert "sc" in states or "vsc" in states
    texts = [item["message"] for message in _of_type(race, "raceControl") for item in message["messages"]]
    assert any("SAFETY CAR" in (text or "") for text in texts)
    if race["season"] == 2026:
        assert {"sc", "vsc", "red"} <= states


def test_init_carries_session_and_drivers(race):
    init = _of_type(race, "init")[-1]
    assert init["session"]["code"] == "R"
    assert init["session"]["season"] == race["season"]
    assert len(init["drivers"]) >= 20
    assert all(driver["teamColor"].startswith("#") and len(driver["teamColor"]) == 7 for driver in init["drivers"])


def test_drs_reported_only_when_the_car_data_has_it(race):
    rows = [row for message in _of_type(race, "timing") for row in message["rows"]]
    drs_values = {row["drs"] for row in rows}
    if race["season"] >= 2026:
        assert drs_values == {None}
    else:
        assert True in drs_values


def test_replay_path_uses_the_same_message_shapes(race):
    recording = build_recording(race["raw"])
    player = ReplayPlayer(recording, speed=8)
    snapshot = player.start()
    assert [message["type"] for message in snapshot] == [
        "init", "timing", "trackStatus", "weather", "raceControl", "pitHistory", "frame", "playback"
    ]
    live = race["messages"]
    live_frame = next(m for m in live if m["type"] == "frame" and m["cars"])
    live_timing = next(m for m in live if m["type"] == "timing" and m["rows"])
    replay_frame = next(m for m in snapshot if m["type"] == "frame")
    replay_timing = next(m for m in snapshot if m["type"] == "timing")
    assert set(replay_frame) == set(live_frame)
    assert set(replay_frame["cars"][0]) == set(live_frame["cars"][0])
    assert set(replay_timing) == set(live_timing)
    assert set(replay_timing["rows"][0]) == set(live_timing["rows"][0])
    assert len(replay_frame["cars"]) >= 20

    timeline = snapshot[0]["timeline"]
    late = player.seek(player.origin + timeline["end"] - 60_000)
    late_timing = next(m for m in late if m["type"] == "timing")
    assert late_timing["lap"]["current"] >= late_timing["lap"]["total"] - 1
    early = player.seek(player.origin + timeline["green"] + 120_000)
    early_timing = next(m for m in early if m["type"] == "timing")
    assert early_timing["lap"]["current"] <= 3
    assert player.command({"cmd": "speed", "value": 4})[0] == {
        "type": "playback", "t": player.position_utc - player.origin, "speed": 4.0, "paused": False, "ended": False
    }
    assert player.command({"cmd": "pause"})[0]["paused"] is True
    ticked = player.tick()
    assert ticked[-1]["type"] == "frame"


def test_replay_seek_outside_the_recording_is_clamped(race):
    recording = build_recording(race["raw"])
    player = ReplayPlayer(recording, speed=8)
    timeline = player.start()[0]["timeline"]
    before = player.command({"cmd": "seek", "t": timeline["start"] - 10_000_000})
    assert before[-1]["t"] == timeline["start"]
    assert [m for m in before if m["type"] == "weather"]
    again = player.command({"cmd": "seek", "t": -10**15})
    assert again[-1]["t"] == timeline["start"]
    after = player.command({"cmd": "seek", "t": timeline["end"] + 10_000_000})
    assert after[-1]["t"] == timeline["end"]
    assert after[-1]["ended"] is True
    for broken in (float("nan"), float("inf"), True, "10", None):
        reply = player.command({"cmd": "seek", "t": broken})
        assert reply[0]["type"] == "error"
    assert player.position_utc == recording.end_utc


def _load_raw(season: int, round_number: int) -> RawFeed:
    async def load() -> RawFeed:
        client = ArchiveClient()
        try:
            session = await client.find_session(season, round_number, "R")
            assert session is not None
            return await client.load_raw_feed(session)
        finally:
            await client.close()

    try:
        return asyncio.run(load())
    except httpx.HTTPError as error:
        pytest.skip(f"F1 archive not reachable: {error}")


def _of_type(race: dict, kind: str) -> list[dict]:
    return [message for message in race["messages"] if message["type"] == kind]


def _cars_that_moved(frames: list[dict]) -> set[int]:
    first_seen: dict[int, tuple[int, int]] = {}
    moved = set()
    for frame in frames:
        for car in frame["cars"]:
            origin = first_seen.setdefault(car["number"], (car["x"], car["y"]))
            if abs(car["x"] - origin[0]) + abs(car["y"] - origin[1]) > 1000:
                moved.add(car["number"])
    return moved
