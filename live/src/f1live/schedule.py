"""Is a session live right now, and when is the next one.

The season schedule comes from Jolpica (session start times for every round, including future
ones). Exact start and end times of sessions that already happened come from the F1 archive
index, and the archive root `SessionInfo.json` (the session the live timing system is currently
on) confirms a live session even when it overruns its slot.
"""

import json
import logging
import time
from dataclasses import dataclass

import httpx

from f1live import config
from f1live.archive import ArchiveClient, session_code
from f1live.decode import format_utc, local_to_utc_ms, now_ms, parse_utc

log = logging.getLogger(__name__)

SCHEDULE_TTL_S = 6 * 3600
LIVE_INFO_TTL_S = 30
PRE_SESSION_MS = 15 * 60 * 1000
POST_SESSION_MS = 30 * 60 * 1000
# SessionInfo.SessionStatus values while cars can be on track (a red flag is "Aborted").
RUNNING_STATUSES = {"Started", "Aborted"}
DURATIONS_MIN = {"FP1": 60, "FP2": 60, "FP3": 60, "SQ": 45, "S": 60, "Q": 60, "R": 120}
JOLPICA_SESSIONS = {
    "FirstPractice": "FP1",
    "SecondPractice": "FP2",
    "ThirdPractice": "FP3",
    "SprintQualifying": "SQ",
    "SprintShootout": "SQ",
    "Sprint": "S",
    "Qualifying": "Q",
}
SESSION_NAMES = {
    "FP1": "Practice 1",
    "FP2": "Practice 2",
    "FP3": "Practice 3",
    "SQ": "Sprint Qualifying",
    "S": "Sprint",
    "Q": "Qualifying",
    "R": "Race",
}


@dataclass
class ScheduledSession:
    season: int
    round: int
    race_name: str
    code: str
    start_utc: int
    end_utc: int

    def as_dict(self) -> dict:
        return {
            "season": self.season,
            "round": self.round,
            "raceName": self.race_name,
            "session": self.code,
            "name": SESSION_NAMES.get(self.code, self.code),
            "start": format_utc(self.start_utc),
            "end": format_utc(self.end_utc),
        }


class Schedule:
    def __init__(self, http: httpx.AsyncClient, archive: ArchiveClient) -> None:
        self.http = http
        self.archive = archive
        self._live_info: tuple[float, dict | None] = (0.0, None)

    async def status(self, at_ms: int | None = None) -> dict:
        current_ms = at_ms or now_ms()
        season = time.gmtime(current_ms / 1000).tm_year
        sessions = await self.sessions(season)
        if not any(session.start_utc > current_ms for session in sessions):
            sessions += await self.sessions(season + 1)
        current = next(
            (s for s in sessions if s.start_utc - PRE_SESSION_MS <= current_ms <= s.end_utc + POST_SESSION_MS),
            None,
        )
        upcoming = [s for s in sessions if s.start_utc > current_ms]
        next_session = min(upcoming, key=lambda s: s.start_utc) if upcoming else None
        live_info = await self.live_session_info()
        feed_live = _feed_says_live(live_info, current_ms)
        if current is not None and _feed_says_over(live_info, current, current_ms):
            current = None
        session = current.as_dict() if current else None
        if feed_live and session is None:
            session = _session_from_info(live_info)
        return {
            "live": current is not None or feed_live,
            "session": session,
            "next": next_session.as_dict() if next_session else None,
            "now": format_utc(current_ms),
        }

    async def sessions(self, season: int) -> list[ScheduledSession]:
        races = await self._jolpica_races(season)
        exact = await self._archive_times(season)
        sessions = []
        for race in races:
            round_number = int(race["round"])
            slots = [(code, race.get(key)) for key, code in JOLPICA_SESSIONS.items()]
            slots.append(("R", {"date": race.get("date"), "time": race.get("time")}))
            for code, slot in slots:
                if not slot or not slot.get("date"):
                    continue
                slot_time = slot.get("time") or "00:00:00Z"
                start = parse_utc(f"{slot['date']}T{slot_time}")
                end = start + DURATIONS_MIN.get(code, 60) * 60 * 1000
                start, end = exact.get((round_number, code), (start, end))
                session = ScheduledSession(season, round_number, race["raceName"], code, start, end)
                sessions.append(session)
        sessions.sort(key=lambda s: s.start_utc)
        return sessions

    async def live_session_info(self) -> dict | None:
        """The archive root SessionInfo.json: the session the timing system is on now."""
        fetched_at, cached = self._live_info
        if time.time() - fetched_at < LIVE_INFO_TTL_S:
            return cached
        try:
            response = await self.http.get(f"{config.STATIC_BASE}/SessionInfo.json")
            response.raise_for_status()
            text = response.content.decode("utf-8-sig")
            info = json.loads(text)
        except (httpx.HTTPError, ValueError) as error:
            log.warning("SessionInfo.json unavailable: %s", error)
            info = None
        self._live_info = (time.time(), info)
        return info

    async def _jolpica_races(self, season: int) -> list[dict]:
        cache_file = config.ARCHIVE_CACHE_DIR / str(season) / "jolpica_races.json"
        is_fresh = cache_file.exists() and time.time() - cache_file.stat().st_mtime < SCHEDULE_TTL_S
        if is_fresh:
            return _read_json(cache_file)
        url = f"{config.JOLPICA_BASE}/{season}/races/?limit=100"
        try:
            response = await self.http.get(url)
            response.raise_for_status()
            races = response.json()["MRData"]["RaceTable"]["Races"]
        except (httpx.HTTPError, KeyError, ValueError) as error:
            log.warning("jolpica schedule unavailable for %s: %s", season, error)
            if cache_file.exists():
                return _read_json(cache_file)
            return []
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        text = json.dumps(races)
        cache_file.write_text(text, encoding="utf-8")
        return races

    async def _archive_times(self, season: int) -> dict[tuple[int, str], tuple[int, int]]:
        try:
            archived = await self.archive.list_sessions(season)
        except httpx.HTTPError:
            return {}
        return {(s.round, s.code): (s.start_utc, s.end_utc) for s in archived if s.round}


def _read_json(path) -> list | dict:
    text = path.read_text(encoding="utf-8")
    return json.loads(text)


def _feed_says_live(info: dict | None, now_ms: int) -> bool:
    if not info or not info.get("StartDate"):
        return False
    archive_status = (info.get("ArchiveStatus") or {}).get("Status")
    if archive_status == "Complete" or _ended(info, now_ms):
        return False
    start = local_to_utc_ms(info["StartDate"], info.get("GmtOffset"))
    return start - PRE_SESSION_MS <= now_ms <= start + 5 * 3600 * 1000


def _feed_says_over(info: dict | None, session: "ScheduledSession", now_ms: int) -> bool:
    """The timing feed is on this session and says it has ended, so the post-session grace
    window no longer applies."""
    if not info or not info.get("StartDate"):
        return False
    start = local_to_utc_ms(info["StartDate"], info.get("GmtOffset"))
    if start != session.start_utc:
        return False
    return _ended(info, now_ms)


def _ended(info: dict, now_ms: int) -> bool:
    """After its scheduled end the feed reports "Inactive" (or "Finished"/"Finalised") once the
    cars are back; a session still "Started" or "Aborted" is overrunning and stays live."""
    if info.get("SessionStatus") in RUNNING_STATUSES or not info.get("EndDate"):
        return False
    end = local_to_utc_ms(info["EndDate"], info.get("GmtOffset"))
    return now_ms > end


def _session_from_info(info: dict) -> dict:
    meeting = info.get("Meeting") or {}
    start = local_to_utc_ms(info["StartDate"], info.get("GmtOffset"))
    path = info.get("Path") or ""
    season = int(path[:4]) if path[:4].isdigit() else time.gmtime(start / 1000).tm_year
    name = info.get("Name") or ""
    return {
        "season": season,
        "round": meeting.get("Number"),
        "raceName": meeting.get("Name"),
        "session": session_code(name),
        "name": name,
        "start": format_utc(start),
        "end": None,
    }
