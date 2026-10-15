"""Recent fantasy points per asset, with and without fantasy ids (2024 and 2025 have none).

    uv run --with pytest python -m pytest tests -q      (from ml)
"""

import numpy as np
import pandas as pd

from f1ml import export


def test_previous_points_found_without_fantasy_ids():
    book = asset_book(fantasy_id=np.nan)
    info = book.lookup("driver", "max_verstappen")
    assert info["previous"] == [10.0, 20.0]
    team = book.lookup("constructor", "red_bull")
    assert team["previous"] == [30.0, 40.0]


def test_previous_points_follow_fantasy_id_when_present():
    book = asset_book(fantasy_id="131")
    info = book.lookup("driver", "max_verstappen")
    assert info["previous"] == [10.0, 20.0]


def asset_book(fantasy_id) -> export.AssetBook:
    book = object.__new__(export.AssetBook)
    book.season = 2025
    book.round = 3
    book.rows = pd.DataFrame({
        "kind": ["driver", "constructor"],
        "driverId": ["max_verstappen", np.nan],
        "constructorId": ["red_bull", "red_bull"],
        "fantasyId": [fantasy_id, fantasy_id if pd.isna(fantasy_id) else "9"],
        "price": [29.0, 28.0],
        "fantasyName": ["M. Verstappen", "Red Bull"],
    })
    book.points = pd.DataFrame({
        "kind": ["driver", "driver", "constructor", "constructor", "driver"],
        "driverId": ["max_verstappen", "max_verstappen", np.nan, np.nan, "tsunoda"],
        "constructorId": ["red_bull", "red_bull", "red_bull", "red_bull", "red_bull"],
        "fantasyId": [fantasy_id, fantasy_id, "9", "9", "77"] if pd.notna(fantasy_id)
        else [np.nan] * 5,
        "round": [1, 2, 1, 2, 1],
        "points": [10.0, 20.0, 30.0, 40.0, 5.0],
    })
    return book
