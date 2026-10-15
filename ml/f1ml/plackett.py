"""Plackett-Luce helpers: log likelihood of an observed order, temperature / stacking fits.

A race is a list of drivers ordered by finishing position (classified finishers only). A
model gives each driver a log-strength s; the probability of the observed order is
prod_k exp(s_k) / sum_{j>=k} exp(s_j).
"""

from __future__ import annotations

import numpy as np
from scipy.optimize import minimize, minimize_scalar
from scipy.special import logsumexp


def race_groups(frame, score_cols, order_col) -> list[tuple[np.ndarray, ...]]:
    """Per race: arrays of each score column ordered by `order_col` (rows with an order only)."""
    groups = []
    ranked = frame[frame[order_col].notna()]
    for _, race in ranked.groupby("raceId", sort=True):
        if len(race) < 2:
            continue
        ordered = race.sort_values(order_col)
        arrays = tuple(ordered[col].to_numpy(dtype=float) for col in score_cols)
        groups.append(arrays)
    return groups


def loglik(ordered_scores: np.ndarray) -> float:
    """Plackett-Luce log likelihood of one race, scores already in finishing order."""
    reversed_scores = ordered_scores[::-1]
    running = np.logaddexp.accumulate(reversed_scores)[::-1]
    return float((ordered_scores - running).sum())


def mean_nll(groups: list, weights: np.ndarray) -> float:
    """Average negative log likelihood per race of a linear blend of score columns."""
    total = 0.0
    for arrays in groups:
        blended = np.zeros_like(arrays[0])
        for weight, scores in zip(weights, arrays):
            blended = blended + weight * scores
        total -= loglik(blended)
    return total / max(len(groups), 1)


def fit_temperature(groups: list) -> float:
    """Scale a (single score column) that maximises the likelihood: strengths = a * score."""
    def objective(log_scale):
        scale = np.exp(log_scale)
        return mean_nll(groups, np.array([scale]))

    result = minimize_scalar(objective, bounds=(-6.0, 4.0), method="bounded")
    return float(np.exp(result.x))


def fit_blend(groups: list) -> np.ndarray:
    """Non-negative weights for several score columns, jointly fitting blend and temperature."""
    count = len(groups[0])
    start = np.full(count, 0.5)

    def objective(raw):
        weights = np.abs(raw)
        return mean_nll(groups, weights)

    result = minimize(objective, start, method="Nelder-Mead",
                      options={"xatol": 1e-4, "fatol": 1e-6, "maxiter": 2000})
    return np.abs(result.x)


def win_probabilities(strengths: np.ndarray) -> np.ndarray:
    """Exact P(first) under Plackett-Luce, softmax of the strengths."""
    shifted = strengths - logsumexp(strengths)
    return np.exp(shifted)


def schedule(params: np.ndarray, length: int) -> np.ndarray:
    """Temperature per choice step k = 1..length: b + (a - b) * exp(-(k - 1) / tau).

    a: sharpness of the first pick (the winner), b: sharpness deep in the order, tau: how
    fast it decays. A constant schedule (a = b) is the ordinary Plackett-Luce model.
    """
    first, last, tau = params
    steps = np.arange(length, dtype=float)
    return last + (first - last) * np.exp(-steps / tau)


def loglik_schedule(ordered_scores: np.ndarray, temperatures: np.ndarray) -> float:
    """Log likelihood of an order where step k chooses with softmax(temperature_k * scores)."""
    total = 0.0
    count = len(ordered_scores)
    for k in range(count - 1):
        remaining = ordered_scores[k:] * temperatures[k]
        total += remaining[0] - logsumexp(remaining)
    return float(total)


def fit_schedule(groups: list) -> np.ndarray:
    """Fit (a, b, tau) on single-column race groups by maximum likelihood (vectorised)."""
    scores, valid = _padded(groups)
    width = scores.shape[1]
    # later[k, j] is True when car j is still unchosen at step k (j >= k)
    later = np.triu(np.ones((width, width), dtype=bool))
    alive = later[None, :, :] & valid[:, None, :]
    step_valid = valid[:, :-1]
    chosen = scores[:, :-1]

    def objective(raw):
        params = np.exp(raw)
        temperatures = schedule(params, width)
        scaled = scores[:, None, :] * temperatures[None, :, None]
        masked = np.where(alive, scaled, -np.inf)
        normaliser = logsumexp(masked, axis=2)[:, :-1]
        picked = chosen * temperatures[None, :-1]
        terms = np.where(step_valid & valid[:, 1:], picked - normaliser, 0.0)
        return -terms.sum() / len(groups)

    start = np.log(np.array([2.0, 1.0, 3.0]))
    result = minimize(objective, start, method="Nelder-Mead",
                      options={"xatol": 1e-3, "fatol": 1e-5, "maxiter": 600})
    return np.exp(result.x)


def _padded(groups: list) -> tuple[np.ndarray, np.ndarray]:
    width = max(len(scores) for (scores,) in groups)
    scores = np.zeros((len(groups), width))
    valid = np.zeros((len(groups), width), dtype=bool)
    for i, (values,) in enumerate(groups):
        scores[i, :len(values)] = values
        valid[i, :len(values)] = True
    return scores, valid


def fit_first_pick(groups: list) -> float:
    """Temperature that maximises the likelihood of the winner only (first pick)."""
    scores, valid = _padded(groups)
    masked = np.where(valid, scores, -np.inf)
    winners = scores[:, 0]

    def objective(log_scale):
        scale = np.exp(log_scale)
        normaliser = logsumexp(masked * scale, axis=1)
        return float(-(winners * scale - normaliser).mean())

    result = minimize_scalar(objective, bounds=(-6.0, 4.0), method="bounded")
    return float(np.exp(result.x))


GRID_BONUS_SLOTS = 3
GRID_BONUS_PENALTY = 0.05


def fit_first_pick_grid(frame) -> tuple[float, list[float]]:
    """Winner likelihood fit of a temperature plus a bonus for grid slots 1..3 (L2 penalised).

    frame: raceId, y_finish, strength, grid. The bonus corrects how much a front row start is
    worth on top of the ranker's own use of the grid (pole was worth more than the rankers
    implied, 2019 onwards).
    """
    races = []
    for _, race in frame[frame["y_finish"].notna()].groupby("raceId"):
        strength = race["strength"].to_numpy(dtype=float)
        grid = race["grid"].fillna(99).to_numpy(dtype=float)
        slots = np.stack([(grid == k + 1).astype(float) for k in range(GRID_BONUS_SLOTS)], axis=1)
        winner = race["y_finish"].to_numpy() == 1
        if winner.any():
            races.append((strength, slots, winner))

    def objective(params):
        scale = np.exp(params[0])
        bonus = params[1:]
        total = 0.0
        for strength, slots, winner in races:
            logits = scale * strength + slots @ bonus
            total -= logits[winner].sum() - logsumexp(logits)
        return total / len(races) + GRID_BONUS_PENALTY * float((bonus ** 2).sum())

    start = np.zeros(GRID_BONUS_SLOTS + 1)
    result = minimize(objective, start, method="Nelder-Mead",
                      options={"xatol": 1e-4, "fatol": 1e-6, "maxiter": 3000})
    return float(np.exp(result.x[0])), [float(v) for v in result.x[1:]]


def fit_grid_term(frame) -> float:
    """Full-order likelihood fit of g in strength - g * rgrid (frame: raceId, y_finish, strength,
    rgrid). Round 10 experiment (F1ML_GRIDTERM)."""
    frame = frame[frame["rgrid"].notna()]
    groups = race_groups(frame, ["strength", "rgrid"], "y_finish")

    def objective(params):
        return mean_nll(groups, np.array([1.0, -params[0]]))

    result = minimize(objective, np.zeros(1), method="Nelder-Mead",
                      options={"xatol": 1e-4, "fatol": 1e-6, "maxiter": 400})
    return float(result.x[0])
