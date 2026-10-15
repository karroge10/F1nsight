"""Build history rows (same shape as the engine fixture) for 2024, 2025, 2026 into this folder.

Run: cd pipeline && uv run python ../research/fantasy-backtest/export_history.py
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "pipeline" / "scripts"))
from export_fantasy_engine_fixtures import history_rows  # noqa: E402

seasons = {str(s): history_rows(s) for s in (2024, 2025, 2026)}
(HERE / "history.json").write_text(json.dumps({"seasons": seasons}, separators=(",", ":")), encoding="utf-8")
for s, rows in seasons.items():
    print(s, len(rows), "scored rounds", len({r["round"] for r in rows if r["points"] is not None}))
