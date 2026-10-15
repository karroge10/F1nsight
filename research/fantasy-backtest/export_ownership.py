"""Ownership (selectedPct) per season, round and asset id into ownership.json here.

Run: cd pipeline && uv run python ../research/fantasy-backtest/export_ownership.py
"""
import json
from pathlib import Path

import pandas as pd

HERE = Path(__file__).resolve().parent
prices = pd.read_parquet(HERE.parents[1] / "data" / "processed" / "fantasy_prices.parquet")
prices = prices[(prices.season >= 2024) & prices.active & prices.selectedPct.notna()]
prices = prices.assign(id=prices.driverId.where(prices.kind == "driver", prices.constructorId))
out: dict = {}
for row in prices.itertuples():
    out.setdefault(str(row.season), {}).setdefault(str(row.round), {})[f"{row.kind}:{row.id}"] = float(row.selectedPct)
(HERE / "ownership.json").write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
print({s: len(r) for s, r in out.items()})
