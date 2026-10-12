"""Ablations and the regulation-change adaptation study (GBM only, no Monte Carlo).

    uv run python -m f1ml.studies --ablation       # feature group ablations, 2024-2026
    uv run python -m f1ml.studies --adaptation     # reset years vs normal years
    uv run python -m f1ml.studies --reset a.parquet b.parquet   # era discount: feature tables

Both walk forward: the ranker is retrained every `RETRAIN` rounds on races before the target.
Scores are compared with Spearman (predicted order vs classification) and the Plackett-Luce
negative log likelihood of the finishing order, with the temperature fitted on the previous
season (no peeking at the evaluated season).
"""

from __future__ import annotations

import argparse
import json
import warnings

import numpy as np
import pandas as pd
from scipy.stats import spearmanr

from f1ml import features as feat
from f1ml import explain, gbm, paths, plackett, train

RETRAIN = 4
ABLATION_SEASONS = (2024, 2025, 2026)
RESET_SEASONS = (2014, 2017, 2022, 2026)
RESET_FIT_SEASONS = (2014, 2017, 2022)
RESET_TEST_SEASONS = (2026,)
NORMAL_SEASONS = (2016, 2019, 2024)
DRIVER_GROUPS = ("form", "quali_pace", "teammate", "racecraft", "experience")
TEAM_GROUPS = ("team", "track_type", "reliability")
ABLATIONS = {
    "no practice": ("post-practice", explain.GROUPS["practice_pace"] + explain.GROUPS["race_pace"]),
    "no sprint": ("post-practice", explain.GROUPS["sprint"]),
    "no grid/quali": ("post-qualifying", explain.GROUPS["grid"]),
    "no driver form": ("pre-weekend", sum((explain.GROUPS[g] for g in DRIVER_GROUPS), [])),
    "no team form": ("pre-weekend", sum((explain.GROUPS[g] for g in TEAM_GROUPS), [])),
    "no circuit history": ("pre-weekend", explain.GROUPS["track_history"]
                           + ["c_grid_corr", "c_pole_win", "c_abs_change", "c_visits",
                              "c_street", "c_speed", "c_length", "c_turns"]),
    "no standings": ("pre-weekend", explain.GROUPS["championship"]),
    "no season context": ("pre-weekend", ["season", "round", "n_rounds", "season_progress",
                                          "rounds_since_reset", "reset_season"]),
    "no current-season stats": ("pre-weekend", ["d_fin_s", "d_q_s", "d_qgap_s", "d_n_s",
                                                "t_qgap_s", "t_fin_s", "t_n_s", "t_mech_s"]),
}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ablation", action="store_true")
    parser.add_argument("--adaptation", action="store_true")
    parser.add_argument("--reset", nargs="+", help="feature tables to compare on reset years")
    args = parser.parse_args()
    warnings.filterwarnings("ignore", category=RuntimeWarning)
    features = train.load_features()
    features = features[features["y_finish"].notna()]
    params = train.load_params()
    report_path = paths.REPORTS_DIR / "studies.json"
    report = json.loads(report_path.read_text(encoding="utf-8")) if report_path.exists() else {}
    if args.ablation:
        report["ablation"] = run_ablation(features, params)
    if args.adaptation:
        report["adaptation"] = run_adaptation(features, params)
    if args.reset:
        report["reset"] = run_reset(args.reset, params)
    report_text = json.dumps(report, indent=2, default=float)
    report_path.write_text(report_text, encoding="utf-8")
    print(report_text)


def run_ablation(features: pd.DataFrame, params: dict) -> dict:
    results = {}
    for stage in feat.STAGES:
        columns = feat.stage_columns(stage)
        results[f"full:{stage}"] = walk_forward(features, params, stage, columns,
                                                ABLATION_SEASONS)
        print(f"  full {stage}: {results[f'full:{stage}']['overall']}")
    for name, (stage, removed) in ABLATIONS.items():
        columns = [c for c in feat.stage_columns(stage) if c not in removed]
        outcome = walk_forward(features, params, stage, columns, ABLATION_SEASONS)
        full = results[f"full:{stage}"]["overall"]
        outcome["deltaSpearman"] = round(outcome["overall"]["spearman"] - full["spearman"], 4)
        outcome["deltaNll"] = round(outcome["overall"]["nll"] - full["nll"], 4)
        outcome["stage"] = stage
        results[name] = outcome
        print(f"  {name} ({stage}): dSpearman {outcome['deltaSpearman']:+.4f} "
              f"dNLL {outcome['deltaNll']:+.4f}")
    return results


def run_adaptation(features: pd.DataFrame, params: dict) -> dict:
    """Per round-bucket accuracy in regulation reset seasons vs normal seasons."""
    results = {}
    columns = feat.stage_columns("pre-weekend")
    for label, seasons in (("reset", RESET_SEASONS), ("normal", NORMAL_SEASONS)):
        for decay_label, decay in (("tuned", None), ("strong recency 0.5", 0.5)):
            outcome = walk_forward(features, params, "pre-weekend", columns, seasons,
                                   decay=decay, buckets=True)
            results[f"{label}:{decay_label}"] = outcome
            print(f"  {label} {decay_label}: {outcome['buckets']}")
    return results


def run_reset(feature_paths: list[str], params: dict) -> dict:
    """Pre-weekend walk-forward on reset seasons, one run per feature table (era discount).

    Fit seasons 2014, 2017, 2022 choose the table; 2026 is the test. Rounds 1 to 8 matter.
    """
    results = {}
    columns = feat.stage_columns("pre-weekend")
    for path in feature_paths:
        table = pd.read_parquet(path)
        table = table[table["y_finish"].notna()]
        outcome = {}
        for label, seasons in (("fit", RESET_FIT_SEASONS), ("test", RESET_TEST_SEASONS)):
            outcome[label] = walk_forward(table, params, "pre-weekend", columns, seasons,
                                          buckets=True)
        results[path] = outcome
        print(f"  {path}: fit {outcome['fit']['buckets']} {outcome['fit']['nllBuckets']} "
              f"test {outcome['test']['buckets']} {outcome['test']['nllBuckets']}", flush=True)
    return results


def walk_forward(features: pd.DataFrame, params: dict, stage: str, columns: list,
                 seasons, decay: float | None = None, buckets: bool = False) -> dict:
    stage_params = dict(params["rank"].get(stage, params["rank"]["default"]))
    if decay is not None:
        stage_params["decay"] = decay
    rows = []
    for season in seasons:
        race_ids = sorted(features[features["season"] == season]["raceId"].unique())
        scale = None
        booster = None
        for index, race_id in enumerate(race_ids):
            if booster is None or index % RETRAIN == 0:
                train_rows = feat.stage_frame(features[features["raceId"] < race_id], stage)
                booster = gbm.train_ranker(train_rows, columns, "y_finish", stage_params)
                if scale is None:
                    scale = _previous_season_scale(booster, features, stage, columns, season)
            race = feat.stage_frame(features[features["raceId"] == race_id], stage)
            scores = gbm.predict(booster, race, columns)
            actual = race["y_finish"].to_numpy(dtype=float)
            spearman = spearmanr(-scores, actual).statistic
            ordered = race.assign(score=scores * scale)
            groups = plackett.race_groups(ordered, ["score"], "y_finish")
            nll = plackett.mean_nll(groups, np.array([1.0]))
            winner = float(actual[np.argmax(scores)] == 1)
            round_number = int(race_id % 100)
            rows.append((season, round_number, spearman, nll, winner))
    frame = pd.DataFrame(rows, columns=["season", "round", "spearman", "nll", "winner"])
    result = {"overall": {"spearman": round(float(frame["spearman"].mean()), 4),
                          "nll": round(float(frame["nll"].mean()), 4),
                          "winnerAccuracy": round(float(frame["winner"].mean()), 4),
                          "races": int(len(frame))}}
    by_season = frame.groupby("season")["spearman"].mean().round(4)
    result["bySeason"] = {str(k): float(v) for k, v in by_season.items()}
    if buckets:
        frame["bucket"] = pd.cut(frame["round"], [0, 4, 8, 12, 30],
                                 labels=["R1-4", "R5-8", "R9-12", "R13+"])
        grouped = frame.groupby("bucket", observed=True)["spearman"].mean().round(4)
        result["buckets"] = {str(k): float(v) for k, v in grouped.items()}
        nll_grouped = frame.groupby("bucket", observed=True)["nll"].mean().round(4)
        result["nllBuckets"] = {str(k): float(v) for k, v in nll_grouped.items()}
        season_buckets = frame.groupby(["season", "bucket"], observed=True)["spearman"].mean()
        result["seasonBuckets"] = {f"{s}:{b}": round(float(v), 4)
                                   for (s, b), v in season_buckets.items()}
    return result


def _previous_season_scale(booster, features, stage, columns, season) -> float:
    previous = feat.stage_frame(features[features["season"] == season - 1], stage)
    scores = gbm.predict(booster, previous, columns)
    scored = previous.assign(score=scores)
    groups = plackett.race_groups(scored, ["score"], "y_finish")
    return plackett.fit_temperature(groups)


if __name__ == "__main__":
    main()
