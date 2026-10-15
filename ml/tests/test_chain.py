"""Qualifying chain (forecast.RaceChain): race draws per qualifying order and its likelihood.

    uv run --with pytest python -m pytest tests -q      (from ml)
"""

import numpy as np

from f1ml import forecast, scorecard, simulate

DRIVERS = 6
WORLDS = 4


def test_chain_likelihood_with_identical_orders_equals_the_plain_likelihood():
    chain = race_chain(identical=True)
    finish = np.array([2.0, 1.0, 3.0, 4.0, 5.0, np.nan])
    classified = np.array([True, True, True, True, True, False])
    order_nll, dnf_nll = scorecard.chain_log_likelihood(chain, finish, classified)
    plain_order, plain_dnf = scorecard.order_log_likelihood(
        chain.strength[0], chain.schedule, chain.bonus[0], finish, classified, chain.p_dnf[0])
    assert np.isclose(order_nll + dnf_nll, plain_order + plain_dnf)


def test_chained_weekend_takes_quali_and_grid_from_its_order():
    chain = race_chain(identical=False)
    inputs = simulate.WeekendInputs(race_strength=np.zeros(DRIVERS),
                                    p_dnf=np.full(DRIVERS, 0.1),
                                    quali_strength=np.zeros(DRIVERS))
    weekend = simulate.simulate_weekend(inputs, sims=40, seed=3)
    chained = forecast.chained_weekend(chain, inputs, weekend, seed=3)
    for sim in range(40):
        world = sim % WORLDS
        assert np.array_equal(chained.quali[sim], chain.quali[world])
        assert np.array_equal(chained.grid[sim], chain.grid[world])
    assert sorted(chained.race[0].tolist()) == list(range(1, DRIVERS + 1))


def race_chain(identical: bool) -> forecast.RaceChain:
    rng = np.random.default_rng(1)
    orders = np.stack([rng.permutation(DRIVERS) + 1 for _ in range(WORLDS)])
    strength = rng.normal(size=(WORLDS, DRIVERS))
    if identical:
        orders[:] = orders[0]
        strength[:] = strength[0]
    return forecast.RaceChain(quali=orders, grid=orders.copy(), strength=strength,
                              p_dnf=np.full((WORLDS, DRIVERS), 0.1),
                              bonus=np.zeros((WORLDS, DRIVERS)),
                              schedule=np.array([1.5, 0.8, 4.0]), shift=np.zeros(DRIVERS))
