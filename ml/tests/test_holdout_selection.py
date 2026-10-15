"""Race selection of the walk-forward backtest (--first-race, --limit).

    uv run --with pytest python -m pytest tests -q      (from ml)
"""

import pandas as pd

from f1ml.backtest import select_race_ids

LABELLED = pd.DataFrame({"season": [2025, 2026, 2026, 2026, 2026],
                         "raceId": [202524, 202616, 202617, 202618, 202617]})


def test_default_keeps_every_race_of_the_season():
    assert select_race_ids(LABELLED, 2026) == [202616, 202617, 202618]


def test_first_race_drops_earlier_races():
    assert select_race_ids(LABELLED, 2026, first_race=202617) == [202617, 202618]


def test_limit_applies_after_first_race():
    assert select_race_ids(LABELLED, 2026, limit=1, first_race=202617) == [202617]
