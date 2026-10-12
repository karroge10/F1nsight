"""F1 live timing over SignalR Core (wss://livetiming.formula1.com/signalrcore).

Protocol: JSON hub protocol, frames separated by the 0x1E record separator.
  1. OPTIONS /signalrcore/negotiate to get the AWSALBCORS load balancer cookie
  2. POST /signalrcore/negotiate?negotiateVersion=1 -> connectionToken
  3. WebSocket /signalrcore?id=<connectionToken>, handshake {"protocol":"json","version":1}
  4. invoke Subscribe([topics]); the completion result is a full snapshot of every topic
  5. updates arrive as invocations of `feed` with arguments [topic, data, utc timestamp]

As of October 2026 the hub works without authentication for every topic except `Position.z`
and `CarData.z`, which are left out of the snapshot and the updates unless an F1TV subscription
token is sent as a Bearer token. The legacy `/signalr` hub answers 401 to anonymous negotiate.

`parse_frames` is the live parser. The simulated live mode builds the exact same frame text
from archive lines (`feed_frame`) and pushes it through `parse_frames` too.
"""

import asyncio
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass, field

import httpx
import orjson
import websockets

from f1live import config
from f1live.decode import FeedMessage, decode_feed, now_ms

log = logging.getLogger(__name__)

RECORD_SEPARATOR = "\x1e"
INVOCATION = 1
COMPLETION = 3
PING = 6
CLOSE = 7
PING_INTERVAL_S = 15
RECEIVE_TIMEOUT_S = 60
# Applied first so the session origin and the driver list exist before timing arrives.
SNAPSHOT_ORDER = ["SessionInfo", "SessionStatus", "DriverList", "Heartbeat"]


@dataclass(slots=True)
class HubUpdate:
    message: FeedMessage
    replace: bool = False


@dataclass
class UpstreamStatus:
    connected: bool = False
    authenticated: bool = False
    positions_available: bool | None = None
    snapshot_topics: list[str] = field(default_factory=list)
    last_message_at: float | None = None
    connects: int = 0
    last_error: str | None = None

    def as_dict(self) -> dict:
        return {
            "connected": self.connected,
            "authenticated": self.authenticated,
            "positionsAvailable": self.positions_available,
            "snapshotTopics": self.snapshot_topics,
            "lastMessageAgoS": None if self.last_message_at is None else round(time.time() - self.last_message_at, 1),
            "connects": self.connects,
            "lastError": self.last_error,
        }


def parse_frames(text: str, snapshot_utc: int) -> list[HubUpdate]:
    """Parse one WebSocket text message (one or more SignalR Core frames) into updates.

    `snapshot_utc` timestamps the Subscribe completion snapshot, which carries no time of its own.
    """
    updates: list[HubUpdate] = []
    for part in text.split(RECORD_SEPARATOR):
        if not part:
            continue
        frame = orjson.loads(part)
        frame_type = frame.get("type")
        if frame_type == INVOCATION and frame.get("target") == "feed":
            topic, data, timestamp = frame["arguments"][:3]
            message = decode_feed(topic, data, timestamp)
            update = HubUpdate(message)
            updates.append(update)
        elif frame_type == COMPLETION and isinstance(frame.get("result"), dict):
            snapshot = _snapshot_updates(frame["result"], snapshot_utc)
            updates.extend(snapshot)
    return updates


def feed_frame(topic: str, data_json: str, timestamp: str) -> str:
    """The text of a live `feed` invocation, built from raw JSON (used by the simulation)."""
    return (
        '{"type":1,"target":"feed","arguments":["' + topic + '",' + data_json + ',"' + timestamp + '"]}'
        + RECORD_SEPARATOR
    )


class SignalRCoreClient:
    """Keeps one upstream connection open (with reconnects) and hands parsed updates on."""

    def __init__(
        self,
        on_updates: Callable[[list[HubUpdate]], None],
        token: str | None = config.F1TV_TOKEN,
        topics: list[str] | None = None,
    ) -> None:
        self.on_updates = on_updates
        self.token = token
        self.topics = topics or config.LIVE_TOPICS
        self.status = UpstreamStatus(authenticated=bool(token))

    async def run(self) -> None:
        backoff = 2.0
        while True:
            try:
                await self._session()
                backoff = 2.0
            except asyncio.CancelledError:
                raise
            except Exception as error:  # network errors of every kind end in a reconnect
                self.status.last_error = f"{type(error).__name__}: {error}"
                log.warning("signalr connection lost: %s", self.status.last_error)
            self.status.connected = False
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60.0)

    async def _session(self) -> None:
        cookie, connection_token = await self._negotiate()
        headers = {"Cookie": f"AWSALBCORS={cookie}", "User-Agent": config.USER_AGENT}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        url = config.SIGNALR_CORE_URL.replace("https://", "wss://") + f"?id={connection_token}"
        async with websockets.connect(url, additional_headers=headers, max_size=None) as socket:
            handshake = _frame_text({"protocol": "json", "version": 1})
            await socket.send(handshake)
            await _receive_within(socket, RECEIVE_TIMEOUT_S)
            subscribe = {"type": INVOCATION, "invocationId": "1", "target": "Subscribe", "arguments": [self.topics]}
            subscribe_text = _frame_text(subscribe)
            await socket.send(subscribe_text)
            self.status.connected = True
            self.status.connects += 1
            log.info("signalr core connected (authenticated=%s)", self.status.authenticated)
            pinging = self._ping(socket)
            pinger = asyncio.create_task(pinging)
            try:
                await self._receive(socket)
            finally:
                pinger.cancel()

    async def _negotiate(self) -> tuple[str, str]:
        headers = {"User-Agent": config.USER_AGENT}
        async with httpx.AsyncClient(timeout=20.0, headers=headers) as http:
            preflight = await http.options(f"{config.SIGNALR_CORE_URL}/negotiate")
            cookie = preflight.cookies.get("AWSALBCORS", "")
            negotiate_headers = {"Cookie": f"AWSALBCORS={cookie}"}
            if self.token:
                negotiate_headers["Authorization"] = f"Bearer {self.token}"
            response = await http.post(
                f"{config.SIGNALR_CORE_URL}/negotiate?negotiateVersion=1", headers=negotiate_headers
            )
            response.raise_for_status()
            body = response.json()
        return cookie, body["connectionToken"]

    async def _receive(self, socket) -> None:
        while True:
            text = await _receive_within(socket, RECEIVE_TIMEOUT_S)
            if isinstance(text, bytes):
                text = text.decode("utf-8")
            self.status.last_message_at = time.time()
            if '"type":7' in text:
                raise ConnectionError("hub closed the connection")
            wall_utc = now_ms()
            updates = parse_frames(text, wall_utc)
            self._note_snapshot(updates)
            if updates:
                self.on_updates(updates)

    def _note_snapshot(self, updates: list[HubUpdate]) -> None:
        snapshot_topics = [update.message.topic for update in updates if update.replace]
        if not snapshot_topics:
            return
        self.status.snapshot_topics = snapshot_topics
        self.status.positions_available = "Position" in snapshot_topics
        if not self.status.positions_available:
            log.info("live hub sent no Position.z: positions need an F1TV token (falling back)")

    async def _ping(self, socket) -> None:
        frame = _frame_text({"type": PING})
        while True:
            await asyncio.sleep(PING_INTERVAL_S)
            await socket.send(frame)


def _snapshot_updates(result: dict, snapshot_utc: int) -> list[HubUpdate]:
    ordered = [topic for topic in SNAPSHOT_ORDER if topic in result]
    ordered += [topic for topic in result if topic not in SNAPSHOT_ORDER]
    updates = []
    for topic in ordered:
        data = result[topic]
        if data is None or data == {}:
            continue
        message = decode_feed(topic, data, snapshot_utc)
        update = HubUpdate(message, replace=True)
        updates.append(update)
    return updates


def _frame_text(frame: dict) -> str:
    body = orjson.dumps(frame).decode()
    return body + RECORD_SEPARATOR


async def _receive_within(socket, timeout_s: float):
    receiving = socket.recv()
    return await asyncio.wait_for(receiving, timeout_s)
