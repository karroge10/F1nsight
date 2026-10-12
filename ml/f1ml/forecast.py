"""One race forecast: stage inputs -> model strengths -> Monte Carlo -> fantasy -> title odds.

Shared by `backtest` (every historical race, every stage) and `predict` (the next race).

Announced grid penalties (`penalties`) reach every stage:
- post-qualifying: the frame's grid already holds them when no official grid exists yet
  (`features._weekend_quali`), so the race is conditioned on the penalised grid as usual.
- pre-weekend and post-practice: the race order is not driven by a simulated grid; the stage
  model's strength already averages over where the driver will qualify. The cost of the
  penalty comes from the post-qualifying model instead: its race strength with the penalised
  grid minus its strength from the expected qualifying slot, everything else held fixed
  (`penalty_shift`), rescaled to the stage's first-pick temperature and added to the stage
  strength. Each simulated qualifying order also becomes a penalised starting grid, which
  drives the fantasy grid-to-finish scoring. Sprint penalties work the same way on the sprint.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from f1ml import fantasy, penalties, simulate
from f1ml import features as feat

STAGE_INPUTS = {
    "pre-weekend": [],
    "post-practice": ["FP1", "FP2", "FP3", "SQ", "S"],
    "post-qualifying": ["FP1", "FP2", "FP3", "SQ", "S", "Q"],
}


@dataclass
class RaceForecast:
    race_id: int
    stage: str
    inputs_used: list
    frame: pd.DataFrame
    prediction: pd.DataFrame
    sims: simulate.WeekendSims
    summary: dict
    fantasy_sims: fantasy.FantasySims | None
    championship: dict | None = None
    extras: dict = field(default_factory=dict)
    # announced penalties used: {"race": GridPenalties | None, "sprint": ..., "shift": array}
    grid_penalties: dict = field(default_factory=dict)


def forecast_race(bundle, frame: pd.DataFrame, stage: str, extras: fantasy.ExtrasModel | None,
                  history=None, races: pd.DataFrame | None = None, sims: int = 20000,
                  seed: int = 0, standings: dict | None = None,
                  announced: pd.DataFrame | None = None) -> RaceForecast:
    """Forecast one race at a stage. `frame`: feature rows of the race (one per entrant).

    announced: rows of grid_penalties.parquet for this race (`penalties.load`), or None.
    """
    frame = frame.reset_index(drop=True)
    prediction = bundle.predict(frame, stage)
    inputs = weekend_inputs(bundle, frame, stage, prediction, announced)
    weekend = simulate.simulate_weekend(inputs, sims=sims, seed=seed)
    summary = simulate.summarize_positions(weekend)
    used = inputs_used(frame, stage)
    fantasy_sims = None
    season = int(frame["season"].iloc[0])
    if extras is not None and season >= 2023:
        abs_change = float(frame["c_abs_change"].iloc[0])
        entrants = frame[["driverId", "constructorId"]]
        fantasy_sims = fantasy.score_weekend(weekend, entrants, season, extras, abs_change,
                                             seed=seed)
    forecast = RaceForecast(int(frame["raceId"].iloc[0]), stage, used, frame, prediction,
                            weekend, summary, fantasy_sims)
    forecast.grid_penalties = {"race": inputs.race_penalties, "sprint": inputs.sprint_penalties,
                               "shift": inputs.penalty_shift}
    if history is not None and standings is not None:
        forecast.championship = championship(bundle, history, frame, weekend, standings,
                                             sims=sims, seed=seed)
    return forecast


def lock_frame(frame: pd.DataFrame) -> pd.DataFrame:
    """The race frame as known at the fantasy team lock (before the first qualifying session).

    Practice laps are known; sprint qualifying, sprint and qualifying are not. Forecast it
    with the post-practice stage.
    """
    locked = frame.copy()
    locked[feat.SPRINT_COLS] = np.nan
    locked[feat.QUALI_COLS] = np.nan
    locked["sprint_pre_q"] = 0
    return locked


def weekend_inputs(bundle, frame: pd.DataFrame, stage: str, prediction: pd.DataFrame,
                   announced: pd.DataFrame | None = None) -> simulate.WeekendInputs:
    has_sprint = bool(frame["has_sprint"].iloc[0])
    base_strength = prediction["race_strength"].to_numpy()
    inputs = simulate.WeekendInputs(
        race_strength=base_strength,
        p_dnf=prediction["p_dnf"].to_numpy(),
        has_sprint=has_sprint,
        race_schedule=bundle.schedule(stage, "race"),
        teams=frame["constructorId"].to_numpy(),
    )
    race_penalties = penalties.for_frame(announced, frame["driverId"], "race")
    sprint_penalties = None
    if has_sprint:
        sprint_penalties = penalties.for_frame(announced, frame["driverId"], "sprint")
    inputs.race_penalties = race_penalties
    inputs.sprint_penalties = sprint_penalties
    if stage == "post-qualifying":
        inputs.known_quali = _ranks(frame["q_pos"])
        inputs.known_grid = _ranks(frame["grid"])
        inputs.race_first_bonus = bundle.grid_bonus(stage, inputs.known_grid)
    else:
        inputs.quali_strength = prediction["quali_strength"].to_numpy()
        inputs.quali_schedule = bundle.schedule(stage, "quali")
        if race_penalties is not None:
            shift = penalty_shift(bundle, frame, stage, inputs.quali_strength, race_penalties)
            inputs.race_strength = base_strength + shift
            inputs.penalty_shift = shift
    if not has_sprint:
        return inputs
    if race_penalties is not None:
        # a Grand Prix penalty does not touch the sprint: keep its unpenalised strength
        inputs.sprint_strength = base_strength
    sprint_visible = stage == "post-qualifying" or (frame["sprint_pre_q"].iloc[0] == 1
                                                    and stage == "post-practice")
    sprint_done = sprint_visible and frame["sp_fin"].notna().sum() >= len(frame) // 2
    sq_known = sprint_visible and frame["sq_pos"].notna().sum() >= len(frame) // 2
    if sq_known:
        sprint_quali = _ranks(frame["sq_pos"])
        inputs.known_sprint_grid = penalties.apply(sprint_quali, sprint_penalties)
    if sprint_done:
        inputs.known_sprint = _ranks(frame["sp_fin"])
        classified = frame["sp_dnf"].fillna(0).to_numpy() < 0.5
        inputs.known_sprint_classified = classified
    elif sq_known:
        inputs.sprint_strength = conditional_strength(bundle, frame, frame["sq_pos"],
                                                      sprint_penalties)
    elif sprint_penalties is not None:
        quali_strength = prediction["quali_strength"].to_numpy()
        sprint_shift = penalty_shift(bundle, frame, stage, quali_strength, sprint_penalties)
        inputs.sprint_strength = base_strength + sprint_shift
    return inputs


def conditional_strength(bundle, frame: pd.DataFrame, grid: pd.Series,
                         grid_penalties: penalties.GridPenalties | None = None) -> np.ndarray:
    """Race strength from the post-qualifying model with a given grid (e.g. sprint grid).

    `grid` is the qualifying order; announced penalties, if any, move the starting grid.
    """
    ranks = _ranks(grid)
    modified = grid_frame(frame, ranks, grid_penalties)
    if "sq_gap" in modified:
        modified["q_gap"] = modified["sq_gap"]
    prediction = bundle.predict(modified, "post-qualifying")
    return prediction["race_strength"].to_numpy()


def penalty_shift(bundle, frame: pd.DataFrame, stage: str, quali_strength: np.ndarray,
                  grid_penalties: penalties.GridPenalties) -> np.ndarray:
    """What the penalties cost each driver on the stage's race strength scale.

    The post-qualifying model scores the field twice with the same expected qualifying order
    (ranks of the quali strength): once starting where they qualify, once from the penalised
    grid. The difference is the value of the grid slots the penalised drivers lose. It is
    rescaled by the ratio of first-pick temperatures, post-qualifying over this stage, so the
    change in their chance to win matches the post-qualifying model's. Only penalised drivers
    move: the cars that gain a slot do so in an expected order that is still a guess before
    qualifying, and the Plackett-Luce draw already hands them the penalised drivers' lost share.
    Without qualifying data q_gap is approximated by the sprint qualifying or practice gap; it
    is the same in both scorings, so only the grid columns differ.
    """
    strength_order = pd.Series(-quali_strength)
    expected = _ranks(strength_order)
    natural = grid_frame(frame, expected, None)
    penalised = grid_frame(frame, expected, grid_penalties)
    for modified in (natural, penalised):
        if modified["q_gap"].isna().all():
            proxy = modified["sq_gap"].fillna(modified["fp_best_gap"])
            modified["q_gap"] = proxy
    natural_prediction = bundle.predict(natural, "post-qualifying")
    penalised_prediction = bundle.predict(penalised, "post-qualifying")
    difference = (penalised_prediction["race_strength"].to_numpy()
                  - natural_prediction["race_strength"].to_numpy())
    scale = _first_pick_ratio(bundle, stage)
    penalised_only = np.where(grid_penalties.penalised(), difference, 0.0)
    return penalised_only * scale


def grid_frame(frame: pd.DataFrame, qualifying: np.ndarray,
               grid_penalties: penalties.GridPenalties | None) -> pd.DataFrame:
    """The frame with a qualifying order and the grid it gives after announced penalties.

    Pit lane starters get grid = field size and pitlane = 1, as in the training data.
    """
    modified = frame.copy()
    grid = penalties.apply(qualifying, grid_penalties).astype(float)
    pit_lane = np.zeros(len(frame), dtype=bool)
    if grid_penalties is not None:
        pit_lane = grid_penalties.pit_lane
    field_size = float(len(frame))
    grid = np.where(pit_lane, field_size, grid)
    modified["q_pos"] = qualifying.astype(float)
    modified["grid"] = grid
    modified["grid_pen"] = grid - qualifying
    modified["pitlane"] = pit_lane.astype(float)
    return modified


def inputs_used(frame: pd.DataFrame, stage: str) -> list[str]:
    used = []
    if stage == "pre-weekend":
        return used
    for session, column in (("FP1", "fp1_gap"), ("FP2", "fp2_gap"), ("FP3", "fp3_gap")):
        if frame[column].notna().any():
            used.append(session)
    sprint_visible = stage == "post-qualifying" or frame["sprint_pre_q"].iloc[0] == 1
    if sprint_visible and frame["sq_pos"].notna().any():
        used.append("SQ")
    if sprint_visible and frame["sp_fin"].notna().any():
        used.append("S")
    if stage == "post-qualifying":
        used.append("Q")
    return used


def championship(bundle, history, frame: pd.DataFrame, weekend: simulate.WeekendSims,
                 standings: dict, sims: int, seed: int) -> dict:
    """Title odds: this weekend's simulated points plus every remaining round of the season.

    standings: {"points": array, "wins": array} aligned with `frame` rows (before this race).
    """
    race_id = int(frame["raceId"].iloc[0])
    entrants = frame[["driverId", "constructorId", "number"]]
    future = history.future_targets(race_id, entrants)
    future = [target for target in future if target.race_id > race_id]
    rounds = []
    points, wins = simulate.weekend_points(weekend)
    rounds.append({"fixed_points": points, "fixed_wins": wins})
    if future:
        future_frame = history.features(future)
        prediction = bundle.predict(future_frame, "pre-weekend")
        future_frame = future_frame.reset_index(drop=True)
        prediction = prediction.reset_index(drop=True)
        future_frame["race_strength"] = prediction["race_strength"].to_numpy()
        future_frame["p_dnf"] = prediction["p_dnf"].to_numpy()
        for _, rows in future_frame.groupby("raceId", sort=True):
            ordered = rows.set_index("driverId").loc[frame["driverId"]]
            strengths = ordered["race_strength"].to_numpy()
            dnf = ordered["p_dnf"].to_numpy()
            has_sprint = bool(ordered["has_sprint"].iloc[0])
            rounds.append({"race_strength": strengths, "p_dnf": dnf, "has_sprint": has_sprint,
                           "schedule": bundle.schedule("pre-weekend", "race")})
    teams = frame["constructorId"].to_numpy()
    result = simulate.simulate_championship(standings["points"], teams, rounds, sims=sims,
                                            seed=seed, wins=standings["wins"])
    result["driverIds"] = frame["driverId"].tolist()
    result["remaining"] = len(rounds)
    return result


def _first_pick_ratio(bundle, stage: str) -> float:
    """First-pick temperature of the post-qualifying race schedule over this stage's."""
    post = bundle.schedule("post-qualifying", "race")
    here = bundle.schedule(stage, "race")
    if post is None or here is None or here[0] <= 0:
        return 1.0
    return float(post[0] / here[0])


def _ranks(values: pd.Series) -> np.ndarray:
    """1..n positions from values (missing go last, ties keep row order)."""
    filled = values.to_numpy(dtype=float)
    filled = np.where(np.isnan(filled), 1e6, filled)
    order = np.argsort(filled, kind="stable")
    ranks = np.empty(len(filled), dtype=np.int64)
    ranks[order] = np.arange(1, len(filled) + 1)
    return ranks
