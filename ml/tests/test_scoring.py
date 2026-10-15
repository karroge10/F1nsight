"""Checks for the scorecard scores, the title-odds CRPS and the team retirement shock.

    uv run --with pytest python -m pytest tests -q      (from ml)
"""

import numpy as np
import torch

from f1ml import plackett, scorecard, simulate, title_odds


def test_rps_is_zero_for_a_certain_correct_forecast():
    distribution = np.eye(4)
    actual = np.array([1, 2, 3, 4], dtype=float)
    assert scorecard.ranked_probability_score(distribution, actual) == 0.0


def test_rps_prefers_the_closer_miss():
    actual = np.array([1.0])
    near = np.array([[0.0, 1.0, 0.0, 0.0]])
    far = np.array([[0.0, 0.0, 0.0, 1.0]])
    near_score = scorecard.ranked_probability_score(near, actual)
    far_score = scorecard.ranked_probability_score(far, actual)
    assert near_score < far_score


def test_order_likelihood_matches_plain_plackett_luce():
    strength = np.array([1.0, 0.5, -0.2, 0.3])
    finish = np.array([2.0, 1.0, 4.0, 3.0])
    classified = np.ones(4, dtype=bool)
    p_dnf = np.full(4, 0.1)
    order_nll, dnf_nll = scorecard.order_log_likelihood(strength, None, None, finish,
                                                        classified, p_dnf)
    ordered = strength[np.argsort(finish)]
    expected = -plackett.loglik(ordered)
    assert np.isclose(order_nll, expected)
    assert np.isclose(dnf_nll, -4 * np.log(0.9))


def test_crps_of_standard_normal_at_zero():
    rng = np.random.default_rng(0)
    samples = rng.standard_normal((40000, 1))
    value = title_odds.crps_samples(samples, np.zeros(1))[0]
    assert abs(value - 0.2337) < 0.01


def test_team_shock_keeps_marginal_and_adds_correlation():
    generator = torch.Generator()
    generator.manual_seed(1)
    p_dnf = torch.full((4,), 0.15)
    team_index = torch.tensor([0, 0, 1, 1])
    shape = (200000, 4)
    retired = simulate.draw_retirements(p_dnf, shape, team_index, 0.05, generator)
    retired = retired.float().numpy()
    assert np.allclose(retired.mean(axis=0), 0.15, atol=0.005)
    both = (retired[:, 0] * retired[:, 1]).mean()
    assert both > 0.15 ** 2 + 0.03
