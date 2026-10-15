"""Sharpness round 2: wider k grid and separate k for drivers and constructors.

    uv run python -m scripts.exp_dispersion.round2

Re-simulates the cached team-lock inputs (cache.py) at every k in K_GRID and scores them with
the current extras. Variants, all walk-forward (lowest squared lock error on earlier seasons,
2024 prior k = 1):

- pub: the published method (k = 1 for 2024, 1.5 from 2025).
- J: one k for both kinds, fitted on drivers + constructors.
- K: separate k per kind, each fitted on its own kind.

Per stage k is not tested: only the lock inputs are cached (the other stages would need a full
backtest per setting). Writes ml/reports/exp_dispersion/round2_metrics.json and history folders
history_r2_<variant> for evaluate.ts.
"""

from __future__ import annotations

import json
import time

import pandas as pd

from f1ml import fantasy
from scripts.exp_dispersion import variants as base_round

K_GRID = (1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5)
KINDS = ("driver", "constructor")
EXP_DIR = base_round.EXP_DIR


def main() -> None:
    started = time.time()
    entries = base_round.load_entries()
    actual = base_round.actual_points()
    rows = []
    for entry in entries:
        rows.extend(score_race(entry, actual))
        print(f"  {entry['raceId']} scored ({time.time() - started:.0f}s)", flush=True)
    grid = pd.DataFrame(rows)
    choices = fit_choices(grid)
    table = pd.concat([pick(grid, name, ks) for name, ks in choices.items()], ignore_index=True)
    report = base_round.metrics(table)
    (EXP_DIR / "round2_metrics.json").write_text(json.dumps({"choices": choices, "metrics": report},
                                                            indent=1), encoding="utf-8")
    print("choices:", json.dumps(choices))
    base_round.print_report(report)
    for name in choices:
        base_round.write_history(table, f"r2_{name}")
    print(f"done in {time.time() - started:.0f}s")


def score_race(entry: dict, actual: pd.DataFrame) -> list[dict]:
    race_id = entry["raceId"]
    season = race_id // 100
    extras = fantasy.fit_extras(race_id)
    rows = []
    for k in K_GRID:
        inputs = base_round.sharpened(entry["inputs"], k)
        weekend = base_round.simulate.simulate_weekend(inputs, sims=base_round.SIMS,
                                                       seed=entry["seed"])
        sims = fantasy.score_weekend(weekend, entry["entrants"], season, extras,
                                     entry["absChange"], seed=entry["seed"])
        rows.extend(base_round.asset_rows(f"k{k}", race_id, entry["entrants"], sims, actual))
    return rows


def fit_choices(grid: pd.DataFrame) -> dict:
    """{variant: {season: {kind: k}}} for pub, J and K."""
    choices = {"pub": {}, "J": {}, "K": {}}
    for season in base_round.SEASONS:
        published = fantasy.strength_sharpness(season)
        choices["pub"][season] = {kind: published for kind in KINDS}
        joint = best_k(grid, season, KINDS)
        choices["J"][season] = {kind: joint for kind in KINDS}
        choices["K"][season] = {kind: best_k(grid, season, (kind,)) for kind in KINDS}
    return choices


def best_k(grid: pd.DataFrame, season: int, kinds: tuple) -> float:
    earlier = [s for s in base_round.SEASONS if s < season]
    if not earlier:
        return 1.0
    rows = grid[grid["season"].isin(earlier) & grid["kind"].isin(kinds) & grid["actual"].notna()]
    errors = {}
    for k in K_GRID:
        cell = rows[rows["variant"] == f"k{k}"]
        errors[k] = float(((cell["pred"] - cell["actual"]) ** 2).sum())
    return min(errors, key=errors.get)


def pick(grid: pd.DataFrame, name: str, ks: dict) -> pd.DataFrame:
    parts = []
    for season, by_kind in ks.items():
        for kind, k in by_kind.items():
            mask = (grid["variant"] == f"k{k}") & (grid["season"] == season) & (grid["kind"] == kind)
            parts.append(grid[mask])
    picked = pd.concat(parts, ignore_index=True).copy()
    picked["variant"] = f"r2_{name}"
    return picked


if __name__ == "__main__":
    main()
