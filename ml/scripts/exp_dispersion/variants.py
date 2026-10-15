"""Fantasy lock forecast variants on the cached walk-forward inputs (see cache.py).

    uv run python -m scripts.exp_dispersion.variants [--write-history base O1 ...]

Every variant re-simulates the cached team-lock inputs (same seeds as the backtest) and scores
them with the official rules. Variants:

- base: the current method (overtake Poisson fitted on the last 12 races, any season).
- O1: base overtake rates times a season factor (A + n0 m) / (P + n0 m): A and P are actual and
  predicted overtakes of this season's earlier rows, m the mean predicted rate, n0 = 40 rows
  (two races) of shrinkage toward 1. Round 1 of a season keeps factor 1.
- O2: overtake Poisson refitted with weight 3 on rows of the current season (same window).
- Dk: race, sprint and qualifying strengths times k (sharper order), k in K_GRID.
- D: Dk with k chosen walk-forward (lowest squared error over drivers and constructors on
  earlier seasons; 2024 uses k = 1).
- O1+D: both.

Writes ml/reports/exp_dispersion/metrics.json and, with --write-history, history folders with
fantasyAtLock replaced (input for research/fantasy-backtest/evaluate.ts).
"""

from __future__ import annotations

import argparse
import json
import pickle
import shutil
import time
from dataclasses import replace
from types import SimpleNamespace

import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.linear_model import PoissonRegressor

from f1ml import backtest, data, export, fantasy, fantasy_history, paths, simulate

EXP_DIR = paths.ML_DIR / "reports" / "exp_dispersion"
INPUT_DIR = EXP_DIR / "inputs"
SIMS = 20000
SAMPLES = 4000  # simulated points kept per asset for the price change of written history
K_GRID = (1.0, 1.15, 1.3, 1.5)
SHRINK_ROWS = 40
SEASON_WEIGHT = 3.0
SEASONS = (2024, 2025, 2026)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write-history", nargs="*", default=[])
    args = parser.parse_args()
    started = time.time()
    entries = load_entries()
    actual = actual_points()
    rows = []
    for entry in entries:
        rows.extend(score_race(entry, actual))
        print(f"  {entry['raceId']} scored ({time.time() - started:.0f}s)", flush=True)
    table = pd.DataFrame(rows)
    table = add_fitted_dispersion(table)
    table.drop(columns="samples").to_parquet(EXP_DIR / "rows.parquet", index=False)
    report = metrics(table)
    (EXP_DIR / "metrics.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    print_report(report)
    for variant in args.write_history:
        write_history(table, variant)
    print(f"done in {time.time() - started:.0f}s")


def score_race(entry: dict, actual: pd.DataFrame) -> list[dict]:
    race_id = entry["raceId"]
    season = race_id // 100
    extras = fantasy.fit_extras(race_id)
    variants_extras = {
        "base": extras,
        "O1": season_scaled(extras, race_id),
        "O2": weighted_extras(extras, race_id),
    }
    rows = []
    for k in K_GRID:
        inputs = sharpened(entry["inputs"], k)
        weekend = simulate.simulate_weekend(inputs, sims=SIMS, seed=entry["seed"])
        names = ("base", "O1", "O2") if k == 1.0 else ("base", "O1")
        for name in names:
            sims = fantasy.score_weekend(weekend, entry["entrants"], season,
                                         variants_extras[name], entry["absChange"],
                                         seed=entry["seed"])
            label = name if k == 1.0 else (f"D{k}" if name == "base" else f"O1+D{k}")
            rows.extend(asset_rows(label, race_id, entry["entrants"], sims, actual))
    return rows


def add_fitted_dispersion(table: pd.DataFrame) -> pd.DataFrame:
    """D and O1+D: per season the k with the lowest squared error on earlier seasons."""
    choices = {}
    for prefix, base in (("D", "base"), ("O1+D", "O1")):
        for season in SEASONS:
            k = fitted_k(table, prefix, base, season)
            choices[f"{prefix} {season}"] = k
            label = base if k == 1.0 else f"{prefix}{k}"
            picked = table[(table["variant"] == label) & (table["season"] == season)].copy()
            picked["variant"] = prefix
            table = pd.concat([table, picked], ignore_index=True)
    print("fitted k:", choices)
    (EXP_DIR / "fitted_k.json").write_text(json.dumps(choices, indent=1), encoding="utf-8")
    return table


def metrics(table: pd.DataFrame) -> dict:
    out = {}
    for (variant, season, kind), rows in table.groupby(["variant", "season", "kind"]):
        scored = rows[rows["actual"].notna()]
        error = scored["pred"] - scored["actual"]
        slope = np.polyfit(scored["pred"], scored["actual"], 1)[0]
        per_round = [spearmanr(r["pred"], r["actual"]).statistic
                     for _, r in scored.groupby("raceId") if len(r) > 2]
        cell = {"n": int(len(scored)), "mae": round(float(error.abs().mean()), 3),
                "spearman": round(float(np.nanmean(per_round)), 3),
                "bias": round(float(error.mean()), 2), "slope": round(float(slope), 3)}
        overtakes = scored[scored["actualOvertakes"].notna()]
        if kind == "driver" and len(overtakes):
            gap = overtakes["predOvertakes"] - overtakes["actualOvertakes"]
            cell["overtakeMae"] = round(float(gap.abs().mean()), 3)
            cell["overtakeBias"] = round(float(gap.mean()), 2)
        out.setdefault(variant, {}).setdefault(str(season), {})[kind] = cell
    return out


def write_history(table: pd.DataFrame, variant: str) -> None:
    """Copy of data/predictions/history with fantasyAtLock rebuilt from this variant."""
    target = EXP_DIR / f"history_{variant.replace('+', '_')}"
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(paths.HISTORY_DIR, target)
    rows = table[table["variant"] == variant]
    for race_id, race in rows.groupby("raceId"):
        season, round_number = int(race_id) // 100, int(race_id) % 100
        path = target / f"{season}-{round_number:02d}.json"
        payload = json.loads(path.read_text(encoding="utf-8"))
        lock = payload["fantasyAtLock"]
        assets = export.AssetBook(season, round_number)
        for kind, block in (("driver", "drivers"), ("constructor", "constructors")):
            for row in race[race["kind"] == kind].itertuples():
                info = assets.lookup(kind, row.id)
                points = np.asarray(row.samples, dtype=np.float32)
                lock[block][row.id] = export._fantasy_summary(points, info, season)
        path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                        encoding="utf-8")
    print("history written:", target)


# ----------------------------------------------------------------------------------------------
# helpers


def load_entries() -> list[dict]:
    entries = []
    for path in sorted(INPUT_DIR.glob("*.pkl")):
        with open(path, "rb") as handle:
            entries.append(pickle.load(handle))
    return entries


def actual_points() -> pd.DataFrame:
    points = pd.read_parquet(paths.processed("fantasy_points"))
    points = points[points["season"].isin(SEASONS) & points["active"].fillna(True).astype(bool)]
    points = points.copy()
    points["raceKey"] = points["season"] * 100 + points["round"]
    points["id"] = np.where(points["kind"] == "driver", points["driverId"],
                            points["constructorId"])
    overtakes = points["r_overtakes"].fillna(0) + points["s_overtakes"].fillna(0)
    official = points["breakdownSource"] == "official"
    points["overtakes"] = np.where(official, overtakes, np.nan)
    return points.drop_duplicates(["raceKey", "kind", "id"])


def asset_rows(label: str, race_id: int, entrants: pd.DataFrame, sims, actual) -> list[dict]:
    here = actual[actual["raceKey"] == race_id].set_index(["kind", "id"])
    season = race_id // 100
    rows = []
    for i, driver_id in enumerate(entrants["driverId"]):
        rows.append(asset_row(label, race_id, season, "driver", driver_id,
                              sims.driver_points[:, i],
                              sims.driver_components["overtakes"][:, i], here))
    for t, team in enumerate(sims.teams):
        rows.append(asset_row(label, race_id, season, "constructor", team,
                              sims.constructor_points[:, t],
                              sims.constructor_components["overtakes"][:, t], here))
    return rows


def asset_row(label, race_id, season, kind, asset_id, points, overtakes, here) -> dict:
    key = (kind, asset_id)
    hit = here.loc[key] if key in here.index else None
    actual_value = float(hit["points"]) if hit is not None else np.nan
    actual_overtakes = float(hit["overtakes"]) if hit is not None else np.nan
    keep = np.random.default_rng(race_id).choice(len(points), size=SAMPLES, replace=False)
    return {"variant": label, "raceId": race_id, "season": season, "kind": kind,
            "id": asset_id, "pred": float(points.mean()), "actual": actual_value,
            "predOvertakes": float(overtakes.mean()), "actualOvertakes": actual_overtakes,
            "samples": points[keep].copy()}


def sharpened(inputs, k: float):
    if k == 1.0:
        return inputs
    scaled = replace(inputs, race_strength=inputs.race_strength * k)
    if inputs.quali_strength is not None:
        scaled.quali_strength = inputs.quali_strength * k
    if inputs.sprint_strength is not None:
        scaled.sprint_strength = inputs.sprint_strength * k
    return scaled


def fitted_k(table: pd.DataFrame, prefix: str, base: str, season: int) -> float:
    earlier = [s for s in SEASONS if s < season]
    if not earlier:
        return 1.0
    best, best_error = 1.0, np.inf
    for k in K_GRID:
        label = base if k == 1.0 else f"{prefix}{k}"
        rows = table[(table["variant"] == label) & table["season"].isin(earlier)]
        rows = rows[rows["actual"].notna()]
        error = float(((rows["pred"] - rows["actual"]) ** 2).sum())
        if error < best_error:
            best, best_error = k, error
    return best


class ScaledModel:
    """Overtake rate model times a constant factor (duck-types PoissonRegressor.predict)."""

    def __init__(self, model, factor: float):
        self.model = model
        self.factor = factor

    def predict(self, design):
        return self.factor * self.model.predict(design)


def season_scaled(extras, race_id: int):
    race_factor = season_factor(extras.race_overtakes, race_id, "race_overtakes", sprint=False)
    sprint_factor = season_factor(extras.sprint_overtakes, race_id, "sprint_overtakes",
                                  sprint=True)
    race_model = ScaledModel(extras.race_overtakes, race_factor) if extras.race_overtakes else None
    sprint_model = (ScaledModel(extras.sprint_overtakes, sprint_factor)
                    if extras.sprint_overtakes else None)
    return replace(extras, race_overtakes=race_model, sprint_overtakes=sprint_model,
                   race_overtake_mean=extras.race_overtake_mean * race_factor,
                   sprint_overtake_mean=extras.sprint_overtake_mean * sprint_factor)


def season_factor(model, race_id: int, column: str, sprint: bool) -> float:
    if model is None:
        return 1.0
    season = race_id // 100
    drivers = fantasy_history.driver_components()
    rows = drivers[(drivers["raceId"] < race_id) & (drivers["raceId"] > season * 100)]
    design, target, _ = overtake_rows(rows, column, sprint)
    if design is None:
        return 1.0
    predicted = model.predict(design)
    mean_rate = float(predicted.mean())
    actual_total = float(target.sum()) + SHRINK_ROWS * mean_rate
    predicted_total = float(predicted.sum()) + SHRINK_ROWS * mean_rate
    return actual_total / predicted_total


def weighted_extras(extras, race_id: int):
    race_model = weighted_fit(race_id, "race_overtakes", sprint=False) or extras.race_overtakes
    sprint_model = weighted_fit(race_id, "sprint_overtakes", sprint=True) or extras.sprint_overtakes
    return replace(extras, race_overtakes=race_model, sprint_overtakes=sprint_model)


def weighted_fit(race_id: int, column: str, sprint: bool):
    drivers = fantasy_history.driver_components()
    past = drivers[(drivers["raceId"] < race_id) & drivers[column].notna()]
    race_ids = np.sort(past["raceId"].unique())
    window = 2 * fantasy.OVERTAKE_WINDOW if sprint else fantasy.OVERTAKE_WINDOW
    recent = past[past["raceId"].isin(race_ids[-window:])]
    design, target, joined = overtake_rows(recent, column, sprint)
    if design is None or len(target) < 40:
        return None
    current = (joined["raceId"] // 100 == race_id // 100).to_numpy()
    weights = np.where(current, SEASON_WEIGHT, 1.0)
    model = PoissonRegressor(alpha=1e-3, max_iter=500)
    model.fit(design, target, sample_weight=weights)
    return model


def overtake_rows(rows: pd.DataFrame, column: str, sprint: bool):
    """Design matrix (as fantasy._fit_overtakes builds it), targets and the joined rows."""
    usable = rows[rows[column].notna()]
    if not len(usable):
        return None, None, None
    core = data.load_core()
    source = core["sprint_results"] if sprint else core["results"]
    results = source[["raceId", "driverId", "grid", "positionOrder", "position"]]
    joined = usable.merge(results, on=["raceId", "driverId"], how="inner")
    if not len(joined):
        return None, None, None
    field = joined.groupby("raceId")["driverId"].transform("count").to_numpy()
    grid = joined["grid"].where(joined["grid"] > 0, field).to_numpy(dtype=float)
    finish = joined["positionOrder"].to_numpy(dtype=float)
    classified = joined["position"].notna().to_numpy()
    design = fantasy._overtake_design(grid, finish, classified, field, 0.0)
    design[:, 4] = fantasy._abs_change_by_race(joined["raceId"])
    target = joined[column].clip(lower=0).to_numpy(dtype=float)
    return design, target, joined


def print_report(report: dict) -> None:
    for variant, seasons in report.items():
        for season, kinds in seasons.items():
            for kind, cell in kinds.items():
                print(variant, season, kind, json.dumps(cell))


if __name__ == "__main__":
    main()
