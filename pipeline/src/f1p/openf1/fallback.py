"""OpenF1 stand-in for sessions FastF1 has not published yet.

    uv run python -m f1p.openf1.fallback [--days 45] [--budget-minutes 25]

FastF1 often publishes a weekend days or weeks late. Until it does, this fills two site files
per finished session from OpenF1, both marked "source": "openf1":

- data/serve/telemetry/<season>/<RR>_<code>.json (Q, SQ, S, R): every driver's fastest lap,
  car_data and location of that lap only, resampled onto the telemetry_export distance grid.
- data/serve/sessions/<season>/<RR>_<code>.json (every session): the session_export document,
  built from OpenF1 laps, stints, pit, weather and session_result, when the file is missing or
  FastF1 left it without lap times.

A FastF1 file with laps is never touched. When FastF1 delivers later, telemetry_export and
session_export overwrite the OpenF1 files on their own. Raw responses are cached under
data/raw/openf1/<season>/<session_key>/ (laps.json, telemetry/<number>.json), the raw-openf1
cloud state group. Network errors leave a session pending for the next run; the exit code is 0
unless the arguments are wrong.
"""

from __future__ import annotations

import argparse
import json
import logging
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import numpy as np
import pandas as pd

from f1p.fastf1 import session_export, telemetry_export
from f1p.fastf1.common import SESSION_CODES
from f1p.openf1.download import USER_AGENT, fetch
from f1p.paths import processed_path, raw_dir

SOURCE = "openf1"
TELEMETRY_CODES = set(telemetry_export.DEFAULT_SESSIONS)
# OpenF1 serves a session for free from 30 minutes after it ends.
FINISHED_AFTER = timedelta(minutes=45)
DEFAULT_DAYS = 45
DEFAULT_BUDGET_MINUTES = 25
# A lap faster than the official best by more than this is a deleted lap, not the best one.
DELETED_LAP_MARGIN_S = 0.05
# car_data and location are fetched for the lap window padded on both sides.
WINDOW_PAD_S = 1.0
# The lap must be covered to within this many seconds at both ends.
COVERAGE_SLACK_S = 1.5
MIN_SAMPLES = 20
logger = logging.getLogger("f1p.openf1.fallback")


def main() -> int:
    args = _parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    now = datetime.now(timezone.utc)
    summary = run(now, args.days, args.budget_minutes * 60)
    print("RESULT " + json.dumps(summary), flush=True)
    return 0


def run(now: datetime, days: int, budget_s: float) -> dict:
    """Fill every recent finished session that lacks a telemetry or session file."""
    summary = {"telemetry": [], "sessions": [], "pending": [], "errors": []}
    deadline = time.monotonic() + budget_s
    try:
        targets = missing_sessions(now, days)
    except Exception as exc:
        logger.error("openf1 fallback: cannot list sessions (%s): %s", type(exc).__name__, exc)
        summary["errors"].append(f"{type(exc).__name__}: {exc}")
        return summary
    with httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=60) as client:
        for target in targets:
            label = target["label"]
            if time.monotonic() > deadline:
                summary["pending"].append(label)
                continue
            try:
                done = fill_session(client, target)
            except Exception as exc:
                logger.warning("%s: OpenF1 fallback failed (%s): %s; pending", label, type(exc).__name__, exc)
                summary["pending"].append(label)
                continue
            for kind in ("telemetry", "sessions"):
                if done.get(kind):
                    summary[kind].append(label)
            if done.get("pending"):
                summary["pending"].append(label)
    if summary["telemetry"]:
        telemetry_export.write_index()
    return summary


def missing_sessions(now: datetime, days: int) -> list[dict]:
    """OpenF1 sessions of the last `days` days that ended and miss a site file."""
    races = pd.read_parquet(processed_path("races"))
    seasons = sorted({now.year, (now - timedelta(days=days)).year})
    targets = []
    for season in seasons:
        sessions = _read_rows(raw_dir("openf1") / str(season) / "sessions.json")
        rounds = meeting_rounds(sessions, races)
        for session in sessions:
            target = session_target(session, rounds, races, now, days)
            if target is not None:
                targets.append(target)
    targets.sort(key=lambda t: t["start"])
    return targets


def fill_session(client: httpx.Client, target: dict) -> dict:
    """Write what is missing for one session; returns which files were written."""
    folder = target["folder"]
    laps = cached_rows(client, folder / "laps.json", "laps", {"session_key": target["sessionKey"]})
    if not laps:
        logger.info("%s: OpenF1 has no laps yet; pending", target["label"])
        return {"pending": True}
    drivers = _read_rows(folder / "drivers.json")
    results = _read_rows(folder / "session_result.json")
    done = {}
    if target["needsSession"]:
        payload = session_payload(target, laps, drivers, results)
        if payload is not None:
            path = session_export.session_path(target["season"], target["round"], target["code"])
            _write_payload(path, payload)
            done["sessions"] = True
            logger.info("%s: wrote OpenF1 session report (%d drivers)", target["label"], len(payload["drivers"]))
    if target["needsTelemetry"]:
        payload = telemetry_payload(client, target, laps, drivers, results)
        if payload is None:
            done["pending"] = True
        else:
            path = telemetry_export.session_path(target["season"], target["round"], target["code"])
            _write_payload(path, payload)
            done["telemetry"] = True
            logger.info("%s: wrote OpenF1 telemetry (%d drivers)", target["label"], len(payload["drivers"]))
    return done


def telemetry_payload(client: httpx.Client, target: dict, laps: list[dict], drivers: list[dict],
                      results: list[dict]) -> dict | None:
    """The telemetry_export document of one session, or None when no driver could be resampled."""
    official = official_bests(results)
    records = []
    for driver in drivers:
        number = int(driver["driver_number"])
        lap = fastest_lap(laps, number, official.get(number))
        if lap is None:
            continue
        samples = lap_samples(client, target, lap)
        if samples is None:
            continue
        start = _timestamp(lap["date_start"])
        lap_seconds = float(lap["lap_duration"])
        resampled = resample_lap(samples["car"], samples["location"], start, lap_seconds)
        if resampled is None:
            continue
        info = driver_info(driver)
        records.append({
            "number": str(number),
            "code": info["code"],
            "name": info["name"],
            "team": info["team"],
            "color": info["color"],
            "lapNumber": int(lap["lap_number"]),
            "lapTimeMs": int(round(float(lap["lap_duration"]) * 1000)),
            **resampled,
        })
    if not records:
        return None
    records.sort(key=lambda d: d["lapTimeMs"])
    return {
        "season": target["season"],
        "round": target["round"],
        "code": target["code"],
        "eventName": target["eventName"],
        "sessionName": target["sessionName"],
        "points": telemetry_export.POINTS,
        "source": SOURCE,
        "drivers": records,
    }


def resample_lap(car: list[dict], location: list[dict], lap_start: float, lap_seconds: float) -> dict | None:
    """car_data and location rows of one lap onto the telemetry_export distance grid.

    Distance comes from integrating speed over time from the lap start, the way FastF1 derives
    it. Rows carry ISO dates; `lap_start` is a POSIX timestamp.
    """
    car_frame = _sample_frame(car, lap_start)
    location_frame = _sample_frame(location, lap_start)
    if car_frame is None or location_frame is None:
        return None
    car_t = car_frame["t"].to_numpy(dtype=float)
    location_t = location_frame["t"].to_numpy(dtype=float)
    if not _covers(car_t, lap_seconds) or not _covers(location_t, lap_seconds):
        return None
    inside = car_t[(car_t > 0) & (car_t < lap_seconds)]
    times = np.concatenate([[0.0], inside, [lap_seconds]])
    speed_all = car_frame["speed"].to_numpy(dtype=float)
    travelled = _integrate(car_t, speed_all / 3.6)
    distance = np.interp(times, car_t, travelled)
    distance = distance - distance[0]

    def at_times(frame: pd.DataFrame, t: np.ndarray, name: str) -> np.ndarray:
        values = frame[name].to_numpy(dtype=float)
        return np.interp(times, t, values)

    brake = at_times(car_frame, car_t, "brake")
    telemetry = pd.DataFrame({
        "Distance": distance,
        "Speed": at_times(car_frame, car_t, "speed"),
        "Throttle": at_times(car_frame, car_t, "throttle"),
        "Brake": (brake >= 50).astype(float),
        "nGear": at_times(car_frame, car_t, "n_gear"),
        "X": at_times(location_frame, location_t, "x"),
        "Y": at_times(location_frame, location_t, "y"),
    })
    return telemetry_export.resample(telemetry)


def session_payload(target: dict, laps: list[dict], drivers: list[dict], results: list[dict]) -> dict | None:
    """The session_export document built from OpenF1 tables in the FastF1 table layout."""
    folder = target["folder"]
    origin = _timestamp(target["start"])
    ids = driver_ids(target["season"], target["round"])
    results_frame = results_table(target, drivers, results, ids)
    if results_frame.empty:
        return None
    stints = _read_rows(folder / "stints.json")
    pits = _read_rows(folder / "pit.json")
    laps_frame = laps_table(laps, stints, pits, origin)
    weather_rows = _read_rows(folder / "weather.json")
    weather_frame = weather_table(weather_rows)
    payload = session_export.session_payload(results_frame, laps_frame, weather_frame)
    payload["eventName"] = target["eventName"]
    payload["source"] = SOURCE
    return payload


def results_table(target: dict, drivers: list[dict], results: list[dict], ids: dict) -> pd.DataFrame:
    """One row per driver in the ff1_session_results columns session_export reads."""
    by_number = {int(r["driver_number"]): r for r in results if r.get("driver_number") is not None}
    grid_rows = _read_rows(target["folder"] / "starting_grid.json")
    grid = {int(r["driver_number"]): r.get("position") for r in grid_rows}
    code = target["code"]
    rows = []
    for driver in drivers:
        number = int(driver["driver_number"])
        info = driver_info(driver)
        known = ids.get(number, {})
        result = by_number.get(number, {})
        quali = _quali_times(result) if code in ("Q", "SQ") else [None, None, None]
        rows.append({
            "season": target["season"],
            "round": target["round"],
            "session": code,
            "eventName": target["eventName"],
            "driverNumber": number,
            "code": info["code"],
            "driverId": known.get("driverId") or info["code"].lower(),
            "constructorId": known.get("constructorId"),
            "teamName": info["team"],
            "teamColor": info["color"],
            "fullName": info["name"],
            "position": result.get("position"),
            "classifiedPosition": _classified(result),
            "gridPosition": grid.get(number) if code in ("R", "S") else None,
            "timeS": _race_time(result) if code in ("R", "S") else None,
            "status": _status(result) if code in ("R", "S") else None,
            "points": result.get("points") or 0,
            "laps": result.get("number_of_laps"),
            "q1S": quali[0],
            "q2S": quali[1],
            "q3S": quali[2],
        })
    frame = pd.DataFrame(rows)
    if frame.empty:
        return frame
    frame["position"] = pd.to_numeric(frame["position"], errors="coerce")
    return frame.sort_values("position", na_position="last").reset_index(drop=True)


def laps_table(laps: list[dict], stints: list[dict], pits: list[dict], origin: float) -> pd.DataFrame:
    """One row per lap in the ff1_laps columns session_export reads; times in seconds from `origin`."""
    stint_rows = sorted(stints, key=lambda s: (s["driver_number"], s["stint_number"]))
    pit_in = {(int(p["driver_number"]), int(p["lap_number"])): p
              for p in pits if p.get("lap_number") is not None and p.get("date")}
    rows = []
    best: dict[int, float] = {}
    for lap in sorted(laps, key=lambda l: (l["driver_number"], l["lap_number"])):
        number = int(lap["driver_number"])
        lap_number = int(lap["lap_number"])
        start = _timestamp(lap["date_start"]) - origin if lap.get("date_start") else None
        lap_time = lap.get("lap_duration")
        personal_best = lap_time is not None and lap_time < best.get(number, float("inf"))
        if personal_best:
            best[number] = lap_time
        stint = _stint_for(stint_rows, number, lap_number)
        entry = pit_in.get((number, lap_number))
        entry_s = _timestamp(entry["date"]) - origin if entry else None
        previous_entry = pit_in.get((number, lap_number - 1))
        pit_out = _pit_out(lap, start, previous_entry, origin)
        rows.append({
            "driverNumber": number,
            "lapNumber": lap_number,
            "lapTimeS": lap_time,
            "sector1S": lap.get("duration_sector_1"),
            "sector2S": lap.get("duration_sector_2"),
            "sector3S": lap.get("duration_sector_3"),
            "deleted": False,
            "pitInS": entry_s,
            "pitOutS": pit_out,
            "isPersonalBest": personal_best,
            "compound": stint.get("compound") if stint else None,
            "tyreLife": _tyre_life(stint, lap_number),
            "position": None,
            "stint": stint.get("stint_number") if stint else None,
            "lapStartS": start,
            "speedST": lap.get("st_speed"),
        })
    columns = ["driverNumber", "lapNumber", "lapTimeS", "sector1S", "sector2S", "sector3S", "deleted",
               "pitInS", "pitOutS", "isPersonalBest", "compound", "tyreLife", "position", "stint",
               "lapStartS", "speedST"]
    frame = pd.DataFrame(rows, columns=columns)
    for column in ("lapTimeS", "sector1S", "sector2S", "sector3S", "pitInS", "pitOutS", "lapStartS",
                   "speedST", "tyreLife", "position", "stint"):
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    return frame


def weather_table(rows: list[dict]) -> pd.DataFrame:
    frame = pd.DataFrame(rows)
    if frame.empty:
        return pd.DataFrame(columns=["airTemp", "trackTemp", "humidity", "windSpeed", "rainfall"])
    return pd.DataFrame({
        "airTemp": frame["air_temperature"],
        "trackTemp": frame["track_temperature"],
        "humidity": frame["humidity"],
        "windSpeed": frame["wind_speed"],
        "rainfall": frame["rainfall"].fillna(0).astype(bool),
    })


def fastest_lap(laps: list[dict], number: int, official_best: float | None) -> dict | None:
    """The driver's fastest timed lap, skipping laps faster than the official best (deleted laps)."""
    timed = [l for l in laps if int(l["driver_number"]) == number and l.get("lap_duration") and l.get("date_start")]
    if official_best is not None:
        timed = [l for l in timed if l["lap_duration"] >= official_best - DELETED_LAP_MARGIN_S]
    if not timed:
        return None
    return min(timed, key=lambda l: l["lap_duration"])


def official_bests(results: list[dict]) -> dict[int, float]:
    """driver number -> best qualifying time from session_result (qualifying sessions only)."""
    bests = {}
    for row in results:
        times = [t for t in _quali_times(row) if t is not None]
        if times and isinstance(row.get("duration"), list):
            bests[int(row["driver_number"])] = min(times)
    return bests


def lap_samples(client: httpx.Client, target: dict, lap: dict) -> dict | None:
    """car_data and location of one lap window, cached in telemetry/<number>.json."""
    number = int(lap["driver_number"])
    path = target["folder"] / "telemetry" / f"{number}.json"
    if path.exists():
        text = path.read_text(encoding="utf-8")
        cached = json.loads(text)
        if cached.get("lapNumber") == lap["lap_number"]:
            return cached
    lap_start = _timestamp(lap["date_start"])
    start = _iso(lap_start - WINDOW_PAD_S)
    end = _iso(lap_start + float(lap["lap_duration"]) + WINDOW_PAD_S)
    window = {"session_key": target["sessionKey"], "driver_number": number, "date>": start, "date<": end}
    car = fetch(client, "car_data", window)
    location = fetch(client, "location", window)
    if not car or not location:
        return None
    samples = {"lapNumber": lap["lap_number"], "car": car, "location": location}
    _write_json(path, samples)
    return samples


def cached_rows(client: httpx.Client, path: Path, endpoint: str, params: dict) -> list[dict]:
    """A cached OpenF1 response, fetched once it is not empty."""
    if path.exists():
        return _read_rows(path)
    rows = fetch(client, endpoint, params)
    if rows:
        _write_json(path, rows)
    return rows


def session_target(session: dict, rounds: dict, races: pd.DataFrame, now: datetime, days: int) -> dict | None:
    code = SESSION_CODES.get(session.get("session_name", ""))
    round_number = rounds.get(session["meeting_key"])
    if code is None or round_number is None or session.get("is_cancelled"):
        return None
    end = datetime.fromisoformat(session["date_end"])
    if end + FINISHED_AFTER > now or end < now - timedelta(days=days):
        return None
    season = int(session["year"])
    needs_session = session_needs_report(season, round_number, code)
    telemetry_path = telemetry_export.session_path(season, round_number, code)
    needs_telemetry = code in TELEMETRY_CODES and not telemetry_path.exists()
    if not needs_session and not needs_telemetry:
        return None
    race = races[(races["season"] == season) & (races["round"] == round_number)]
    event_name = str(race["raceName"].iloc[0]) if len(race) else str(session.get("location", ""))
    return {
        "label": f"{season}/{round_number:02d}_{code}",
        "season": season,
        "round": round_number,
        "code": code,
        "sessionKey": int(session["session_key"]),
        "sessionName": session_export.SESSION_NAMES.get(code, code),
        "eventName": event_name,
        "start": session["date_start"],
        "folder": raw_dir("openf1") / str(season) / str(session["session_key"]),
        "needsSession": needs_session,
        "needsTelemetry": needs_telemetry,
    }


def session_needs_report(season: int, round_number: int, code: str) -> bool:
    """True when the session file is missing or carries no lap start (FastF1 sent no laps)."""
    path = session_export.session_path(season, round_number, code)
    if not path.exists():
        return True
    try:
        text = path.read_text(encoding="utf-8")
        payload = json.loads(text)
    except (ValueError, OSError):
        return True
    return not has_lap_starts(payload)


def has_lap_starts(payload: dict) -> bool:
    starts = payload.get("lapStarts") or {}
    return any(t is not None for times in starts.values() for t in times)


def meeting_rounds(sessions: list[dict], races: pd.DataFrame) -> dict[int, int]:
    """OpenF1 meeting_key -> round, by the race start nearest races.raceUtc (within 30 hours)."""
    rounds = {}
    for session in sessions:
        if session.get("session_name") != "Race":
            continue
        start = pd.Timestamp(session["date_start"]).tz_convert("UTC").tz_localize(None)
        season_races = races[races["season"] == int(session["year"])]
        if season_races.empty:
            continue
        gap = (season_races["raceUtc"] - start).abs()
        best = gap.idxmin()
        if gap.loc[best] <= pd.Timedelta(hours=30):
            rounds[session["meeting_key"]] = int(season_races.loc[best, "round"])
    return rounds


def driver_ids(season: int, round_number: int) -> dict[int, dict]:
    """Car number -> driverId and constructorId, from the latest results up to this round."""
    frames = []
    for name in ("results", "sprint_results"):
        path = processed_path(name)
        if path.exists():
            table = pd.read_parquet(path, columns=["season", "round", "number", "driverId", "constructorId"])
            frames.append(table)
    if not frames:
        return {}
    table = pd.concat(frames).dropna(subset=["number", "driverId"])
    table = table[table["season"] == season]
    table = table.assign(later=table["round"] > round_number)
    table = table.sort_values(["later", "round"], ascending=[False, True])
    ids = {}
    for row in table.itertuples():
        ids[int(row.number)] = {"driverId": row.driverId, "constructorId": row.constructorId}
    return ids


def driver_info(driver: dict) -> dict:
    number = int(driver["driver_number"])
    first = (driver.get("first_name") or "").strip()
    last = (driver.get("last_name") or "").strip()
    name = f"{first} {last}".strip() or str(driver.get("full_name") or "")
    color = str(driver.get("team_colour") or "")
    return {
        "code": str(driver.get("name_acronym") or number),
        "name": name,
        "team": str(driver.get("team_name") or ""),
        "color": f"#{color}" if color and not color.startswith("#") else color,
    }


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _sample_frame(rows: list[dict], lap_start: float) -> pd.DataFrame | None:
    if len(rows) < MIN_SAMPLES:
        return None
    frame = pd.DataFrame(rows)
    stamps = pd.to_datetime(frame["date"], utc=True, format="ISO8601")
    seconds = stamps.astype("int64") / 1e9
    frame["t"] = seconds - lap_start
    frame = frame.sort_values("t", kind="stable").drop_duplicates("t")
    values = frame.drop(columns=["date"]).apply(pd.to_numeric, errors="coerce")
    return values.fillna(0)


def _covers(t: np.ndarray, lap_seconds: float) -> bool:
    return t.size >= MIN_SAMPLES and t[0] <= COVERAGE_SLACK_S and t[-1] >= lap_seconds - COVERAGE_SLACK_S


def _integrate(t: np.ndarray, metres_per_second: np.ndarray) -> np.ndarray:
    steps = np.diff(t) * (metres_per_second[1:] + metres_per_second[:-1]) / 2
    return np.concatenate([[0.0], np.cumsum(steps)])


def _quali_times(result: dict) -> list[float | None]:
    duration = result.get("duration")
    if not isinstance(duration, list):
        return [None, None, None]
    padded = list(duration) + [None, None, None]
    return [float(t) if t else None for t in padded[:3]]


def _classified(result: dict) -> str | None:
    if result.get("dsq"):
        return "D"
    if result.get("dns"):
        return "W"
    if result.get("dnf"):
        return "R"
    position = result.get("position")
    return str(position) if position else None


def _race_time(result: dict) -> float | None:
    """Like FastF1: the winner's total time, everyone else's gap to the winner."""
    if result.get("position") == 1 and isinstance(result.get("duration"), (int, float)):
        return float(result["duration"])
    gap = result.get("gap_to_leader")
    return float(gap) if isinstance(gap, (int, float)) and gap > 0 else None


def _status(result: dict) -> str:
    if result.get("dsq"):
        return "Disqualified"
    if result.get("dns"):
        return "Did not start"
    if result.get("dnf"):
        return "Retired"
    gap = result.get("gap_to_leader")
    if isinstance(gap, str) and "LAP" in gap.upper():
        return gap.replace("LAPS", "Laps").replace("LAP", "Lap")
    return "Finished"


def _stint_for(stints: list[dict], number: int, lap_number: int) -> dict | None:
    for stint in stints:
        if int(stint["driver_number"]) != number:
            continue
        lap_end = stint.get("lap_end") or lap_number
        if stint["lap_start"] <= lap_number <= lap_end:
            return stint
    return None


def _pit_out(lap: dict, start: float | None, previous_entry: dict | None, origin: float) -> float | None:
    """Pit exit of an out lap: the previous lap's pit entry plus the OpenF1 lane time, else the lap start."""
    if not lap.get("is_pit_out_lap"):
        return None
    lane = previous_entry.get("pit_duration") or previous_entry.get("lane_duration") if previous_entry else None
    if not lane:
        return start
    entry_s = _timestamp(previous_entry["date"]) - origin
    return entry_s + float(lane)


def _tyre_life(stint: dict | None, lap_number: int) -> int | None:
    if not stint:
        return None
    age = stint.get("tyre_age_at_start") or 0
    return int(age + lap_number - stint["lap_start"] + 1)


def _timestamp(text: str) -> float:
    return datetime.fromisoformat(text).timestamp()


def _iso(seconds: float) -> str:
    moment = datetime.fromtimestamp(seconds, tz=timezone.utc)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.%f")


def _read_rows(path: Path) -> list[dict]:
    if not path.exists():
        return []
    text = path.read_text(encoding="utf-8")
    return json.loads(text)


def _write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, ensure_ascii=False)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


def _write_payload(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, separators=(",", ":"), allow_nan=False)
    path.write_text(text, encoding="utf-8")


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fill sessions FastF1 has not published from OpenF1")
    parser.add_argument("--days", type=int, default=DEFAULT_DAYS, help="look back this many days")
    parser.add_argument("--budget-minutes", type=float, default=DEFAULT_BUDGET_MINUTES,
                        help="stop starting new sessions after this long; the rest stay pending")
    return parser.parse_args()


if __name__ == "__main__":
    raise SystemExit(main())
