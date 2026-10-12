"""OpenF1 (https://openf1.org) car positions, used when the F1 hub withholds Position.z.

Live data from OpenF1 during a session needs a paid sponsor account: an OAuth2 token from
POST https://api.openf1.org/token (form fields username, password), sent as a Bearer token.
Set OPENF1_TOKEN, or OPENF1_USERNAME and OPENF1_PASSWORD. Without credentials the poller makes
one attempt; when OpenF1 refuses, it stops and the map stays empty (timing keeps working).
Historical data (2023 onwards) is free and needs no token.

Positions are converted into the same decoded `Position` message shape the F1 feed uses, so
the engine stores and interpolates them exactly like F1 positions.
"""

import asyncio
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass

import httpx

from f1live import config
from f1live.decode import FeedMessage, format_utc, now_ms, parse_utc

log = logging.getLogger(__name__)

# Free tier: 3 requests/s and 30/min. Sponsors: 6/s and 60/min.
POLL_INTERVAL_S = 1.0
ANONYMOUS_POLL_INTERVAL_S = 2.5
TOKEN_REFRESH_MARGIN_S = 300
FIRST_WINDOW_MS = 10_000


@dataclass
class OpenF1Status:
    active: bool = False
    disabled_reason: str | None = None
    samples: int = 0

    def as_dict(self) -> dict:
        return {"active": self.active, "disabledReason": self.disabled_reason, "samples": self.samples}


class OpenF1Positions:
    def __init__(self, http: httpx.AsyncClient, on_message: Callable[[FeedMessage], None]) -> None:
        self.http = http
        self.on_message = on_message
        self.status = OpenF1Status()
        self._token: str | None = config.OPENF1_TOKEN
        self._token_expires = float("inf") if self._token else 0.0

    async def run(self, session_key: str = "latest") -> None:
        since = now_ms() - FIRST_WINDOW_MS
        self.status.active = True
        while True:
            headers = await self._auth_headers()
            interval = POLL_INTERVAL_S if headers else ANONYMOUS_POLL_INTERVAL_S
            params = {"session_key": session_key, "date>": format_utc(since)}
            try:
                response = await self.http.get(f"{config.OPENF1_BASE}/location", params=params, headers=headers)
            except httpx.HTTPError as error:
                log.warning("openf1 request failed: %s", error)
                await asyncio.sleep(POLL_INTERVAL_S * 5)
                continue
            if response.status_code in (401, 403):
                self._disable(f"OpenF1 refused live data ({response.status_code}); a sponsor token is needed")
                return
            if response.status_code == 404:
                await asyncio.sleep(interval)
                continue
            if response.status_code == 429:
                await asyncio.sleep(interval * 4)
                continue
            response.raise_for_status()
            rows = response.json()
            if rows:
                message = location_rows_to_message(rows)
                self.status.samples += len(rows)
                self.on_message(message)
                since = message.utc
            await asyncio.sleep(interval)

    async def _auth_headers(self) -> dict:
        if self._token and time.time() < self._token_expires - TOKEN_REFRESH_MARGIN_S:
            return {"Authorization": f"Bearer {self._token}"}
        if not (config.OPENF1_USERNAME and config.OPENF1_PASSWORD):
            return {}
        form = {"username": config.OPENF1_USERNAME, "password": config.OPENF1_PASSWORD}
        response = await self.http.post("https://api.openf1.org/token", data=form)
        if response.status_code != 200:
            log.warning("openf1 token request failed: %s", response.status_code)
            return {}
        body = response.json()
        self._token = body.get("access_token")
        expires_in = float(body.get("expires_in") or 3600)
        self._token_expires = time.time() + expires_in
        return {"Authorization": f"Bearer {self._token}"}

    def _disable(self, reason: str) -> None:
        log.info(reason)
        self.status.active = False
        self.status.disabled_reason = reason


def location_rows_to_message(rows: list[dict]) -> FeedMessage:
    """OpenF1 /location rows to a decoded F1 `Position` message (one frame per row)."""
    frames = []
    latest = 0
    for row in rows:
        timestamp = row["date"]
        utc = parse_utc(timestamp)
        latest = max(latest, utc)
        entry = {"Status": "OnTrack", "X": int(row["x"]), "Y": int(row["y"]), "Z": int(row.get("z") or 0)}
        frames.append({"Timestamp": timestamp, "Entries": {str(row["driver_number"]): entry}})
    return FeedMessage("Position", {"Position": frames}, latest)
