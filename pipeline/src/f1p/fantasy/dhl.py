"""Download DHL Fastest Pit Stop Award data (free, public): stationary pit stop times.

The fantasy constructor pit stop points use the official stationary time of a team's
fastest stop (DHL timing). OpenF1 only has `stop_duration` for a few sessions, so this
module reads the JSON the public award pages (inmotion.dhl/en/formula-1/fastest-pit-stop-award)
load:

- /api/f1-award-element-data/<event_info id>?event=<event id>   the 10 fastest stops of a race
- /api/f1-award-element-data/<season_average id>                 every team's average stop
                                                                 time per race, plus the event list

Teams outside a race's top 10 only have their average stop time, which is an upper
bound for their fastest stop; `build_pitstops` then estimates the fastest stop as the
midpoint between the race's 10th fastest stop (lower bound) and that average.

`build_pitstops` writes data/processed/fantasy_pitstops.parquet: season, round,
constructorId, fastestStop, exact (True when the stop is in DHL's top 10), raceFastest.
"""

import argparse
import json

import pandas as pd

from f1p.fantasy import idmap
from f1p.fantasy.http import get_json, save_json
from f1p.paths import processed_path, raw_dir

API = "https://inmotion.dhl/api/f1-award-element-data"
# Element ids per season page: (event_info, season_average).
ELEMENTS = {
    2023: (6282, 6284),
    2024: (6273, 6276),
    2025: (6365, 6367),
    2026: (7373, 7375),
}


def fetch_all(seasons: tuple[int, ...] = tuple(ELEMENTS), refresh_current: bool = True) -> dict:
    """Fetch every season; finished events on disk are skipped. Returns events per season."""
    newest = max(ELEMENTS)
    summary = {}
    for season in seasons:
        refresh = refresh_current and season == newest
        summary[season] = fetch_season(season, refresh)
    return summary


def fetch_season(season: int, refresh: bool = False) -> int:
    event_element, average_element = ELEMENTS[season]
    out = raw_dir("fantasy") / "dhl" / str(season)
    averages_path = out / "season_average.json"
    if refresh or not averages_path.exists():
        averages = get_json(f"{API}/{average_element}")
        save_json(averages_path, averages)
    averages = _read(averages_path)
    events = averages["data"]["chart"]["events"]
    saved = 0
    for event in events:
        path = out / f"event_{event['id']}.json"
        if path.exists() and not refresh:
            saved += 1
            continue
        payload = get_json(f"{API}/{event_element}", {"event": event["id"]})
        if payload is None:
            continue
        save_json(path, payload)
        saved += 1
    return saved


def build_pitstops() -> pd.DataFrame:
    """Team fastest stationary stop per race from the downloaded DHL files."""
    races_path = processed_path("races")
    races = pd.read_parquet(races_path)
    rows = []
    for season in ELEMENTS:
        season_dir = raw_dir("fantasy") / "dhl" / str(season)
        averages_path = season_dir / "season_average.json"
        if not averages_path.exists():
            continue
        chart = _read(averages_path)["data"]["chart"]
        constructor_ids = idmap.season_constructors(season)
        for event in chart["events"]:
            event_path = season_dir / f"event_{event['id']}.json"
            if not event_path.exists():
                continue
            stops = _read(event_path)["data"]["chart"]
            round_number = _round_for(races, season, event["date"]["date"])
            if not stops or round_number is None:
                continue
            event_rows = _event_rows(season, round_number, event["id"], stops, chart, constructor_ids)
            rows.extend(event_rows)
    frame = pd.DataFrame(rows)
    path = processed_path("fantasy_pitstops")
    frame.to_parquet(path, index=False)
    return frame


def _event_rows(season, round_number, event_id, stops, chart, constructor_ids) -> list[dict]:
    durations = [stop["duration"] for stop in stops]
    race_fastest = min(durations)
    tenth = max(durations)
    best: dict[str, float] = {}
    for stop in stops:
        team, _ = idmap.match_constructor(constructor_ids, stop["team"])
        if team is not None and stop["duration"] < best.get(team, float("inf")):
            best[team] = stop["duration"]
    rows = []
    for value in chart["values"]:
        team, _ = idmap.match_constructor(constructor_ids, value["team_name"])
        if team is None:
            continue
        average = value["duration"].get(str(event_id))
        exact = team in best
        if exact:
            fastest = best[team]
        elif average is None:
            fastest = None
        else:
            fastest = (tenth + max(average, tenth)) / 2
        rows.append({
            "season": season, "round": round_number, "constructorId": team,
            "fastestStop": fastest, "exact": exact, "averageStop": average,
            "raceFastest": race_fastest, "dhlEventId": event_id,
        })
    return rows


def _round_for(races: pd.DataFrame, season: int, event_date: str) -> int | None:
    """DHL event date (race day) -> round, nearest race date within 2 days."""
    season_races = races[races["season"] == season]
    day = pd.Timestamp(event_date[:10])
    race_days = pd.to_datetime(season_races["date"])
    gap = (race_days - day).abs()
    if gap.empty:
        return None
    best = gap.idxmin()
    if gap.loc[best] > pd.to_timedelta(2, unit="D"):
        return None
    return int(season_races.loc[best, "round"])


def _read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--no-refresh", action="store_true",
                        help="do not re-fetch the current season's events")
    args = parser.parse_args()
    summary = fetch_all(refresh_current=not args.no_refresh)
    pitstops = build_pitstops()
    print(summary, "pitstop rows:", len(pitstops))


if __name__ == "__main__":
    main()
