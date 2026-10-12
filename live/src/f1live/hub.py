"""LiveHub: one upstream feed shared by every /ws/live client.

The hub owns a SessionEngine and one source:
  live       SignalRCoreClient (F1 hub), plus OpenF1 positions when the hub withholds them
  simulated  SimulatedFeed: a recorded session from the archive, replayed line by line in
             arrival order as SignalR Core frame text and parsed by the live parser
             (`anonymous` drops Position.z and CarData.z, like a live connection without a token)

Without positions the engine's PositionEstimator reconstructs them from timing; the hub loads
its circuit reference from the free archive (and refreshes it when an earlier session of the
weekend gets archived), and follows the static archive's Position.z of the running session in
case it grows during the session (DelayedPositions).

A ticker calls `engine.tick` FRAME_HZ times a second and broadcasts the result. Each client has
a bounded queue; a slow client loses old frames instead of slowing everyone down.
"""

import asyncio
import contextlib
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass

import httpx
import orjson

from f1live import config
from f1live.archive import ArchiveClient, ArchiveSession, RawFeed
from f1live.decode import FeedMessage, format_utc, now_ms
from f1live.delayed import DelayedPositions
from f1live.engine import SessionEngine
from f1live.estimator import PositionEstimator
from f1live.openf1 import OpenF1Positions
from f1live.reference_source import ReferenceSource
from f1live.signalr import HubUpdate, SignalRCoreClient, feed_frame, parse_frames
from f1live.track import resolve_track

log = logging.getLogger(__name__)

CLIENT_QUEUE_SIZE = 256
IDLE_STOP_S = 60
TRACK_RETRY_S = 30
OPENF1_GRACE_S = 20
FALLBACK_CHECK_S = 30
READY_TIMEOUT_S = 10
SESSION_WAIT_S = 2
FINISHED_STATUSES = {"Finalised", "Ends"}
CAR_TOPICS = {"Position.z", "CarData.z"}


@dataclass
class SimulationOptions:
    season: int
    round: int
    session: str
    speed: float = 1.0
    # Where to start, in ms relative to the green light (SessionStatus Started). Negative = before.
    start_offset_ms: int = -120_000
    # Drop car positions and car data, as a live connection without an F1TV token gets.
    anonymous: bool = False


class Client:
    def __init__(self) -> None:
        self.queue: asyncio.Queue[str] = asyncio.Queue(CLIENT_QUEUE_SIZE)
        self.dropped = 0

    def offer(self, text: str) -> None:
        if self.queue.full():
            with contextlib.suppress(asyncio.QueueEmpty):
                self.queue.get_nowait()
            self.dropped += 1
        self.queue.put_nowait(text)


class LiveHub:
    def __init__(
        self,
        http: httpx.AsyncClient,
        archive: ArchiveClient,
        simulation: SimulationOptions | None = None,
        references: ReferenceSource | None = None,
    ) -> None:
        self.http = http
        self.archive = archive
        self.simulation = simulation
        self.mode = "simulated" if simulation else "live"
        if references is None and archive is not None:
            references = ReferenceSource(archive)
        self.references = references
        self.engine = self._new_engine()
        self.clients: set[Client] = set()
        self.upstream: SignalRCoreClient | None = None
        self.openf1: OpenF1Positions | None = None
        self.delayed: DelayedPositions | None = None
        self.sim_feed: SimulatedFeed | None = None
        self._tasks: list[asyncio.Task] = []
        self._clock_skew_ms = 0
        self._track_key: tuple | None = None
        self._track_task: asyncio.Task | None = None
        self._last_track_attempt = 0.0
        self._idle_since: float | None = None
        self._started_at: float | None = None
        self._ready = asyncio.Event()
        self.messages_sent = 0

    @property
    def running(self) -> bool:
        return bool(self._tasks)

    async def start(self) -> None:
        if self.running:
            return
        self._started_at = time.time()
        if self.simulation:
            self.sim_feed = await SimulatedFeed.create(self.archive, self.simulation, self.on_text)
            positions = None if self.simulation.anonymous else "archive-simulated"
            self.engine.sources = {"timing": "archive-simulated", "positions": positions}
            self._spawn_task(self.sim_feed.run)
        else:
            self.upstream = SignalRCoreClient(self.on_updates)
            self.engine.sources = {"timing": "f1-signalrcore", "positions": None}
            self._spawn_task(self.upstream.run)
            self._spawn_task(self._position_fallback)
            if config.DELAYED_ENABLED and self.http is not None:
                self._spawn_task(self._delayed_positions)
        if self.engine.estimator is not None and self.references is not None:
            self._spawn_task(self._reference_loop)
        self._spawn_task(self._ticker)

    async def stop(self) -> None:
        for task in self._tasks:
            task.cancel()
        for task in self._tasks:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task
        self._tasks.clear()
        self.engine = self._new_engine()
        self.delayed = None
        self._track_key = None
        self._ready = asyncio.Event()

    async def subscribe(self) -> Client:
        await self.start()
        # Give the upstream a moment to deliver its snapshot so the first init is complete.
        ready = self._ready.wait()
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(ready, READY_TIMEOUT_S)
        if self._track_task is not None:
            shielded = asyncio.shield(self._track_task)
            with contextlib.suppress(TimeoutError, asyncio.CancelledError):
                await asyncio.wait_for(shielded, READY_TIMEOUT_S)
        client = Client()
        self._idle_since = None
        now = self.now()
        snapshot = self.engine.snapshot(now)
        for message in snapshot:
            text = _encode(message)
            client.offer(text)
        self.clients.add(client)
        return client

    def unsubscribe(self, client: Client) -> None:
        self.clients.discard(client)
        if not self.clients:
            self._idle_since = time.time()

    def now(self) -> int:
        """Current feed time in UTC ms: the simulation clock, or wall time corrected for skew."""
        if self.sim_feed is not None:
            return self.sim_feed.clock_utc()
        return now_ms() + self._clock_skew_ms

    def on_text(self, text: str) -> None:
        """Entry point for raw SignalR Core text (used by the simulated feed)."""
        now = self.now()
        updates = parse_frames(text, now)
        self.on_updates(updates)

    def on_updates(self, updates: list[HubUpdate]) -> None:
        for update in updates:
            if update.message.topic == "Heartbeat" and self.sim_feed is None:
                self._clock_skew_ms = update.message.utc - now_ms()
            self.engine.ingest(update.message, replace=update.replace)
        if not self._ready.is_set() and self.engine.state.session_info():
            self._ready.set()
        self._maybe_resolve_track()

    def on_position_message(self, message: FeedMessage) -> None:
        self.engine.ingest(message)

    def status(self) -> dict:
        return {
            "mode": self.mode,
            "running": self.running,
            "clients": len(self.clients),
            "sources": self.engine.sources,
            "upstream": self.upstream.status.as_dict() if self.upstream else None,
            "openf1": self.openf1.status.as_dict() if self.openf1 else None,
            "positionsSource": self.engine.positions_source,
            "estimator": self.engine.estimator.describe() if self.engine.estimator else None,
            "delayed": self.delayed.describe() if self.delayed else None,
            "simulation": self.sim_feed.describe() if self.sim_feed else None,
            "messagesSent": self.messages_sent,
            "feedTime": self._feed_time(),
        }

    def _new_engine(self) -> SessionEngine:
        estimator = None
        if config.ESTIMATOR_ENABLED:
            estimator = PositionEstimator(render_delay_ms=config.LIVE_RENDER_DELAY_MS)
        return SessionEngine(self.mode, render_delay_ms=config.LIVE_RENDER_DELAY_MS, estimator=estimator)

    def _feed_time(self) -> str | None:
        if not self.running:
            return None
        now = self.now()
        return format_utc(now)

    async def _ticker(self) -> None:
        interval = 1.0 / config.FRAME_HZ
        next_tick = time.perf_counter()
        while True:
            next_tick += interval
            now = self.now()
            outgoing = self.engine.tick(now)
            self._broadcast(outgoing)
            await self._maybe_idle_stop()
            delay = next_tick - time.perf_counter()
            if delay < 0:
                next_tick = time.perf_counter()
                delay = 0
            await asyncio.sleep(delay)

    def _spawn_task(self, factory: Callable) -> None:
        coroutine = factory()
        task = asyncio.create_task(coroutine)
        self._tasks.append(task)

    def _broadcast(self, outgoing: list[dict]) -> None:
        if not self.clients:
            return
        for message in outgoing:
            text = _encode(message)
            for client in self.clients:
                client.offer(text)
            self.messages_sent += 1

    async def _maybe_idle_stop(self) -> None:
        if self.simulation or self._idle_since is None:
            return
        if time.time() - self._idle_since > IDLE_STOP_S:
            log.info("no live clients for %ss, closing upstream", IDLE_STOP_S)
            self._idle_since = None
            stopping = self.stop()
            asyncio.ensure_future(stopping)

    async def _position_fallback(self) -> None:
        """Start OpenF1 positions while a session runs and the F1 hub withholds positions."""
        await asyncio.sleep(OPENF1_GRACE_S)
        while not self._needs_position_fallback():
            if self.upstream is not None and self.upstream.status.positions_available:
                return
            await asyncio.sleep(FALLBACK_CHECK_S)
        self.openf1 = OpenF1Positions(self.http, self.on_position_message)
        self.engine.sources["positions"] = "openf1"
        await self.openf1.run()
        if self.openf1.status.disabled_reason:
            self.engine.sources["positions"] = None

    async def _reference_loop(self) -> None:
        """Give the estimator a circuit reference, and refresh it while the session runs."""
        while not self.engine.state.session_info().get("Path"):
            await asyncio.sleep(SESSION_WAIT_S)
        while True:
            await self._refresh_reference()
            await asyncio.sleep(config.REFERENCE_REFRESH_S)

    async def _refresh_reference(self) -> None:
        info = self.engine.state.session_info()
        circuit_key = ((info.get("Meeting") or {}).get("Circuit") or {}).get("Key")
        path = info.get("Path") or ""
        season = int(path[:4]) if path[:4].isdigit() else None
        if not circuit_key or season is None:
            return
        try:
            now = self.now()
            reference = await self.references.best(circuit_key, season, now, exclude_path=path)
        except Exception:
            log.exception("estimator reference failed")
            return
        estimator = self.engine.estimator
        if reference is None or estimator is None or reference is estimator.reference:
            return
        estimator.set_reference(reference)
        self.engine.refresh_init()
        log.info("estimator uses reference %s", reference.source)

    async def _delayed_positions(self) -> None:
        """Follow the static archive's Position.z of the running session when the hub has none."""
        await asyncio.sleep(OPENF1_GRACE_S)
        while not self._needs_delayed_positions():
            await asyncio.sleep(FALLBACK_CHECK_S)
        path = self.engine.state.session_info().get("Path")
        follower = DelayedPositions(self.http, path, clock=self.now)
        self.delayed = follower
        self.engine.delayed = follower
        log.info("following the static archive positions of %s", path)
        await follower.run(self._on_delayed_poll)

    def _on_delayed_poll(self, follower: DelayedPositions) -> None:
        now = self.now()
        estimator = self.engine.estimator
        if estimator is not None and follower.can_correct(now):
            estimator.apply_truth(follower.store)

    def _needs_delayed_positions(self) -> bool:
        if self.upstream is None or self.upstream.status.positions_available is not False:
            return False
        state = self.engine.state
        session_info = state.session_info()
        return bool(session_info.get("Path")) and session_is_running(session_info, state.topics)

    def _needs_position_fallback(self) -> bool:
        if self.upstream is None or self.upstream.status.positions_available is not False:
            return False
        if self.engine.positions.has_data():
            return False
        state = self.engine.state
        session_info = state.session_info()
        return session_is_running(session_info, state.topics)

    def _maybe_resolve_track(self) -> None:
        """Fetch the track once the session is known; rebuild from positions when possible."""
        if self.http is None:
            return
        session = self.engine.state.session_info()
        meeting = session.get("Meeting") or {}
        circuit_key = (meeting.get("Circuit") or {}).get("Key")
        path = session.get("Path") or ""
        season = int(path[:4]) if path[:4].isdigit() else None
        round_number = meeting.get("Number")
        key = (circuit_key, season, round_number)
        if circuit_key is None or self._track_task is not None:
            return
        track = self.engine.track
        needs_first = key != self._track_key
        can_improve = (
            track is not None
            and track.get("source") != "positions"
            and time.time() - self._last_track_attempt > TRACK_RETRY_S
            and self.engine.positions.has_data()
        )
        if not (needs_first or can_improve):
            return
        self._track_key = key
        self._last_track_attempt = time.time()
        loop = asyncio.get_running_loop()
        resolving = self._resolve_track(circuit_key, season, round_number)
        self._track_task = loop.create_task(resolving)

    async def _resolve_track(self, circuit_key: int, season: int | None, round_number: int | None) -> None:
        try:
            # resolve_track builds from positions when a clean lap exists, else cache or MultiViewer.
            track = await resolve_track(
                self.http, circuit_key, season, self.engine.positions, self.engine.state, round_number
            )
            if track is not None and track != self.engine.track:
                self.engine.set_track(track)
        except Exception:
            log.exception("track resolution failed")
        finally:
            self._track_task = None


class SimulatedFeed:
    """Plays a recorded session's raw lines into the hub at `speed`, as live SignalR text."""

    def __init__(self, raw: RawFeed, options: SimulationOptions, sink: Callable[[str], None], start_utc: int) -> None:
        self.raw = raw
        self.options = options
        self.sink = sink
        self.start_utc = start_utc
        self.speed = options.speed
        self._wall_start: float | None = None
        self._offline_now: int | None = None
        self.lines_sent = 0
        self.finished = False

    @classmethod
    async def create(
        cls, archive: ArchiveClient, options: SimulationOptions, sink: Callable[[str], None]
    ) -> "SimulatedFeed":
        session = await archive.find_session(options.season, options.round, options.session)
        if session is None:
            raise LookupError(f"no archived session {options.season} round {options.round} {options.session}")
        raw = await archive.load_raw_feed(session)
        if options.anonymous:
            raw.lines = [line for line in raw.lines if line.topic not in CAR_TOPICS]
        green = _green_utc(raw)
        anchor = green if green is not None else raw.zero_utc
        start_utc = max(raw.zero_utc, anchor + options.start_offset_ms)
        return cls(raw, options, sink, start_utc)

    @property
    def session(self) -> ArchiveSession:
        return self.raw.session

    def clock_utc(self) -> int:
        if self._offline_now is not None:
            return self._offline_now
        if self._wall_start is None:
            return self.start_utc
        elapsed = (time.perf_counter() - self._wall_start) * 1000 * self.speed
        return self.start_utc + int(elapsed)

    async def run(self) -> None:
        """Send everything before the start point at once, then follow the virtual clock."""
        lines = self.raw.lines
        index = 0
        while index < len(lines) and self.raw.zero_utc + lines[index].offset <= self.start_utc:
            self._send(index)
            index += 1
        self._wall_start = time.perf_counter()
        while index < len(lines):
            now = self.clock_utc()
            while index < len(lines) and self.raw.zero_utc + lines[index].offset <= now:
                self._send(index)
                index += 1
            await asyncio.sleep(0.02)
        self.finished = True

    def run_offline(self, tick_ms: int, on_tick: Callable[[int], None]) -> None:
        """Push every line as fast as possible, calling `on_tick(now)` every `tick_ms` of feed time.

        Same frames and parser as `run`, without waiting; used by tests and benchmarks.
        """
        self._offline_now = self.start_utc
        next_tick = self.start_utc
        for index, line in enumerate(self.raw.lines):
            utc = self.raw.zero_utc + line.offset
            while utc > next_tick >= self.start_utc:
                self._offline_now = next_tick
                on_tick(next_tick)
                next_tick += tick_ms
            self._send(index)
        self._offline_now = next_tick
        on_tick(next_tick)
        self.finished = True

    def describe(self) -> dict:
        clock = self.clock_utc()
        return {
            "season": self.options.season,
            "round": self.options.round,
            "session": self.options.session,
            "speed": self.speed,
            "anonymous": self.options.anonymous,
            "start": format_utc(self.start_utc),
            "clock": format_utc(clock),
            "linesSent": self.lines_sent,
            "linesTotal": len(self.raw.lines),
            "finished": self.finished,
        }

    def _send(self, index: int) -> None:
        line = self.raw.lines[index]
        timestamp = format_utc(self.raw.zero_utc + line.offset)
        text = feed_frame(line.topic, line.text, timestamp)
        self.sink(text)
        self.lines_sent += 1


def session_is_running(session_info: dict, topics: dict) -> bool:
    """True while the timing system is on a session that has not been finalised."""
    if not session_info:
        return False
    archive_status = (session_info.get("ArchiveStatus") or {}).get("Status")
    status = (topics.get("SessionStatus") or {}).get("Status") or session_info.get("SessionStatus")
    return archive_status != "Complete" and status not in FINISHED_STATUSES


def _green_utc(raw: RawFeed) -> int | None:
    for line in raw.lines:
        if line.topic == "SessionStatus" and '"Started"' in line.text and '"Status":"Started"' in line.text:
            return raw.zero_utc + line.offset
    return None


def _encode(message: dict) -> str:
    return orjson.dumps(message).decode()

