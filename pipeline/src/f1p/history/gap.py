"""Fetch rounds that the dump does not cover yet from the live Jolpica API.

Raw JSON is cached under raw/jolpica/api/<season>/<round>/. A round counts as final once it
was fetched at least FINAL_AFTER_DAYS after the race, so late penalties and corrections are
picked up by the next run; final rounds are never requested again.
"""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from f1p.history.api import JolpicaClient
from f1p.paths import raw_dir

FINAL_AFTER_DAYS = 3
ROUND_ENDPOINTS = {
    "results": ("results", "Results"),
    "sprint": ("sprint", "SprintResults"),
    "qualifying": ("qualifying", "QualifyingResults"),
    "laps": ("laps", "Laps"),
    "pitstops": ("pitstops", "PitStops"),
}
STANDINGS_ENDPOINTS = ["driverstandings", "constructorstandings"]


def fetch_gap(covered_rounds: set[tuple[int, int]], first_season: int, today: date) -> dict:
    """Fetch schedules for first_season..today.year and every completed round not covered.

    Returns {"schedules": {season: [race, ...]}, "rounds": [round_payload, ...]} where each
    round payload holds the cached JSON for that round's endpoints.
    """
    client = JolpicaClient()
    schedules: dict[int, list[dict]] = {}
    round_payloads: list[dict] = []
    try:
        for season in range(first_season, today.year + 1):
            schedule = _schedule(client, season, today)
            schedules[season] = schedule
            for race in schedule:
                key = (int(race["season"]), int(race["round"]))
                if key in covered_rounds or not _race_is_over(race, today):
                    continue
                payload = _round_payload(client, race, today)
                if payload is not None:
                    round_payloads.append(payload)
    finally:
        client.close()
        print(f"  jolpica API requests this run: {client.request_count}")
    return {"schedules": schedules, "rounds": round_payloads}


def api_cache_dir() -> Path:
    return raw_dir("jolpica") / "api"


def _schedule(client: JolpicaClient, season: int, today: date) -> list[dict]:
    """Season schedule, cached for the day so repeated runs cost no requests."""
    path = api_cache_dir() / str(season) / "schedule.json"
    cached = _read_json(path)
    if cached and cached.get("fetchedOn") == today.isoformat():
        return cached["races"]
    if cached and season < today.year:
        return cached["races"]
    races = client.get_races(f"{season}/races")
    _write_json(path, {"fetchedOn": today.isoformat(), "races": races})
    return races


def _round_payload(client: JolpicaClient, race: dict, today: date) -> dict | None:
    season = int(race["season"])
    race_round = int(race["round"])
    folder = api_cache_dir() / str(season) / f"{race_round:02d}"
    meta = _read_json(folder / "_meta.json")
    if meta and meta.get("final"):
        return _load_round(folder)

    print(f"  fetching {season} round {race_round} {race['raceName']} from the API")
    results = client.get_races(f"{season}/{race_round}/results", "Results")
    if not results or not results[0].get("Results"):
        print(f"    no results published yet for {season} round {race_round}, skipping")
        return None
    _write_json(folder / "results.json", results)

    for name, (endpoint, list_key) in ROUND_ENDPOINTS.items():
        if name == "results":
            continue
        if name == "sprint" and "Sprint" not in race:
            continue
        races = client.get_races(f"{season}/{race_round}/{endpoint}", list_key)
        _write_json(folder / f"{name}.json", races)
    for endpoint in STANDINGS_ENDPOINTS:
        standings = client.get_standings(f"{season}/{race_round}/{endpoint}")
        _write_json(folder / f"{endpoint}.json", standings)

    race_day = date.fromisoformat(race["date"])
    is_final = today - race_day >= timedelta(days=FINAL_AFTER_DAYS)
    fetched_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    _write_json(folder / "_meta.json", {"fetchedAt": fetched_at, "raceDate": race["date"],
                                        "final": is_final})
    return _load_round(folder)


def _load_round(folder: Path) -> dict:
    payload = {"folder": str(folder)}
    for name in [*ROUND_ENDPOINTS, *STANDINGS_ENDPOINTS]:
        data = _read_json(folder / f"{name}.json")
        payload[name] = data if data is not None else []
    return payload


def _race_is_over(race: dict, today: date) -> bool:
    """A race counts as over three hours after its start (or the day after, if no time)."""
    race_day = date.fromisoformat(race["date"])
    if not race.get("time"):
        return race_day < today
    start_text = f"{race['date']}T{race['time'].rstrip('Z')}+00:00"
    start = datetime.fromisoformat(start_text)
    now = datetime.now(timezone.utc)
    return now - start > timedelta(hours=3)


def _read_json(path: Path):
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8")
    return json.loads(text)


def _write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(".tmp")
    text = json.dumps(data, ensure_ascii=False)
    temp_path.write_text(text, encoding="utf-8")
    temp_path.replace(path)
