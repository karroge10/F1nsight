from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path

import httpx
import pandas as pd

from f1p.paths import PROCESSED_DIR, SERVE_DIR

TARGETS = {
    (2026, 18): {
        "race": "https://www.formula1.com/en/results/2026/races/1297/united-states/race-result",
        "qualifying": "https://www.formula1.com/en/results/2026/races/1297/united-states/qualifying",
    }
}
CACHE_PATH = SERVE_DIR / "official_results.json"
CACHE_MAX_AGE = timedelta(hours=12)


class ResultsTableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._in_results = False
        self._results_depth = 0
        self._row: list[str] | None = None
        self._cell: list[str] | None = None
        self._cell_tag = ""
        self.rows: list[list[str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == "div" and attributes.get("id") == "results-table":
            self._in_results = True
            self._results_depth = 1
            return
        if not self._in_results:
            return
        if tag == "div":
            self._results_depth += 1
        elif tag == "tr":
            self._row = []
        elif tag in {"td", "th"} and self._row is not None:
            self._cell = []
            self._cell_tag = tag
        elif tag == "br" and self._cell is not None:
            self._cell.append(" ")

    def handle_endtag(self, tag: str) -> None:
        if not self._in_results:
            return
        if tag in {"td", "th"} and self._cell is not None and self._row is not None:
            value = " ".join("".join(self._cell).replace("\xa0", " ").split())
            self._row.append(value)
            self._cell = None
            self._cell_tag = ""
        elif tag == "tr" and self._row is not None:
            if self._row:
                self.rows.append(self._row)
            self._row = None
        elif tag == "div":
            self._results_depth -= 1
            if self._results_depth == 0:
                self._in_results = False

    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            self._cell.append(data)


def parse_table(html: str) -> tuple[list[str], list[list[str]]]:
    parser = ResultsTableParser()
    parser.feed(html)
    if not parser.rows:
        raise ValueError("Formula 1 results table was not found")
    headers = [value.strip().casefold() for value in parser.rows[0]]
    rows = [row for row in parser.rows[1:] if len(row) == len(headers)]
    if not rows:
        raise ValueError("Formula 1 results table has no data rows")
    return headers, rows


def parse_lap_time(value: str) -> int | None:
    parts = value.strip().split(":")
    if len(parts) == 2:
        hours = 0
        minutes, second_part = parts
    elif len(parts) == 3:
        hours, minutes, second_part = parts
    else:
        return None
    match = re.fullmatch(r"(\d{1,2})\.(\d{3})", second_part)
    if not match:
        return None
    return (int(hours) * 3600 + int(minutes) * 60 + int(match.group(1))) * 1000 + int(match.group(2))


def _column(headers: list[str], name: str) -> int:
    try:
        return headers.index(name.casefold())
    except ValueError as exc:
        raise ValueError(f"Formula 1 table is missing the {name} column") from exc


def _driver_code(value: str) -> str:
    match = re.search(r"([A-Z]{3})\s*$", value)
    if not match:
        raise ValueError(f"Could not read driver code from {value!r}")
    return match.group(1)


def _identities(season: int) -> tuple[dict[tuple[str, str], str], dict[str, str], set[tuple[str, str, str]]]:
    drivers = pd.read_parquet(PROCESSED_DIR / "drivers.parquet")
    constructors = pd.read_parquet(PROCESSED_DIR / "constructors.parquet")
    entries = pd.read_parquet(PROCESSED_DIR / "season_entries.parquet")
    driver_codes: dict[str, set[str]] = {}
    for row in drivers.itertuples(index=False):
        driver_codes.setdefault(str(row.code).upper(), set()).add(str(row.driverId))
    constructor_ids = {
        "RED BULL RACING": "red_bull",
        "RACING BULLS": "rb",
        "HAAS F1 TEAM": "haas",
        "ALPINE": "alpine",
        "CADILLAC": "cadillac",
    }
    names = {str(row.name).casefold(): row.constructorId for row in constructors.itertuples(index=False)}
    for row in constructors.itertuples(index=False):
        constructor_ids[str(row.name).casefold().upper()] = row.constructorId
    constructor_ids = {name: names.get(value, value) for name, value in constructor_ids.items()}
    entry_map: set[tuple[str, str, str]] = set()
    for row in entries[entries["season"] == season].itertuples(index=False):
        if pd.isna(row.carNumbers):
            continue
        for number in str(row.carNumbers).split(","):
            entry_map.add((str(row.driverId), number.strip(), str(row.constructorId)))
    driver_ids = {}
    for driver_id, number, _ in entry_map:
        codes = [code for code, ids in driver_codes.items() if driver_id in ids]
        for code in codes:
            driver_ids[(code, number)] = driver_id
    return driver_ids, constructor_ids, entry_map


def _team_id(name: str, constructor_ids: dict[str, str]) -> str:
    team = constructor_ids.get(name.strip().casefold().upper())
    if not team:
        raise ValueError(f"Could not map Formula 1 team {name!r} to a constructor id")
    return team


def build_race_rows(headers: list[str], rows: list[list[str]], season: int) -> list[dict]:
    driver_ids, constructor_ids, entry_map = _identities(season)
    pos_i, number_i, driver_i, team_i, laps_i, time_i, points_i = (
        _column(headers, name) for name in ("pos.", "no.", "driver", "team", "laps", "time / retired", "pts.")
    )
    winner_time = None
    parsed = []
    for row in rows:
        position_text = row[pos_i].strip()
        code = _driver_code(row[driver_i])
        number = int(row[number_i])
        driver_id = driver_ids.get((code, str(number)))
        if not driver_id:
            raise ValueError(f"Could not map Formula 1 driver code {code!r} to a driver id")
        team_id = _team_id(row[team_i], constructor_ids)
        if (driver_id, str(number), team_id) not in entry_map:
            raise ValueError(f"Official team and local season entry disagree for {code} car {number}")
        time_text = row[time_i].strip()
        if position_text == "1":
            winner_time = parse_lap_time(time_text)
            if winner_time is None:
                raise ValueError("Formula 1 race winner time could not be parsed")
        parsed.append((row, position_text, driver_id, number, team_id, time_text))
    if winner_time is None:
        raise ValueError("Formula 1 race result has no classified winner")
    result = []
    for row, position_text, driver_id, number, team_id, time_text in parsed:
        position = int(position_text) if position_text.isdigit() else None
        if position == 1:
            time_ms = winner_time
            status = "Finished"
        elif re.fullmatch(r"\+\d+\.\d{3}s", time_text):
            time_ms = winner_time + round(float(time_text[1:-1]) * 1000)
            status = "Finished"
        elif re.fullmatch(r"\+\d+ lap", time_text):
            time_ms = None
            status = time_text
        else:
            time_ms = None
            status = time_text
        result.append({
            "position": position,
            "positionText": position_text,
            "driverId": driver_id,
            "constructorId": team_id,
            "number": number,
            "grid": None,
            "laps": int(row[laps_i]),
            "status": status,
            "classified": position is not None,
            "points": float(row[points_i]),
            "timeMs": time_ms,
            "fastestLapRank": None,
            "fastestLapMs": None,
            "fastestLapNumber": None,
        })
    return result


def build_qualifying_rows(headers: list[str], rows: list[list[str]], season: int) -> list[dict]:
    driver_ids, constructor_ids, entry_map = _identities(season)
    pos_i, number_i, driver_i, team_i, q1_i, q2_i, q3_i = (
        _column(headers, name) for name in ("pos.", "no.", "driver", "team", "q1", "q2", "q3")
    )
    result = []
    for row in rows:
        code = _driver_code(row[driver_i])
        number = int(row[number_i])
        driver_id = driver_ids.get((code, str(number)))
        if not driver_id:
            raise ValueError(f"Could not map Formula 1 driver code {code!r} to a driver id")
        team_id = _team_id(row[team_i], constructor_ids)
        if (driver_id, str(number), team_id) not in entry_map:
            raise ValueError(f"Official team and local season entry disagree for {code} car {number}")
        result.append({
            "position": int(row[pos_i]),
            "driverId": driver_id,
            "constructorId": team_id,
            "number": number,
            "q1": parse_lap_time(row[q1_i]),
            "q2": parse_lap_time(row[q2_i]),
            "q3": parse_lap_time(row[q3_i]),
        })
    return result


def _fetch(client: httpx.Client, url: str) -> str:
    response = client.get(url)
    response.raise_for_status()
    return response.text


def import_official_results(force: bool = False) -> dict:
    races = pd.read_parquet(PROCESSED_DIR / "races.parquet")
    results = pd.read_parquet(PROCESSED_DIR / "results.parquet", columns=["season", "round"])
    missing = set(zip(results["season"], results["round"]))
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=3)
    candidates = []
    for key in TARGETS:
        scheduled = races[(races["season"] == key[0]) & (races["round"] == key[1])]
        if key not in missing and not scheduled.empty and scheduled.iloc[0]["raceUtc"] < cutoff:
            candidates.append(key)
    existing = {"races": []}
    if CACHE_PATH.exists():
        existing = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    cached_races = {(entry["season"], entry["round"]): entry for entry in existing.get("races", [])}
    cached_keys = set(cached_races)
    generated_at = datetime.fromisoformat(existing["generatedAt"]) if existing.get("generatedAt") else None
    cache_is_fresh = generated_at is not None and datetime.now(timezone.utc) - generated_at < CACHE_MAX_AGE
    fetch_keys = [key for key in candidates if force or key not in cached_keys or not cache_is_fresh]
    if not fetch_keys:
        reason = "cache is current" if candidates else "no eligible missing race results"
        return {"written": False, "races": len(cached_keys), "reason": reason}
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    new_entries = [entry for entry in existing.get("races", []) if (entry["season"], entry["round"]) not in fetch_keys]
    with httpx.Client(headers={"User-Agent": "Mozilla/5.0 F1nsight official-results importer"}, timeout=45) as client:
        for season, round_number in fetch_keys:
            urls = TARGETS[(season, round_number)]
            race_headers, race_table = parse_table(_fetch(client, urls["race"]))
            qualifying_headers, qualifying_table = parse_table(_fetch(client, urls["qualifying"]))
            race_rows = build_race_rows(race_headers, race_table, season)
            qualifying_rows = build_qualifying_rows(qualifying_headers, qualifying_table, season)
            if len(race_rows) != 22 or len(qualifying_rows) != 22:
                raise ValueError(f"Expected 22 race and qualifying rows, received {len(race_rows)} and {len(qualifying_rows)}")
            new_entries.append({
                "season": season,
                "round": round_number,
                "results": race_rows,
                "qualifying": qualifying_rows,
                "sources": {"race": urls["race"], "qualifying": urls["qualifying"]},
            })
    payload = {"source": "Formula 1", "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "races": sorted(new_entries, key=lambda row: (row["season"], row["round"]))}
    temp_path = CACHE_PATH.with_suffix(".json.tmp")
    temp_path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    temp_path.replace(CACHE_PATH)
    return {"written": True, "races": len(new_entries), "imported": [f"{year}-R{rnd}" for year, rnd in fetch_keys], "rows": {"race": len(race_rows), "qualifying": len(qualifying_rows)}}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    print(f"RESULT {json.dumps(import_official_results(args.force), separators=(',', ':'))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
