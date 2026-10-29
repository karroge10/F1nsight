"""Download the public JSON feeds of the official F1 Fantasy game (current season only).

The game front end (fantasy.formula1.com) reads unauthenticated, CDN-cached feeds:

- feeds/schedule/raceday_en.json         sessions of every gameday (race weekend)
- feeds/limits/constraints.json          current gameday, deadline, budget
- feeds/drivers/<gameday>_en.json        every driver and constructor with price
                                         (Value, OldPlayerValue), gameday points,
                                         session points, selection %, season stats
- feeds/popup/playerstats_<id>.json      per gameday, per session points breakdown
                                         (overtakes, positions gained, DOTD, pit stops...)
- feeds/translations/web/en.json         UI strings incl. the official game rules text

The feeds only cover the running season; past seasons are not served any more.
"""

import argparse
import json

from f1p.fantasy.leader import refresh_leader
from f1p.fantasy.http import get_bytes, get_json, save_bytes, save_json
from f1p.paths import raw_dir

FEEDS = "https://fantasy.formula1.com/feeds"
# Completed gamedays are re-fetched this many gamedays back, because the game
# applies stewards' post-race penalties and corrections a few days later.
REFRESH_COMPLETED_GAMEDAYS = 2


def fetch_current_season(force: bool = False) -> dict:
    """Fetch every public feed of the running season; return a small summary.

    Idempotent: finished gamedays already on disk are skipped, except the last
    REFRESH_COMPLETED_GAMEDAYS ones and the upcoming one, which always refresh.
    """
    schedule = get_json(f"{FEEDS}/schedule/raceday_en.json")
    constraints = get_json(f"{FEEDS}/limits/constraints.json")
    season = _season_of(schedule)
    out = raw_dir("fantasy") / "official" / str(season)
    save_json(out / "raceday_en.json", schedule)
    save_json(out / "constraints.json", constraints)

    leader = refresh_leader(constraints, schedule)
    current_gameday = constraints["Data"]["Value"]["GamedayId"]
    fetched = _fetch_gameday_feeds(out, current_gameday, force)
    player_ids = _player_ids(out, current_gameday)
    _fetch_player_stats(out, player_ids)
    _fetch_rules_text(out)
    return {
        "season": season,
        "currentGameday": current_gameday,
        "leader": leader,
        "gamedayFeedsFetched": fetched,
        "players": len(player_ids),
        "dir": str(out),
    }


def gameday_feed_path(season: int, gameday: int):
    return raw_dir("fantasy") / "official" / str(season) / "drivers" / f"gd_{gameday:02d}.json"


def _fetch_gameday_feeds(out, current_gameday: int, force: bool) -> list[int]:
    fetched = []
    refresh_from = current_gameday - REFRESH_COMPLETED_GAMEDAYS
    for gameday in range(1, current_gameday + 1):
        path = out / "drivers" / f"gd_{gameday:02d}.json"
        if path.exists() and gameday < refresh_from and not force:
            continue
        payload = get_json(f"{FEEDS}/drivers/{gameday}_en.json")
        if payload is None:
            continue
        save_json(path, payload)
        fetched.append(gameday)
    return fetched


def _player_ids(out, current_gameday: int) -> list[str]:
    """Union of player ids over every gameday feed (reserves appear mid-season)."""
    ids: dict[str, None] = {}
    for gameday in range(1, current_gameday + 1):
        path = out / "drivers" / f"gd_{gameday:02d}.json"
        if not path.exists():
            continue
        payload = _read_json(path)
        for player in payload["Data"]["Value"]:
            ids[str(player["PlayerId"])] = None
    return list(ids)


def _fetch_player_stats(out, player_ids: list[str]) -> None:
    """Per player breakdowns are cumulative for the season, so always refresh them."""
    for player_id in player_ids:
        payload = get_json(f"{FEEDS}/popup/playerstats_{player_id}.json")
        if payload is None:
            continue
        save_json(out / "playerstats" / f"{player_id}.json", payload)


def _fetch_rules_text(out) -> None:
    """The rules page text lives in the UI translation feed (keys rules_*, qr_*, con_*)."""
    body = get_bytes(f"{FEEDS}/translations/web/en.json")
    if body is not None:
        save_bytes(out / "translations_en.json", body)


def _season_of(schedule: dict) -> int:
    first = schedule["Data"]["Value"][0]
    return int(first["Season"])


def _read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--force", action="store_true", help="re-fetch every gameday feed")
    args = parser.parse_args()
    summary = fetch_current_season(force=args.force)
    print(summary)


if __name__ == "__main__":
    main()
