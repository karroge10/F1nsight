"""Low level decoding shared by every source: compressed topics, timestamps, archive lines.

Every source (live SignalR, simulated live, archive replay, OpenF1) ends up producing
`FeedMessage` objects through `decode_feed`, so the state machine only ever sees one shape.
"""

import base64
import re
import time
import zlib
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import orjson

COMPRESSED_SUFFIX = ".z"
_UTC_RE = re.compile(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})?$")
_OFFSET_RE = re.compile(r"^(\d{2}):(\d{2}):(\d{2})\.(\d{3})")


@dataclass(slots=True)
class FeedMessage:
    """One decoded feed update. `utc` is epoch milliseconds of when the update was published."""

    topic: str
    data: Any
    utc: int


def decode_feed(topic: str, payload: Any, timestamp: str | int | None) -> FeedMessage:
    """Turn a raw feed update (as sent by the hub or stored in the archive) into a FeedMessage.

    Compressed topics (`Position.z`, `CarData.z`) carry a base64 deflate string; they are
    inflated here and the `.z` suffix is dropped from the topic name.
    """
    if isinstance(payload, str) and topic.endswith(COMPRESSED_SUFFIX):
        data = decode_z(payload)
    else:
        data = payload
    clean_topic = topic.removesuffix(COMPRESSED_SUFFIX)
    utc = timestamp if isinstance(timestamp, int) else parse_utc(timestamp)
    return FeedMessage(clean_topic, data, utc)


def decode_z(encoded: str) -> Any:
    """Inflate a base64 encoded raw deflate stream (no zlib header) and parse it as JSON."""
    compressed = base64.b64decode(encoded)
    raw = zlib.decompress(compressed, -zlib.MAX_WBITS)
    return orjson.loads(raw)


def parse_utc(value: str | None) -> int:
    """Parse the feed's ISO timestamps (up to 7 fractional digits, optional Z) to epoch ms."""
    if not value:
        return 0
    cleaned = value.strip()
    match = _UTC_RE.match(cleaned)
    if not match:
        raise ValueError(f"unrecognised timestamp: {value!r}")
    base, fraction, zone = match.groups()
    parsed = datetime.fromisoformat(base)
    if zone and zone != "Z":
        parsed = datetime.fromisoformat(base + zone)
    else:
        parsed = parsed.replace(tzinfo=timezone.utc)
    millis = int((fraction or "0")[:3].ljust(3, "0"))
    return int(parsed.timestamp()) * 1000 + millis


def now_ms() -> int:
    """Wall clock as epoch milliseconds."""
    return time.time_ns() // 1_000_000


def format_utc(epoch_ms: int) -> str:
    """Epoch ms to the feed's ISO format with a Z suffix."""
    moment = datetime.fromtimestamp(epoch_ms / 1000, tz=timezone.utc)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{epoch_ms % 1000:03d}Z"


def parse_archive_line(line: str) -> tuple[int, str] | None:
    """Split an archive `.jsonStream` line `HH:MM:SS.mmm<json>` into (offset ms, json text)."""
    line = line.lstrip("﻿").rstrip("\r\n")
    match = _OFFSET_RE.match(line)
    if not match:
        return None
    hours, minutes, seconds, millis = (int(part) for part in match.groups())
    offset = ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis
    return offset, line[match.end():]


def parse_gmt_offset(value: str | None) -> int:
    """`"08:00:00"` or `"-05:00:00"` to milliseconds."""
    if not value:
        return 0
    sign = -1 if value.startswith("-") else 1
    hours, minutes, seconds = (int(part) for part in value.lstrip("+-").split(":"))
    return sign * ((hours * 60 + minutes) * 60 + seconds) * 1000


def local_to_utc_ms(local_iso: str, gmt_offset: str | None) -> int:
    """Session dates in SessionInfo and Index.json are local track time plus a GmtOffset."""
    local = datetime.fromisoformat(local_iso).replace(tzinfo=timezone.utc)
    offset_ms = parse_gmt_offset(gmt_offset)
    return int(local.timestamp() * 1000) - offset_ms
