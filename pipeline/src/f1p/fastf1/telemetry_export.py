"""Export compact fastest-lap car telemetry per driver and session for the site.

    uv run python -m f1p.fastf1.telemetry_export [--seasons 2026] [--sessions Q R S SQ] [--force]

Reads only the local FastF1 cache (data/fastf1_cache, offline mode, no requests). Sessions whose
car data is not cached are skipped. For every driver the fastest lap is resampled onto an even
distance grid of POINTS samples: speed (km/h), throttle (%), brake (0/1), gear and the X/Y
position (1/10 m) for the track heatmap.

Writes data/serve/telemetry/<season>/<RR>_<code>.json (about 150 KB each) and
data/serve/telemetry/index.json (every exported session). Existing files are kept unless --force.
"""

import argparse
import json
import logging

import fastf1
import numpy as np

from f1p.fastf1.common import read_expected, get_session, season_range, season_schedule
from f1p.paths import FASTF1_CACHE_DIR, SERVE_DIR

POINTS = 320
DEFAULT_SESSIONS = ["Q", "SQ", "R", "S"]
TELEMETRY_DIR = SERVE_DIR / "telemetry"
logger = logging.getLogger("f1p.telemetry_export")


def export(seasons: list[int], codes: list[str], force: bool = False) -> dict:
    setup_offline(seasons)
    written = 0
    skipped = 0
    for season in seasons:
        for ref in read_expected(season):
            if ref.code not in codes:
                continue
            path = session_path(ref.season, ref.round, ref.code)
            if path.exists() and not force:
                continue
            payload = session_payload(ref)
            if payload is None:
                skipped += 1
                continue
            path.parent.mkdir(parents=True, exist_ok=True)
            text = json.dumps(payload, separators=(",", ":"))
            path.write_text(text, encoding="utf-8")
            written += 1
            logger.info("wrote %s (%d drivers)", path.name, len(payload["drivers"]))
    index = write_index()
    return {"written": written, "skipped": skipped, "indexed": len(index)}


def session_payload(ref) -> dict | None:
    """Fastest lap telemetry of every driver in one session, or None when nothing is cached."""
    try:
        session = get_session(ref)
        session.load(laps=True, telemetry=True, weather=False, messages=True)
    except Exception as exc:  # offline cache miss or broken session
        logger.warning("%s: not loadable offline (%s)", ref.key, type(exc).__name__)
        return None
    drivers = []
    for number in session.drivers:
        record = driver_record(session, number)
        if record is not None:
            drivers.append(record)
    if not drivers:
        return None
    drivers.sort(key=lambda d: d["lapTimeMs"])
    return {
        "season": ref.season,
        "round": ref.round,
        "code": ref.code,
        "eventName": ref.event_name,
        "sessionName": ref.name,
        "points": POINTS,
        "drivers": drivers,
    }


def driver_record(session, number: str) -> dict | None:
    try:
        lap = session.laps.pick_drivers(number).pick_fastest()
        if lap is None or lap.empty or lap["LapTime"] is None:
            return None
        telemetry = lap.get_telemetry()
    except Exception:
        return None
    if telemetry is None or len(telemetry) < 20:
        return None
    lap_time = lap["LapTime"]
    if lap_time != lap_time:  # NaT
        return None
    info = session.get_driver(number)
    resampled = resample(telemetry)
    if resampled is None:
        return None
    color = str(info.get("TeamColor") or "")
    return {
        "number": str(number),
        "code": str(info.get("Abbreviation") or number),
        "name": str(info.get("FullName") or ""),
        "team": str(info.get("TeamName") or ""),
        "color": f"#{color}" if color and not color.startswith("#") else color,
        "lapNumber": int(lap["LapNumber"]),
        "lapTimeMs": int(lap_time.total_seconds() * 1000),
        **resampled,
    }


def resample(telemetry) -> dict | None:
    """Values on an even distance grid from 0 to the lap length."""
    distance = telemetry["Distance"].to_numpy(dtype=float)
    keep = np.isfinite(distance)
    distance = distance[keep]
    if distance.size < 20:
        return None
    order = np.argsort(distance, kind="stable")
    distance = distance[order]
    length = float(distance[-1])
    grid = np.linspace(0.0, length, POINTS)

    def channel(name: str) -> np.ndarray:
        values = telemetry[name].to_numpy(dtype=float)[keep][order]
        return np.interp(grid, distance, values)

    speed = channel("Speed")
    throttle = np.clip(channel("Throttle"), 0, 100)
    brake = channel("Brake") >= 0.5
    gear = channel("nGear")
    x = channel("X")
    y = channel("Y")
    return {
        "length": round(length, 1),
        "speed": np.rint(speed).astype(int).tolist(),
        "throttle": np.rint(throttle).astype(int).tolist(),
        "brake": brake.astype(int).tolist(),
        "gear": np.rint(gear).astype(int).tolist(),
        "x": np.rint(x).astype(int).tolist(),
        "y": np.rint(y).astype(int).tolist(),
    }


def write_index() -> list[dict]:
    """index.json: one entry per exported session file, newest first."""
    entries = []
    for path in sorted(TELEMETRY_DIR.glob("*/*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        entries.append(
            {
                "season": payload["season"],
                "round": payload["round"],
                "code": payload["code"],
                "eventName": payload["eventName"],
                "sessionName": payload["sessionName"],
                "drivers": [d["code"] for d in payload["drivers"]],
            }
        )
    entries.sort(key=lambda e: (e["season"], e["round"], session_rank(e["code"])), reverse=True)
    TELEMETRY_DIR.mkdir(parents=True, exist_ok=True)
    text = json.dumps({"sessions": entries}, separators=(",", ":"))
    (TELEMETRY_DIR / "index.json").write_text(text, encoding="utf-8")
    return entries


def session_path(season: int, round_number: int, code: str):
    return TELEMETRY_DIR / str(season) / f"{round_number:02d}_{code}.json"


def session_rank(code: str) -> int:
    order = ["FP1", "FP2", "FP3", "SQ", "S", "Q", "R"]
    return order.index(code) if code in order else -1


def setup_offline(seasons: list[int]) -> None:
    """FastF1 cache with its HTTP cache, read only: offline mode never touches the network.

    Event schedules are fetched online first (one request per season): the cache does not hold
    them for seasons downloaded before the HTTP cache was kept, so offline lookups fail there.
    """
    fastf1.Cache.enable_cache(str(FASTF1_CACHE_DIR))
    for season in seasons:
        season_schedule(season)
    fastf1.Cache.offline_mode(True)
    fastf1.set_log_level("ERROR")


def main() -> None:
    parser = argparse.ArgumentParser(description="Export fastest-lap telemetry for the site")
    parser.add_argument("--seasons", nargs="*", default=None, help="seasons or ranges, default the latest")
    parser.add_argument("--sessions", nargs="*", default=DEFAULT_SESSIONS, help="session codes")
    parser.add_argument("--force", action="store_true", help="rewrite existing files")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    seasons = season_range(args.seasons) if args.seasons else [latest_cached_season()]
    summary = export(seasons, args.sessions, args.force)
    print(json.dumps(summary))


def latest_cached_season() -> int:
    years = [int(p.name) for p in FASTF1_CACHE_DIR.iterdir() if p.is_dir() and p.name.isdigit()]
    return max(years)


if __name__ == "__main__":
    main()
