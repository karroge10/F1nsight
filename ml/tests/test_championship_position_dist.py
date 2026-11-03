import numpy as np

from f1ml import export, simulate


def test_distribution_rows_follow_entrant_ids_not_rank_order():
    result = simulate.simulate_championship(
        np.array([15, 15, 50, 50, 30, 30]), np.array(["A", "A", "B", "B", "C", "C"]),
        [], sims=3, seed=7)
    np.testing.assert_array_equal(result["team_position_dist"],
                                  [[0, 0, 1], [1, 0, 0], [0, 1, 0]])
    assert result["driver_position_dist"][2, :2].sum() == 1
    assert result["driver_position_dist"][0, 4:].sum() == 1
    np.testing.assert_array_equal(result["driver_title"], [0, 0, 1, 0, 0, 0])


def test_fixed_championship_positions_and_constructor_ranking():
    teams = np.array(["A", "A", "B", "B"])
    rounds = [{"fixed_points": np.zeros((3, 4)),
               "fixed_wins": np.zeros((3, 4))}]
    result = simulate.simulate_championship(
        np.array([100, 90, 80, 70]), teams, rounds, sims=3, seed=2, keep_totals=True)
    expected = np.eye(4)
    np.testing.assert_array_equal(result["driver_position_dist"], expected)
    np.testing.assert_array_equal(result["driver_title"], expected[:, 0])
    np.testing.assert_array_equal(result["team_position_dist"], np.eye(2))
    np.testing.assert_array_equal(result["team_title"], result["team_position_dist"][:, 0])
    np.testing.assert_array_equal(result["totals"], np.tile([100, 90, 80, 70], (3, 1)))


def test_position_distributions_normalize_by_entrant_and_position():
    teams = np.array(["A", "A", "B", "B"])
    rounds = [{"race_strength": np.array([1.0, 0.4, -0.2, -0.8]),
               "p_dnf": np.zeros(4), "has_sprint": False}]
    result = simulate.simulate_championship(np.zeros(4), teams, rounds, sims=100, seed=7)
    for key, count in (("driver_position_dist", 4), ("team_position_dist", 2)):
        dist = result[key]
        assert dist.shape == (count, count)
        np.testing.assert_allclose(dist.sum(axis=1), 1)
        np.testing.assert_allclose(dist.sum(axis=0), 1)
    np.testing.assert_array_equal(result["driver_title"], result["driver_position_dist"][:, 0])


def test_championship_export_includes_optional_distributions():
    result = {"driverIds": ["d1", "d2"], "driver_title": np.array([0.75, 0.25]),
              "driver_points": np.array([20, 10]), "teams": np.array(["A", "B"]),
              "team_title": np.array([0.8, 0.2]), "team_points": np.array([30, 5]),
              "driver_position_dist": np.array([[0.75, 0.25], [0.25, 0.75]]),
              "team_position_dist": np.array([[0.8, 0.2], [0.2, 0.8]]), "remaining": 2}
    payload = export._championship_block(result)
    assert payload["drivers"][0]["positionDist"] == [0.75, 0.25]
    assert payload["drivers"][0]["pTitle"] == payload["drivers"][0]["positionDist"][0]
    assert payload["constructors"][0]["positionDist"] == [0.8, 0.2]
    legacy = dict(result)
    legacy.pop("driver_position_dist")
    legacy.pop("team_position_dist")
    legacy_payload = export._championship_block(legacy)
    assert all("positionDist" not in row for row in legacy_payload["drivers"])
    assert all("positionDist" not in row for row in legacy_payload["constructors"])
