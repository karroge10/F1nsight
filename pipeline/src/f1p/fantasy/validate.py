"""Validate scoring.py and price_change.py against recorded fantasy data.

Scoring (2026, official per session breakdowns):
- mode "oracle": results from data/processed (qualifying, sprint, race) plus the
  official overtake counts, driver of the day and pit stop points. Checks that the
  rules are implemented right; every remaining miss is a data or rule gap.
- mode "derived": only public data: results plus OpenF1 overtakes and OpenF1
  stationary pit stop times, no driver of the day. Shows how well fantasy points can
  be reconstructed without the game's private inputs.

Price changes (2025, 2026): replays price_change() over every asset and gameday.

Writes data/raw/fantasy/validation.json and prints a summary.
"""

import json

import numpy as np
import pandas as pd

from f1p.fantasy import price_change as pc
from f1p.fantasy import scoring
from f1p.paths import processed_path, raw_dir

SCORING_SEASON = 2026
PRICE_SEASONS = (2025, 2026)


def run() -> dict:
    """Run every check; returns and saves the report."""
    report = {
        "scoring": validate_scoring(SCORING_SEASON),
        "scoring_2025_wayback": validate_scoring_wayback(2025),
        "overtakes_2025_openf1_vs_wayback": overtakes_vs_wayback(2025),
        "price_change": {str(s): validate_prices(s) for s in PRICE_SEASONS},
    }
    path = raw_dir("fantasy") / "validation.json"
    text = json.dumps(report, indent=1, default=str)
    path.write_text(text, encoding="utf-8")
    return report


def validate_scoring(season: int) -> dict:
    official = _table("fantasy_points")
    official = official[(official["season"] == season) & official["breakdownSource"].notna()]
    inputs = _results_inputs(season)
    openf1 = _public_inputs(season)
    out = {}
    for mode in ("oracle", "derived"):
        rows = _score_all(official, inputs, openf1, season, mode)
        out[mode] = _summarise(rows)
        if mode == "oracle":
            out["oracle_mismatches"] = _mismatch_examples(rows)
    out["overtakes_openf1_vs_official"] = _overtake_agreement(official, openf1)
    return out


def validate_scoring_wayback(season: int = 2025) -> dict:
    """Driver totals for rounds with Wayback-derived overtakes and DOTD (2025)."""
    points = _table("fantasy_points")
    rows = points[(points["season"] == season) & (points["kind"] == "driver")
                  & points["wb_overtakes"].notna()]
    inputs = _results_inputs(season)
    rows = rows.assign(breakdownSource="wayback")
    scored = _score_all(rows, inputs, {}, season, "wayback")
    frame = pd.DataFrame(scored)
    if frame.empty:
        return {}
    error = frame["total_calc"] - frame["total_off"]
    misses = frame[error != 0]
    return {
        "n": len(frame),
        "rounds": sorted(frame["round"].unique().tolist()),
        "total_exact": round((error == 0).mean(), 4),
        "total_mae": round(error.abs().mean(), 3),
        "mismatches": misses.head(40).to_dict("records"),
    }


def overtakes_vs_wayback(season: int = 2025) -> dict:
    """OpenF1 overtakes (race + sprint) against official counts derived from Wayback."""
    points = _table("fantasy_points")
    rows = points[(points["season"] == season) & (points["kind"] == "driver")
                  & points["wb_overtakes"].notna()]
    openf1 = _public_inputs(season)
    if not openf1:
        return {"available": False}
    pairs = []
    for row in rows.itertuples():
        race = openf1.get((row.round, "Race"))
        if race is None or not race["overtakes"]:
            continue
        sprint = openf1.get((row.round, "Sprint"), {"overtakes": {}})
        race_count = race["overtakes"].get(row.driverId, 0)
        sprint_count = sprint["overtakes"].get(row.driverId, 0)
        counted = race_count + sprint_count
        pairs.append({"official": row.wb_overtakes, "openf1": counted})
    return _agreement(pd.DataFrame(pairs))


def validate_prices(season: int) -> dict:
    prices = _table("fantasy_prices")
    points = _table("fantasy_points")
    prices = prices[(prices["season"] == season) & prices["priceChange"].notna()]
    points = points[points["season"] == season]
    keys = ["season", "round", "kind", "fantasyId", "fantasyCode", "fantasyName"]
    merged = prices.merge(points[[*keys, "points"]], on=keys, how="left")
    merged = merged.sort_values([*keys[2:], "round"])

    rows = []
    for _, asset in merged.groupby(["kind", "fantasyId", "fantasyCode", "fantasyName"], dropna=False):
        history: list[float] = []
        for row in asset.itertuples():
            if row.active:
                history.append(row.points if pd.notna(row.points) else 0.0)
            active = bool(row.active)
            result = pc.price_change(row.price, history, season=season, active=active)
            rows.append({
                "round": row.round, "kind": row.kind, "name": row.fantasyName,
                "price": row.price, "actual": row.priceChange, "predicted": result.change,
                "ppm": round(result.ppm, 3), "active": row.active,
            })
    frame = pd.DataFrame(rows)
    frame["match"] = np.isclose(frame["actual"], frame["predicted"])
    misses = frame[~frame["match"]]
    return {
        "changes": len(frame),
        "match_rate": round(frame["match"].mean(), 4),
        "match_rate_active_only": round(frame[frame["active"]]["match"].mean(), 4),
        "mismatches": misses.to_dict("records"),
    }


# ------------------------------------------------------------------------------ inputs


def _results_inputs(season: int) -> dict:
    """{round: {driverId: DriverWeekend-kwargs pieces}} from processed history tables."""
    quali = _table("qualifying")
    sprint = _table("sprint_results")
    race = _table("results")
    quali = quali[quali["season"] == season]
    sprint = sprint[sprint["season"] == season]
    race = race[race["season"] == season]
    rounds = {}
    for round_number, race_round in race.groupby("round"):
        quali_round = quali[quali["round"] == round_number].set_index("driverId")
        sprint_round = sprint[sprint["round"] == round_number]
        rounds[round_number] = {
            "race": _session_results(race_round),
            "sprint": _session_results(sprint_round) if len(sprint_round) else None,
            "quali": quali_round,
            # Some rounds come without lap times (2025 Miami): then a listed driver set a time.
            "quali_has_times": bool(quali_round["q1Ms"].notna().any()),
            "teams": race_round.groupby("constructorId")["driverId"].apply(list).to_dict(),
            "field": len(race_round),
        }
    return rounds


def _session_results(frame: pd.DataFrame) -> dict:
    grids = dict(zip(frame["driverId"], frame["grid"]))
    effective = scoring.effective_grid(grids)
    result = {}
    for row in frame.itertuples():
        classified = pd.notna(row.position)
        result[row.driverId] = {
            "grid": effective[row.driverId],
            "finish": int(row.position) if classified else None,
            "classified": bool(classified),
            "disqualified": row.positionText == "D",
            "fastest_lap": row.fastestLapRank == 1,
        }
    return result


def _public_inputs(season: int) -> dict:
    """{(round, 'Race'|'Sprint'): {'overtakes': {driverId: n}, 'pit': {...}}} from free data.

    Overtakes: f1p.fantasy.overtakes (filtered OpenF1). Pit stops: f1p.fantasy.dhl
    (DHL award data, team fastest stationary stop per race).
    """
    try:
        overtakes = _table("fantasy_overtakes")
        pitstops = _table("fantasy_pitstops")
    except (FileNotFoundError, OSError):
        return {}
    out: dict = {}
    for row in overtakes[overtakes["season"] == season].itertuples():
        key = (row.round, row.session)
        entry = out.setdefault(key, {"overtakes": {}, "pit": {}})
        entry["overtakes"][row.driverId] = row.overtakes
    for row in pitstops[pitstops["season"] == season].itertuples():
        entry = out.setdefault((row.round, "Race"), {"overtakes": {}, "pit": {}})
        entry["pit"][row.constructorId] = (row.fastestStop, row.raceFastest)
    return out


# ----------------------------------------------------------------------------- scoring


def _score_all(official, inputs, openf1, season, mode) -> list[dict]:
    rules = scoring.rules_for(season)
    rows = []
    driver_rows = official[official["kind"] == "driver"]
    weekends: dict = {}
    for row in driver_rows.itertuples():
        weekend = _driver_weekend(row, inputs, openf1, mode)
        if weekend is None:
            continue
        weekends[(row.round, row.driverId)] = weekend
        points = scoring.score_driver(weekend, rules)
        rows.append(_compare_row(row, points, "driver", mode))
    for row in official[official["kind"] == "constructor"].itertuples():
        team = _constructor_inputs(row, inputs, openf1, weekends, mode)
        if team is None:
            continue
        drivers, pit_kwargs = team
        field = inputs[row.round]["field"]
        points = scoring.score_constructor(drivers, rules, field_size=field, **pit_kwargs)
        rows.append(_compare_row(row, points, "constructor", mode))
    return rows


def _driver_weekend(row, inputs, openf1, mode):
    round_inputs = inputs.get(row.round)
    if round_inputs is None or row.driverId not in round_inputs["race"]:
        return None
    quali = round_inputs["quali"]
    quali_position, quali_segment = None, None
    if row.driverId in quali.index:
        entry = quali.loc[row.driverId]
        has_time = pd.notna(entry["q1Ms"]) or pd.notna(entry["q2Ms"]) or pd.notna(entry["q3Ms"])
        has_time = has_time or not round_inputs["quali_has_times"]
        quali_position = int(entry["position"]) if has_time else None
        timed_segment = 3 if pd.notna(entry["q3Ms"]) else 2 if pd.notna(entry["q2Ms"]) else 1
        field = round_inputs["field"]
        classified_segment = scoring.quali_segment_from_position(int(entry["position"]), field)
        quali_segment = max(timed_segment, classified_segment)
    race = _session(round_inputs["race"][row.driverId], row, "r", openf1, (row.round, "Race"), mode)
    sprint = None
    if round_inputs["sprint"] is not None and row.driverId in round_inputs["sprint"]:
        raw = round_inputs["sprint"][row.driverId]
        sprint = _session(raw, row, "s", openf1, (row.round, "Sprint"), mode)
    return scoring.DriverWeekend(quali_position=quali_position, quali_segment=quali_segment,
                                 sprint=sprint, race=race)


def _session(raw: dict, row, prefix: str, openf1: dict, key, mode: str):
    if mode == "oracle":
        overtakes = getattr(row, f"{prefix}_overtakes")
        overtakes = int(overtakes) if pd.notna(overtakes) else 0
        dotd = prefix == "r" and pd.notna(row.r_dotd) and row.r_dotd > 0
    elif mode == "wayback":
        # Season-cumulative deltas mix sprint and race overtakes; the total is the same.
        overtakes = int(row.wb_overtakes) if prefix == "r" else 0
        dotd = prefix == "r" and row.wb_dotd > 0
    else:
        session = openf1.get(key, {})
        overtakes = session.get("overtakes", {}).get(row.driverId, 0)
        dotd = False
    return scoring.SessionResult(overtakes=overtakes, driver_of_the_day=dotd, **raw)


def _constructor_inputs(row, inputs, openf1, weekends, mode):
    round_inputs = inputs.get(row.round)
    if round_inputs is None or row.constructorId not in round_inputs["teams"]:
        return None
    driver_ids = round_inputs["teams"][row.constructorId]
    drivers = [weekends[(row.round, d)] for d in driver_ids if (row.round, d) in weekends]
    if len(drivers) != len(driver_ids):
        return None
    if mode == "oracle":
        return drivers, {"team_fastest_pit_s": None}
    session = openf1.get((row.round, "Race"), {})
    team_stop, race_best = session.get("pit", {}).get(row.constructorId, (None, None))
    if team_stop is not None and pd.isna(team_stop):
        team_stop = None
    return drivers, {"team_fastest_pit_s": team_stop, "race_fastest_pit_s": race_best}


def _compare_row(row, points, kind: str, mode: str) -> dict:
    """In oracle mode the official pit stop points stand in for unknown stop times."""
    race = points.race
    if kind == "constructor" and mode == "oracle":
        for column in ("pit_band", "pit_fastest", "pit_world_record"):
            value = getattr(row, column)
            race += value if pd.notna(value) else 0.0
    total = points.qualifying + points.sprint + race
    return {
        "round": row.round, "kind": kind, "name": row.fantasyName,
        "q_off": row.qualiPoints, "q_calc": points.qualifying,
        "s_off": row.sprintPoints, "s_calc": points.sprint,
        "r_off": row.racePoints, "r_calc": race,
        "total_off": row.points, "total_calc": total,
    }


def _summarise(rows: list[dict]) -> dict:
    frame = pd.DataFrame(rows)
    if frame.empty:
        return {}
    out = {}
    for kind, group in frame.groupby("kind"):
        error = group["total_calc"] - group["total_off"]
        out[kind] = {
            "n": len(group),
            "qualifying_exact": round((group["q_calc"] == group["q_off"]).mean(), 4),
            "sprint_exact": round((group["s_calc"] == group["s_off"]).mean(), 4),
            "race_exact": round((group["r_calc"] == group["r_off"]).mean(), 4),
            "total_exact": round((error == 0).mean(), 4),
            "total_mae": round(error.abs().mean(), 3),
        }
    return out


def _mismatch_examples(rows: list[dict]) -> list[dict]:
    frame = pd.DataFrame(rows)
    bad = frame[frame["total_calc"] != frame["total_off"]]
    return bad.head(80).to_dict("records")


def _overtake_agreement(official: pd.DataFrame, openf1: dict) -> dict:
    if not openf1:
        return {"available": False}
    rows = []
    for row in official[official["kind"] == "driver"].itertuples():
        for prefix, session in (("r", "Race"), ("s", "Sprint")):
            data = openf1.get((row.round, session))
            official_value = getattr(row, f"{prefix}_overtakes")
            if data is None or not data["overtakes"]:
                continue
            if session == "Sprint" and pd.isna(row.sprintPosition):
                continue
            off = int(official_value) if pd.notna(official_value) else 0
            rows.append({"official": off, "openf1": data["overtakes"].get(row.driverId, 0)})
    return _agreement(pd.DataFrame(rows))


def _agreement(frame: pd.DataFrame) -> dict:
    if frame.empty:
        return {"available": False}
    diff = frame["openf1"] - frame["official"]
    correlation = frame["openf1"].corr(frame["official"])
    return {
        "available": True,
        "driver_sessions": len(frame),
        "exact": round((diff == 0).mean(), 4),
        "within_2": round((diff.abs() <= 2).mean(), 4),
        "mean_official": round(frame["official"].mean(), 2),
        "mean_openf1": round(frame["openf1"].mean(), 2),
        "pearson": round(float(correlation), 3),
    }


def _table(name: str) -> pd.DataFrame:
    path = processed_path(name)
    return pd.read_parquet(path)


def main() -> None:
    report = run()
    printable = {
        "scoring": {k: v for k, v in report["scoring"].items() if k != "oracle_mismatches"},
        "scoring_2025_wayback": {k: v for k, v in report["scoring_2025_wayback"].items()
                                 if k != "mismatches"},
        "overtakes_2025_openf1_vs_wayback": report["overtakes_2025_openf1_vs_wayback"],
        "price_change": {s: {k: v for k, v in r.items() if k != "mismatches"}
                         for s, r in report["price_change"].items()},
    }
    print(json.dumps(printable, indent=1, default=str))


if __name__ == "__main__":
    main()
