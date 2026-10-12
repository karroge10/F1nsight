"""Monte Carlo race weekend and championship simulation on the GPU (torch).

Orders are sampled from a Plackett-Luce model with a position dependent temperature: the
k-th pick among the remaining cars is drawn from softmax(T_k * strength), where T_k decays
from a sharp first pick (who wins) to a flat tail (the back of the midfield is close to a
lottery). The schedule (T_1, T_inf, tau) is fitted on held out races in `bundle.fit_stack`;
a constant schedule is the ordinary Plackett-Luce model. Each pick uses fresh Gumbel noise.

Retirements are Bernoulli draws with a common team shock (both cars of a team retire together
with probability TEAM_SHOCK per race, each car's own rate lowered so its marginal pDnf is
unchanged); retired cars are classified behind every finisher in random order. Qualifying, sprint and race are sampled independently given the strengths (pre-quali
stages), so the joint spread of grid versus finish is wider than reality; once qualifying is
known the race is conditioned on the real grid through the post-qualifying model.

Announced grid penalties (`race_penalties`, `sprint_penalties`) turn each simulated qualifying
order into that world's starting grid (`penalties.apply`). They do not move the finishing order
by themselves: the caller folds their cost into the strengths (`forecast.weekend_inputs`).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import torch

from f1ml import penalties

RACE_POINTS = (25, 18, 15, 12, 10, 8, 6, 4, 2, 1)
SPRINT_POINTS = (8, 7, 6, 5, 4, 3, 2, 1)
DEFAULT_SIMS = 20000
SPRINT_DNF_FACTOR = 0.35
CONSTANT_SCHEDULE = np.array([1.0, 1.0, 1.0])
# Both cars of a team retire together (power unit, team strategy, team-mates colliding), per
# race, on top of the race-level rate; estimated by `title_odds.estimate_team_shock` on 2014-2023.
TEAM_SHOCK = 0.0034
# Championship drift on the strength scale per simulated season (fitted by `title_odds`).
TEAM_SIGMA = 0.4
DRIVER_SIGMA = 0.25


@dataclass
class WeekendInputs:
    """Inputs for one weekend. Arrays have one entry per entrant (same order everywhere).

    known_quali / known_grid / known_sprint: finishing positions (1-based) when the session is
    already done, else None. Pit lane starters get grid = field size. Schedules are
    (T_first, T_last, tau) arrays from the bundle; None means a constant temperature of 1.
    """

    race_strength: np.ndarray
    p_dnf: np.ndarray
    quali_strength: np.ndarray | None = None
    known_quali: np.ndarray | None = None
    known_grid: np.ndarray | None = None
    has_sprint: bool = False
    sprint_strength: np.ndarray | None = None
    known_sprint_grid: np.ndarray | None = None
    known_sprint: np.ndarray | None = None
    known_sprint_classified: np.ndarray | None = None
    race_schedule: np.ndarray | None = None
    quali_schedule: np.ndarray | None = None
    race_first_bonus: np.ndarray | None = None
    teams: np.ndarray | None = None
    team_shock: float = TEAM_SHOCK
    race_penalties: penalties.GridPenalties | None = None
    sprint_penalties: penalties.GridPenalties | None = None
    penalty_shift: np.ndarray | None = None  # race strength change from race penalties (info)


@dataclass
class WeekendSims:
    """Simulated outcomes, numpy arrays of shape (sims, drivers), positions 1-based."""

    quali: np.ndarray
    grid: np.ndarray
    race: np.ndarray
    classified: np.ndarray
    sprint_grid: np.ndarray | None
    sprint: np.ndarray | None
    sprint_classified: np.ndarray | None


def simulate_weekend(inputs: WeekendInputs, sims: int = DEFAULT_SIMS,
                     seed: int = 0) -> WeekendSims:
    device = _device()
    generator = torch.Generator(device=device)
    generator.manual_seed(int(seed))
    drivers = len(inputs.race_strength)
    shape = (sims, drivers)

    if inputs.known_quali is not None:
        quali = _broadcast_known(inputs.known_quali, sims, device)
    else:
        quali_strength = _tensor(inputs.quali_strength, device).expand(shape)
        quali = sample_order(quali_strength, inputs.quali_schedule, None, generator)
    if inputs.known_grid is not None:
        grid = _broadcast_known(inputs.known_grid, sims, device)
    else:
        grid = _penalised(quali, inputs.race_penalties)

    team_index = _team_index(inputs.teams, device)
    sprint_grid = sprint = sprint_classified = None
    if inputs.has_sprint:
        sprint_grid, sprint, sprint_classified = _simulate_sprint(inputs, quali, generator,
                                                                  team_index)

    race_strength = _tensor(inputs.race_strength, device).expand(shape)
    p_dnf = _tensor(inputs.p_dnf, device)
    retired = draw_retirements(p_dnf, shape, team_index, inputs.team_shock, generator)
    first_bonus = None
    if inputs.race_first_bonus is not None:
        first_bonus = _tensor(inputs.race_first_bonus, device)
    race = sample_order(race_strength, inputs.race_schedule, retired, generator, first_bonus)
    classified = ~retired
    return WeekendSims(
        quali=quali.cpu().numpy(),
        grid=grid.cpu().numpy(),
        race=race.cpu().numpy(),
        classified=classified.cpu().numpy(),
        sprint_grid=_numpy(sprint_grid),
        sprint=_numpy(sprint),
        sprint_classified=_numpy(sprint_classified),
    )


def sample_order(strength: torch.Tensor, schedule, retired, generator,
                 first_bonus: torch.Tensor | None = None) -> torch.Tensor:
    """1-based positions (sims, drivers) from sequential Plackett-Luce picks.

    strength: (sims, drivers); retired: bool (sims, drivers) or None. Finishers are picked
    first (pick k uses temperature T_k), retired cars fill the remaining places at random.
    first_bonus: optional (drivers,) logit bonus for the first pick only (grid slot effect).
    """
    sims, drivers = strength.shape
    device = strength.device
    params = CONSTANT_SCHEDULE if schedule is None else np.asarray(schedule, dtype=float)
    temperatures = _temperatures(params, drivers)
    available = torch.ones((sims, drivers), dtype=torch.bool, device=device)
    if retired is None:
        retired = torch.zeros((sims, drivers), dtype=torch.bool, device=device)
    positions = torch.zeros((sims, drivers), dtype=torch.long, device=device)
    rows = torch.arange(sims, device=device)
    for step in range(drivers):
        uniform = torch.rand((sims, drivers), generator=generator, device=device)
        gumbel = -torch.log(-torch.log(uniform.clamp(1e-7, 1 - 1e-7)))
        finisher_keys = strength * float(temperatures[step]) + gumbel
        if step == 0 and first_bonus is not None:
            finisher_keys = finisher_keys + first_bonus
        keys = torch.where(retired, gumbel - 1e6, finisher_keys)
        keys = torch.where(available, keys, torch.full_like(keys, -1e9))
        choice = keys.argmax(dim=1)
        positions[rows, choice] = step + 1
        available[rows, choice] = False
    return positions


def summarize_positions(sims: WeekendSims) -> dict[str, np.ndarray]:
    """Per driver summaries of the race; every number comes from the same simulated worlds.

    expectedPoints counts race and sprint championship points.
    """
    race = sims.race
    count, drivers = race.shape
    distribution = np.zeros((drivers, drivers))
    for position in range(drivers):
        distribution[:, position] = (race == position + 1).mean(axis=0)
    points, _ = weekend_points(sims)
    positions = np.arange(1, drivers + 1)
    return {
        "positionDist": distribution,
        "expectedPosition": distribution @ positions,
        "pWin": distribution[:, 0],
        "pPodium": distribution[:, :3].sum(axis=1),
        "pPoints": distribution[:, :10].sum(axis=1),
        "pDnf": 1.0 - sims.classified.mean(axis=0),
        "expectedPoints": points.mean(axis=0),
        "expectedQuali": sims.quali.mean(axis=0),
    }


def simulate_championship(current_points: np.ndarray, teams: np.ndarray, rounds: list[dict],
                          sims: int = DEFAULT_SIMS, seed: int = 0,
                          team_sigma: float = TEAM_SIGMA, driver_sigma: float = DRIVER_SIGMA,
                          wins: np.ndarray | None = None, team_shock: float = TEAM_SHOCK,
                          keep_totals: bool = False) -> dict:
    """Simulate the remaining rounds of a season.

    rounds: one dict per remaining race with 'race_strength', 'p_dnf', 'has_sprint',
    'schedule'; the first entry carries 'fixed_points' / 'fixed_wins' (sims, drivers) from
    the weekend simulation of the current race so both outputs agree. Car development
    uncertainty: each simulated season draws a team offset N(0, team_sigma) and a driver offset
    N(0, driver_sigma) on the strength scale, applied to every race after the current one.
    Retirements carry the common team shock (see `draw_retirements`). keep_totals adds the
    simulated final points per world, (sims, drivers), for scoring.
    """
    device = _device()
    generator = torch.Generator(device=device)
    generator.manual_seed(int(seed))
    drivers = len(current_points)
    totals = torch.as_tensor(current_points, dtype=torch.float32, device=device).repeat(sims, 1)
    win_counts = torch.zeros((sims, drivers), device=device)
    if wins is not None:
        win_counts = win_counts + torch.as_tensor(wins, dtype=torch.float32, device=device)
    team_codes = np.unique(teams, return_inverse=True)[1]
    team_index = torch.as_tensor(team_codes, device=device)
    team_count = int(team_codes.max()) + 1
    team_offset = torch.randn((sims, team_count), generator=generator, device=device)
    drift = team_offset[:, team_index] * team_sigma
    driver_noise = torch.randn((sims, drivers), generator=generator, device=device)
    drift = drift + driver_noise * driver_sigma
    race_table = torch.as_tensor(_points_lookup(RACE_POINTS, drivers), device=device)
    sprint_table = torch.as_tensor(_points_lookup(SPRINT_POINTS, drivers), device=device)
    for round_inputs in rounds:
        fixed = round_inputs.get("fixed_points")
        if fixed is not None:
            totals = totals + torch.as_tensor(fixed, dtype=torch.float32, device=device)
            fixed_wins = round_inputs["fixed_wins"]
            win_counts = win_counts + torch.as_tensor(fixed_wins, dtype=torch.float32,
                                                      device=device)
            continue
        schedule = round_inputs.get("schedule")
        strength = _tensor(round_inputs["race_strength"], device) + drift
        p_dnf = _tensor(round_inputs["p_dnf"], device)
        race_positions, race_classified = _race_draw(strength, p_dnf, schedule, generator,
                                                     team_index, team_shock)
        totals = totals + race_table[race_positions - 1] * race_classified
        win_counts = win_counts + (race_positions == 1).float()
        if round_inputs.get("has_sprint"):
            sprint_dnf = p_dnf * SPRINT_DNF_FACTOR
            sprint_shock = team_shock * SPRINT_DNF_FACTOR
            sprint_positions, sprint_classified = _race_draw(strength, sprint_dnf, schedule,
                                                             generator, team_index,
                                                             sprint_shock)
            totals = totals + sprint_table[sprint_positions - 1] * sprint_classified
    jitter = torch.rand((sims, drivers), generator=generator, device=device) * 1e-6
    ranked = totals + win_counts * 1e-3 + jitter
    champion = ranked.argmax(dim=1)
    driver_title = torch.bincount(champion, minlength=drivers).float() / sims
    team_totals = torch.zeros((sims, team_count), device=device)
    team_totals.index_add_(1, team_index, totals)
    team_champion = team_totals.argmax(dim=1)
    team_title = torch.bincount(team_champion, minlength=team_count).float() / sims
    unique_teams = np.unique(teams)
    result = {
        "driver_title": driver_title.cpu().numpy(),
        "driver_points": totals.mean(dim=0).cpu().numpy(),
        "teams": unique_teams,
        "team_title": team_title.cpu().numpy(),
        "team_points": team_totals.mean(dim=0).cpu().numpy(),
    }
    if keep_totals:
        result["totals"] = totals.cpu().numpy()
    return result


def draw_retirements(p_dnf: torch.Tensor, shape: tuple, team_index: torch.Tensor | None,
                     shock: float, generator) -> torch.Tensor:
    """Bernoulli retirements (sims, drivers) with a common team shock.

    With probability `shock` both cars of a team retire; otherwise each car retires with
    (p - shock) / (1 - shock), so every car keeps its marginal p. No team index or no shock
    gives independent draws.
    """
    device = p_dnf.device
    own_draw = torch.rand(shape, generator=generator, device=device)
    if team_index is None or shock <= 0:
        return own_draw < p_dnf
    own_rate = (p_dnf - shock).clamp(min=0.0) / (1.0 - shock)
    team_count = int(team_index.max()) + 1
    team_draw = torch.rand((shape[0], team_count), generator=generator, device=device)
    team_hit = (team_draw < shock)[:, team_index]
    return (own_draw < own_rate) | team_hit


def weekend_points(sims: WeekendSims) -> tuple[np.ndarray, np.ndarray]:
    """Championship points (race + sprint) and wins per simulated world, (sims, drivers)."""
    drivers = sims.race.shape[1]
    race_table = _points_lookup(RACE_POINTS, drivers)
    points = race_table[sims.race - 1] * sims.classified
    if sims.sprint is not None:
        sprint_table = _points_lookup(SPRINT_POINTS, drivers)
        points = points + sprint_table[sims.sprint - 1] * sims.sprint_classified
    wins = (sims.race == 1).astype(float)
    return points.astype(np.float32), wins


# ----------------------------------------------------------------------------------------------
# helpers


def _device() -> torch.device:
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


def _tensor(values, device) -> torch.Tensor:
    return torch.as_tensor(np.asarray(values, dtype=np.float32), device=device)


def _numpy(values):
    return None if values is None else values.cpu().numpy()


def _penalised(quali: torch.Tensor, grid_penalties) -> torch.Tensor:
    """Starting grid per simulated world: the qualifying order with announced penalties."""
    if grid_penalties is None:
        return quali.clone()
    order = quali.cpu().numpy()
    grid = penalties.apply(order, grid_penalties)
    return torch.as_tensor(grid, device=quali.device)


def _broadcast_known(known: np.ndarray, sims: int, device) -> torch.Tensor:
    tensor = torch.as_tensor(np.asarray(known, dtype=np.int64), device=device)
    return tensor.unsqueeze(0).repeat(sims, 1)


def _temperatures(params: np.ndarray, length: int) -> np.ndarray:
    first, last, tau = params
    steps = np.arange(length, dtype=float)
    return last + (first - last) * np.exp(-steps / tau)


def _team_index(teams, device) -> torch.Tensor | None:
    if teams is None:
        return None
    codes = np.unique(np.asarray(teams).astype(str), return_inverse=True)[1]
    return torch.as_tensor(codes, device=device)


def _simulate_sprint(inputs: WeekendInputs, quali, generator, team_index):
    sims, drivers = quali.shape
    device = quali.device
    if inputs.known_sprint_grid is not None:
        sprint_grid = _broadcast_known(inputs.known_sprint_grid, sims, device)
    else:
        sprint_grid = _penalised(quali, inputs.sprint_penalties)
    if inputs.known_sprint is not None:
        sprint = _broadcast_known(inputs.known_sprint, sims, device)
        classified_known = inputs.known_sprint_classified
        if classified_known is None:
            classified_known = np.ones(drivers, dtype=bool)
        classified = torch.as_tensor(classified_known, device=device).unsqueeze(0)
        return sprint_grid, sprint, classified.repeat(sims, 1)
    base = inputs.sprint_strength if inputs.sprint_strength is not None else inputs.race_strength
    strength = _tensor(base, device).expand((sims, drivers))
    sprint_dnf = _tensor(inputs.p_dnf, device) * SPRINT_DNF_FACTOR
    sprint_shock = inputs.team_shock * SPRINT_DNF_FACTOR
    retired = draw_retirements(sprint_dnf, (sims, drivers), team_index, sprint_shock, generator)
    sprint = sample_order(strength, inputs.race_schedule, retired, generator)
    return sprint_grid, sprint, ~retired


def _race_draw(strength: torch.Tensor, p_dnf: torch.Tensor, schedule, generator,
               team_index: torch.Tensor | None = None, shock: float = 0.0):
    retired = draw_retirements(p_dnf, tuple(strength.shape), team_index, shock, generator)
    positions = sample_order(strength, schedule, retired, generator)
    return positions, (~retired).float()


def _points_lookup(table: tuple, drivers: int) -> np.ndarray:
    lookup = np.zeros(max(drivers, len(table)), dtype=np.float32)
    lookup[:len(table)] = table
    return lookup
