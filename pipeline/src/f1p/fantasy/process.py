"""Build processed fantasy tables from data/raw/fantasy.

Outputs (data/processed/):
- fantasy_prices.parquet   one row per season, round, asset: price going into the
                           round, price after it, change, selection %
- fantasy_points.parquet   one row per season, round, asset: total, qualifying /
                           sprint / race points and breakdown columns where known
- id_map_fantasy.parquet   fantasy asset -> driverId / constructorId per season

Sources by season: 2026 (running season) official feeds; 2023 to 2025 community
round files (mzafram2001/f1-fantasy) plus per round stat deltas derived from Wayback
snapshots of the official feed; 2021 and 2022 old game price snapshots.
"""

import json
import re
from pathlib import Path

import pandas as pd

from f1p.fantasy import idmap
from f1p.paths import processed_path, raw_dir

BREAKDOWN_EVENTS = {
    ("Qualifying", "Qualifying Position"): "q_position",
    ("Qualifying", "QF not classified"): "q_nc",
    ("Qualifying", "DQ Qualifying"): "q_dsq",
    ("Qualifying", "No Driver Q2"): "q_progression",
    ("Qualifying", "One Driver Q2"): "q_progression",
    ("Qualifying", "Both Driver Q2"): "q_progression",
    ("Qualifying", "One Driver Q3"): "q_progression",
    ("Qualifying", "Both Driver Q3"): "q_progression",
    ("Sprint", "Sprint Position"): "s_position",
    ("Sprint", "Sprint position gained"): "s_gained",
    ("Sprint", "Sprint Position lost"): "s_lost",
    ("Sprint", "Sprint overtake bonus"): "s_overtakes",
    ("Sprint", "Sprint Fastest lap"): "s_fastest_lap",
    ("Sprint", "Sprint Not Classified"): "s_nc",
    ("Sprint", "DQ Sprint"): "s_dsq",
    ("Race", "Race Position"): "r_position",
    ("Race", "Race position gained"): "r_gained",
    ("Race", "Race Position lost"): "r_lost",
    ("Race", "race overtake bonus"): "r_overtakes",
    ("Race", "Race Fastest lap"): "r_fastest_lap",
    ("Race", "Driver Of Day"): "r_dotd",
    ("Race", "Race not classified"): "r_nc",
    ("Race", "DQ Race"): "r_dsq",
    ("Race", "Fastest Pitstop"): "pit_band",
    ("Race", "2nd Fastest Pitstop"): "pit_fastest",
    ("Race", "World Record"): "pit_world_record",
}
BREAKDOWN_COLUMNS = sorted(set(BREAKDOWN_EVENTS.values())) + ["other"]
# mzafram2001/f1-fantasy renames these official constructor codes.
COMMUNITY_CODE_OVERRIDES = {"RBR": "RED", "RBS": "VRB"}
WAYBACK_STATS = {
    "overtaking_pts": "wb_overtakes",
    "dotd_pts": "wb_dotd",
    "fastest_lap_pts": "wb_fastest_lap",
    "total_position_gained_lost": "wb_gained_lost",
    "total_dnf_dq_pts": "wb_nc_dsq",
}


def build_all() -> dict:
    """Rebuild every processed fantasy table; returns row counts."""
    official = _official_frames()
    community = _community_frames()
    wayback = _wayback_deltas()
    legacy_prices = _legacy_prices()

    official_seasons = set(official["prices"]["season"])
    community_prices = community["prices"][~community["prices"]["season"].isin(official_seasons)]
    community_points = community["points"][~community["points"]["season"].isin(official_seasons)]
    community_points = community_points.merge(
        wayback, on=["season", "round", "kind", "fantasyCode"], how="left")

    prices = _concat([official["prices"], community_prices, legacy_prices])
    points = _concat([official["points"], community_points])
    prices = _add_price_changes(prices)
    id_map = _build_id_map(prices)
    prices = _attach_ids(prices, id_map)
    points = _attach_ids(points, id_map)
    points = _attach_price(points, prices)

    prices = prices.sort_values(["season", "round", "kind", "fantasyCode"]).reset_index(drop=True)
    points = points.sort_values(["season", "round", "kind", "fantasyCode"]).reset_index(drop=True)
    prices_path = processed_path("fantasy_prices")
    points_path = processed_path("fantasy_points")
    id_map_path = processed_path("id_map_fantasy")
    prices.to_parquet(prices_path, index=False)
    points.to_parquet(points_path, index=False)
    id_map.to_parquet(id_map_path, index=False)
    unmatched = id_map[id_map["driverId"].isna() & id_map["constructorId"].isna()]
    return {
        "fantasy_prices": len(prices),
        "fantasy_points": len(points),
        "id_map_fantasy": len(id_map),
        "unmatched_assets": unmatched[["season", "kind", "fantasyName"]].values.tolist(),
    }


# ----------------------------------------------------------------------------- official


def _official_frames() -> dict:
    price_rows, point_rows = [], []
    base = raw_dir("fantasy") / "official"
    for season_dir in sorted(p for p in base.iterdir() if p.is_dir()):
        season = int(season_dir.name)
        stats = _official_breakdowns(season_dir)
        played = _played_gamedays(season_dir)
        for feed in sorted((season_dir / "drivers").glob("gd_*.json")):
            gameday = int(feed.stem.split("_")[1])
            for asset in _read(feed)["Data"]["Value"]:
                price_row = _official_price_row(season, gameday, asset)
                price_rows.append(price_row)
                if gameday in played:
                    player_key = (str(asset["PlayerId"]), gameday)
                    breakdown = stats.get(player_key, {})
                    point_row = _official_point_row(season, gameday, asset, breakdown)
                    point_rows.append(point_row)
    return {"prices": pd.DataFrame(price_rows), "points": pd.DataFrame(point_rows)}


def _official_price_row(season: int, gameday: int, asset: dict) -> dict:
    kind = "driver" if asset["PositionName"] == "DRIVER" else "constructor"
    team = asset["TeamName"] if kind == "driver" else asset["FUllName"]
    return {
        "season": season,
        "round": gameday,
        "kind": kind,
        "fantasyId": str(asset["PlayerId"]),
        "fantasyCode": asset.get("DriverTLA") or None,
        "fantasyName": asset["FUllName"],
        "fantasyTeam": team,
        "price": float(asset["Value"]),
        "oldPrice": float(asset["OldPlayerValue"]),
        "selectedPct": _num(asset.get("SelectedPercentage")),
        "captainPct": _num(asset.get("CaptainSelectedPercentage")),
        "active": str(asset.get("IsActive")) == "1",
        "source": "official",
    }


def _official_point_row(season: int, gameday: int, asset: dict, breakdown: dict) -> dict:
    kind = "driver" if asset["PositionName"] == "DRIVER" else "constructor"
    sessions = {"Qualifying": 0.0, "Sprint": 0.0, "Race": 0.0}
    for session in asset.get("SessionWisePoints") or []:
        name = _session_name(session["sessiontype"])
        sessions[name] += _num(session.get("points")) or 0.0
    if breakdown:
        # The per gameday feed keeps stale session splits after corrections (Monaco
        # 2026); the breakdown feed is authoritative.
        sessions = {name: breakdown.get(f"_total_{name}", 0.0) for name in sessions}
    row = {
        "season": season,
        "round": gameday,
        "kind": kind,
        "fantasyId": str(asset["PlayerId"]),
        "fantasyCode": asset.get("DriverTLA") or None,
        "fantasyName": asset["FUllName"],
        "points": _num(asset.get("GamedayPoints")) or 0.0,
        "qualiPoints": sessions["Qualifying"],
        "sprintPoints": sessions["Sprint"],
        "racePoints": sessions["Race"],
        "active": str(asset.get("IsActive")) == "1",
        "breakdownSource": "official" if breakdown else None,
        "source": "official",
    }
    for column in BREAKDOWN_COLUMNS:
        row[column] = breakdown.get(column)
    row["qualiPosition"] = breakdown.get("_quali_position")
    row["sprintPosition"] = breakdown.get("_sprint_position")
    row["racePosition"] = breakdown.get("_race_position")
    return row


def _official_breakdowns(season_dir: Path) -> dict:
    """(playerId, gameday) -> {column: points, '_race_position': 6, ...}."""
    result = {}
    for path in sorted((season_dir / "playerstats").glob("*.json")):
        value = _read(path)["Value"]
        player_id = str(value["PlayerId"])
        for gameday in value.get("MatchWiseStats") or []:
            columns: dict = {}
            for session in gameday.get("RaceDayWise") or []:
                session_name = _session_name(session["SessionType"])
                for event in session.get("StatsWise") or []:
                    _add_event(columns, session_name, event)
            result[(player_id, gameday["GamedayId"])] = columns
    return result


def _add_event(columns: dict, session_name: str, event: dict) -> None:
    name = event["Event"].strip()
    if name == "Total":
        return
    total_key = f"_total_{session_name}"
    columns[total_key] = columns.get(total_key, 0.0) + event["Value"]
    column = BREAKDOWN_EVENTS.get((session_name, name), "other")
    columns[column] = (columns.get(column) or 0) + event["Value"]
    position_key = {"q_position": "_quali_position", "s_position": "_sprint_position",
                    "r_position": "_race_position"}.get(column)
    if position_key is not None:
        digits = re.sub(r"\D", "", str(event.get("Frequency")))
        columns[position_key] = int(digits) if digits else None


def _played_gamedays(season_dir: Path) -> set[int]:
    """Gamedays whose race has finished (MatchStatus 4 on the race session)."""
    schedule = _read(season_dir / "raceday_en.json")["Data"]["Value"]
    played = set()
    for session in schedule:
        if session["SessionType"] == "Race" and str(session.get("MatchStatus")) == "4":
            played.add(int(session["GamedayId"]))
    return played


def _session_name(session_type: str) -> str:
    """The feeds call the sprint race 'Sprint Qualifying'."""
    if session_type.startswith("Sprint"):
        return "Sprint"
    if session_type.startswith("Qualifying"):
        return "Qualifying"
    return "Race"


# ---------------------------------------------------------------------------- community


def _community_frames() -> dict:
    price_rows, point_rows = [], []
    base = raw_dir("fantasy") / "community" / "mzafram2001_f1-fantasy"
    for path in sorted(base.glob("*/round_*.json")):
        payload = _read(path)
        season = int(payload["Meta"]["season"])
        round_number = int(payload["Meta"]["race_id"])
        for kind, key, code_key, name_key in (("driver", "Drivers", "Driver_Code", "Driver_Name"),
                                              ("constructor", "Teams", "Team_Code", "Team_Name")):
            for asset in payload[key]:
                common = {
                    "season": season,
                    "round": round_number,
                    "kind": kind,
                    "fantasyId": None,
                    "fantasyCode": asset[code_key],
                    "fantasyName": asset[name_key],
                    "source": "mzafram2001/f1-fantasy",
                }
                team = asset.get("Team_Name")
                price_rows.append({**common, "fantasyTeam": team, "price": asset["Value"],
                                   "oldPrice": None,
                                   "selectedPct": asset["Selected_Percentage"] * 100,
                                   "captainPct": None, "active": True})
                point_rows.append({**common, "points": asset["Round_Fantasy_Points"],
                                   "qualiPoints": asset["Qualifying_Points"],
                                   "sprintPoints": asset["Sprint_Points"],
                                   "racePoints": asset["Race_Points"], "active": True,
                                   "breakdownSource": None})
    return {"prices": pd.DataFrame(price_rows), "points": pd.DataFrame(point_rows)}


def _wayback_deltas() -> pd.DataFrame:
    """Per round stat deltas from cumulative AdditionalStats in Wayback snapshots.

    A snapshot taken before gameday g's deadline holds the season totals through
    round g-1, so stats(g+1) - stats(g) is round g. Only consecutive pairs are used.
    """
    base = raw_dir("fantasy") / "wayback"
    rows = []
    for season_dir in sorted(p for p in base.iterdir() if p.is_dir()):
        season = int(season_dir.name)
        snapshots = _earliest_pre_race_snapshots(season_dir)
        for gameday, totals in snapshots.items():
            following = snapshots.get(gameday + 1)
            if following is None:
                continue
            for key, before in totals.items():
                after = following.get(key)
                if after is None:
                    continue
                row = {"season": season, "round": gameday, "kind": key[0], "fantasyCode": key[1]}
                for stat, column in WAYBACK_STATS.items():
                    row[column] = after[stat] - before[stat]
                rows.append(row)
    columns = ["season", "round", "kind", "fantasyCode", *WAYBACK_STATS.values()]
    return pd.DataFrame(rows, columns=columns)


def _earliest_pre_race_snapshots(season_dir: Path) -> dict:
    """gameday -> {(kind, code): AdditionalStats} from the earliest snapshot of each gameday."""
    chosen: dict[int, Path] = {}
    for path in sorted(season_dir.glob("gd_*.json")):
        parts = path.stem.split("_")
        gameday = int(parts[1])
        month = int(parts[2][4:6])
        if month == 1 or (month == 2 and gameday > 3):
            continue  # off-season capture of the previous season's final feed
        chosen.setdefault(gameday, path)
    result = {}
    for gameday, path in chosen.items():
        try:
            assets = _read(path)["Data"]["Value"]
        except (ValueError, KeyError):
            continue
        if any(_num(a.get("GamedayPoints")) for a in assets):
            continue  # taken after the race was scored: not a clean pre-race total
        totals = {}
        for asset in assets:
            stats = asset.get("AdditionalStats")
            if not stats:
                continue
            kind = "driver" if asset["PositionName"] == "DRIVER" else "constructor"
            code = _community_code(asset)
            totals[(kind, code)] = stats
        result[gameday] = totals
    return result


def _community_code(asset: dict) -> str:
    """Code used by the community round files for an official feed asset."""
    code = asset.get("DriverTLA")
    if code:
        return COMMUNITY_CODE_OVERRIDES.get(code, code)
    return _team_code(asset["FUllName"])


def _team_code(team_name: str) -> str:
    """Community files use 3 letter team codes; map the official team names onto them."""
    codes = {"alfa romeo": "ALF", "alpine": "ALP", "alphatauri": "ALT", "aston martin": "AST",
             "ferrari": "FER", "haas f1 team": "HAA", "kick sauber": "KCK", "mclaren": "MCL",
             "mercedes": "MER", "red bull racing": "RED", "racing bulls": "VRB",
             "williams": "WIL", "audi": "AUD", "cadillac": "CAD"}
    return codes.get(team_name.strip().lower(), team_name)


def _legacy_prices() -> pd.DataFrame:
    """2021/2022 old game: one row per asset per race, the last snapshot before qualifying."""
    base = raw_dir("fantasy") / "community" / "EduardoFAFernandes_F1FantasyData"
    frames = []
    races_path = processed_path("races")
    races = pd.read_parquet(races_path)
    for season in (2021, 2022):
        path = base / str(season) / "prices.csv"
        if not path.exists():
            continue
        snapshots = pd.read_csv(path)
        season_races = races[races["season"] == season]
        season_prices = _legacy_prices_per_round(season, snapshots, season_races)
        frames.append(season_prices)
    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)


def _legacy_prices_per_round(season: int, snapshots: pd.DataFrame, races: pd.DataFrame) -> pd.DataFrame:
    time_column = "date_time" if "date_time" in snapshots.columns else "datetime"
    id_column = "asset_id" if "asset_id" in snapshots.columns else "id"
    snapshots = snapshots.rename(columns={time_column: "taken", id_column: "assetId"})
    snapshots["taken"] = pd.to_datetime(snapshots["taken"], utc=True)
    rows = []
    for race in races.itertuples():
        race_day = pd.Timestamp(race.date, tz="UTC")
        cutoff = race_day - pd.to_timedelta(1, unit="D")
        before = snapshots[snapshots["taken"] < cutoff]
        if before.empty:
            continue
        last_taken = before["taken"].max()
        if cutoff - last_taken > pd.to_timedelta(4, unit="D"):
            continue  # scraper gap: no snapshot from this race week
        latest = before[before["taken"] == last_taken]
        for asset in latest.itertuples():
            rows.append({
                "season": season,
                "round": int(race.round),
                "kind": "constructor" if _looks_like_team(asset.name) else "driver",
                "fantasyId": str(asset.assetId),
                "fantasyCode": None,
                "fantasyName": asset.name,
                "fantasyTeam": None,
                "price": float(asset.price),
                "oldPrice": None,
                "selectedPct": float(asset.selection_percentage),
                "captainPct": None,
                "active": True,
                "source": "EduardoFAFernandes/F1FantasyData (old game)",
            })
    return pd.DataFrame(rows)


def _looks_like_team(name: str) -> bool:
    """Old game driver names are 'N. Surname'; team names have no initial."""
    return re.match(r"^[A-Z]\.\s", str(name)) is None


# ------------------------------------------------------------------------- joins / ids


def _add_price_changes(prices: pd.DataFrame) -> pd.DataFrame:
    prices = prices.sort_values(["season", "kind", "fantasyName", "fantasyId", "round"])
    key = ["season", "kind", "fantasyName", "fantasyId"]
    grouped = prices.groupby(key, dropna=False)["price"]
    prices["priceAfter"] = grouped.shift(-1)
    change = prices["priceAfter"] - prices["price"]
    prices["priceChange"] = change.round(1)
    return prices


def _build_id_map(prices: pd.DataFrame) -> pd.DataFrame:
    columns = ["season", "kind", "fantasyId", "fantasyCode", "fantasyName", "fantasyTeam", "source"]
    assets = prices[columns].drop_duplicates(["season", "kind", "fantasyId", "fantasyCode", "fantasyName"])
    rows = []
    for season, group in assets.groupby("season"):
        roster = idmap.season_roster(season)
        constructor_ids = idmap.season_constructors(season)
        for asset in group.itertuples():
            mapped = _map_asset(asset, roster, constructor_ids)
            rows.append(mapped)
    return pd.DataFrame(rows)


def _map_asset(asset, roster: pd.DataFrame, constructor_ids: set[str]) -> dict:
    driver_id, constructor_id, method = None, None, "unmatched"
    if asset.kind == "driver":
        driver_id, method = idmap.match_driver(roster, asset.fantasyCode, asset.fantasyName)
        team = asset.fantasyTeam
        if team:
            constructor_id, _ = idmap.match_constructor(constructor_ids, team)
    else:
        constructor_id, method = idmap.match_constructor(constructor_ids, asset.fantasyName)
    return {
        "season": asset.season,
        "kind": asset.kind,
        "fantasyId": asset.fantasyId,
        "fantasyCode": asset.fantasyCode,
        "fantasyName": asset.fantasyName,
        "fantasyTeam": asset.fantasyTeam,
        "driverId": driver_id,
        "constructorId": constructor_id,
        "matchMethod": method,
        "source": asset.source,
    }


def _attach_ids(frame: pd.DataFrame, id_map: pd.DataFrame) -> pd.DataFrame:
    keys = ["season", "kind", "fantasyId", "fantasyCode", "fantasyName"]
    columns = [*keys, "driverId", "constructorId"]
    return frame.merge(id_map[columns], on=keys, how="left")


def _attach_price(points: pd.DataFrame, prices: pd.DataFrame) -> pd.DataFrame:
    keys = ["season", "round", "kind", "fantasyId", "fantasyCode", "fantasyName"]
    columns = [*keys, "price", "priceAfter", "priceChange", "selectedPct"]
    return points.merge(prices[columns], on=keys, how="left")


def _concat(frames: list[pd.DataFrame]) -> pd.DataFrame:
    """Concat without pandas' all-NA column dtype warning (those columns stay NA)."""
    columns = list(dict.fromkeys(c for f in frames for c in f.columns))
    trimmed = [f.dropna(axis=1, how="all") for f in frames if not f.empty]
    combined = pd.concat(trimmed, ignore_index=True)
    return combined.reindex(columns=columns)


def _read(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _num(value) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def main() -> None:
    summary = build_all()
    print(summary)


if __name__ == "__main__":
    main()
