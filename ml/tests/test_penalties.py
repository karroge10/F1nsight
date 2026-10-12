"""Announced grid penalties: grid order, per-stage inputs, simulation and explanations.

    uv run --with pytest python -m pytest tests -q      (from v2/ml)
"""

import numpy as np
import pandas as pd

from f1ml import explain, features, forecast, penalties, simulate


def test_no_penalty_keeps_the_qualifying_order():
    qualifying = np.array([3, 1, 2, 4])
    assert penalties.apply(qualifying, None).tolist() == [3, 1, 2, 4]


def test_place_penalty_slots_in_behind_the_car_that_qualified_n_places_back():
    qualifying = np.arange(1, 11)
    grid_penalties = _penalties(10, places={2: 5})
    grid = penalties.apply(qualifying, grid_penalties)
    assert grid[2] == 8
    assert sorted(grid.tolist()) == list(range(1, 11))
    assert grid[3] == 3 and grid[7] == 7 and grid[8] == 9


def test_penalty_past_the_field_back_of_grid_and_pit_lane_order():
    qualifying = np.arange(1, 7)
    grid_penalties = _penalties(6, places={0: 40}, back={3}, pit_lane={1, 4})
    grid = penalties.apply(qualifying, grid_penalties)
    # unpenalised P3 and P6 first, then back of grid in qualifying order, then the pit lane
    assert grid.tolist() == [3, 5, 1, 4, 6, 2]


def test_apply_works_per_simulated_world():
    sims = np.array([[1, 2, 3], [3, 1, 2]])
    grid_penalties = _penalties(3, places={0: 40})
    grid = penalties.apply(sims, grid_penalties)
    assert grid.tolist() == [[3, 1, 2], [3, 1, 2]]


def test_for_frame_sums_rows_and_treats_big_power_unit_penalties_as_back_of_grid():
    table = pd.DataFrame({
        "raceId": [1, 1, 1, 1],
        "driverId": ["a", "a", "b", "c"],
        "kind": ["places", "places", "places", "pit_lane"],
        "places": [10, 10, 5, None],
        "category": ["power_unit", "power_unit", "other", "other"],
        "appliesTo": ["race", "race", "race", "sprint"],
    })
    race = penalties.for_frame(table, ["a", "b", "c", "d"], "race")
    assert race.places.tolist() == [20, 5, 0, 0]
    assert race.back.tolist() == [True, False, False, False]
    assert race.labels[0] == "+20 places"
    sprint = penalties.for_frame(table, ["a", "b", "c", "d"], "sprint")
    assert sprint.pit_lane.tolist() == [False, False, True, False]
    assert penalties.for_frame(table, ["d"], "race") is None
    assert penalties.for_frame(None, ["a"], "race") is None


def test_pre_qualifying_penalty_lowers_only_the_penalised_driver_and_spares_the_sprint():
    frame = _frame(4, has_sprint=True)
    bundle = _GridBundle()
    prediction = bundle.predict(frame, "post-practice")
    announced = _announced("d0", 40, "race")
    inputs = forecast.weekend_inputs(bundle, frame, "post-practice", prediction, announced)
    base = prediction["race_strength"].to_numpy()
    shift = inputs.race_strength - base
    assert shift[0] < 0
    assert np.allclose(shift[1:], 0.0)
    assert np.allclose(inputs.sprint_strength, base)
    assert inputs.race_penalties is not None and inputs.sprint_penalties is None
    # grid 1 -> 4 costs 3 * 0.5 on the post-qualifying scale, times the temperature ratio 2
    assert np.isclose(shift[0], -3.0)


def test_post_qualifying_ignores_the_shift_and_uses_the_frame_grid():
    frame = _frame(4, has_sprint=False)
    frame["q_pos"] = [1.0, 2.0, 3.0, 4.0]
    frame["grid"] = [4.0, 1.0, 2.0, 3.0]
    bundle = _GridBundle()
    prediction = bundle.predict(frame, "post-qualifying")
    announced = _announced("d0", 40, "race")
    inputs = forecast.weekend_inputs(bundle, frame, "post-qualifying", prediction, announced)
    assert inputs.penalty_shift is None
    assert inputs.known_grid.tolist() == [4, 1, 2, 3]


def test_simulated_grid_carries_the_penalty_in_every_world():
    grid_penalties = _penalties(4, places={0: 40})
    inputs = simulate.WeekendInputs(
        race_strength=np.array([2.0, 1.0, 0.5, 0.0]), p_dnf=np.full(4, 0.05),
        quali_strength=np.array([5.0, 1.0, 0.5, 0.0]), race_penalties=grid_penalties,
        has_sprint=True)
    sims = simulate.simulate_weekend(inputs, sims=500, seed=3)
    assert (sims.grid[:, 0] == 4).all()
    assert (sims.sprint_grid == sims.quali).all()


def test_explanation_puts_the_announced_penalty_first():
    grid_penalties = _penalties(3, places={1: 40})
    announced = {"race": grid_penalties, "sprint": None, "shift": np.array([0.0, -0.8, 0.0])}
    existing = [{"kind": "practice_pace", "label": "Practice pace", "value": "Fastest",
                 "impact": 0.1, "detail": "x"}]
    row = pd.Series({"grid": np.nan})
    factors = explain.penalty_factors(list(existing), announced, 1, row, 0.0)
    assert factors[0]["label"] == "Grid penalty"
    assert factors[0]["value"] == "+40 places"
    assert factors[0]["impact"] == -0.8
    assert "40-place grid penalty for the Grand Prix" in factors[0]["detail"]
    untouched = explain.penalty_factors(list(existing), announced, 0, row, 0.0)
    assert untouched == existing


def test_features_apply_announced_penalties_only_without_an_official_grid(monkeypatch):
    announced = _announced("b", 40, "race")
    monkeypatch.setattr(penalties, "load", lambda race_id: announced)
    gaps = pd.DataFrame({
        "raceId": [1, 1, 1, 2, 2, 2],
        "driverId": ["a", "b", "c", "a", "b", "c"],
        "q_pos": [1.0, 2.0, 3.0, 1.0, 2.0, 3.0],
        "grid_raw": [1.0, 2.0, 3.0, 1.0, 2.0, 3.0],
    })
    official = pd.Series([False, False, False, True, True, True])
    result = features._announced_grid(gaps, official)
    assert result["grid_raw"].tolist() == [1.0, 3.0, 2.0, 1.0, 2.0, 3.0]


# ----------------------------------------------------------------------------------------------
# helpers


class _GridBundle:
    """Post-qualifying strength = -0.5 per grid slot; other stages use a fixed strength."""

    def predict(self, frame, stage):
        out = pd.DataFrame(index=frame.index)
        if stage == "post-qualifying":
            out["race_strength"] = -0.5 * frame["grid"].to_numpy(dtype=float)
            out["quali_strength"] = np.nan
        else:
            out["race_strength"] = np.linspace(1.0, 0.0, len(frame))
            out["quali_strength"] = np.linspace(2.0, 0.0, len(frame))
        out["p_dnf"] = 0.1
        return out

    def schedule(self, stage, kind="race"):
        first = 2.0 if stage == "post-qualifying" else 1.0
        return np.array([first, 0.5, 5.0])

    def grid_bonus(self, stage, grid):
        return None


def _frame(count: int, has_sprint: bool) -> pd.DataFrame:
    nan = np.full(count, np.nan)
    return pd.DataFrame({
        "driverId": [f"d{i}" for i in range(count)],
        "constructorId": [f"t{i // 2}" for i in range(count)],
        "has_sprint": has_sprint, "sprint_pre_q": 1,
        "sq_pos": nan, "sq_gap": nan, "sp_fin": nan, "sp_dnf": nan,
        "fp_best_gap": np.linspace(0.0, 1.0, count), "q_gap": nan, "q_pos": nan, "grid": nan,
        "grid_pen": nan, "pitlane": nan,
    })


def _announced(driver_id: str, places: int, applies_to: str) -> pd.DataFrame:
    return pd.DataFrame({"raceId": [1], "driverId": [driver_id], "kind": ["places"],
                         "places": [places], "category": ["power_unit"],
                         "appliesTo": [applies_to]})


def _penalties(count: int, places=None, back=(), pit_lane=()) -> penalties.GridPenalties:
    drop = np.zeros(count)
    for index, amount in (places or {}).items():
        drop[index] = amount
    back_mask = np.isin(np.arange(count), list(back))
    pit_mask = np.isin(np.arange(count), list(pit_lane))
    labels = [None] * count
    for index in range(count):
        labels[index] = penalties._label(drop[index], back_mask[index], pit_mask[index])
    return penalties.GridPenalties(drop, back_mask, pit_mask, labels, ["other"] * count)
