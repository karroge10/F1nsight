"""Checks for the compound and track evolution corrected practice pace.

    uv run --with pytest python -m pytest tests -q      (from ml)
"""

import numpy as np
import pandas as pd

from f1ml import features, practice_pace

SOFT_OVER_MEDIUM = 0.7


def test_medium_only_driver_is_not_penalised_for_the_tyre():
    laps = _session(pace={"a": 90.0, "b": 90.1, "c": 90.2}, medium_only={"b"})
    gaps = _gaps(laps)
    assert gaps["b"] < 0.3
    assert gaps["a"] < gaps["c"]


def test_raw_gap_would_have_counted_the_tyre():
    laps = _session(pace={"a": 90.0, "b": 90.1, "c": 90.2}, medium_only={"b"})
    raw_best = laps.groupby("driverId")["lapTimeS"].min()
    raw_gap = (raw_best["b"] / raw_best["a"] - 1.0) * 100.0
    assert raw_gap > 0.6


def test_offsets_follow_the_session_when_drivers_ran_two_compounds():
    laps = _session(pace={"a": 90.0, "b": 90.1, "c": 90.2}, medium_only=set())
    fit = practice_pace.fit_session(laps, use_prior=True)
    assert abs(fit["coefficients"]["MEDIUM"] - SOFT_OVER_MEDIUM) < 0.15


def test_driver_with_too_few_push_laps_gets_no_gap():
    laps = _session(pace={"a": 90.0, "b": 90.1, "c": 90.2}, medium_only=set())
    few = laps[(laps["driverId"] != "c") | (laps["lapNumber"] <= 2)]
    gaps = _gaps(few)
    assert "c" not in gaps


def test_red_flag_laps_and_deleted_laps_are_ignored():
    laps = _session(pace={"a": 90.0, "b": 90.1, "c": 90.2}, medium_only=set())
    fast = laps.index[(laps["driverId"] == "c") & (laps["lapNumber"] == 5)]
    laps.loc[fast, "lapTimeS"] = 89.0
    laps.loc[fast, "trackStatus"] = "15"
    gaps = _gaps(laps)
    assert gaps["c"] > gaps["a"]
    assert gaps["c"] > 0.1


def test_corrected_gap_replaces_raw_gap_in_covered_sessions_only():
    practice = pd.DataFrame({
        "raceId": [1, 1, 1, 2], "session": ["FP1", "FP1", "FP1", "FP1"],
        "driverId": ["a", "b", "c", "a"], "gap": [0.0, 0.8, 1.0, 0.3],
        "rank": [1.0, 2.0, 3.0, 1.0],
    })
    corrected = pd.DataFrame({"raceId": [1, 1], "session": ["FP1", "FP1"],
                              "driverId": ["a", "b"], "pace_gap": [0.2, 0.0],
                              "pace_rank": [2.0, 1.0], "push_laps": [5, 5],
                              "compound": ["SOFT", "MEDIUM"]})
    merged = features._apply_corrected(practice, corrected).set_index(["raceId", "driverId"])
    assert merged.loc[(1, "b"), "gap"] == 0.0
    assert np.isnan(merged.loc[(1, "c"), "gap"])
    assert merged.loc[(2, "a"), "gap"] == 0.3


def _gaps(laps: pd.DataFrame) -> dict:
    result = practice_pace.corrected_gaps(laps)
    return dict(zip(result["driverId"], result["pace_gap"].round(3)))


def _session(pace: dict, medium_only: set) -> pd.DataFrame:
    """Ten synthetic drivers, three laps per compound, no track evolution or tyre wear.

    Half the field runs Soft first and half Medium first, so compound and time of day are not
    confounded; drivers in `medium_only` never fit a Soft.
    """
    rows = []
    fillers = {f"z{i}": 91.0 + 0.1 * i for i in range(7)}
    everyone = {**pace, **fillers}
    for index, (driver, base) in enumerate(everyone.items()):
        soft_first = index % 2 == 1
        for lap in range(1, 7):
            second_run = lap > 3
            soft_run = second_run != soft_first and driver not in medium_only
            compound = "SOFT" if soft_run else "MEDIUM"
            offset = 0.0 if soft_run else base * SOFT_OVER_MEDIUM / 100.0
            rows.append({
                "raceId": 202601, "session": "FP2", "driverId": driver, "lapNumber": lap,
                "lapTimeS": base + offset, "lapStartS": 600.0 + 300.0 * lap,
                "pitInS": np.nan, "pitOutS": np.nan, "compound": compound,
                "tyreLife": 1.0 + (lap - 1) % 3, "trackStatus": "1", "deleted": False,
            })
    return pd.DataFrame(rows)
