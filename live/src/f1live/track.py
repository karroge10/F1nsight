"""Track map: outline, rotation, corners and sector boundaries, cached per circuit.

Sources, best first:
  1. The session's own position data: the fastest complete lap of any car is a clean closed
     loop in exactly the coordinates the cars use. Sector boundaries come from where that car
     was when its sector 1 and sector 2 times were set.
  2. The pipeline's FastF1 export (data/raw/fastf1/<season>/<round>_track.json) when present:
     its finish and sector points come from FastF1 lap data and replace our estimate, and its
     corners and rotation fill in when MultiViewer has nothing for the circuit.
  3. The MultiViewer circuit API (the one FastF1 `get_circuit_info` uses) for rotation and
     corner numbers, and as the outline when no position data is available yet.
  4. A cached track built from an earlier session at the same circuit (data/raw/livetiming/tracks).

Timing is published about TIMING_LAG_MS after the moment the position samples show, so lap and
sector completion times are shifted back by that much before looking up where the car was.
"""

import json
import logging
import math
from itertools import pairwise
from pathlib import Path

import httpx

from f1live import config
from f1live.state import SessionState
from f1live.stores import PositionStore

log = logging.getLogger(__name__)

MIN_LAP_MS = 40_000
MIN_LAP_SAMPLES = 60
LAP_CANDIDATES = 20
MAX_CLOSURE_RATIO = 0.05
MULTIVIEWER_YEARS_BACK = 4


async def resolve_track(
    http: httpx.AsyncClient,
    circuit_key: int | None,
    season: int | None,
    positions: PositionStore | None = None,
    state: SessionState | None = None,
    round_number: int | None = None,
) -> dict | None:
    """Best available track for a circuit; builds from positions when given and caches it."""
    info = None
    if circuit_key and season:
        info = await fetch_circuit_info(http, circuit_key, season)
    fastf1_track = load_fastf1_track(season, round_number)
    shape = None
    if positions is not None and state is not None:
        shape = outline_from_positions(positions, state)
    if shape is None:
        cached = load_cached_track(circuit_key)
        if cached is not None:
            return cached
    track = assemble_track(shape, info, circuit_key, fastf1_track)
    if track is not None and shape is not None and circuit_key:
        save_cached_track(circuit_key, track)
    return track


def outline_from_positions(positions: PositionStore, state: SessionState) -> dict | None:
    """Closed outline from the fastest complete lap that has clean position data."""
    lag = config.TIMING_LAG_MS
    candidates = []
    for number, marks in state.lap_marks.items():
        for previous, current in pairwise(marks):
            if current.laps != previous.laps + 1:
                continue
            duration = current.utc - previous.utc
            if duration >= MIN_LAP_MS:
                candidates.append((duration, number, previous.utc - lag, current.utc - lag))
    candidates.sort()
    for _, number, start, end in candidates[:LAP_CANDIDATES]:
        samples = positions.window(number, start, end)
        if len(samples) < MIN_LAP_SAMPLES:
            continue
        if not all(on_track for _, _, _, on_track in samples):
            continue
        points = [[x, y] for _, x, y, _ in samples]
        perimeter = _perimeter(points)
        closure = _distance(points[0], points[-1])
        if perimeter == 0 or closure > MAX_CLOSURE_RATIO * perimeter:
            continue
        sector_points = _sector_points(positions, state, number, start, end)
        return {"outline": points, "finish": points[0], "sectorPoints": sector_points}
    return None


def assemble_track(
    shape: dict | None,
    info: dict | None,
    circuit_key: int | None,
    fastf1_track: dict | None = None,
) -> dict | None:
    if shape is not None:
        outline = shape["outline"]
        source = "positions"
    elif info is not None:
        outline = [[round(x), round(y)] for x, y in zip(info.get("x", []), info.get("y", []))]
        source = "multiviewer"
    elif fastf1_track is not None:
        outline = fastf1_track.get("outline") or []
        source = "fastf1"
    else:
        return None
    if not outline:
        return None

    finish = shape["finish"] if shape is not None else None
    sector_points = shape["sectorPoints"] if shape is not None else []
    fastf1_points = _fastf1_sector_points(fastf1_track)
    if fastf1_points is not None:
        finish = fastf1_points[0]
        sector_points = fastf1_points[1:]
    if finish is not None:
        outline = _start_at(outline, finish)
    sectors = _sector_ranges(outline, sector_points)

    rotation = 0.0
    corners = []
    if info is not None:
        rotation = float(info.get("rotation") or 0.0)
        corners = [_corner(corner) for corner in info.get("corners", [])]
    elif fastf1_track is not None:
        rotation = float(fastf1_track.get("rotation") or 0.0)
        corners = [_fastf1_corner(corner) for corner in fastf1_track.get("corners") or []]
    return {
        "outline": outline,
        "rotation": rotation,
        "corners": corners,
        "sectors": sectors,
        "finish": outline[0] if finish is not None else None,
        "source": source,
        "circuitKey": circuit_key,
    }


def load_fastf1_track(season: int | None, round_number: int | None) -> dict | None:
    """The pipeline's FastF1 track export for a race weekend, when it has been written."""
    if not season or not round_number:
        return None
    path = config.FASTF1_RAW_DIR / str(season) / f"{round_number:02d}_track.json"
    if not path.exists():
        return None
    try:
        text = path.read_text(encoding="utf-8")
        return json.loads(text)
    except (OSError, ValueError):
        log.warning("unreadable fastf1 track file %s", path)
        return None


async def fetch_circuit_info(http: httpx.AsyncClient, circuit_key: int, season: int) -> dict | None:
    """MultiViewer circuit info for the season, or the latest earlier season that has it."""
    for year in range(season, season - MULTIVIEWER_YEARS_BACK, -1):
        cache_file = config.TRACK_CACHE_DIR / f"multiviewer_{circuit_key}_{year}.json"
        if cache_file.exists():
            text = cache_file.read_text(encoding="utf-8")
            cached = json.loads(text)
            if cached:
                return cached
            continue
        url = f"{config.MULTIVIEWER_BASE}/circuits/{circuit_key}/{year}"
        try:
            response = await http.get(url, headers={"User-Agent": config.USER_AGENT})
        except httpx.HTTPError as error:
            log.warning("multiviewer request failed: %s", error)
            return None
        info = response.json() if response.status_code == 200 else None
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        text = json.dumps(info)
        cache_file.write_text(text, encoding="utf-8")
        if info:
            return info
    return None


def load_cached_track(circuit_key: int | None) -> dict | None:
    if not circuit_key:
        return None
    cache_file = _cache_path(circuit_key)
    if not cache_file.exists():
        return None
    text = cache_file.read_text(encoding="utf-8")
    track = json.loads(text)
    track["source"] = "cache"
    return track


def save_cached_track(circuit_key: int, track: dict) -> None:
    cache_file = _cache_path(circuit_key)
    cache_file.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(track)
    cache_file.write_text(text, encoding="utf-8")


def _cache_path(circuit_key: int) -> Path:
    return config.TRACK_CACHE_DIR / f"circuit_{circuit_key}.json"


def _sector_points(
    positions: PositionStore, state: SessionState, number: str, start: int, end: int
) -> list[list[float]]:
    """Where the car was when it set its sector 1 and sector 2 times on this lap."""
    lag = config.TIMING_LAG_MS
    points = []
    marks = state.sector_marks.get(number, [])
    after = start
    for sector in (0, 1):
        mark = next((m for m in marks if m.sector == sector and after < m.utc - lag < end), None)
        if mark is None:
            return []
        moment = mark.utc - lag
        sample = positions.sample(number, moment)
        if sample is None:
            return []
        points.append([sample.x, sample.y])
        after = moment
    return points


def _fastf1_sector_points(fastf1_track: dict | None) -> list[list[float]] | None:
    """[finish, end of S1, end of S2] from the FastF1 export, if it has all three."""
    if not fastf1_track:
        return None
    by_sector = {item.get("sector"): item for item in fastf1_track.get("sectors") or []}
    if not all(index in by_sector for index in (0, 1, 2)):
        return None
    return [[by_sector[index]["x"], by_sector[index]["y"]] for index in (0, 1, 2)]


def _start_at(outline: list[list[float]], point: list[float]) -> list[list[float]]:
    """Rotate a closed outline so it starts at the vertex nearest to `point` (the finish line)."""
    index = _nearest_index(outline, point)
    return outline[index:] + outline[:index]


def _sector_ranges(outline: list[list[float]], sector_points: list[list[float]]) -> list[dict]:
    """Three index ranges into the outline. The outline starts at the finish line."""
    if len(sector_points) != 2:
        return []
    first = _nearest_index(outline, sector_points[0])
    second = _nearest_index(outline, sector_points[1])
    if not 0 < first < second < len(outline) - 1:
        return []
    last = len(outline) - 1
    return [
        {"number": 1, "start": 0, "end": first},
        {"number": 2, "start": first, "end": second},
        {"number": 3, "start": second, "end": last},
    ]


def _corner(raw: dict) -> dict:
    position = raw.get("trackPosition") or {}
    return {
        "number": raw.get("number"),
        "letter": raw.get("letter") or "",
        "x": round(position.get("x", 0.0)),
        "y": round(position.get("y", 0.0)),
        "angle": raw.get("angle"),
    }


def _fastf1_corner(raw: dict) -> dict:
    return {
        "number": raw.get("number"),
        "letter": raw.get("letter") or "",
        "x": round(raw.get("x", 0.0)),
        "y": round(raw.get("y", 0.0)),
        "angle": raw.get("angle"),
    }


def _nearest_index(outline: list[list[float]], point: list[float]) -> int:
    best_index = 0
    best_distance = math.inf
    for index, candidate in enumerate(outline):
        distance = _distance(candidate, point)
        if distance < best_distance:
            best_distance = distance
            best_index = index
    return best_index


def _perimeter(points: list[list[float]]) -> float:
    return sum(_distance(a, b) for a, b in pairwise(points))


def _distance(a: list[float], b: list[float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])
