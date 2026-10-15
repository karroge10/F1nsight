"""Download historical OpenF1 data to data/raw/openf1/<season>/...

Run from pipeline:
    uv run python -m f1p.openf1.download [--seasons 2023 2024 2025 2026] [--refresh]
"""

import argparse
import json
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

from f1p.paths import raw_dir

BASE_URL = "https://api.openf1.org/v1"
USER_AGENT = "f1nsight-pipeline/2.0 (personal non-commercial stats project; historical data only)"
DEFAULT_SEASONS = [2023, 2024, 2025, 2026]
# Free tier: 3 req/s and 30 req/min. 2.1 s between requests keeps us under both.
REQUEST_INTERVAL_S = 2.1
MAX_RETRIES = 6
# Data counts as live (paid) until 30 minutes after a session ends.
LIVE_GRACE = timedelta(minutes=45)
# With --refresh, meetings whose last session ended within this window are fetched again.
REFRESH_WINDOW = timedelta(days=14)

SEASON_ENDPOINTS = ["meetings", "sessions"]
# Fetched once per meeting (meeting_key filter) and split into per-session files.
MEETING_ENDPOINTS = [
    "drivers",
    "stints",
    "pit",
    "race_control",
    "weather",
    "team_radio",
    "starting_grid",
    "session_result",
]
# Fetched per session, Race and Sprint sessions only.
RACE_ENDPOINTS = [
    "overtakes",
    "intervals",
    "position",
    "championship_drivers",
    "championship_teams",
]
RACE_SESSION_TYPES = {"Race"}

_last_request_at = 0.0


def main() -> None:
    args = _parse_args()
    root = raw_dir("openf1")
    now = datetime.now(timezone.utc)
    with httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=120) as client:
        for season in args.seasons:
            is_current = season == now.year
            refresh = args.refresh and is_current
            download_season(client, root, season, now, refresh)


def download_season(client: httpx.Client, root: Path, season: int, now: datetime, refresh: bool) -> None:
    season_dir = root / str(season)
    season_dir.mkdir(parents=True, exist_ok=True)
    for endpoint in SEASON_ENDPOINTS:
        target = season_dir / f"{endpoint}.json"
        if target.exists() and not refresh:
            continue
        rows = fetch(client, endpoint, {"year": season})
        _write_json(target, rows)

    sessions_path = season_dir / "sessions.json"
    sessions = json.loads(sessions_path.read_text(encoding="utf-8"))
    finished = [s for s in sessions if _is_finished(s, now)]
    by_meeting: dict[int, list[dict]] = {}
    for session in finished:
        by_meeting.setdefault(session["meeting_key"], []).append(session)

    for meeting_key, meeting_sessions in sorted(by_meeting.items()):
        refresh_meeting = refresh and _ended_recently(meeting_sessions, now)
        download_meeting(client, season_dir, meeting_key, meeting_sessions, refresh_meeting)
    print(f"[{season}] done: {len(finished)} finished sessions in {len(by_meeting)} meetings", flush=True)


def download_meeting(
    client: httpx.Client, season_dir: Path, meeting_key: int, sessions: list[dict], refresh: bool
) -> None:
    for endpoint in MEETING_ENDPOINTS:
        targets = {s["session_key"]: season_dir / str(s["session_key"]) / f"{endpoint}.json" for s in sessions}
        all_present = all(t.exists() for t in targets.values())
        if all_present and not refresh:
            continue
        rows = fetch(client, endpoint, {"meeting_key": meeting_key})
        for session_key, target in targets.items():
            session_rows = [r for r in rows if r.get("session_key") == session_key]
            _write_json(target, session_rows)

    race_sessions = [s for s in sessions if s["session_type"] in RACE_SESSION_TYPES]
    for session in race_sessions:
        session_dir = season_dir / str(session["session_key"])
        for endpoint in RACE_ENDPOINTS:
            target = session_dir / f"{endpoint}.json"
            if target.exists() and not refresh:
                continue
            rows = fetch(client, endpoint, {"session_key": session["session_key"]})
            _write_json(target, rows)
    print(f"  meeting {meeting_key}: {len(sessions)} sessions ok", flush=True)


def fetch(client: httpx.Client, endpoint: str, params: dict) -> list[dict]:
    """GET one endpoint with rate limiting and retries. 404 'No results' means empty."""
    url = f"{BASE_URL}/{endpoint}"
    for attempt in range(MAX_RETRIES):
        _throttle()
        try:
            response = client.get(url, params=params)
        except httpx.TransportError as exc:
            _backoff(attempt, f"{endpoint} {params}: {exc}")
            continue
        if response.status_code == 404:
            return []
        if response.status_code == 429 or response.status_code >= 500:
            _backoff(attempt, f"{endpoint} {params}: HTTP {response.status_code}")
            continue
        response.raise_for_status()
        return response.json()
    raise RuntimeError(f"giving up on {endpoint} {params}")


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Download historical OpenF1 data")
    parser.add_argument("--seasons", type=int, nargs="+", default=DEFAULT_SEASONS)
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="refetch current-season meetings/sessions lists and meetings that ended recently",
    )
    return parser.parse_args()


def _is_finished(session: dict, now: datetime) -> bool:
    if session.get("is_cancelled"):
        return False
    end = datetime.fromisoformat(session["date_end"])
    return end + LIVE_GRACE < now


def _ended_recently(sessions: list[dict], now: datetime) -> bool:
    ends = [datetime.fromisoformat(s["date_end"]) for s in sessions]
    last_end = max(ends)
    return now - last_end < REFRESH_WINDOW


def _throttle() -> None:
    global _last_request_at
    wait = REQUEST_INTERVAL_S - (time.monotonic() - _last_request_at)
    if wait > 0:
        time.sleep(wait)
    _last_request_at = time.monotonic()


def _backoff(attempt: int, reason: str) -> None:
    delay = min(5 * 2**attempt, 120)
    print(f"  retry {attempt + 1}/{MAX_RETRIES} in {delay}s ({reason})", flush=True)
    time.sleep(delay)


def _write_json(path: Path, rows: list[dict]) -> None:
    """Write atomically; leave the file (and its mtime) alone when the content is unchanged,
    so later steps can tell from modification times whether a refresh brought anything new."""
    text = json.dumps(rows, ensure_ascii=False)
    if path.exists() and path.read_text(encoding="utf-8") == text:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


if __name__ == "__main__":
    main()
