"""Export one compact JSON per session for the site's session result pages.

    uv run python -m f1p.fastf1.session_export [--seasons 2026 2018-2025] [--force]

Reads data/processed/ff1_session_results, ff1_laps and ff1_weather (written by build_tables), plus
fantasy_overtakes (f1p.fantasy.overtakes) for the race and sprint overtake counts, and
writes data/serve/sessions/<season>/<RR>_<code>.json: the entry list, the classification (from the
timing results for Q, SQ, S and R; by best lap for practice), every lap per driver, the stints,
pit stops, sector bests, the speed trap and a weather summary. build_tables calls `export_all` after every
rebuild; without --force only sessions whose raw archive is newer than their JSON are written.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import pandas as pd

from f1p.fastf1.common import fastf1_root, season_range
from f1p.paths import SERVE_DIR, processed_path

SESSIONS_DIR = SERVE_DIR / "sessions"
SESSION_NAMES = {
    "FP1": "Practice 1",
    "FP2": "Practice 2",
    "FP3": "Practice 3",
    "SQ": "Sprint Qualifying",
    "S": "Sprint",
    "Q": "Qualifying",
    "R": "Race",
}
# Current compounds get the letter the chips are coloured by; the pre-2019 names keep two
# letters without a colour. Anything else (TEST_UNKNOWN, blanks) is no compound.
COMPOUND_LETTERS = {
    "SOFT": "S",
    "MEDIUM": "M",
    "HARD": "H",
    "INTERMEDIATE": "I",
    "WET": "W",
    "SUPERSOFT": "SS",
    "ULTRASOFT": "US",
    "HYPERSOFT": "HS",
}
# Lap flags, bit mask in the laps array.
FLAG_DELETED = 1
FLAG_PIT_IN = 2
FLAG_PIT_OUT = 4
FLAG_PERSONAL_BEST = 8
SESSION_KEYS = ["season", "round", "session"]


def main() -> int:
    args = _parse_args()
    seasons = season_range(args.seasons) if args.seasons else None
    results = pd.read_parquet(processed_path("ff1_session_results"))
    laps = pd.read_parquet(processed_path("ff1_laps"))
    weather = pd.read_parquet(processed_path("ff1_weather"))
    overtakes = read_overtakes()
    summary = export_all(results, laps, weather, overtakes, seasons=seasons, force=args.force)
    print(f"session export: {summary}")
    return 0


def export_all(results: pd.DataFrame, laps: pd.DataFrame, weather: pd.DataFrame,
               overtakes: pd.DataFrame | None = None, seasons: list[int] | None = None,
               force: bool = False) -> dict:
    """Write every session present in `results`; returns counts of written and skipped files."""
    if seasons is not None:
        results = results[results["season"].isin(seasons)]
    written = 0
    skipped = 0
    laps_by_session = _grouped(laps)
    weather_by_session = _grouped(weather)
    overtake_rows = _overtake_sessions(overtakes)
    overtakes_by_session = _grouped(overtake_rows)
    for key, session_results in results.groupby(SESSION_KEYS, sort=True):
        season, round_number, code = int(key[0]), int(key[1]), str(key[2])
        path = session_path(season, round_number, code)
        if not force and not _stale(path, season, round_number, code):
            skipped += 1
            continue
        session_laps = laps_by_session.get(key, laps.iloc[0:0])
        session_weather = weather_by_session.get(key, weather.iloc[0:0])
        session_overtakes = overtakes_by_session.get(key)
        payload = session_payload(session_results, session_laps, session_weather, session_overtakes)
        text = json.dumps(payload, separators=(",", ":"), allow_nan=False)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        written += 1
    return {"written": written, "skipped": skipped}


def session_payload(results: pd.DataFrame, laps: pd.DataFrame, weather: pd.DataFrame,
                    overtakes: pd.DataFrame | None = None) -> dict:
    """The JSON document of one session (every frame already filtered to that session)."""
    first = results.iloc[0]
    code = str(first["session"])
    drivers = [_driver_entry(row) for _, row in results.iterrows()]
    id_by_number = {d["number"]: d["driverId"] for d in drivers}
    laps = laps.copy()
    laps["driverId"] = laps["driverNumber"].map(id_by_number)
    laps = laps[laps["driverId"].notna()]
    best_laps = _best_laps(laps)
    if code in ("FP1", "FP2", "FP3"):
        classification = _practice_classification(drivers, best_laps)
    else:
        classification = _timed_classification(results, code, best_laps)
    return {
        "season": int(first["season"]),
        "round": int(first["round"]),
        "code": code,
        "sessionName": SESSION_NAMES.get(code, code),
        "eventName": str(first["eventName"]),
        "drivers": drivers,
        "classification": classification,
        "laps": _laps_by_driver(laps),
        "stints": _stints(laps),
        "pitStops": _pit_stops(laps),
        "sectorBests": _sector_bests(laps),
        "speedTrap": _speed_trap(laps),
        "weather": _weather_summary(weather),
        "overtakes": _overtakes(overtakes),
    }


def read_overtakes() -> pd.DataFrame | None:
    """data/processed/fantasy_overtakes.parquet when the fantasy step has produced it."""
    path = processed_path("fantasy_overtakes")
    if not path.exists():
        return None
    return pd.read_parquet(path)


def session_path(season: int, round_number: int, code: str) -> Path:
    return SESSIONS_DIR / str(season) / f"{round_number:02d}_{code}.json"


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _overtake_sessions(overtakes: pd.DataFrame | None) -> pd.DataFrame:
    """The fantasy overtake rows keyed like the FastF1 tables (session code R or S)."""
    if overtakes is None or overtakes.empty:
        return pd.DataFrame(columns=SESSION_KEYS + ["driverId", "overtakes", "overtakesRaw"])
    frame = overtakes.copy()
    frame["session"] = frame["session"].map({"Race": "R", "Sprint": "S"})
    return frame[frame["session"].notna()]


def _overtakes(overtakes: pd.DataFrame | None) -> list[dict]:
    """Per driver: filtered on-track passes (the fantasy count) and the raw OpenF1 swaps."""
    if overtakes is None or overtakes.empty:
        return []
    rows = []
    for _, row in overtakes.iterrows():
        driver_id = _text(row["driverId"])
        if not driver_id:
            continue
        count = _int(row["overtakes"]) or 0
        raw = _int(row["overtakesRaw"]) or 0
        rows.append({"driverId": driver_id, "count": count, "raw": raw})
    rows.sort(key=lambda r: (-r["count"], r["driverId"]))
    return rows


def _grouped(frame: pd.DataFrame) -> dict:
    if frame.empty:
        return {}
    return {key: group for key, group in frame.groupby(SESSION_KEYS, sort=False)}


def _stale(path: Path, season: int, round_number: int, code: str) -> bool:
    """True when the JSON is missing or older than the session's raw meta.json."""
    if not path.exists():
        return True
    meta_path = fastf1_root() / str(season) / f"{round_number:02d}_{code}" / "meta.json"
    if not meta_path.exists():
        return False
    return meta_path.stat().st_mtime > path.stat().st_mtime


def _driver_entry(row: pd.Series) -> dict:
    number = _int(row["driverNumber"])
    code = _text(row["code"]) or f"#{number}"
    driver_id = _text(row["driverId"]) or code.lower()
    constructor_id = _text(row["constructorId"]) or (_text(row["teamName"]) or "").lower()
    color = _text(row["teamColor"])
    return {
        "number": number,
        "code": code,
        "driverId": driver_id,
        "constructorId": constructor_id,
        "name": _text(row["fullName"]) or code,
        "team": _text(row["teamName"]) or constructor_id,
        "color": f"#{color}" if color and not color.startswith("#") else color,
    }


def _best_laps(laps: pd.DataFrame) -> dict:
    """driverId -> (lapTimeMs, lapNumber, compound letter) of the fastest non-deleted lap."""
    timed = laps[laps["lapTimeS"].notna() & ~laps["deleted"].fillna(False).astype(bool)]
    best = {}
    for driver_id, group in timed.groupby("driverId"):
        fastest_index = group["lapTimeS"].idxmin()
        row = group.loc[fastest_index]
        best[driver_id] = (_ms(row["lapTimeS"]), _int(row["lapNumber"]), _compound(row["compound"]))
    return best


def _practice_classification(drivers: list[dict], best_laps: dict) -> list[dict]:
    rows = []
    for driver in drivers:
        best = best_laps.get(driver["driverId"])
        rows.append({
            "driverId": driver["driverId"],
            "position": None,
            "positionText": "",
            "grid": None,
            "timeMs": None,
            "status": "",
            "points": 0,
            "laps": None,
            "q1Ms": None,
            "q2Ms": None,
            "q3Ms": None,
            "bestLapMs": best[0] if best else None,
            "bestLapNumber": best[1] if best else None,
            "bestLapCompound": best[2] if best else None,
        })
    rows.sort(key=lambda r: (r["bestLapMs"] is None, r["bestLapMs"] or 0))
    for index, row in enumerate(rows, start=1):
        if row["bestLapMs"] is not None:
            row["position"] = index
            row["positionText"] = str(index)
    return rows


def _timed_classification(results: pd.DataFrame, code: str, best_laps: dict) -> list[dict]:
    rows = []
    for _, row in results.iterrows():
        driver_id = _text(row["driverId"]) or (_text(row["code"]) or "").lower()
        best = best_laps.get(driver_id)
        position = _int(row["position"])
        position_text = _text(row["classifiedPosition"]) or (str(position) if position else "")
        rows.append({
            "driverId": driver_id,
            "position": position,
            "positionText": position_text,
            "grid": _int(row["gridPosition"]),
            "timeMs": _ms(row["timeS"]),
            "status": _text(row["status"]) or "",
            "points": _float(row["points"]) or 0,
            "laps": _int(row["laps"]),
            "q1Ms": _ms(row["q1S"]),
            "q2Ms": _ms(row["q2S"]),
            "q3Ms": _ms(row["q3S"]),
            "bestLapMs": best[0] if best else None,
            "bestLapNumber": best[1] if best else None,
            "bestLapCompound": best[2] if best else None,
        })
    rows.sort(key=lambda r: (r["position"] is None, r["position"] or 0))
    return rows


def _laps_by_driver(laps: pd.DataFrame) -> dict:
    """driverId -> [[lap, timeMs, s1Ms, s2Ms, s3Ms, compound, tyreLife, position, flags]]."""
    out: dict[str, list] = {}
    ordered = laps.sort_values(["driverId", "lapNumber"])
    for _, row in ordered.iterrows():
        flags = 0
        if pd.notna(row["deleted"]) and bool(row["deleted"]):
            flags |= FLAG_DELETED
        if pd.notna(row["pitInS"]):
            flags |= FLAG_PIT_IN
        if pd.notna(row["pitOutS"]):
            flags |= FLAG_PIT_OUT
        if pd.notna(row["isPersonalBest"]) and bool(row["isPersonalBest"]):
            flags |= FLAG_PERSONAL_BEST
        entry = [
            _int(row["lapNumber"]),
            _ms(row["lapTimeS"]),
            _ms(row["sector1S"]),
            _ms(row["sector2S"]),
            _ms(row["sector3S"]),
            _compound(row["compound"]),
            _int(row["tyreLife"]),
            _int(row["position"]),
            flags,
        ]
        out.setdefault(str(row["driverId"]), []).append(entry)
    return out


def _stints(laps: pd.DataFrame) -> list[dict]:
    stints = []
    valid = laps[laps["stint"].notna()]
    for (driver_id, stint), group in valid.groupby(["driverId", "stint"], sort=True):
        ordered = group.sort_values("lapNumber")
        first = ordered.iloc[0]
        compound = ordered["compound"].dropna()
        stints.append({
            "driverId": str(driver_id),
            "stint": int(stint),
            "compound": _compound(compound.iloc[0]) if len(compound) else None,
            "lapStart": _int(first["lapNumber"]),
            "lapEnd": _int(ordered.iloc[-1]["lapNumber"]),
            "laps": int(len(ordered)),
            "tyreAgeAtStart": max((_int(first["tyreLife"]) or 1) - 1, 0),
        })
    stints.sort(key=lambda s: (s["driverId"], s["stint"]))
    return stints


def _pit_stops(laps: pd.DataFrame) -> list[dict]:
    """Every pit entry with the pit lane time (pit out on the next lap minus pit in), in lap order."""
    stops = []
    for driver_id, group in laps.groupby("driverId", sort=False):
        ordered = group.sort_values("lapNumber")
        pit_out_by_lap = {}
        for _, row in ordered.iterrows():
            if pd.notna(row["pitOutS"]):
                pit_out_by_lap[_int(row["lapNumber"])] = float(row["pitOutS"])
        count = 0
        for _, row in ordered.iterrows():
            if pd.isna(row["pitInS"]):
                continue
            count += 1
            lap = _int(row["lapNumber"])
            pit_out = pit_out_by_lap.get((lap or 0) + 1)
            pit_in = float(row["pitInS"])
            duration = _ms(pit_out - pit_in) if pit_out is not None else None
            stops.append({"driverId": str(driver_id), "stop": count, "lap": lap, "durationMs": duration})
    stops.sort(key=lambda s: ((s["lap"] or 0), s["driverId"]))
    return stops


def _sector_bests(laps: pd.DataFrame) -> list[dict]:
    valid = laps[~laps["deleted"].fillna(False).astype(bool)]
    bests = []
    for number, column in ((1, "sector1S"), (2, "sector2S"), (3, "sector3S")):
        timed = valid[valid[column].notna()]
        if timed.empty:
            continue
        fastest_index = timed[column].idxmin()
        row = timed.loc[fastest_index]
        bests.append({"sector": number, "driverId": str(row["driverId"]), "ms": _ms(row[column])})
    return bests


def _speed_trap(laps: pd.DataFrame) -> list[dict]:
    timed = laps[laps["speedST"].notna()]
    if timed.empty:
        return []
    top = timed.groupby("driverId")["speedST"].max().sort_values(ascending=False)
    return [{"driverId": str(driver_id), "kph": round(float(speed), 1)} for driver_id, speed in top.items()]


def _weather_summary(weather: pd.DataFrame) -> dict | None:
    if weather.empty:
        return None
    rain = weather["rainfall"].fillna(False).astype(bool)
    # A track sensor reads 0 while it warms up; those samples are not a temperature.
    track = weather["trackTemp"][weather["trackTemp"] > 0]
    air_low, air_high = weather["airTemp"].min(), weather["airTemp"].max()
    track_low, track_high = track.min(), track.max()
    humidity = weather["humidity"].mean()
    wind = weather["windSpeed"].max()
    rained = rain.any()
    return {
        "airTemp": [_round(air_low), _round(air_high)],
        "trackTemp": [_round(track_low), _round(track_high)],
        "humidity": _round(humidity),
        "windSpeed": _round(wind),
        "rainfall": bool(rained),
    }


def _compound(value) -> str | None:
    text = _text(value)
    if not text:
        return None
    return COMPOUND_LETTERS.get(text.upper())


def _ms(value) -> int | None:
    if value is None or pd.isna(value):
        return None
    return int(round(float(value) * 1000))


def _int(value) -> int | None:
    if value is None or pd.isna(value):
        return None
    return int(value)


def _float(value) -> float | None:
    if value is None or pd.isna(value):
        return None
    number = float(value)
    return None if math.isnan(number) else number


def _round(value) -> float | None:
    number = _float(value)
    return None if number is None else round(number, 1)


def _text(value) -> str | None:
    if value is None or (not isinstance(value, str) and pd.isna(value)):
        return None
    text = str(value).strip()
    return text or None


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--seasons", nargs="*", help="seasons or ranges, e.g. 2026 2018-2025 (default: all)")
    parser.add_argument("--force", action="store_true", help="rewrite files that are up to date")
    return parser.parse_args()


if __name__ == "__main__":
    raise SystemExit(main())
