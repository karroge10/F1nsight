"""F1 static live timing archive (https://livetiming.formula1.com/static/...).

Every finished session's recorded live feed is stored there as one `<Topic>.jsonStream` file per
topic. Each line is `HH:MM:SS.mmm<json>` where the time is the offset from the start of the
recording. Compressed topics hold a quoted base64 string, exactly as sent live.

Downloads are cached under data/raw/livetiming/<session path>/ once the archive is complete.
"""

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path

import httpx
import orjson

from f1live import config
from f1live.decode import (
    FeedMessage,
    decode_feed,
    format_utc,
    local_to_utc_ms,
    now_ms,
    parse_archive_line,
    parse_utc,
)
from f1live.state import SESSION_CODES, SessionState
from f1live.stores import PositionStore, TelemetryStore

log = logging.getLogger(__name__)

# A finished session appears in the season index some time after it ends; a short TTL makes its
# replay show up within minutes instead of up to an hour later.
INDEX_TTL_S = 600
POSITIONS_CACHE = "_positions.npz"
TELEMETRY_CACHE = "_telemetry.npz"


@dataclass
class ArchiveSession:
    season: int
    round: int | None
    code: str
    name: str
    type: str
    meeting: str
    meeting_key: int
    session_key: int
    circuit: str
    circuit_key: int
    country: str
    start_utc: int
    end_utc: int
    path: str

    def as_dict(self) -> dict:
        return {
            "season": self.season,
            "round": self.round,
            "session": self.code,
            "name": self.name,
            "type": self.type,
            "meeting": self.meeting,
            "meetingKey": self.meeting_key,
            "sessionKey": self.session_key,
            "circuit": self.circuit,
            "circuitKey": self.circuit_key,
            "country": self.country,
            "start": format_utc(self.start_utc),
            "end": format_utc(self.end_utc),
            "path": self.path,
        }


@dataclass
class RawLine:
    offset: int
    topic: str
    text: str


@dataclass
class RawFeed:
    """All archive lines of one session in arrival order, plus the UTC of offset zero."""

    session: ArchiveSession
    zero_utc: int
    lines: list[RawLine]


@dataclass
class Recording:
    """A session prepared for replay: decoded timing messages plus fully loaded car stores."""

    session: ArchiveSession
    messages: list[FeedMessage]
    positions: PositionStore
    telemetry: TelemetryStore
    final_state: SessionState
    start_utc: int
    end_utc: int
    green_utc: int | None
    track: dict | None = None
    stats: dict = field(default_factory=dict)


class ArchiveClient:
    def __init__(self, cache_dir: Path = config.ARCHIVE_CACHE_DIR) -> None:
        self.cache_dir = cache_dir
        timeout = httpx.Timeout(60.0, connect=15.0)
        self._http = httpx.AsyncClient(
            timeout=timeout,
            headers={"User-Agent": config.USER_AGENT},
            follow_redirects=True,
        )

    async def close(self) -> None:
        await self._http.aclose()

    async def list_sessions(self, season: int) -> list[ArchiveSession]:
        index = await self.season_index(season)
        sessions = []
        for meeting in index.get("Meetings", []):
            meeting_sessions = _meeting_sessions(season, meeting)
            sessions.extend(meeting_sessions)
        sessions.sort(key=lambda session: session.start_utc)
        return sessions

    async def find_session(self, season: int, round_number: int, code: str) -> ArchiveSession | None:
        wanted = code.upper()
        for session in await self.list_sessions(season):
            if session.round == round_number and session.code == wanted:
                return session
        return None

    async def season_index(self, season: int) -> dict:
        cache_file = self.cache_dir / str(season) / "Index.json"
        is_fresh = cache_file.exists() and time.time() - cache_file.stat().st_mtime < INDEX_TTL_S
        if is_fresh:
            return _read_json(cache_file)
        url = f"{config.STATIC_BASE}/{season}/Index.json"
        try:
            response = await self._http.get(url)
            response.raise_for_status()
        except httpx.HTTPError:
            if cache_file.exists():
                log.warning("index refresh failed for %s, using cached copy", season)
                return _read_json(cache_file)
            raise
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        cache_file.write_bytes(response.content)
        text = response.content.decode("utf-8-sig")
        return json.loads(text)

    async def fetch_stream(self, session: ArchiveSession, topic: str) -> str:
        """Text of one `.jsonStream` file; cached on disk once the session is long finished."""
        cache_file = self.cache_dir / session.path / f"{topic}.jsonStream"
        if cache_file.exists():
            return cache_file.read_text(encoding="utf-8-sig")
        url = f"{config.STATIC_BASE}/{session.path}{topic}.jsonStream"
        response = await self._http.get(url)
        if response.status_code in (403, 404):
            return ""
        response.raise_for_status()
        text = response.content.decode("utf-8-sig")
        if self.is_settled(session):
            cache_file.parent.mkdir(parents=True, exist_ok=True)
            cache_file.write_bytes(response.content)
        return text

    async def load_raw_feed(self, session: ArchiveSession, topics: list[str] | None = None) -> RawFeed:
        topics = topics or config.ARCHIVE_TOPICS
        tasks = [self.fetch_stream(session, topic) for topic in topics]
        texts = await asyncio.gather(*tasks)
        lines: list[RawLine] = []
        for topic, text in zip(topics, texts):
            for raw in text.splitlines():
                parsed = parse_archive_line(raw)
                if parsed is None:
                    continue
                offset, body = parsed
                raw_line = RawLine(offset, topic, body)
                lines.append(raw_line)
        # Stable sort keeps the per-topic order for messages sharing an offset.
        lines.sort(key=lambda line: line.offset)
        zero_utc = _zero_utc(lines, session)
        return RawFeed(session, zero_utc, lines)

    async def load_recording(self, session: ArchiveSession) -> Recording:
        """Download (or read from cache) and decode a session for replay.

        Decoded car positions and telemetry are cached as .npz next to the raw streams, so only
        the first load pays for inflating the compressed topics.
        """
        session_dir = self.cache_dir / session.path
        positions_file = session_dir / POSITIONS_CACHE
        telemetry_file = session_dir / TELEMETRY_CACHE
        if positions_file.exists() and telemetry_file.exists():
            timing_topics = [topic for topic in config.ARCHIVE_TOPICS if not topic.endswith(".z")]
            raw = await self.load_raw_feed(session, timing_topics)
            positions = await asyncio.to_thread(PositionStore.load, positions_file)
            telemetry = await asyncio.to_thread(TelemetryStore.load, telemetry_file)
            return await asyncio.to_thread(build_recording, raw, positions, telemetry)
        raw = await self.load_raw_feed(session)
        recording = await asyncio.to_thread(build_recording, raw)
        if self.is_settled(session) and recording.positions.has_data():
            await asyncio.to_thread(recording.positions.save, positions_file)
            await asyncio.to_thread(recording.telemetry.save, telemetry_file)
        return recording

    @staticmethod
    def is_settled(session: ArchiveSession) -> bool:
        """The archive is final a few hours after the scheduled end."""
        return now_ms() - session.end_utc > 3 * 3600 * 1000


def build_recording(
    raw: RawFeed,
    positions: PositionStore | None = None,
    telemetry: TelemetryStore | None = None,
) -> Recording:
    """Decode a raw feed into a replayable Recording (CPU bound, run off the event loop)."""
    started = time.perf_counter()
    fill_stores = positions is None
    positions = positions or PositionStore()
    telemetry = telemetry or TelemetryStore()
    state = SessionState()
    timing_messages: list[FeedMessage] = []
    for line in raw.lines:
        is_car_topic = line.topic.endswith(".z")
        if is_car_topic and not fill_stores:
            continue
        message = decode_line(line, raw.zero_utc)
        if message is None:
            continue
        if message.topic == "Position":
            positions.add_message(message.data)
            continue
        if message.topic == "CarData":
            telemetry.add_message(message.data)
            continue
        timing_messages.append(message)
        state.apply(message)

    green_utc = _first_status_utc(timing_messages, "Started")
    start_utc = timing_messages[0].utc if timing_messages else raw.zero_utc
    last_position_utc = positions.latest_utc()
    end_utc = max(state.last_utc, last_position_utc)
    elapsed = time.perf_counter() - started
    stats = {
        "messages": len(timing_messages),
        "positionSamples": positions.sample_count(),
        "decodeSeconds": round(elapsed, 2),
    }
    return Recording(
        raw.session, timing_messages, positions, telemetry, state, start_utc, end_utc, green_utc, stats=stats
    )


def decode_line(line: RawLine, zero_utc: int) -> FeedMessage | None:
    """Archive line to FeedMessage, through the same decode_feed used for live messages."""
    try:
        payload = orjson.loads(line.text)
    except orjson.JSONDecodeError:
        return None
    return decode_feed(line.topic, payload, zero_utc + line.offset)


def session_code(name: str) -> str:
    fallback = name.upper().replace(" ", "")
    return SESSION_CODES.get(name.lower(), fallback)


def _meeting_sessions(season: int, meeting: dict) -> list[ArchiveSession]:
    is_testing = "testing" in (meeting.get("Name") or "").lower()
    sessions = []
    for raw in meeting.get("Sessions", []):
        if not raw.get("Path") or not raw.get("StartDate"):
            continue
        gmt = raw.get("GmtOffset")
        name = raw.get("Name") or ""
        code = session_code(name)
        if is_testing:
            day = raw.get("Number") or code
            code = f"T{day}"
        circuit = meeting.get("Circuit") or {}
        country = meeting.get("Country") or {}
        start_utc = local_to_utc_ms(raw["StartDate"], gmt)
        end_utc = local_to_utc_ms(raw.get("EndDate") or raw["StartDate"], gmt)
        session = ArchiveSession(
            season=season,
            round=None if is_testing else meeting.get("Number"),
            code=code,
            name=name,
            type=raw.get("Type") or "",
            meeting=meeting.get("Name") or "",
            meeting_key=meeting.get("Key") or 0,
            session_key=raw.get("Key") or 0,
            circuit=circuit.get("ShortName") or "",
            circuit_key=circuit.get("Key") or 0,
            country=country.get("Name") or "",
            start_utc=start_utc,
            end_utc=end_utc,
            path=raw["Path"],
        )
        sessions.append(session)
    return sessions


def _read_json(path: Path) -> dict:
    text = path.read_text(encoding="utf-8-sig")
    return json.loads(text)


def _zero_utc(lines: list[RawLine], session: ArchiveSession) -> int:
    """UTC of archive offset 0, from Heartbeat messages (Utc minus their offset).

    Uses every heartbeat: a recording that started late begins with a burst of buffered
    heartbeats sharing one offset (2025 Canada qualifying), so the first few are minutes off.
    """
    estimates = []
    for line in lines:
        if line.topic != "Heartbeat":
            continue
        try:
            heartbeat = json.loads(line.text)
            utc = parse_utc(heartbeat.get("Utc"))
        except (json.JSONDecodeError, ValueError, AttributeError):
            continue
        estimates.append(utc - line.offset)
    if not estimates:
        # No heartbeat: assume the recording started an hour before the scheduled start.
        return session.start_utc - 3600 * 1000
    estimates.sort()
    return estimates[len(estimates) // 2]


def _first_status_utc(timing_messages: list[FeedMessage], status: str) -> int | None:
    for message in timing_messages:
        if message.topic == "SessionStatus" and message.data.get("Status") == status:
            return message.utc
    return None
