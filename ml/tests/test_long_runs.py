"""Checks for the long run features (lr_gap, lr_rank, lr_deg).

    uv run --with pytest python -m pytest tests -q      (from ml)
"""

import pandas as pd
import pytest

from f1ml import data, features

RACE = 202110
SPRINT_RACE_2021 = 202114


def test_main_session_gives_gap_to_the_best_driver():
    runs = _runs(RACE, "FP2", {"a": 90.0, "b": 90.9, "c": 91.8, "d": 90.45})
    table = _features_from(runs, sprint=False)
    assert table.loc["a", "lr_gap"] == pytest.approx(0.0)
    assert table.loc["b", "lr_gap"] == pytest.approx(1.0)
    assert table.loc["b", "lr_rank"] == 3


def test_driver_missing_from_main_session_is_bridged_from_another():
    main = _runs(RACE, "FP2", {"a": 90.0, "b": 90.9, "c": 91.8, "d": 90.45, "e": 91.35})
    fp1 = _runs(RACE, "FP1", {"a": 91.0, "b": 91.91, "c": 92.82, "d": 91.455, "f": 91.0})
    table = _features_from(pd.concat([main, fp1], ignore_index=True), sprint=False)
    assert table.loc["f", "lr_gap"] == pytest.approx(0.0, abs=0.02)
    assert table.loc["a", "lr_gap"] == pytest.approx(0.0)
    assert len(table) == 6


def test_no_bridge_without_enough_common_drivers():
    main = _runs(RACE, "FP2", {"a": 90.0, "b": 90.9, "c": 91.8, "d": 90.45, "e": 91.35})
    fp1 = _runs(RACE, "FP1", {"a": 91.0, "f": 91.0})
    table = _features_from(pd.concat([main, fp1], ignore_index=True), sprint=False)
    assert "f" not in table.index


def test_practice_after_qualifying_on_old_sprint_weekend_is_ignored():
    fp1 = _runs(SPRINT_RACE_2021, "FP1", {"a": 91.0, "b": 91.5})
    fp2 = _runs(SPRINT_RACE_2021, "FP2", {"a": 92.0, "b": 90.0, "c": 90.5, "d": 91.0})
    table = _features_from(pd.concat([fp1, fp2], ignore_index=True), sprint=True)
    assert set(table.index) == {"a", "b"}
    assert table.loc["a", "lr_gap"] == pytest.approx(0.0)


def _features_from(runs: pd.DataFrame, sprint: bool) -> pd.DataFrame:
    races = pd.DataFrame({"hasSprint": [sprint]}, index=[int(runs["raceId"].iloc[0])])
    original = data.long_run_pace
    data.long_run_pace = lambda: runs
    try:
        table = features._long_run_features(races)
    finally:
        data.long_run_pace = original
    return table.set_index("driverId")


def _runs(race_id: int, session: str, paces: dict) -> pd.DataFrame:
    rows = [(race_id, driver, session, pace, 10, 0.05) for driver, pace in paces.items()]
    columns = ["raceId", "driverId", "session", "longRunS", "longRunLaps", "degSlope"]
    return pd.DataFrame(rows, columns=columns)
