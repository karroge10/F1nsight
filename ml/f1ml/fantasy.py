"""F1 Fantasy points and price changes for simulated weekends.

For every simulated world (qualifying, sprint and race order with retirements) the official
rules are applied in vectorised form (constants from `f1p.fantasy.scoring`, cross checked
against its scalar functions in `check_against_reference`). Parts that do not follow from
positions are drawn from simple models fitted on earlier rounds only:

- overtakes: Poisson regression on grid, finish, places gained/lost, retirement and the
  circuit's position-change index, fitted on the most recent rounds (2026 overtake counts
  are much higher than before, so the window is short and weighted to the current season);
- fastest lap: one classified driver per race, chosen with probabilities by finishing
  position (2019+ history);
- Driver of the Day: multinomial logit on places gained and finishing position (F1DB votes);
- constructor pit stop points: the team's own recent distribution mixed with the league's.

`strength_sharpness` / `sharpened_inputs` can score the fantasy points on a sharper
re-simulation of the weekend. It is off (FANTASY_SHARPNESS = 1): sharpness 1.5 from 2025 was
tried on 2026-10-14 and reverted on 2026-10-15, because with reproducible builds it was
significantly worse in 2025 (-18.8 points, t -2.74, 8 builds) and not significantly better in
2026 (+41.4, t 2.23); see research/fantasy-model-log.md (round 7) and ml/scripts/exp_dispersion.

Price changes use the official 2025/2026 PPM rule (`f1p.fantasy.price_change`) applied to
the simulated points, giving a probability for every possible step.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace

import numpy as np
import pandas as pd
from scipy.optimize import minimize
from sklearn.linear_model import PoissonRegressor

from f1ml import data, fantasy_history
from f1ml.fantasy_rules import price_rules, scoring

OVERTAKE_WINDOW = 12
FANTASY_SHARPNESS = 1.0
FIRST_SHARPENED_SEASON = 2025
PIT_WINDOW = 12
PIT_TEAM_WEIGHT = 0.7


@dataclass
class ExtrasModel:
    """Fitted non-positional components, all estimated from rounds before `cutoff`."""

    cutoff: int
    race_overtakes: PoissonRegressor | None
    sprint_overtakes: PoissonRegressor | None
    race_overtake_mean: float
    sprint_overtake_mean: float
    fastest_lap_weights: np.ndarray
    dotd_coef: np.ndarray
    pit_values: dict = field(default_factory=dict)
    league_pit_values: np.ndarray = field(default_factory=lambda: np.zeros(1))


COMPONENTS = ("qualifying", "race", "sprint", "positionsGained", "overtakes", "fastestLap",
              "dotd", "pitStops", "dnfPenalty")


@dataclass
class FantasySims:
    """Totals and per component points, each (sims, assets); components sum to the totals."""

    driver_points: np.ndarray
    constructor_points: np.ndarray
    teams: list
    driver_components: dict = field(default_factory=dict)
    constructor_components: dict = field(default_factory=dict)
    driver_race: np.ndarray | None = None  # Grand Prix points only (for Final Fix)
    constructor_race: np.ndarray | None = None
    driver_negative: np.ndarray | None = None  # sum of negative items (for No Negative)
    constructor_negative: np.ndarray | None = None


def fit_extras(cutoff: int) -> ExtrasModel:
    """Fit every non-positional component on fantasy rounds with raceId < cutoff."""
    drivers = fantasy_history.driver_components()
    past = drivers[drivers["raceId"] < cutoff]
    race_model, race_mean = _fit_overtakes(past, "race_overtakes", sprint=False)
    sprint_model, sprint_mean = _fit_overtakes(past, "sprint_overtakes", sprint=True)
    fastest_lap = _fastest_lap_weights(cutoff)
    dotd = _fit_dotd(cutoff)
    pit_values, league = _pit_distributions(cutoff)
    return ExtrasModel(cutoff, race_model, sprint_model, race_mean, sprint_mean, fastest_lap,
                       dotd, pit_values, league)


def strength_sharpness(season: int) -> float:
    """Strength multiplier of the fantasy simulation (walk-forward fit, see the module notes)."""
    return FANTASY_SHARPNESS if season >= FIRST_SHARPENED_SEASON else 1.0


def sharpened_inputs(inputs, sharpness: float):
    """A copy of simulate.WeekendInputs with race, sprint and qualifying strengths scaled."""
    if sharpness == 1.0:
        return inputs
    scaled = replace(inputs, race_strength=inputs.race_strength * sharpness)
    if inputs.quali_strength is not None:
        scaled.quali_strength = inputs.quali_strength * sharpness
    if inputs.sprint_strength is not None:
        scaled.sprint_strength = inputs.sprint_strength * sharpness
    return scaled


def score_weekend(sims, entrants: pd.DataFrame, season: int, extras: ExtrasModel,
                  circuit_abs_change: float, seed: int = 0) -> FantasySims:
    """Fantasy points of every driver and constructor in every simulated world.

    sims: simulate.WeekendSims; entrants: driverId, constructorId in the simulation order.
    """
    rules = scoring.rules_for(max(season, 2023))
    rng = np.random.default_rng(int(seed))
    count, drivers = sims.race.shape
    components = {name: np.zeros((count, drivers), dtype=np.float32) for name in COMPONENTS}
    quali_table = _lookup(scoring.QUALI_POINTS, drivers)
    components["qualifying"] += quali_table[sims.quali - 1]
    race = _race_components(sims, rules, extras, circuit_abs_change, rng)
    _add_components(components, race)
    sprint = None
    if sims.sprint is not None:
        sprint = _sprint_components(sims, rules, extras, circuit_abs_change, rng)
        _add_components(components, sprint)
    driver_points = _total(components)
    driver_race = _total(race)
    driver_negative = _negative_items([race, sprint], None)

    constructor_ids = entrants["constructorId"].tolist()
    teams = list(dict.fromkeys(constructor_ids))
    team_components = {name: np.zeros((count, len(teams)), dtype=np.float32)
                       for name in COMPONENTS}
    team_race = np.zeros((count, len(teams)), dtype=np.float32)
    team_negative = np.zeros((count, len(teams)), dtype=np.float32)
    for t, team in enumerate(teams):
        members = [i for i, c in enumerate(constructor_ids) if c == team]
        for name in COMPONENTS:
            if name == "dotd":
                continue
            team_components[name][:, t] = components[name][:, members].sum(axis=1)
        progression = _progression(sims.quali[:, members], drivers, rules)
        team_components["qualifying"][:, t] += progression
        pit = _sample_pit(extras, team, count, rng)
        team_components["pitStops"][:, t] = pit
        race_without_dotd = driver_race[:, members].sum(axis=1)
        race_without_dotd -= race["dotd"][:, members].sum(axis=1)
        team_race[:, t] = race_without_dotd + pit
        member_negative = _negative_items([race, sprint], members)
        team_negative[:, t] = member_negative + np.minimum(progression, 0.0)
    team_points = _total(team_components)
    return FantasySims(driver_points, team_points, teams, components, team_components,
                       driver_race, team_race, driver_negative, team_negative)


def summarize_points(points: np.ndarray) -> dict:
    return {
        "expectedPoints": points.mean(axis=0),
        "p10": np.percentile(points, 10, axis=0),
        "p90": np.percentile(points, 90, axis=0),
    }


def price_change_distribution(points: np.ndarray, price: float, previous: list[float],
                              season: int) -> dict:
    """Probability of each price step after this round, from simulated points (1-D array).

    previous: the asset's earlier active gameday totals, oldest first (only the last two
    matter). Uses the official PPM thresholds, tiers and clamps.
    """
    if season < 2025 or price is None or np.isnan(price):
        return {"expected": None, "probs": {}}
    window = list(previous[-(price_rules.WINDOW - 1):])
    count = len(window) + 1
    mean_points = (np.sum(window) + points) / count
    ppm = np.round(mean_points / price + 1e-9, 2)
    tier = price_rules.tier_of(price)
    steps = price_rules.STEPS[tier]
    change = np.where(ppm >= 1.2, steps["great"],
                      np.where(ppm >= 0.9, steps["good"],
                               np.where(ppm > 0.6, steps["poor"], steps["terrible"])))
    floor = price_rules.price_floor(season)
    ceiling = price_rules.price_ceiling(season)
    new_price = np.round(np.clip(price + change, floor, ceiling), 1)
    realised = np.round(new_price - price, 1)
    values, counts = np.unique(realised, return_counts=True)
    total = counts.sum()
    probs = {f"{value:+.1f}".replace("+0.0", "0.0").replace("-0.0", "0.0"): float(c / total)
             for value, c in zip(values, counts)}
    return {"expected": float(realised.mean()), "probs": probs}


def check_against_reference(sims, entrants: pd.DataFrame, season: int, samples: int = 200,
                            seed: int = 0) -> float:
    """Share of sampled worlds where the vectorised position points equal `scoring` exactly.

    Overtakes, DOTD, fastest lap and pit stops are switched off on both sides.
    """
    rules = scoring.rules_for(max(season, 2023))
    rng = np.random.default_rng(int(seed))
    count, drivers = sims.race.shape
    picks = rng.choice(count, size=min(samples, count), replace=False)
    zero_extras = ExtrasModel(0, None, None, 0.0, 0.0, np.zeros(drivers), np.zeros(4))
    quali_table = _lookup(scoring.QUALI_POINTS, drivers)
    matches = 0
    for sim in picks:
        single = _slice_sims(sims, sim)
        race_parts = _race_components(single, rules, zero_extras, 0.0, rng, deterministic=True)
        vector = quali_table[single.quali - 1] + sum(race_parts.values())
        if single.sprint is not None:
            sprint_parts = _sprint_components(single, rules, zero_extras, 0.0, rng,
                                              deterministic=True)
            vector = vector + sum(sprint_parts.values())
        reference = _reference_points(single, rules, drivers)
        matches += int(np.allclose(vector[0], reference))
    return matches / len(picks)


# ----------------------------------------------------------------------------------------------
# helpers: points


def _lookup(table, drivers: int) -> np.ndarray:
    lookup = np.zeros(max(drivers, len(table)), dtype=np.float32)
    lookup[:len(table)] = table
    return lookup


def _race_components(sims, rules, extras: ExtrasModel, circuit_abs_change: float, rng,
                     deterministic: bool = False) -> dict:
    """Race points split by component (position, gained/lost, NC, overtakes, FL, DOTD)."""
    count, drivers = sims.race.shape
    table = _lookup(scoring.RACE_POINTS, drivers)
    classified = sims.classified
    gained = (sims.grid - sims.race).astype(np.float32)
    parts = {
        "race": np.where(classified, table[sims.race - 1], 0.0).astype(np.float32),
        "positionsGained": np.where(classified, gained, 0.0).astype(np.float32),
        "dnfPenalty": np.where(classified, 0.0, float(rules.race_nc)).astype(np.float32),
    }
    if deterministic:
        return parts
    overtakes = _draw_overtakes(extras.race_overtakes, extras.race_overtake_mean, sims.grid,
                                sims.race, classified, drivers, circuit_abs_change, rng)
    parts["overtakes"] = (overtakes * rules.overtake).astype(np.float32)
    fastest = _draw_fastest_lap(extras.fastest_lap_weights, sims.race, classified, rng)
    parts["fastestLap"] = (fastest * rules.race_fastest_lap * classified).astype(np.float32)
    dotd = _draw_dotd(extras.dotd_coef, sims.grid, sims.race, classified, rng)
    parts["dotd"] = (dotd * rules.dotd * classified).astype(np.float32)
    return parts


def _sprint_components(sims, rules, extras: ExtrasModel, circuit_abs_change: float, rng,
                       deterministic: bool = False) -> dict:
    count, drivers = sims.sprint.shape
    table = _lookup(scoring.SPRINT_POINTS, drivers)
    classified = sims.sprint_classified
    gained = (sims.sprint_grid - sims.sprint).astype(np.float32)
    gained = np.maximum(gained, -rules.sprint_lost_cap)
    parts = {
        "sprint": np.where(classified, table[sims.sprint - 1], 0.0).astype(np.float32),
        "positionsGained": np.where(classified, gained, 0.0).astype(np.float32),
        "dnfPenalty": np.where(classified, 0.0, float(rules.sprint_nc)).astype(np.float32),
    }
    if deterministic:
        return parts
    overtakes = _draw_overtakes(extras.sprint_overtakes, extras.sprint_overtake_mean,
                                sims.sprint_grid, sims.sprint, classified, drivers,
                                circuit_abs_change, rng)
    parts["overtakes"] = (overtakes * rules.overtake).astype(np.float32)
    fastest = _draw_fastest_lap(extras.fastest_lap_weights, sims.sprint, classified, rng)
    parts["fastestLap"] = (fastest * rules.sprint_fastest_lap * classified).astype(np.float32)
    return parts


def _negative_items(sessions: list, members: list | None) -> np.ndarray:
    """Sum of negative scoring items per world.

    Per session the items that can be negative are places gained/lost and the not
    classified penalty. For a constructor (`members` given) each item is first summed over its
    drivers, as the game's breakdown does, then clamped at zero.
    """
    total = None
    for parts in sessions:
        if parts is None:
            continue
        for name in ("positionsGained", "dnfPenalty"):
            values = parts[name]
            if members is not None:
                values = values[:, members].sum(axis=1)
            negative = np.minimum(values, 0.0)
            total = negative if total is None else total + negative
    return total.astype(np.float32)


def _add_components(target: dict, parts: dict) -> None:
    for name, values in parts.items():
        target[name] += values


def _total(components: dict) -> np.ndarray:
    first = next(iter(components.values()))
    total = np.zeros_like(first)
    for values in components.values():
        total = total + values
    return total


def _progression(quali_positions: np.ndarray, field_size: int, rules) -> np.ndarray:
    eliminated = (field_size - 10) // 2
    q2_cut = 10 + eliminated
    in_q3 = (quali_positions <= 10).sum(axis=1)
    in_q2 = (quali_positions <= q2_cut).sum(axis=1)
    table = rules.progression
    bonus = np.where(in_q3 >= 2, table["both_q3"],
                     np.where(in_q3 == 1, table["one_q3"],
                              np.where(in_q2 >= 2, table["both_q2"],
                                       np.where(in_q2 == 1, table["one_q2"],
                                                table["none_q2"]))))
    return bonus.astype(np.float32)


def _reference_points(single, rules, drivers: int) -> np.ndarray:
    """Scalar reference via f1p.fantasy.scoring.score_driver for one simulated world."""
    totals = np.zeros(drivers)
    for i in range(drivers):
        race = scoring.SessionResult(grid=int(single.grid[0, i]), finish=int(single.race[0, i]),
                                     classified=bool(single.classified[0, i]), overtakes=0)
        sprint = None
        if single.sprint is not None:
            sprint = scoring.SessionResult(grid=int(single.sprint_grid[0, i]),
                                           finish=int(single.sprint[0, i]),
                                           classified=bool(single.sprint_classified[0, i]),
                                           overtakes=0)
        weekend = scoring.DriverWeekend(quali_position=int(single.quali[0, i]), sprint=sprint,
                                        race=race)
        result = scoring.score_driver(weekend, rules)
        totals[i] = result.total
    return totals


def _slice_sims(sims, index: int):
    from f1ml.simulate import WeekendSims

    def pick(values):
        return None if values is None else values[index:index + 1]

    return WeekendSims(pick(sims.quali), pick(sims.grid), pick(sims.race), pick(sims.classified),
                       pick(sims.sprint_grid), pick(sims.sprint), pick(sims.sprint_classified))


# ----------------------------------------------------------------------------------------------
# helpers: extras models


def _overtake_design(grid, finish, classified, drivers, circuit_abs_change) -> np.ndarray:
    grid = np.asarray(grid, dtype=float)
    finish = np.asarray(finish, dtype=float)
    gained = np.clip(grid - finish, 0, None)
    lost = np.clip(finish - grid, 0, None)
    retired = 1.0 - np.asarray(classified, dtype=float)
    change = np.full_like(grid, circuit_abs_change if circuit_abs_change == circuit_abs_change
                          else 3.0)
    columns = [grid / drivers, gained, lost, retired, change, (grid / drivers) ** 2]
    return np.stack(columns, axis=-1)


def _fit_overtakes(past: pd.DataFrame, column: str, sprint: bool):
    usable = past[past[column].notna()].copy()
    if not len(usable):
        return None, 0.0
    race_ids = np.sort(usable["raceId"].unique())
    window = 2 * OVERTAKE_WINDOW if sprint else OVERTAKE_WINDOW
    recent_ids = race_ids[-window:]
    recent = usable[usable["raceId"].isin(recent_ids)]
    core = data.load_core()
    source = core["sprint_results"] if sprint else core["results"]
    rows = source[["raceId", "driverId", "grid", "positionOrder", "position"]]
    joined = recent.merge(rows, on=["raceId", "driverId"], how="inner")
    if len(joined) < 40:
        return None, float(recent[column].mean())
    field = joined.groupby("raceId")["driverId"].transform("count").to_numpy()
    grid = joined["grid"].where(joined["grid"] > 0, field).to_numpy(dtype=float)
    finish = joined["positionOrder"].to_numpy(dtype=float)
    classified = joined["position"].notna().to_numpy()
    change = _abs_change_by_race(joined["raceId"])
    design = _overtake_design(grid, finish, classified, field, 0.0)
    design[:, 4] = change
    target = joined[column].clip(lower=0).to_numpy(dtype=float)
    model = PoissonRegressor(alpha=1e-3, max_iter=500)
    model.fit(design, target)
    return model, float(target.mean())


def _abs_change_by_race(race_ids: pd.Series) -> np.ndarray:
    results = data.load_core()["results"]
    rows = results[results["raceId"].isin(race_ids.unique()) & results["position"].notna()]
    rows = rows[rows["grid"] > 0]
    change = (rows["grid"] - rows["positionOrder"]).abs().groupby(rows["raceId"]).mean()
    mapped = race_ids.map(change).fillna(3.0)
    return mapped.to_numpy(dtype=float)


def _draw_overtakes(model, mean, grid, finish, classified, drivers, circuit_abs_change, rng):
    if model is None:
        return rng.poisson(mean, size=grid.shape).astype(np.float32)
    design = _overtake_design(grid, finish, classified, drivers, circuit_abs_change)
    flat = design.reshape(-1, design.shape[-1])
    rate = model.predict(flat).reshape(grid.shape)
    # the scoring generator, not torch's global one, so a seed reproduces every draw
    draws = rng.poisson(np.maximum(rate, 0.0))
    return draws.astype(np.float32)


def _fastest_lap_weights(cutoff: int) -> np.ndarray:
    """P(fastest lap | classified finishing position), 2019+ races before the cutoff."""
    results = data.load_core()["results"]
    rows = results[(results["season"] >= 2019) & (results["raceId"] < cutoff)
                   & results["position"].notna()]
    holders = rows[rows["fastestLapRank"] == 1]
    counts = holders["positionOrder"].value_counts()
    weights = np.ones(26)
    for position, value in counts.items():
        if 1 <= position <= 26:
            weights[int(position) - 1] += value
    return weights / weights.sum()


def _draw_fastest_lap(weights: np.ndarray, positions, classified, rng) -> np.ndarray:
    count, drivers = positions.shape
    log_weights = np.log(weights[np.clip(positions - 1, 0, len(weights) - 1)] + 1e-12)
    log_weights = np.where(classified, log_weights, -np.inf)
    gumbel = rng.gumbel(size=(count, drivers))
    keys = log_weights + gumbel
    winner = keys.argmax(axis=1)
    result = np.zeros((count, drivers), dtype=np.float32)
    result[np.arange(count), winner] = 1.0
    return result


def _dotd_design(grid, finish, classified):
    grid = np.asarray(grid, dtype=float)
    finish = np.asarray(finish, dtype=float)
    gained = np.clip(grid - finish, 0, None)
    winner = (finish == 1).astype(float)
    podium = (finish <= 3).astype(float)
    finished = np.asarray(classified, dtype=float)
    return np.stack([gained, winner, podium, finished], axis=-1)


def _fit_dotd(cutoff: int) -> np.ndarray:
    """Multinomial logit over the field for the DOTD winner (2016+ races before cutoff)."""
    dotd = data.driver_of_the_day()
    winners = dotd[(dotd["dotdRank"] == 1) & (dotd["raceId"] < cutoff)]
    results = data.load_core()["results"]
    rows = results[results["raceId"].isin(winners["raceId"])].copy()
    field = rows.groupby("raceId")["driverId"].transform("count")
    rows["grid_eff"] = rows["grid"].where(rows["grid"] > 0, field)
    rows = rows.merge(winners[["raceId", "driverId"]].assign(won=1), on=["raceId", "driverId"],
                      how="left")
    rows["won"] = rows["won"].fillna(0)
    races = [race for _, race in rows.groupby("raceId") if race["won"].sum() == 1]
    designs = []
    targets = []
    for race in races:
        design = _dotd_design(race["grid_eff"], race["positionOrder"], race["position"].notna())
        designs.append(design)
        targets.append(int(np.argmax(race["won"].to_numpy())))

    def objective(coef):
        total = 0.0
        for design, target in zip(designs, targets):
            utility = design @ coef
            shifted = utility - utility.max()
            total -= shifted[target] - np.log(np.exp(shifted).sum())
        return total / len(designs) + 1e-3 * (coef ** 2).sum()

    start = np.zeros(4)
    result = minimize(objective, start, method="L-BFGS-B")
    return result.x


def _draw_dotd(coef: np.ndarray, grid, finish, classified, rng) -> np.ndarray:
    design = _dotd_design(grid, finish, classified)
    utility = design @ coef
    gumbel = rng.gumbel(size=utility.shape)
    winner = (utility + gumbel).argmax(axis=1)
    count, drivers = grid.shape
    result = np.zeros((count, drivers), dtype=np.float32)
    result[np.arange(count), winner] = 1.0
    return result


def _pit_distributions(cutoff: int):
    """Recent pit stop point values per constructor (same pit scoring system as the cutoff)."""
    teams = fantasy_history.constructor_components()
    season = cutoff // 100
    if season >= 2025:
        same_rules = teams["season"] >= 2025
    else:
        same_rules = teams["season"] <= 2024
    past = teams[(teams["raceId"] < cutoff) & same_rules & teams["pit_points"].notna()].copy()
    past["pit_points"] = past["pit_points"].clip(0, 40)
    race_ids = np.sort(past["raceId"].unique())
    recent = past[past["raceId"].isin(race_ids[-PIT_WINDOW:])]
    values = {team: rows["pit_points"].to_numpy() for team, rows in
              recent.groupby("constructorId")}
    league = recent["pit_points"].to_numpy() if len(recent) else np.zeros(1)
    return values, league


def _sample_pit(extras: ExtrasModel, team: str, count: int, rng) -> np.ndarray:
    league = extras.league_pit_values
    own = extras.pit_values.get(team)
    if own is None or not len(own):
        return rng.choice(league, size=count).astype(np.float32)
    use_own = rng.random(count) < PIT_TEAM_WEIGHT
    own_draw = rng.choice(own, size=count)
    league_draw = rng.choice(league, size=count)
    return np.where(use_own, own_draw, league_draw).astype(np.float32)


def price_path_step(prices: np.ndarray, windows: np.ndarray, points: np.ndarray,
                    season: int) -> tuple[np.ndarray, np.ndarray]:
    """One price update for many simulated worlds at once.

    prices: (sims,) price going into the round; windows: (sims, k) earlier active gameday
    points (NaN where the asset had fewer gamedays); points: (sims,) points of this round.
    Returns the realised change and the new window (last WINDOW - 1 gamedays incl. this one).
    """
    window = np.concatenate([windows, points[:, None]], axis=1)[:, -price_rules.WINDOW:]
    counts = np.sum(~np.isnan(window), axis=1)
    mean_points = np.nansum(window, axis=1) / np.maximum(counts, 1)
    ppm = np.round(mean_points / prices + 1e-9, 2)
    tier_a = prices >= price_rules.TIER_SPLIT
    changes = np.zeros_like(prices)
    great = ppm >= 1.2
    good = (ppm >= 0.9) & ~great
    poor = (ppm > 0.6) & ~great & ~good
    terrible = ~(great | good | poor)
    for mask, rating in ((great, "great"), (good, "good"), (poor, "poor"),
                         (terrible, "terrible")):
        step = np.where(tier_a, price_rules.STEPS["A"][rating], price_rules.STEPS["B"][rating])
        changes = np.where(mask, step, changes)
    floor = price_rules.price_floor(season)
    ceiling = price_rules.price_ceiling(season)
    new_prices = np.round(np.clip(prices + changes, floor, ceiling), 1)
    realised = np.round(new_prices - prices, 1)
    keep = price_rules.WINDOW - 1
    return realised, window[:, -keep:]
