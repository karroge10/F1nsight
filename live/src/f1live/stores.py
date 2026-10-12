"""Per-car time series for positions and car telemetry, with interpolation for smooth frames.

Samples arrive roughly 4 times a second per car. Frames are rendered at any time `t` by linear
interpolation between the two samples around `t`, so the map can be drawn at 8 to 10 Hz.
"""

from array import array
from bisect import bisect_right
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from f1live.decode import parse_utc

ON_TRACK = "OnTrack"


@dataclass(slots=True)
class CarSample:
    x: float
    y: float
    status: str
    age_ms: int


@dataclass
class _Series:
    t: array = field(default_factory=lambda: array("q"))
    x: array = field(default_factory=lambda: array("i"))
    y: array = field(default_factory=lambda: array("i"))
    off_track: array = field(default_factory=lambda: array("b"))


class PositionStore:
    """Car X/Y positions keyed by racing number, kept sorted by sample time."""

    def __init__(self) -> None:
        self._series: dict[str, _Series] = {}

    def add_message(self, data: dict) -> int:
        """Add every sample of a decoded `Position` message. Returns the number of samples kept."""
        kept = 0
        for frame in data.get("Position", []):
            utc = parse_utc(frame.get("Timestamp"))
            for number, entry in (frame.get("Entries") or {}).items():
                kept += self.add(number, utc, entry)
        return kept

    def add(self, number: str, utc: int, entry: dict) -> int:
        x = entry.get("X", 0)
        y = entry.get("Y", 0)
        # (0, 0, 0) means the car is not transmitting (garage, before the session).
        if x == 0 and y == 0 and entry.get("Z", 0) == 0:
            return 0
        series = self._series.get(number)
        if series is None:
            series = _Series()
            self._series[number] = series
        off_track = 0 if entry.get("Status", ON_TRACK) == ON_TRACK else 1
        times = series.t
        if times and utc <= times[-1]:
            if utc == times[-1]:
                return 0
            self._insert_sorted(series, utc, x, y, off_track)
            return 1
        times.append(utc)
        series.x.append(x)
        series.y.append(y)
        series.off_track.append(off_track)
        return 1

    def sample(self, number: str, utc: int) -> CarSample | None:
        """Interpolated position of one car at `utc`; holds the last known sample past the end."""
        series = self._series.get(number)
        if series is None or not series.t:
            return None
        index = bisect_right(series.t, utc)
        if index == 0:
            return None
        last = index - 1
        status = "OffTrack" if series.off_track[last] else ON_TRACK
        if index >= len(series.t):
            return CarSample(series.x[last], series.y[last], status, utc - series.t[last])
        t0 = series.t[last]
        t1 = series.t[index]
        ratio = (utc - t0) / (t1 - t0)
        x = series.x[last] + (series.x[index] - series.x[last]) * ratio
        y = series.y[last] + (series.y[index] - series.y[last]) * ratio
        return CarSample(x, y, status, 0)

    def numbers(self) -> list[str]:
        return list(self._series)

    def window(self, number: str, start: int, end: int) -> list[tuple[int, int, int, bool]]:
        """Raw samples (utc, x, y, on track) of one car between two times."""
        series = self._series.get(number)
        if series is None:
            return []
        first = bisect_right(series.t, start)
        last = bisect_right(series.t, end)
        rows = []
        for i in range(first, last):
            rows.append((series.t[i], series.x[i], series.y[i], not series.off_track[i]))
        return rows

    def latest_utc(self) -> int:
        times = [series.t[-1] for series in self._series.values() if series.t]
        return max(times) if times else 0

    def latest_utc_of(self, number: str) -> int | None:
        series = self._series.get(number)
        if series is None or not series.t:
            return None
        return series.t[-1]

    def sample_count(self) -> int:
        return sum(len(series.t) for series in self._series.values())

    def has_data(self) -> bool:
        return any(series.t for series in self._series.values())

    def save(self, path: Path) -> None:
        arrays = {}
        for number, series in self._series.items():
            arrays[f"{number}_t"] = np.frombuffer(series.t, dtype=np.int64)
            arrays[f"{number}_x"] = np.frombuffer(series.x, dtype=np.int32)
            arrays[f"{number}_y"] = np.frombuffer(series.y, dtype=np.int32)
            arrays[f"{number}_off"] = np.frombuffer(series.off_track, dtype=np.int8)
        _save_npz(path, arrays)

    @classmethod
    def load(cls, path: Path) -> "PositionStore":
        store = cls()
        with np.load(path) as data:
            for number in _numbers_in(data.files):
                series = _Series()
                raw = _column_bytes(data, f"{number}_t", np.int64)
                series.t.frombytes(raw)
                raw = _column_bytes(data, f"{number}_x", np.int32)
                series.x.frombytes(raw)
                raw = _column_bytes(data, f"{number}_y", np.int32)
                series.y.frombytes(raw)
                raw = _column_bytes(data, f"{number}_off", np.int8)
                series.off_track.frombytes(raw)
                store._series[number] = series
        return store

    @staticmethod
    def _insert_sorted(series: _Series, utc: int, x: float, y: float, off_track: int) -> None:
        index = bisect_right(series.t, utc)
        series.t.insert(index, utc)
        series.x.insert(index, int(x))
        series.y.insert(index, int(y))
        series.off_track.insert(index, off_track)


class TelemetryStore:
    """Speed, gear and DRS per car (CarData channels 2, 3 and 45), latest value at a time."""

    CHANNEL_SPEED = "2"
    CHANNEL_GEAR = "3"
    CHANNEL_DRS = "45"
    # DRS channel values meaning the flap is open (8 = eligible, 10/12/14 = open).
    DRS_OPEN = {10, 12, 14}
    NO_DRS = -1

    def __init__(self) -> None:
        self._series: dict[str, _TelemetrySeries] = {}
        self.has_drs_channel = False

    def add_message(self, data: dict) -> int:
        kept = 0
        for entry in data.get("Entries", []):
            utc = parse_utc(entry.get("Utc"))
            for number, car in (entry.get("Cars") or {}).items():
                channels = car.get("Channels") or {}
                kept += self.add(number, utc, channels)
        return kept

    def add(self, number: str, utc: int, channels: dict) -> int:
        series = self._series.get(number)
        if series is None:
            series = _TelemetrySeries()
            self._series[number] = series
        if series.t and utc <= series.t[-1]:
            return 0
        drs = channels.get(self.CHANNEL_DRS)
        if drs is None:
            drs = self.NO_DRS
        else:
            self.has_drs_channel = True
        series.t.append(utc)
        series.speed.append(channels.get(self.CHANNEL_SPEED, 0))
        series.gear.append(channels.get(self.CHANNEL_GEAR, 0))
        series.drs.append(drs)
        return 1

    def at(self, number: str, utc: int) -> tuple[int, int, int | None] | None:
        """(speed, gear, drs) of the latest sample at or before `utc`."""
        series = self._series.get(number)
        if series is None or not series.t:
            return None
        index = bisect_right(series.t, utc)
        if index == 0:
            return None
        last = index - 1
        drs = series.drs[last]
        return series.speed[last], series.gear[last], None if drs == self.NO_DRS else drs

    def drs_open(self, number: str, utc: int) -> bool | None:
        if not self.has_drs_channel:
            return None
        values = self.at(number, utc)
        if values is None or values[2] is None:
            return None
        return values[2] in self.DRS_OPEN

    def save(self, path: Path) -> None:
        has_drs = int(self.has_drs_channel)
        arrays = {"_has_drs": np.array([has_drs])}
        for number, series in self._series.items():
            arrays[f"{number}_t"] = np.frombuffer(series.t, dtype=np.int64)
            arrays[f"{number}_speed"] = np.frombuffer(series.speed, dtype=np.int16)
            arrays[f"{number}_gear"] = np.frombuffer(series.gear, dtype=np.int8)
            arrays[f"{number}_drs"] = np.frombuffer(series.drs, dtype=np.int16)
        _save_npz(path, arrays)

    @classmethod
    def load(cls, path: Path) -> "TelemetryStore":
        store = cls()
        with np.load(path) as data:
            store.has_drs_channel = bool(data["_has_drs"][0])
            for number in _numbers_in(data.files):
                series = _TelemetrySeries()
                raw = _column_bytes(data, f"{number}_t", np.int64)
                series.t.frombytes(raw)
                raw = _column_bytes(data, f"{number}_speed", np.int16)
                series.speed.frombytes(raw)
                raw = _column_bytes(data, f"{number}_gear", np.int8)
                series.gear.frombytes(raw)
                raw = _column_bytes(data, f"{number}_drs", np.int16)
                series.drs.frombytes(raw)
                store._series[number] = series
        return store


@dataclass
class _TelemetrySeries:
    t: array = field(default_factory=lambda: array("q"))
    speed: array = field(default_factory=lambda: array("h"))
    gear: array = field(default_factory=lambda: array("b"))
    drs: array = field(default_factory=lambda: array("h"))


def _save_npz(path: Path, arrays: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp.npz")
    np.savez(temporary, **arrays)
    temporary.replace(path)


def _column_bytes(data, key: str, dtype) -> bytes:
    column = data[key].astype(dtype)
    return column.tobytes()


def _numbers_in(files: list[str]) -> list[str]:
    return sorted({name.split("_")[0] for name in files if not name.startswith("_")})
