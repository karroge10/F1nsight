"""Two fantasy scorings of the same weekend with the same seed must be bit-identical.

    uv run --with pytest python -m pytest tests -q      (from ml)
"""

import numpy as np
import pandas as pd
import torch
from sklearn.linear_model import PoissonRegressor

from f1ml import fantasy, simulate

DRIVERS = 20


def test_same_seed_gives_identical_fantasy_points():
    weekend = simulate.simulate_weekend(weekend_inputs(), sims=500, seed=11)
    entrants = entrant_frame()
    extras = extras_model()
    first = fantasy.score_weekend(weekend, entrants, 2026, extras, 3.0, seed=5)
    torch.manual_seed(12345)
    np.random.seed(54321)
    torch.rand(1000)
    second = fantasy.score_weekend(weekend, entrants, 2026, extras, 3.0, seed=5)
    assert np.array_equal(first.driver_points, second.driver_points)
    assert np.array_equal(first.constructor_points, second.constructor_points)
    assert first.driver_components["overtakes"].sum() > 0


def test_same_seed_gives_identical_weekend():
    first = simulate.simulate_weekend(weekend_inputs(), sims=500, seed=11)
    torch.rand(1000)
    second = simulate.simulate_weekend(weekend_inputs(), sims=500, seed=11)
    assert np.array_equal(first.race, second.race)
    assert np.array_equal(first.quali, second.quali)


def weekend_inputs() -> simulate.WeekendInputs:
    strength = np.linspace(1.5, -1.5, DRIVERS)
    teams = np.repeat(np.arange(DRIVERS // 2), 2).astype(str)
    return simulate.WeekendInputs(race_strength=strength, p_dnf=np.full(DRIVERS, 0.08),
                                  quali_strength=strength, teams=teams)


def entrant_frame() -> pd.DataFrame:
    teams = [f"team{i // 2}" for i in range(DRIVERS)]
    return pd.DataFrame({"driverId": [f"d{i}" for i in range(DRIVERS)], "constructorId": teams})


def extras_model() -> fantasy.ExtrasModel:
    rng = np.random.default_rng(0)
    design = rng.random((400, 6))
    target = rng.poisson(3.0, size=400)
    overtakes = PoissonRegressor(alpha=1e-3, max_iter=300).fit(design, target)
    league = np.array([2.0, 5.0, 10.0])
    return fantasy.ExtrasModel(0, overtakes, overtakes, 3.0, 1.0, np.ones(26) / 26,
                               np.zeros(4), {}, league)
