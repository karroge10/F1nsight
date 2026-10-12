"""Small rate limited client for the Jolpica-F1 Ergast compatible API.

Jolpica allows roughly 4 requests per second and 500 per hour for anonymous use, so every
request goes through one throttle and 429 responses are retried with backoff.
"""

from __future__ import annotations

import time
from collections import deque

import httpx

BASE_URL = "https://api.jolpi.ca/ergast/f1"
PAGE_LIMIT = 100
MIN_INTERVAL_S = 0.5
HOURLY_BUDGET = 450
MAX_RETRIES = 6


class JolpicaClient:
    """Fetches Ergast format JSON, merging paginated responses into one list."""

    def __init__(self) -> None:
        self._http = httpx.Client(timeout=60, headers={"User-Agent": "f1nsight-pipeline"})
        self._sent: deque[float] = deque()
        self.request_count = 0

    def close(self) -> None:
        self._http.close()

    def get_races(self, path: str, list_key: str | None = None) -> list[dict]:
        """Return MRData.RaceTable.Races for `path`, following pagination.

        When `list_key` is given (e.g. "Laps", "Results"), the per race lists of every page are
        concatenated so the caller receives each race once with its complete list.
        """
        merged: dict[str, dict] = {}
        offset = 0
        while True:
            payload = self.get_json(path, offset)
            mr_data = payload["MRData"]
            races = mr_data.get("RaceTable", {}).get("Races", [])
            for race in races:
                _merge_race(merged, race, list_key)
            total = int(mr_data.get("total", 0))
            offset += PAGE_LIMIT
            if offset >= total:
                break
        return list(merged.values())

    def get_standings(self, path: str) -> list[dict]:
        """Return MRData.StandingsTable.StandingsLists for `path` (single page is enough)."""
        payload = self.get_json(path, 0)
        standings_table = payload["MRData"].get("StandingsTable", {})
        return standings_table.get("StandingsLists", [])

    def get_json(self, path: str, offset: int) -> dict:
        url = f"{BASE_URL}/{path}.json"
        params = {"limit": PAGE_LIMIT, "offset": offset}
        for attempt in range(MAX_RETRIES):
            self._throttle()
            response = self._http.get(url, params=params)
            self.request_count += 1
            if response.status_code == 200:
                return response.json()
            if response.status_code in (429, 500, 502, 503, 504):
                wait_s = _retry_wait(response, attempt)
                print(f"  jolpica {response.status_code} on {path}, waiting {wait_s:.0f}s")
                time.sleep(wait_s)
                continue
            response.raise_for_status()
        raise RuntimeError(f"Jolpica request kept failing: {url} offset={offset}")

    def _throttle(self) -> None:
        now = time.monotonic()
        while self._sent and now - self._sent[0] > 3600:
            self._sent.popleft()
        if len(self._sent) >= HOURLY_BUDGET:
            wait_s = 3600 - (now - self._sent[0]) + 1
            print(f"  hourly request budget reached, sleeping {wait_s:.0f}s")
            time.sleep(wait_s)
        if self._sent:
            since_last = time.monotonic() - self._sent[-1]
            if since_last < MIN_INTERVAL_S:
                time.sleep(MIN_INTERVAL_S - since_last)
        self._sent.append(time.monotonic())


def _merge_race(merged: dict[str, dict], race: dict, list_key: str | None) -> None:
    key = f"{race['season']}-{race['round']}"
    if key not in merged:
        merged[key] = race
        return
    if list_key is None:
        return
    existing = merged[key]
    existing_items = existing.setdefault(list_key, [])
    new_items = race.get(list_key, [])
    if list_key == "Laps":
        _merge_laps(existing_items, new_items)
        return
    existing_items.extend(new_items)


def _merge_laps(existing_laps: list[dict], new_laps: list[dict]) -> None:
    """A lap can be split across two pages; join its Timings instead of duplicating it."""
    by_number = {lap["number"]: lap for lap in existing_laps}
    for lap in new_laps:
        if lap["number"] in by_number:
            by_number[lap["number"]]["Timings"].extend(lap["Timings"])
            continue
        existing_laps.append(lap)
        by_number[lap["number"]] = lap


def _retry_wait(response: httpx.Response, attempt: int) -> float:
    retry_after = response.headers.get("Retry-After")
    if retry_after and retry_after.isdigit():
        return float(retry_after) + 1
    return min(5 * 2**attempt, 300)
