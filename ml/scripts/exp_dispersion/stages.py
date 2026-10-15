"""Sharpness per forecast stage (and per kind), on the cached inputs of all four stages.

    uv run python -m scripts.exp_dispersion.stages

Stages: the team lock (inputs/, seed race + 7) and pre-weekend, post-practice, post-qualifying
(inputs_stages/, seed race), as in f1ml.backtest. Every stage is re-simulated at every k in
K_GRID and scored with the current extras. Fits, walk-forward (lowest squared error on earlier
seasons, 2024 prior k = 1): per stage (both kinds together) and per stage and kind. Compared with
the published rule (k = 1.5 from 2025). Writes ml/reports/exp_dispersion/stages_metrics.json.
"""

from __future__ import annotations

import json
import pickle
import time

import pandas as pd

from f1ml import fantasy, simulate
from scripts.exp_dispersion import variants as base_round

K_GRID = (1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5)
KINDS = ("driver", "constructor")
LOCK = "lock"
STAGES_DIR = base_round.EXP_DIR / "inputs_stages"


def main() -> None:
    started = time.time()
    lock_entries = {e["raceId"]: e for e in base_round.load_entries()}
    actual = base_round.actual_points()
    rows = []
    for path in sorted(STAGES_DIR.glob("*.pkl")):
        with open(path, "rb") as handle:
            entry = pickle.load(handle)
        lock = lock_entries[entry["raceId"]]
        rows.extend(score_race(entry, lock, actual))
        print(f"  {entry['raceId']} scored ({time.time() - started:.0f}s)", flush=True)
    grid = pd.DataFrame(rows)
    grid.to_parquet(base_round.EXP_DIR / "stages_rows.parquet", index=False)
    result = compare(grid)
    (base_round.EXP_DIR / "stages_metrics.json").write_text(json.dumps(result, indent=1),
                                                             encoding="utf-8")
    for line in result["table"]:
        print(json.dumps(line))
    print(f"done in {time.time() - started:.0f}s")


def score_race(entry: dict, lock: dict, actual: pd.DataFrame) -> list[dict]:
    race_id = entry["raceId"]
    season = race_id // 100
    extras = fantasy.fit_extras(race_id)
    stage_inputs = dict(entry["stages"])
    stage_inputs[LOCK] = lock["inputs"]
    rows = []
    for stage, inputs in stage_inputs.items():
        seed = lock["seed"] if stage == LOCK else entry["seed"]
        for k in K_GRID:
            sharpened = base_round.sharpened(inputs, k)
            weekend = simulate.simulate_weekend(sharpened, sims=base_round.SIMS, seed=seed)
            sims = fantasy.score_weekend(weekend, entry["entrants"], season, extras,
                                         entry["absChange"], seed=seed)
            scored = base_round.asset_rows(f"k{k}", race_id, entry["entrants"], sims, actual)
            for row in scored:
                row.pop("samples")
                row["stage"] = stage
                row["k"] = k
            rows.extend(scored)
    return rows


def compare(grid: pd.DataFrame) -> dict:
    """Per stage: published rule vs stage fit vs stage-and-kind fit, metrics per season and kind."""
    table = []
    fits = {}
    for stage in grid["stage"].unique():
        here = grid[grid["stage"] == stage]
        rules = {"pub": {}, "stage": {}, "stageKind": {}}
        for season in base_round.SEASONS:
            published = fantasy.strength_sharpness(season)
            rules["pub"][season] = {kind: published for kind in KINDS}
            joint = best_k(here, season, KINDS)
            rules["stage"][season] = {kind: joint for kind in KINDS}
            rules["stageKind"][season] = {kind: best_k(here, season, (kind,)) for kind in KINDS}
        fits[stage] = rules
        for name, ks in rules.items():
            picked = pick(here, ks)
            report = base_round.metrics(picked.assign(variant=name))
            for season, kinds in report[name].items():
                for kind, cell in kinds.items():
                    table.append({"stage": stage, "variant": name, "season": season,
                                  "kind": kind, "k": ks[int(season)][kind], **cell})
    return {"fits": fits, "table": table}


def best_k(rows: pd.DataFrame, season: int, kinds: tuple) -> float:
    earlier = [s for s in base_round.SEASONS if s < season]
    if not earlier:
        return 1.0
    usable = rows[rows["season"].isin(earlier) & rows["kind"].isin(kinds) & rows["actual"].notna()]
    errors = {}
    for k in K_GRID:
        cell = usable[usable["k"] == k]
        errors[k] = float(((cell["pred"] - cell["actual"]) ** 2).sum())
    return min(errors, key=errors.get)


def pick(rows: pd.DataFrame, ks: dict) -> pd.DataFrame:
    parts = []
    for season, by_kind in ks.items():
        for kind, k in by_kind.items():
            mask = (rows["k"] == k) & (rows["season"] == season) & (rows["kind"] == kind)
            parts.append(rows[mask])
    return pd.concat(parts, ignore_index=True)


if __name__ == "__main__":
    main()
