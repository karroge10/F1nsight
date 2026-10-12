"""Replay of archived sessions: one ReplayPlayer per /ws/replay client.

A recording is loaded once (shared through RecordingCache) and every player drives its own
SessionEngine over it, with its own clock, speed, pause and seek. Car positions are preloaded,
and frames are drawn TIMING_LAG_MS behind the replay clock so the map matches the tower.
"""

import asyncio
import math
import time
from collections import OrderedDict

import httpx

from f1live import config
from f1live.archive import ArchiveClient, Recording
from f1live.engine import SessionEngine
from f1live.estimator import PositionEstimator
from f1live.reference import CircuitReference
from f1live.stores import PositionStore, TelemetryStore
from f1live.track import resolve_track

MIN_SPEED = 0.1
MAX_SPEED = 64.0
CACHE_SIZE = 3
# Default start: this long before the green light (SessionStatus Started).
DEFAULT_LEAD_MS = 60_000


class RecordingCache:
    """Loaded recordings (with their track), shared by all replay clients."""

    def __init__(self, archive: ArchiveClient, http: httpx.AsyncClient) -> None:
        self.archive = archive
        self.http = http
        self._items: OrderedDict[tuple, Recording] = OrderedDict()
        self._locks: dict[tuple, asyncio.Lock] = {}

    async def get(self, season: int, round_number: int, code: str) -> Recording:
        key = (season, round_number, code.upper())
        if key not in self._locks:
            self._locks[key] = asyncio.Lock()
        lock = self._locks[key]
        async with lock:
            if key in self._items:
                self._items.move_to_end(key)
                return self._items[key]
            session = await self.archive.find_session(season, round_number, code)
            if session is None:
                raise LookupError(f"no archived session {season} round {round_number} {code}")
            recording = await self.archive.load_recording(session)
            recording.track = await resolve_track(
                self.http,
                session.circuit_key,
                session.season,
                recording.positions,
                recording.final_state,
                session.round,
            )
            self._items[key] = recording
            while len(self._items) > CACHE_SIZE:
                self._items.popitem(last=False)
            return recording


class ReplayPlayer:
    def __init__(
        self,
        recording: Recording,
        speed: float = 1.0,
        start_t: int | None = None,
        estimate_with: CircuitReference | None = None,
    ) -> None:
        """`estimate_with`: ignore the recorded positions and show the estimate from timing alone
        (a reference built from another session), exactly as a live session without a token."""
        self.recording = recording
        self.estimate_with = estimate_with
        self.speed = _clamp_speed(speed)
        self.paused = False
        self.engine = self._new_engine()
        self._cursor = 0
        default_start = recording.start_utc
        if recording.green_utc is not None:
            default_start = max(recording.start_utc, recording.green_utc - DEFAULT_LEAD_MS)
        self.position_utc = default_start
        if start_t is not None:
            self.position_utc = self._clamp(self.origin + start_t)
        self._wall_anchor = time.perf_counter()
        self._utc_anchor = self.position_utc

    @property
    def origin(self) -> int:
        return self.engine.origin or self.recording.start_utc

    @property
    def ended(self) -> bool:
        return self.position_utc >= self.recording.end_utc

    def start(self) -> list[dict]:
        """Fast-forward to the start position and return the initial snapshot."""
        self._apply_until(self.position_utc)
        self.engine.drain()
        self._reanchor()
        return self.engine.snapshot(self.position_utc) + [self.playback_message()]

    def tick(self) -> list[dict]:
        """Advance the replay clock and return what to send for this tick."""
        if not self.paused and not self.ended:
            elapsed_ms = (time.perf_counter() - self._wall_anchor) * 1000 * self.speed
            advanced = self._utc_anchor + int(elapsed_ms)
            self.position_utc = min(self.recording.end_utc, advanced)
        self._apply_until(self.position_utc)
        out = self.engine.tick(self.position_utc)
        if self.ended and not self.paused:
            self.paused = True
            playback = self.playback_message()
            out.append(playback)
        return out

    def command(self, command: dict) -> list[dict]:
        """Handle a client command: seek, speed, pause, resume. Returns messages to send."""
        name = command.get("cmd")
        if name == "seek" and _is_number(command.get("t")):
            # Any offset is accepted: seek() clamps it to the recording, before the start included.
            target_utc = self.origin + int(command["t"])
            return self.seek(target_utc)
        if name == "speed" and _is_number(command.get("value")):
            self._reanchor()
            self.speed = _clamp_speed(command["value"])
        elif name == "pause":
            self._reanchor()
            self.paused = True
        elif name == "resume":
            if self.ended:
                return self.seek(self.recording.start_utc)
            self.paused = False
            self._reanchor()
        else:
            return [{"type": "error", "message": f"unknown command: {command}"}]
        return [self.playback_message()]

    def seek(self, target_utc: int) -> list[dict]:
        target_utc = self._clamp(target_utc)
        if target_utc < self.position_utc:
            self.engine = self._new_engine()
            self._cursor = 0
        self.position_utc = target_utc
        self._apply_until(target_utc)
        self.engine.drain()
        self._reanchor()
        return self.engine.snapshot(target_utc) + [self.playback_message()]

    def playback_message(self) -> dict:
        return {
            "type": "playback",
            "t": self.position_utc - self.origin,
            "speed": self.speed,
            "paused": self.paused,
            "ended": self.ended,
        }

    def _new_engine(self) -> SessionEngine:
        recording = self.recording
        if self.estimate_with is not None:
            estimator = PositionEstimator(self.estimate_with, render_delay_ms=config.LIVE_RENDER_DELAY_MS)
            engine = SessionEngine(
                "replay",
                render_delay_ms=config.LIVE_RENDER_DELAY_MS,
                positions=PositionStore(),
                telemetry=TelemetryStore(),
                estimator=estimator,
            )
            engine.sources = {"timing": "f1-archive", "positions": None}
        else:
            engine = SessionEngine(
                "replay",
                render_delay_ms=config.TIMING_LAG_MS,
                positions=recording.positions,
                telemetry=recording.telemetry,
            )
            engine.sources = {"timing": "f1-archive", "positions": "f1-archive"}
        engine.track = recording.track
        # Apply the first SessionInfo right away so `origin` is known before the timeline is built.
        first_session_info = next((m for m in recording.messages if m.topic == "SessionInfo"), None)
        if first_session_info is not None:
            engine.ingest(first_session_info)
            engine.drain()
        origin = engine.origin or recording.start_utc
        green = recording.green_utc
        engine.timeline = {
            "start": recording.start_utc - origin,
            "end": recording.end_utc - origin,
            "green": None if green is None else green - origin,
        }
        return engine

    def _apply_until(self, utc: int) -> None:
        messages = self.recording.messages
        while self._cursor < len(messages) and messages[self._cursor].utc <= utc:
            self.engine.ingest(messages[self._cursor])
            self._cursor += 1

    def _reanchor(self) -> None:
        self._wall_anchor = time.perf_counter()
        self._utc_anchor = self.position_utc

    def _clamp(self, utc: int) -> int:
        capped = min(self.recording.end_utc, utc)
        return max(self.recording.start_utc, capped)


def tick_interval() -> float:
    return 1.0 / config.FRAME_HZ


def _clamp_speed(speed: float) -> float:
    capped = min(MAX_SPEED, float(speed))
    return max(MIN_SPEED, capped)


def _is_number(value: object) -> bool:
    """A finite int or float (JSON lets NaN and Infinity through, and bool is an int)."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    return math.isfinite(value)
