"""DelayedPositions: follow the static archive's Position.z stream of a session that is running.

The free static archive (`livetiming.formula1.com/static/<path>Position.z.jsonStream`) holds the
real car positions of past sessions. If it is also written while a session runs, it is a free
source of real positions, only delayed. This follower polls the file with HTTP Range requests
(`bytes=<already read>-`), decodes the complete new lines into a PositionStore and tracks how far
the newest sample is behind the clock.

The engine uses it in two ways (see config.DELAYED_*):
  lag <= DELAYED_REPLACE_MAX_LAG_MS   frames come from it, drawn that far behind, labelled
                                      `official-delayed`
  lag <= DELAYED_CORRECT_MAX_LAG_MS   the estimator learns mini-sector distances and where
                                      stopped cars really are from it

Whether the archive grows during a session is unverified (no session could be observed when this
was written); `scripts/probe_static_live.py` measures it. If the file only appears after the
session, the follower simply finds nothing and the estimate stays as it is.
"""

import asyncio
import logging
from collections.abc import Callable
from dataclasses import dataclass

import httpx
import orjson

from f1live import config
from f1live.decode import decode_feed, now_ms, parse_archive_line
from f1live.stores import PositionStore

log = logging.getLogger(__name__)

# Draw delayed positions this much further behind the newest sample, so both sides exist.
RENDER_MARGIN_MS = 1_000
# The stream counts as growing if it grew within this many polls.
GROWING_POLLS = 3
BOM = b"\xef\xbb\xbf"


@dataclass
class DelayedStatus:
    url: str
    http_status: int | None = None
    available: bool = False
    bytes_read: int = 0
    lines: int = 0
    samples: int = 0
    polls: int = 0
    last_growth_poll: int | None = None
    newest_utc: int | None = None
    lag_ms: int | None = None
    error: str | None = None


class DelayedPositions:
    def __init__(
        self,
        http: httpx.AsyncClient,
        session_path: str,
        poll_s: float = config.DELAYED_POLL_S,
        clock: Callable[[], int] = now_ms,
    ) -> None:
        self.http = http
        self.poll_s = poll_s
        self.clock = clock
        self.store = PositionStore()
        url = f"{config.STATIC_BASE}/{session_path}Position.z.jsonStream"
        self.status = DelayedStatus(url)
        self._remainder = b""

    async def run(self, on_poll: Callable[["DelayedPositions"], None] | None = None) -> None:
        while True:
            await self.poll_once()
            if on_poll is not None:
                on_poll(self)
            await asyncio.sleep(self.poll_s)

    async def poll_once(self) -> int:
        """Fetch what was appended since the last poll. Returns the number of new samples."""
        status = self.status
        status.polls += 1
        offset = status.bytes_read
        headers = {"Range": f"bytes={offset}-"} if offset else {}
        try:
            response = await self.http.get(status.url, headers=headers)
        except httpx.HTTPError as error:
            status.error = str(error)
            return 0
        status.http_status = response.status_code
        status.error = None
        if response.status_code in (403, 404):
            status.available = False
            return 0
        if response.status_code == 416:
            self._update_lag()
            return 0
        if response.status_code not in (200, 206):
            status.error = f"HTTP {response.status_code}"
            return 0
        body = response.content
        if response.status_code == 200 and offset:
            # The server ignored the range: skip what was already read.
            body = body[offset:]
        status.available = True
        status.bytes_read += len(body)
        added = self._consume(body)
        if body:
            status.last_growth_poll = status.polls
        self._update_lag()
        return added

    def lag_ms(self, now_utc: int | None = None) -> int | None:
        newest = self.status.newest_utc
        if newest is None:
            return None
        now = self.clock() if now_utc is None else now_utc
        return now - newest

    def growing(self) -> bool:
        grew = self.status.last_growth_poll
        return grew is not None and self.status.polls - grew < GROWING_POLLS

    def can_replace(self, now_utc: int) -> bool:
        lag = self.lag_ms(now_utc)
        return self.growing() and lag is not None and lag <= config.DELAYED_REPLACE_MAX_LAG_MS

    def can_correct(self, now_utc: int) -> bool:
        lag = self.lag_ms(now_utc)
        return self.growing() and lag is not None and lag <= config.DELAYED_CORRECT_MAX_LAG_MS

    def render_lag_ms(self, now_utc: int) -> int:
        lag = self.lag_ms(now_utc) or 0
        return lag + RENDER_MARGIN_MS

    def describe(self) -> dict:
        status = self.status
        return {
            "url": status.url,
            "httpStatus": status.http_status,
            "available": status.available,
            "growing": self.growing(),
            "bytes": status.bytes_read,
            "samples": status.samples,
            "lagMs": status.lag_ms,
            "polls": status.polls,
            "error": status.error,
        }

    def _consume(self, body: bytes) -> int:
        data = self._remainder + body
        if data.startswith(BOM):
            data = data[len(BOM):]
        complete, _, rest = data.rpartition(b"\n")
        self._remainder = rest
        added = 0
        for raw in complete.split(b"\n"):
            text = raw.decode("utf-8", errors="replace")
            parsed = parse_archive_line(text)
            if parsed is None:
                continue
            _, body_text = parsed
            try:
                payload = orjson.loads(body_text)
                message = decode_feed("Position.z", payload, 0)
            except (orjson.JSONDecodeError, ValueError):
                continue
            self.status.lines += 1
            added += self.store.add_message(message.data)
        self.status.samples += added
        return added

    def _update_lag(self) -> None:
        if not self.store.has_data():
            return
        newest = self.store.latest_utc()
        self.status.newest_utc = newest
        self.status.lag_ms = self.clock() - newest
