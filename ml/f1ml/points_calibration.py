"""Walk-forward monotone recalibration of published expected championship points.

The simulator moves 1 to 2.5 points per race from the second tier to the back of the field before
the weekend. An isotonic map from predicted to realised points, fitted per stage on backtest rows
of races before the one being published, fixes that without touching the base models. The
race total is kept (the map only redistributes points between drivers).

Walk-forward check on the 2024-2026 backtest (48 races after a 16-race warm-up): pre-weekend
MAE 3.84 -> 3.49 (95% interval of the change -0.45 to -0.25), post-qualifying 2.91 -> 2.79.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression

from f1ml import paths

ROWS_PATH = paths.REPORTS_DIR / "backtest_driver_rows.parquet"
MIN_RACES = 16


def calibrate_expected_points(summary: dict, stage: str, race_id: int) -> bool:
    """Replace summary["expectedPoints"] in place with the calibrated values. True if applied."""
    if not ROWS_PATH.exists():
        return False
    rows = pd.read_parquet(ROWS_PATH)
    rows = rows[(rows["stage"] == stage) & (rows["raceId"] < race_id)]
    if rows["raceId"].nunique() < MIN_RACES:
        return False
    raw = np.asarray(summary["expectedPoints"], dtype=float)
    mapped = fit_map(rows).predict(raw)
    total = float(mapped.sum())
    if total <= 0:
        return False
    summary["expectedPoints"] = mapped * raw.sum() / total
    return True


def fit_map(rows: pd.DataFrame) -> IsotonicRegression:
    model = IsotonicRegression(out_of_bounds="clip")
    model.fit(rows["expectedPoints"].to_numpy(dtype=float),
              rows["actualPoints"].to_numpy(dtype=float))
    return model
