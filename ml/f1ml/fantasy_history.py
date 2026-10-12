"""Historical fantasy components that are not derivable from finishing positions.

The game publishes per-round totals (qualifying / sprint / race) for 2023 to 2026, and full
breakdowns for 2026 only. Replaying the official rules (`f1p.fantasy.scoring`) over the real
results gives the position-derived part of each total; what is left is:

- drivers: race remainder = overtakes + 10 x Driver of the Day (F1DB gives DOTD), sprint
  remainder = sprint overtakes;
- constructors: race remainder = pit stop points (band + fastest stop bonus, or the 2023/2024
  rank points).

2026 breakdown columns (r_overtakes, s_overtakes, pit_*) are used directly where present.
"""

from __future__ import annotations

from functools import lru_cache

import numpy as np
import pandas as pd

from f1ml import data, paths
from f1ml.fantasy_rules import scoring


@lru_cache(maxsize=1)
def driver_components() -> pd.DataFrame:
    """One row per driver per round 2023+: real totals, derived overtakes and DOTD."""
    points = _fantasy_points("driver")
    core = data.load_core()
    results = core["results"][core["results"]["season"] >= 2023]
    sprint = core["sprint_results"][core["sprint_results"]["season"] >= 2023]
    dotd = data.driver_of_the_day()
    dotd_winners = dotd[dotd["dotdRank"] == 1][["raceId", "driverId"]].assign(dotd=1)
    race_det = _deterministic(results, is_sprint=False).rename(columns={"det": "race_det"})
    sprint_det = _deterministic(sprint, is_sprint=True).rename(columns={"det": "sprint_det"})
    frame = points.merge(race_det, on=["raceId", "driverId"], how="left")
    frame = frame.merge(sprint_det, on=["raceId", "driverId"], how="left")
    frame = frame.merge(dotd_winners, on=["raceId", "driverId"], how="left")
    frame["dotd"] = frame["dotd"].fillna(0)
    remainder = frame["racePoints"] - frame["race_det"] - 10.0 * frame["dotd"]
    frame["race_overtakes"] = frame["r_overtakes"].fillna(remainder)
    sprint_remainder = frame["sprintPoints"] - frame["sprint_det"]
    frame["sprint_overtakes"] = frame["s_overtakes"].where(frame["s_overtakes"].notna(),
                                                           sprint_remainder)
    frame.loc[frame["race_det"].isna(), "race_overtakes"] = np.nan
    frame.loc[frame["sprint_det"].isna(), "sprint_overtakes"] = np.nan
    return frame


@lru_cache(maxsize=1)
def constructor_components() -> pd.DataFrame:
    """One row per constructor per round 2023+: real totals and derived pit stop points."""
    points = _fantasy_points("constructor")
    drivers = driver_components()
    core = data.load_core()
    results = core["results"][core["results"]["season"] >= 2023][["raceId", "driverId",
                                                                   "constructorId"]]
    drivers = drivers.drop(columns="constructorId").merge(results, on=["raceId", "driverId"],
                                                          how="inner")
    drivers["race_wo_dotd"] = drivers["racePoints"] - 10.0 * drivers["dotd"]
    team_race = drivers.groupby(["raceId", "constructorId"], as_index=False)["race_wo_dotd"].sum()
    frame = points.merge(team_race, on=["raceId", "constructorId"], how="left")
    derived = frame["racePoints"] - frame["race_wo_dotd"]
    official = frame[["pit_band", "pit_fastest", "pit_world_record"]].sum(axis=1, min_count=1)
    has_breakdown = frame["season"] >= 2026
    frame["pit_points"] = np.where(has_breakdown, official.fillna(0.0), derived)
    return frame


def actual_points(season: int, round_number: int) -> pd.DataFrame:
    """Real fantasy totals for one round: kind, driverId / constructorId, points, price info."""
    drivers = driver_components()
    teams = constructor_components()
    race_id = season * 100 + round_number
    driver_rows = drivers[drivers["raceId"] == race_id]
    team_rows = teams[teams["raceId"] == race_id]
    return pd.concat([driver_rows, team_rows], ignore_index=True)


def price_table() -> pd.DataFrame:
    path = paths.processed("fantasy_prices")
    prices = pd.read_parquet(path)
    prices["raceId"] = prices["season"] * 100 + prices["round"]
    return prices


# ----------------------------------------------------------------------------------------------
# helpers


def _fantasy_points(kind: str) -> pd.DataFrame:
    path = paths.processed("fantasy_points")
    points = pd.read_parquet(path)
    points = points[(points["kind"] == kind) & (points["season"] >= 2023)].copy()
    points["raceId"] = points["season"] * 100 + points["round"]
    if kind == "driver":
        points = points[points["driverId"].notna()]
        points = points.sort_values("points", ascending=False)
        points = points.drop_duplicates(["raceId", "driverId"], keep="first")
    else:
        points = points.drop_duplicates(["raceId", "constructorId"], keep="first")
    return points.reset_index(drop=True)


def _deterministic(results: pd.DataFrame, is_sprint: bool) -> pd.DataFrame:
    """Position-derived fantasy points of a race or sprint (no overtakes, no DOTD)."""
    rows = []
    for race_id, race in results.groupby("raceId"):
        season = int(race_id // 100)
        rules = scoring.rules_for(season)
        grid_input = dict(zip(race["driverId"], race["grid"].fillna(0).astype(int)))
        grid = scoring.effective_grid(grid_input)
        for record in race.itertuples(index=False):
            classified = not pd.isna(record.position)
            disqualified = record.statusCategory == "disqualified"
            finish = int(record.position) if classified else None
            fastest = record.fastestLapRank == 1
            session = scoring.SessionResult(grid=grid[record.driverId], finish=finish,
                                            classified=classified, disqualified=disqualified,
                                            fastest_lap=bool(fastest), overtakes=0)
            breakdown = {}
            points = scoring._score_session(session, rules, breakdown, is_sprint=is_sprint)
            rows.append((race_id, record.driverId, points))
    return pd.DataFrame(rows, columns=["raceId", "driverId", "det"])
