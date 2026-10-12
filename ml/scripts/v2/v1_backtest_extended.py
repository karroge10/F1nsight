"""Run the published (v1) walk-forward backtest on extra seasons without touching published files.

    PYTHONPATH=. uv run python scripts/v2/v1_backtest_extended.py 2019 2020 2021 2022 2023

Per race records go to reports/v2/v1_races_<first>_<last>.json and per driver rows to
reports/v2/v1_driver_rows_<first>_<last>.parquet. data/predictions is never written.
"""

import json
import sys
import warnings

from f1ml import backtest, paths

V2_REPORTS = paths.REPORTS_DIR / "v2"


def main() -> None:
    warnings.filterwarnings("ignore", category=RuntimeWarning)
    seasons = [int(value) for value in sys.argv[1:]] or [2019, 2020, 2021, 2022, 2023]
    V2_REPORTS.mkdir(parents=True, exist_ok=True)
    tag = f"{seasons[0]}_{seasons[-1]}"
    scratch = V2_REPORTS / f"v1_scratch_{tag}"
    scratch.mkdir(exist_ok=True)
    paths.REPORTS_DIR = scratch
    result = backtest.run_backtest(seasons, 3, 20000, True, 0, False)
    races = result["races"]
    target = V2_REPORTS / f"v1_races_{tag}.json"
    target.write_text(json.dumps(races, default=float), encoding="utf-8")
    rows_path = scratch / "backtest_driver_rows.parquet"
    if rows_path.exists():
        rows_path.replace(V2_REPORTS / f"v1_driver_rows_{tag}.parquet")
    print(f"saved {len(races)} races -> {target}")


if __name__ == "__main__":
    main()
