"""DelayedPositions against a simulated growing Position.z.jsonStream.

The static archive of a running session cannot be observed today, so a mock server serves a real
recorded stream (2026 R14) as if it were being written live: at clock time `now` only the lines
whose samples are older than `now - lag` exist, and Range requests return what was appended.
"""

import asyncio

import httpx
import orjson
import pytest

from f1live import config
from f1live.archive import ArchiveClient
from f1live.decode import FeedMessage, decode_feed, parse_archive_line, parse_utc
from f1live.delayed import DelayedPositions
from f1live.engine import ESTIMATED, OFFICIAL_DELAYED, SessionEngine
from f1live.estimator import PositionEstimator

PATH = "2026/2026-09-13_Spanish_Grand_Prix/2026-09-13_Race/"
LINES = 3_000


class GrowingStream:
    """A Position.z.jsonStream that grows with a fake clock, served with HTTP Range support."""

    def __init__(self, lines: list[bytes], times: list[int]) -> None:
        self.lines = lines
        self.times = times
        self.now = times[0]
        self.lag_ms = 5_000
        self.exists = True
        self.requests: list[str | None] = []

    def visible(self) -> bytes:
        cutoff = self.now - self.lag_ms
        count = sum(1 for moment in self.times if moment <= cutoff)
        body = b"".join(self.lines[:count])
        # The writer may be in the middle of a line.
        if count < len(self.lines):
            body += self.lines[count][:40]
        return b"\xef\xbb\xbf" + body

    def handle(self, request: httpx.Request) -> httpx.Response:
        if not self.exists:
            return httpx.Response(404)
        body = self.visible()
        wanted = request.headers.get("range")
        self.requests.append(wanted)
        if not wanted:
            return httpx.Response(200, content=body)
        start = int(wanted.removeprefix("bytes=").rstrip("-"))
        if start >= len(body):
            return httpx.Response(416)
        headers = {"Content-Range": f"bytes {start}-{len(body) - 1}/{len(body)}"}
        return httpx.Response(206, content=body[start:], headers=headers)


@pytest.fixture(scope="module")
def recorded_lines():
    async def load() -> str:
        client = ArchiveClient()
        try:
            session = await client.find_session(2026, 14, "R")
            return await client.fetch_stream(session, "Position.z")
        finally:
            await client.close()

    try:
        text = asyncio.run(load())
    except httpx.HTTPError as error:
        pytest.skip(f"F1 archive not reachable: {error}")
    raw_lines = text.splitlines()[1_000:1_000 + LINES]
    lines = []
    times = []
    for raw in raw_lines:
        parsed = parse_archive_line(raw)
        payload = orjson.loads(parsed[1])
        message = decode_feed("Position.z", payload, 0)
        newest = message.data["Position"][-1]["Timestamp"]
        times.append(parse_utc(newest))
        lines.append((raw + "\r\n").encode())
    return lines, times


def _follower(stream: GrowingStream) -> DelayedPositions:
    transport = httpx.MockTransport(stream.handle)
    http = httpx.AsyncClient(transport=transport)
    return DelayedPositions(http, PATH, poll_s=30, clock=lambda: stream.now)


def test_follower_reads_only_what_was_appended(recorded_lines):
    lines, times = recorded_lines
    stream = GrowingStream(lines, times)
    follower = _follower(stream)
    stream.now = times[0] + 65_000

    async def run() -> list[int]:
        added = [await follower.poll_once()]
        for _ in range(3):
            stream.now += 30_000
            added.append(await follower.poll_once())
        added.append(await follower.poll_once())
        return added

    added = asyncio.run(run())
    assert all(count > 0 for count in added[:4])
    assert added[4] == 0
    assert stream.requests[0] is None
    assert all(header.startswith("bytes=") for header in stream.requests[1:])
    # Exactly the samples of the complete visible lines, none twice, none lost at line cuts.
    reference = DelayedPositions(None, PATH)
    full = b"".join(lines[: sum(1 for moment in times if moment <= stream.now - stream.lag_ms)])
    expected = reference._consume(full)
    assert follower.status.samples == expected
    assert follower.lag_ms() == pytest.approx(stream.lag_ms, abs=1_000)
    assert follower.growing()


def test_missing_file_is_not_an_error(recorded_lines):
    lines, times = recorded_lines
    stream = GrowingStream(lines, times)
    stream.exists = False
    follower = _follower(stream)
    asyncio.run(follower.poll_once())
    assert follower.status.available is False
    assert follower.status.http_status == 404
    assert not follower.growing()


def test_engine_uses_the_delayed_stream_only_when_it_is_close_to_live(recorded_lines):
    lines, times = recorded_lines
    stream = GrowingStream(lines, times)
    follower = _follower(stream)
    engine = SessionEngine("live", render_delay_ms=config.LIVE_RENDER_DELAY_MS, estimator=PositionEstimator())
    engine.ingest(FeedMessage("DriverList", {"1": {"Tla": "AAA", "Line": 1}, "44": {"Tla": "BBB", "Line": 2}}, times[0]))
    engine.delayed = follower

    stream.now = times[0] + 65_000
    asyncio.run(follower.poll_once())
    out = engine.tick(stream.now)
    frame = out[-1]
    assert engine.positions_source == OFFICIAL_DELAYED
    assert out[0]["type"] == "init" and out[0]["positionsSource"] == OFFICIAL_DELAYED
    assert frame["source"] == OFFICIAL_DELAYED and len(frame["cars"]) == 2
    shown_at = engine.origin + frame["t"]
    assert stream.now - shown_at == pytest.approx(stream.lag_ms + 1_000, abs=1_000)

    # The archive falls 2 minutes behind (a line holds about 1 s of samples, hence the tolerance
    # above): too late to draw, the map goes back to the estimate.
    stream.lag_ms = 120_000
    stream.now += 30_000
    asyncio.run(follower.poll_once())
    stream.now += 30_000
    asyncio.run(follower.poll_once())
    assert not follower.can_replace(stream.now)
    assert follower.can_correct(stream.now)
    engine.estimator.set_reference(_tiny_reference())
    engine.tick(stream.now)
    assert engine.positions_source == ESTIMATED


def _tiny_reference():
    from f1live.reference import CircuitReference, Polyline
    import numpy as np

    line = Polyline.densified([[0, 0], [1000, 0], [1000, 1000], [0, 1000]])
    profile_s = np.linspace(0, line.length, 50)
    return CircuitReference(
        circuit_key=1, source="tiny", built_at=0.0, line=line, profile_s=profile_s,
        profile_tau=profile_s / line.length, lap_ms=60_000, layout=[1, 1, 1],
        checkpoints=[line.length / 3, 2 * line.length / 3, line.length],
    )
