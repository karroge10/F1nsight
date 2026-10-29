import math
import httpx
from datetime import datetime, timezone
from urllib.parse import unquote

from f1p.fantasy.http import get_json, save_json
from f1p.paths import SERVE_DIR

URL = "https://fantasy.formula1.com/feeds/leaderboard/public/global/list_1_0_1.json"


def leader_snapshot(board, constraints, schedule):
    gameday = int(constraints["Data"]["Value"]["LPTourGamedayId"])
    race = next((r for r in schedule["Data"]["Value"] if int(r["GamedayId"]) == gameday), None)
    rows = board.get("Value", {}).get("leaderboard", [])
    leaders = [r for r in rows if int(r.get("cur_rank", 0)) == 1]
    if race is None or not leaders:
        return None
    leader = max(leaders, key=lambda r: float(r["cur_points"]))
    points = float(leader["cur_points"])
    if not math.isfinite(points) or points < 0:
        return None
    feed_time = board.get("FeedTime", {}).get("UTCTime")
    updated = datetime.strptime(feed_time, "%m/%d/%Y %I:%M:%S %p").replace(tzinfo=timezone.utc).isoformat() if feed_time else None
    return {"season": int(race["Season"]), "round": int(race["MeetingNumber"]), "gameday": gameday,
            "points": points, "team": unquote(leader.get("team_name", "")), "source": URL,
            "sourceUpdatedAt": updated, "fetchedAt": datetime.now(timezone.utc).isoformat()}


def refresh_leader(constraints, schedule):
    try:
        board = get_json(URL)
        snapshot = leader_snapshot(board, constraints, schedule) if board else None
    except (ValueError, KeyError, TypeError, OSError, RuntimeError, httpx.HTTPError) as error:
        return {"status": "unavailable", "reason": str(error)}
    if snapshot is None:
        return {"status": "unavailable"}
    save_json(SERVE_DIR / "fantasy_leader.json", snapshot)
    return {"status": "updated", "season": snapshot["season"], "round": snapshot["round"], "points": snapshot["points"]}
