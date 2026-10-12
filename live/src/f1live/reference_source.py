"""Pick, build and cache the circuit reference used by the position estimator.

Candidates are archived sessions at the same circuit that ended before `now`, newest first: the
earlier sessions of the same weekend (FP1 is usually archived some time after it ends), then the
previous seasons (for a Friday, last year's race). The newest candidate that builds is used and
cached as data/raw/livetiming/estimator/reference_<circuitKey>.json; grid slots and the pit lane
are carried over from the previous cached reference when the new session cannot provide them
(only races have a grid).
"""

import asyncio
import logging

import httpx

from f1live import config
from f1live.archive import ArchiveClient, ArchiveSession, build_recording
from f1live.reference import CircuitReference, build_reference, load_reference, merge_missing, save_reference

log = logging.getLogger(__name__)

SEASONS_BACK = 2
# A session is worth trying this long after its scheduled end (the archive needs a while).
ARCHIVE_GRACE_MS = 10 * 60_000
TOPICS = [topic for topic in config.ARCHIVE_TOPICS if topic != "CarData.z"]


class ReferenceSource:
    def __init__(self, archive: ArchiveClient) -> None:
        self.archive = archive
        self._failed: set[str] = set()
        self._built: dict[str, CircuitReference] = {}
        self._lock = asyncio.Lock()

    async def best(
        self,
        circuit_key: int,
        season: int,
        now_utc: int,
        exclude_path: str | None = None,
    ) -> CircuitReference | None:
        """The reference from the newest usable session, building and caching it when needed."""
        async with self._lock:
            cached = load_reference(circuit_key)
            candidates = await self._candidates(circuit_key, season, now_utc, exclude_path)
            for session in candidates:
                if cached is not None and cached.source == session.path:
                    return cached
                if session.path in self._built:
                    return self._built[session.path]
                if session.path in self._failed:
                    continue
                reference = await self._build(session)
                if reference is None:
                    continue
                reference = merge_missing(reference, cached)
                reference.stats["sourceStart"] = session.start_utc
                self._built[session.path] = reference
                cached_start = cached.stats.get("sourceStart", 0) if cached is not None else None
                if cached_start is None or cached_start <= session.start_utc:
                    save_reference(reference)
                log.info("estimator reference for circuit %s built from %s", circuit_key, session.path)
                return reference
            if cached is not None and cached.source == exclude_path:
                return None
            return cached

    async def _candidates(
        self, circuit_key: int, season: int, now_utc: int, exclude_path: str | None
    ) -> list[ArchiveSession]:
        sessions = []
        for year in range(season, season - SEASONS_BACK - 1, -1):
            try:
                listed = await self.archive.list_sessions(year)
            except httpx.HTTPError:
                continue
            for session in listed:
                if session.circuit_key != circuit_key or session.path == exclude_path:
                    continue
                if session.end_utc + ARCHIVE_GRACE_MS > now_utc:
                    continue
                sessions.append(session)
        sessions.sort(key=lambda session: session.start_utc, reverse=True)
        return sessions

    async def _build(self, session: ArchiveSession) -> CircuitReference | None:
        try:
            raw = await self.archive.load_raw_feed(session, TOPICS)
        except httpx.HTTPError as error:
            log.info("reference candidate %s not available: %s", session.path, error)
            return None
        recording = await asyncio.to_thread(build_recording, raw)
        if not recording.positions.has_data():
            # Not archived yet (or no positions): try again at the next refresh.
            return None
        reference = await asyncio.to_thread(
            build_reference,
            recording.messages,
            recording.positions,
            recording.final_state,
            session.circuit_key,
            session.path,
        )
        if reference is None and self.archive.is_settled(session):
            self._failed.add(session.path)
        return reference
