"""Session state: every timing topic merged into one full object, plus derived bookkeeping.

`SessionState.apply` takes one decoded FeedMessage, merges it, and returns `Notice`s describing
what changed (new race control messages, a track status change, a pit stop, timing changed...).
The engine turns notices into outgoing WebSocket messages.
"""

from dataclasses import dataclass, field
from typing import Any

from f1live.decode import FeedMessage, local_to_utc_ms
from f1live.merge import clone, deep_merge

# Topics whose whole object is replaced by every message instead of merged.
REPLACE_TOPICS = {"Heartbeat", "SessionStatus", "TrackStatus", "WeatherData"}
TIMING_TOPICS = {"TimingData", "TimingAppData", "TimingStats", "LapCount", "ExtrapolatedClock"}
# A stint opens as the car comes in; the feed counts that in-lap as not yet completed.
LAP_OFFSET = 1

SESSION_CODES = {
    "practice 1": "FP1",
    "practice 2": "FP2",
    "practice 3": "FP3",
    "sprint qualifying": "SQ",
    "sprint shootout": "SQ",
    "sprint": "S",
    "qualifying": "Q",
    "race": "R",
}


@dataclass(slots=True)
class Notice:
    kind: str
    utc: int
    payload: Any = None


@dataclass
class LapMark:
    utc: int
    laps: int


@dataclass
class SectorMark:
    utc: int
    sector: int


@dataclass
class SessionState:
    topics: dict[str, Any] = field(default_factory=dict)
    lap_marks: dict[str, list[LapMark]] = field(default_factory=dict)
    sector_marks: dict[str, list[SectorMark]] = field(default_factory=dict)
    pit_stops: list[dict] = field(default_factory=list)
    stint_changes: list[dict] = field(default_factory=list)
    last_utc: int = 0
    _rc_count: int = 0
    _pit_keys: set = field(default_factory=set)
    _stint_counts: dict[str, int] = field(default_factory=dict)

    def apply(self, message: FeedMessage, replace: bool = False) -> list[Notice]:
        """Merge one message and report what changed. `replace` marks a full snapshot."""
        topic = message.topic
        data = message.data
        if not isinstance(data, dict):
            return []
        self.last_utc = max(self.last_utc, message.utc)
        if topic == "TimingData":
            self._record_timing_marks(data, message.utc)

        if replace or topic in REPLACE_TOPICS or topic not in self.topics:
            self.topics[topic] = clone(data)
        else:
            deep_merge(self.topics[topic], data)
        return self._notices_for(topic, data, message.utc)

    # Read helpers used by the message builders.

    def session_info(self) -> dict:
        return self.topics.get("SessionInfo", {})

    def session_start_utc(self) -> int | None:
        info = self.session_info()
        if not info.get("StartDate"):
            return None
        return local_to_utc_ms(info["StartDate"], info.get("GmtOffset"))

    def session_code(self) -> str:
        name = (self.session_info().get("Name") or "").lower()
        return SESSION_CODES.get(name, name.upper())

    def is_race_like(self) -> bool:
        return self.session_info().get("Type") == "Race"

    def drivers(self) -> dict[str, dict]:
        raw = self.topics.get("DriverList", {})
        return {number: info for number, info in raw.items() if isinstance(info, dict)}

    def timing_lines(self) -> dict[str, dict]:
        return self.topics.get("TimingData", {}).get("Lines", {})

    def app_lines(self) -> dict[str, dict]:
        return self.topics.get("TimingAppData", {}).get("Lines", {})

    def race_control_messages(self) -> list[dict]:
        raw = self.topics.get("RaceControlMessages", {}).get("Messages", [])
        if isinstance(raw, dict):
            ordered_keys = sorted(raw, key=int)
            return [raw[key] for key in ordered_keys]
        return [item for item in raw if item]

    def stints(self, number: str) -> list[dict]:
        raw = self.app_lines().get(number, {}).get("Stints", [])
        if isinstance(raw, dict):
            ordered_keys = sorted(raw, key=int)
            return [raw[key] for key in ordered_keys]
        return [stint for stint in raw if stint]

    # Internals.

    def _notices_for(self, topic: str, data: dict, utc: int) -> list[Notice]:
        if topic in TIMING_TOPICS:
            notices = [Notice("timing", utc)]
            if topic == "TimingAppData":
                stint_notices = self._stint_notices(utc)
                notices.extend(stint_notices)
            return notices
        if topic == "DriverList":
            return [Notice("drivers", utc), Notice("timing", utc)]
        if topic == "SessionInfo":
            return [Notice("session", utc)]
        if topic in ("TrackStatus", "SessionStatus"):
            return [Notice("trackStatus", utc)]
        if topic == "WeatherData":
            return [Notice("weather", utc)]
        if topic == "RaceControlMessages":
            return self._race_control_notices(utc)
        if topic == "PitLaneTimeCollection":
            return self._pit_notices(utc)
        return []

    def _race_control_notices(self, utc: int) -> list[Notice]:
        messages = self.race_control_messages()
        if len(messages) <= self._rc_count:
            return []
        fresh = messages[self._rc_count:]
        self._rc_count = len(messages)
        return [Notice("raceControl", utc, fresh)]

    def _pit_notices(self, utc: int) -> list[Notice]:
        notices = []
        pit_times = self.topics.get("PitLaneTimeCollection", {}).get("PitTimes", {})
        for number, entry in pit_times.items():
            if not isinstance(entry, dict) or not entry.get("Duration"):
                continue
            key = (number, entry.get("Lap"))
            if key in self._pit_keys:
                continue
            self._pit_keys.add(key)
            stop = {"number": number, "duration": entry.get("Duration"), "lap": entry.get("Lap"), "utc": utc}
            self.pit_stops.append(stop)
            notice = Notice("pitStop", utc, stop)
            notices.append(notice)
        return notices

    def _stint_notices(self, utc: int) -> list[Notice]:
        notices = []
        for number in self.app_lines():
            stints = self.stints(number)
            previous = self._stint_counts.get(number, 0)
            if len(stints) <= previous:
                continue
            self._stint_counts[number] = len(stints)
            if previous == 0:
                continue
            change = {
                "number": number,
                "stint": len(stints),
                "compound": stints[-1].get("Compound"),
                "previous": stints[-2].get("Compound") if len(stints) > 1 else None,
                "tyresNotChanged": stints[-1].get("TyresNotChanged") == "1",
                "lap": self._pit_lap(number),
                "utc": utc,
            }
            self.stint_changes.append(change)
            notice = Notice("tyreChange", utc, change)
            notices.append(notice)
        return notices

    def _pit_lap(self, number: str) -> int | None:
        """Lap of a stop that starts a stint now: the lap the car is on when it comes in."""
        laps = self.timing_lines().get(number, {}).get("NumberOfLaps")
        return laps + LAP_OFFSET if isinstance(laps, int) else None

    def _record_timing_marks(self, data: dict, utc: int) -> None:
        for number, line in (data.get("Lines") or {}).items():
            if not isinstance(line, dict):
                continue
            laps = line.get("NumberOfLaps")
            if isinstance(laps, int):
                marks = self.lap_marks.setdefault(number, [])
                if not marks or marks[-1].laps != laps:
                    mark = LapMark(utc, laps)
                    marks.append(mark)
            sectors = line.get("Sectors")
            items = sectors.items() if isinstance(sectors, dict) else enumerate(sectors or [])
            for index, sector in items:
                if isinstance(sector, dict) and sector.get("Value"):
                    mark = SectorMark(utc, int(index))
                    self.sector_marks.setdefault(number, []).append(mark)
