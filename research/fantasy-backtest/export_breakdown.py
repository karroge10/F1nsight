"""Per asset and round: session points (qualifying, sprint, race) and the official item breakdown
(when published) from data/processed/fantasy_points.parquet, for scoring No Negative and Final Fix.

Run: cd pipeline && uv run python ../research/fantasy-backtest/export_breakdown.py
"""
import json
import math
from pathlib import Path

import pandas as pd

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
ITEMS = [
    "pit_band", "pit_fastest", "pit_world_record", "q_dsq", "q_nc", "q_position", "q_progression",
    "r_dotd", "r_dsq", "r_fastest_lap", "r_gained", "r_lost", "r_nc", "r_overtakes", "r_position",
    "s_dsq", "s_fastest_lap", "s_gained", "s_lost", "s_nc", "s_overtakes", "s_position", "other",
]


def main():
    points = pd.read_parquet(ROOT / "data" / "processed" / "fantasy_points.parquet")
    out = {}
    for row in points[points.season.isin([2024, 2025, 2026]) & points.active].itertuples():
        asset = row.driverId if row.kind == "driver" else row.constructorId
        key = f"{row.kind}:{asset}"
        out.setdefault(str(row.season), {}).setdefault(str(row.round), {})[key] = entry(row)
    (HERE / "breakdown.json").write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    for season, rounds in out.items():
        with_items = sum(1 for r in rounds.values() for e in r.values() if e["items"] is not None)
        total = sum(len(r) for r in rounds.values())
        print(season, "rows", total, "with item breakdown", with_items)


def entry(row):
    sessions = [value_of(row.qualiPoints), value_of(row.sprintPoints), value_of(row.racePoints)]
    present = [value_of(getattr(row, c)) for c in ITEMS if not is_missing(getattr(row, c))]
    items = None
    if row.breakdownSource == "official" and present:
        residual = value_of(row.points) - sum(present)
        items = present + ([residual] if abs(residual) > 0.01 else [])
    return {"q": sessions[0], "s": sessions[1], "r": sessions[2], "items": items}


def is_missing(x):
    return x is None or (isinstance(x, float) and math.isnan(x))


def value_of(x):
    return 0.0 if is_missing(x) else float(x)


main()
