"""Hyper-parameter tuning (Optuna, time based CV) and final model training on the GPU.

    uv run python -m f1ml.train                 # train the final bundle with saved params
    uv run python -m f1ml.train --tune          # tune first (about 30 to 60 minutes)
    uv run python -m f1ml.train --seed 2 --gbm-bags 5 --nn-seeds 8

--seed moves every random source of the fit (XGBoost subsampling, network initialisation and
batch order) to a separate block of seeds; 0 is the historical default. --gbm-bags and
--nn-seeds set the ensemble sizes (seed-averaged XGBoost rankers, set transformer networks).

Tuning folds train on every season before the validation season and validate on it
(2021, 2022, 2023). The backtest seasons 2024 to 2026 are never used for tuning.
"""

from __future__ import annotations

import argparse
import json
import time
import warnings
from datetime import datetime, timezone

import numpy as np
import optuna
import pandas as pd
from scipy.stats import spearmanr

from f1ml import bundle as bundle_module
from f1ml import features as feat
from f1ml import gbm, gpu, nn, paths, plackett

TUNE_SEASONS = (2021, 2022, 2023)
NN_TUNE_SEASONS = (2022, 2023)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tune", action="store_true", help="run Optuna before training")
    parser.add_argument("--trials", type=int, default=40, help="trials per GBM study")
    parser.add_argument("--nn-trials", type=int, default=10, help="trials for the network")
    parser.add_argument("--no-nn", action="store_true", help="GBM only (faster)")
    add_ensemble_arguments(parser)
    args = parser.parse_args()
    warnings.filterwarnings("ignore", category=RuntimeWarning)
    optuna.logging.set_verbosity(optuna.logging.WARNING)
    paths.ensure_dirs()
    features = load_features()
    if args.tune:
        params = tune_all(features, args.trials, args.nn_trials, use_nn=not args.no_nn)
    else:
        params = load_params()
    apply_ensemble(params, args)
    train_final(features, params, use_nn=not args.no_nn)


def load_features() -> pd.DataFrame:
    if not paths.FEATURES_PATH.exists():
        raise SystemExit("features missing: run `uv run python -m f1ml.features` first")
    return pd.read_parquet(paths.FEATURES_PATH)


def load_params() -> dict:
    """Saved tuned parameters, or the defaults when tuning has not run yet."""
    defaults = default_params()
    if not paths.PARAMS_PATH.exists():
        return defaults
    saved = json.loads(paths.PARAMS_PATH.read_text(encoding="utf-8"))
    for key, value in defaults.items():
        saved.setdefault(key, value)
    return saved


def add_ensemble_arguments(parser: argparse.ArgumentParser) -> None:
    """--seed, --gbm-bags, --nn-seeds: shared by f1ml.train, f1ml.backtest and the retrain gate."""
    parser.add_argument("--seed", type=int, default=0, help="seed block for every random source")
    parser.add_argument("--gbm-bags", type=int, help="XGBoost rankers averaged per model")
    parser.add_argument("--nn-seeds", type=int, help="set transformer networks averaged")


def apply_ensemble(params: dict, args: argparse.Namespace) -> None:
    """Write the seed and ensemble sizes from the command line into params (kept in meta.json)."""
    params["seed"] = args.seed
    if args.gbm_bags:
        params["gbm_bags"] = args.gbm_bags
    if args.nn_seeds:
        params["nn"]["seeds"] = args.nn_seeds


def default_params() -> dict:
    rank = dict(gbm.DEFAULT_RANK_PARAMS, num_boost_round=150, max_depth=3)
    return {"rank": {"default": rank}, "dnf": dict(gbm.DEFAULT_DNF_PARAMS),
            "nn": dict(nn.DEFAULT_NN_PARAMS)}


def train_final(features: pd.DataFrame, params: dict, use_nn: bool = True) -> str:
    """Train on every completed race, save under models/<version>/, update models/latest."""
    completed = features[features["y_finish"].notna()]
    cutoff = int(completed["raceId"].max())
    print(f"training final bundle on {completed['raceId'].nunique()} races up to {cutoff}")
    with gpu.GpuMonitor() as monitor:
        trained = bundle_module.fit_bundle(completed, params, use_nn=use_nn, verbose=True)
    usage = monitor.summary()
    trained_at = datetime.now(timezone.utc)
    version = f"v{trained_at:%Y%m%d}-r{cutoff}-{trained_at:%H%M}"
    folder = paths.MODELS_DIR / version
    folder.mkdir(parents=True, exist_ok=True)
    trained.save(folder / "bundle.pkl")
    importance = {stage: _top(gbm.importance(trained.race_models[stage]), 25)
                  for stage in feat.STAGES}
    meta = {
        "version": version,
        "trainedAt": trained_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "trainedThroughRaceId": cutoff,
        "races": int(completed["raceId"].nunique()),
        "rows": int(len(completed)),
        "useNN": use_nn,
        "params": params,
        "stack": trained.stack,
        "timings": trained.timings,
        "gpu": usage,
        "importance": importance,
    }
    meta_text = json.dumps(meta, indent=2, default=float)
    (folder / "meta.json").write_text(meta_text, encoding="utf-8")
    latest = {"version": version, "path": str(folder.relative_to(paths.ML_DIR))}
    latest_text = json.dumps(latest, indent=2)
    (paths.MODELS_DIR / "latest.json").write_text(latest_text, encoding="utf-8")
    print(f"saved {version}; gpu {usage}; timings {trained.timings}")
    return version


def tune_all(features: pd.DataFrame, trials: int, nn_trials: int, use_nn: bool) -> dict:
    """Run every study and save models/params.json plus reports/tuning.json."""
    report = {}
    params = default_params()
    with gpu.GpuMonitor() as monitor:
        for stage in feat.STAGES:
            best, info = tune_ranker(features, stage, "y_finish", trials)
            params["rank"][stage] = best
            report[f"race:{stage}"] = info
            print(f"  race {stage}: {info}")
        best, info = tune_ranker(features, "pre-weekend", "y_quali", trials)
        params["rank"]["quali"] = best
        report["quali"] = info
        print(f"  quali: {info}")
        best, info = tune_dnf(features, trials)
        params["dnf"] = best
        report["dnf"] = info
        print(f"  dnf: {info}")
        if use_nn:
            best, info = tune_nn(features, nn_trials)
            params["nn"] = best
            report["nn"] = info
            print(f"  nn: {info}")
    report["gpu"] = monitor.summary()
    params_text = json.dumps(params, indent=2)
    paths.PARAMS_PATH.write_text(params_text, encoding="utf-8")
    report_text = json.dumps(report, indent=2, default=float)
    (paths.REPORTS_DIR / "tuning.json").write_text(report_text, encoding="utf-8")
    return params


def tune_ranker(features: pd.DataFrame, stage: str, order_col: str, trials: int):
    columns = feat.stage_columns(stage)
    folds = _folds(features, TUNE_SEASONS)

    def objective(trial: optuna.Trial) -> float:
        params = {
            "objective": trial.suggest_categorical("objective", ["rank:pairwise", "rank:ndcg"]),
            "eta": trial.suggest_float("eta", 0.01, 0.2, log=True),
            "max_depth": trial.suggest_int("max_depth", 2, 6),
            "min_child_weight": trial.suggest_float("min_child_weight", 1.0, 60.0, log=True),
            "subsample": trial.suggest_float("subsample", 0.5, 1.0),
            "colsample_bytree": trial.suggest_float("colsample_bytree", 0.3, 1.0),
            "lambda": trial.suggest_float("lambda", 0.1, 50.0, log=True),
            "alpha": trial.suggest_float("alpha", 0.0, 10.0),
            "num_boost_round": trial.suggest_int("num_boost_round", 40, 800, log=True),
            "decay": trial.suggest_float("decay", 0.6, 1.0),
        }
        losses = []
        spearmans = []
        for train, valid in folds:
            gated_train = feat.stage_frame(train, stage)
            gated_valid = feat.stage_frame(valid, stage)
            booster = gbm.train_ranker(gated_train, columns, order_col, params)
            scores = gbm.predict(booster, gated_valid, columns)
            scored = valid[["raceId", order_col]].assign(score=scores)
            groups = plackett.race_groups(scored, ["score"], order_col)
            scale = plackett.fit_temperature(groups)
            losses.append(plackett.mean_nll(groups, np.array([scale])))
            spearmans.append(_mean_spearman(scored, order_col))
        trial.set_user_attr("spearman", float(np.mean(spearmans)))
        return float(np.mean(losses))

    study = optuna.create_study(direction="minimize",
                                sampler=optuna.samplers.TPESampler(seed=7))
    baseline = dict(gbm.DEFAULT_RANK_PARAMS, num_boost_round=150, max_depth=3)
    study.enqueue_trial(baseline)
    study.optimize(objective, n_trials=trials)
    best = dict(study.best_params)
    info = {"nll": round(study.best_value, 4),
            "spearman": round(study.best_trial.user_attrs["spearman"], 4),
            "baselineNll": round(study.trials[0].value, 4), "trials": len(study.trials)}
    return best, info


def tune_dnf(features: pd.DataFrame, trials: int):
    folds = _folds(features, TUNE_SEASONS)

    def objective(trial: optuna.Trial) -> float:
        params = {
            "eta": trial.suggest_float("eta", 0.01, 0.2, log=True),
            "max_depth": trial.suggest_int("max_depth", 1, 5),
            "min_child_weight": trial.suggest_float("min_child_weight", 5.0, 200.0, log=True),
            "subsample": trial.suggest_float("subsample", 0.5, 1.0),
            "colsample_bytree": trial.suggest_float("colsample_bytree", 0.3, 1.0),
            "lambda": trial.suggest_float("lambda", 0.1, 50.0, log=True),
            "alpha": trial.suggest_float("alpha", 0.0, 10.0),
            "num_boost_round": trial.suggest_int("num_boost_round", 30, 600, log=True),
            "decay": trial.suggest_float("decay", 0.6, 1.0),
        }
        losses = []
        for train, valid in folds:
            booster = gbm.train_dnf(train, gbm.DNF_COLUMNS, params)
            probability = gbm.predict(booster, valid, gbm.DNF_COLUMNS, margin=False)
            labels = valid["y_dnf"].to_numpy(dtype=float)
            usable = ~np.isnan(labels)
            clipped = np.clip(probability[usable], 1e-4, 1 - 1e-4)
            loss = -(labels[usable] * np.log(clipped)
                     + (1 - labels[usable]) * np.log(1 - clipped)).mean()
            losses.append(loss)
        return float(np.mean(losses))

    study = optuna.create_study(direction="minimize",
                                sampler=optuna.samplers.TPESampler(seed=11))
    study.enqueue_trial(gbm.DEFAULT_DNF_PARAMS)
    study.optimize(objective, n_trials=trials)
    rates = []
    for _, valid in folds:
        rate = valid["y_dnf"].mean()
        rates.append(-(rate * np.log(rate) + (1 - rate) * np.log(1 - rate)))
    info = {"logloss": round(study.best_value, 4),
            "baseRateLogloss": round(float(np.mean(rates)), 4),
            "defaultLogloss": round(study.trials[0].value, 4), "trials": len(study.trials)}
    return dict(study.best_params), info


def tune_nn(features: pd.DataFrame, trials: int):
    folds = _folds(features, NN_TUNE_SEASONS)

    def objective(trial: optuna.Trial) -> float:
        params = dict(nn.DEFAULT_NN_PARAMS)
        params.update({
            "d_model": trial.suggest_categorical("d_model", [32, 64, 128]),
            "layers": trial.suggest_int("layers", 1, 3),
            "dropout": trial.suggest_float("dropout", 0.05, 0.35),
            "lr": trial.suggest_float("lr", 3e-4, 4e-3, log=True),
            "weight_decay": trial.suggest_float("weight_decay", 1e-5, 1e-1, log=True),
            "epochs": trial.suggest_int("epochs", 15, 70),
            "quali_weight": trial.suggest_float("quali_weight", 0.0, 1.0),
            "dnf_weight": trial.suggest_float("dnf_weight", 0.5, 4.0),
            "decay": trial.suggest_float("decay", 0.6, 1.0),
            "seeds": 1,
        })
        losses = []
        started = time.time()
        for train, valid in folds:
            model = nn.train_set_model(train, params)
            for stage in feat.STAGES:
                output = model.predict(valid, stage)
                scored = valid[["raceId", "y_finish"]].assign(score=output["race"])
                groups = plackett.race_groups(scored, ["score"], "y_finish")
                scale = plackett.fit_temperature(groups)
                losses.append(plackett.mean_nll(groups, np.array([scale])))
        trial.set_user_attr("seconds", time.time() - started)
        return float(np.mean(losses))

    study = optuna.create_study(direction="minimize",
                                sampler=optuna.samplers.TPESampler(seed=13))
    default = {key: nn.DEFAULT_NN_PARAMS[key] for key in
               ("d_model", "layers", "dropout", "lr", "weight_decay", "epochs", "quali_weight",
                "dnf_weight", "decay")}
    study.enqueue_trial(default)
    study.optimize(objective, n_trials=trials)
    best = dict(nn.DEFAULT_NN_PARAMS)
    best.update(study.best_params)
    info = {"nll": round(study.best_value, 4), "defaultNll": round(study.trials[0].value, 4),
            "trials": len(study.trials),
            "secondsPerTrial": round(float(np.mean([t.user_attrs.get("seconds", 0)
                                                    for t in study.trials])), 1)}
    return best, info


# ----------------------------------------------------------------------------------------------
# helpers


def _folds(features: pd.DataFrame, seasons) -> list[tuple[pd.DataFrame, pd.DataFrame]]:
    labelled = features[features["y_finish"].notna() | features["y_dnf"].notna()]
    folds = []
    for season in seasons:
        train = labelled[labelled["season"] < season]
        valid = labelled[labelled["season"] == season]
        folds.append((train, valid))
    return folds


def _mean_spearman(scored: pd.DataFrame, order_col: str) -> float:
    values = []
    for _, race in scored[scored[order_col].notna()].groupby("raceId"):
        statistic = spearmanr(-race["score"], race[order_col]).statistic
        values.append(statistic)
    return float(np.nanmean(values))


def _top(importance: dict, count: int) -> dict:
    ordered = sorted(importance.items(), key=lambda item: -item[1])[:count]
    return {name: round(value, 4) for name, value in ordered}


if __name__ == "__main__":
    main()
