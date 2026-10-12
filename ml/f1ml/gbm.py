"""Gradient boosted models on the GPU (XGBoost, device=cuda; the CPU when there is no CUDA).

- rankers: pairwise / LambdaRank over the entrants of each race (group = race), used for the
  race finishing order of classified finishers and for the qualifying order;
- DNF classifier: binary logistic, calibrated later by the stacking step.
Scores of a ranker are log-strengths up to a scale; the scale is fitted afterwards on held out
races (Plackett-Luce likelihood), see `bundle.py`.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import torch
import xgboost as xgb

DEFAULT_RANK_PARAMS = {
    "objective": "rank:pairwise",
    "eta": 0.05,
    "max_depth": 4,
    "min_child_weight": 5.0,
    "subsample": 0.8,
    "colsample_bytree": 0.7,
    "lambda": 5.0,
    "alpha": 0.0,
    "num_boost_round": 400,
    "decay": 0.85,
}
DEFAULT_DNF_PARAMS = {
    "eta": 0.03,
    "max_depth": 3,
    "min_child_weight": 20.0,
    "subsample": 0.8,
    "colsample_bytree": 0.7,
    "lambda": 10.0,
    "alpha": 1.0,
    "num_boost_round": 300,
    "decay": 0.85,
}
DNF_COLUMNS = [
    "season", "round", "season_progress", "rounds_since_reset", "reset_season", "field",
    "c_street", "c_speed", "c_dnf_rate", "c_visits", "d_acc_rate", "d_starts", "d_age",
    "d_fin_e10", "d_q_e10", "d_last_dnf", "t_mech_s", "t_mech_e", "t_n_s", "t_qgap_e8",
    "t_fin_e8", "has_sprint", "s_dnf_rate", "d_dnf_e", "t_dnf_s",
]
DNF_QUALI_COLUMNS = DNF_COLUMNS + ["grid", "q_pos", "pitlane"]


def train_ranker(frame: pd.DataFrame, columns: list[str], order_col: str,
                 params: dict, seed: int = 0) -> xgb.Booster:
    """Ranker over races; rows without an order (DNF, no quali time) are left out."""
    ranked = frame[frame[order_col].notna()].sort_values(["raceId", order_col])
    group_sizes = ranked.groupby("raceId", sort=True).size()
    ranked = ranked[ranked["raceId"].map(group_sizes) >= 2]
    rank_in_race = ranked.groupby("raceId").cumcount()
    race_size = ranked.groupby("raceId")["raceId"].transform("size")
    relevance = (race_size - 1 - rank_in_race).to_numpy(dtype=float)
    features = ranked[columns].to_numpy(dtype=np.float32)
    qid = ranked["raceId"].to_numpy()
    matrix = xgb.DMatrix(features, label=relevance, qid=qid, feature_names=columns,
                         missing=np.nan)
    race_seasons = ranked.groupby("raceId", sort=True)["season"].first()
    group_weights = recency_weights(race_seasons.to_numpy(), params["decay"])
    matrix.set_weight(group_weights)
    booster_params = _booster_params(params, seed)
    booster_params["objective"] = params["objective"]
    booster_params["eval_metric"] = "ndcg@3"
    if params["objective"] == "rank:pairwise":
        booster_params["lambdarank_pair_method"] = "mean"
        booster_params["lambdarank_num_pair_per_sample"] = 8
    else:
        booster_params["lambdarank_pair_method"] = "topk"
        booster_params["lambdarank_num_pair_per_sample"] = 10
        booster_params["ndcg_exp_gain"] = False
    rounds = int(params["num_boost_round"])
    return xgb.train(booster_params, matrix, num_boost_round=rounds)


def train_dnf(frame: pd.DataFrame, columns: list[str], params: dict,
              seed: int = 0) -> xgb.Booster:
    """Binary classifier for 'not classified' (retirement, accident, did not start)."""
    usable = frame[frame["y_dnf"].notna()]
    features = usable[columns].to_numpy(dtype=np.float32)
    labels = usable["y_dnf"].to_numpy(dtype=float)
    weights = recency_weights(usable["season"].to_numpy(), params["decay"])
    matrix = xgb.DMatrix(features, label=labels, weight=weights, feature_names=columns,
                         missing=np.nan)
    booster_params = _booster_params(params, seed)
    booster_params["objective"] = "binary:logistic"
    booster_params["eval_metric"] = "logloss"
    rounds = int(params["num_boost_round"])
    return xgb.train(booster_params, matrix, num_boost_round=rounds)


def predict(booster: xgb.Booster, frame: pd.DataFrame, columns: list[str],
            margin: bool = True) -> np.ndarray:
    features = frame[columns].to_numpy(dtype=np.float32)
    matrix = xgb.DMatrix(features, feature_names=columns, missing=np.nan)
    return booster.predict(matrix, output_margin=margin)


def contributions(booster: xgb.Booster, frame: pd.DataFrame, columns: list[str]) -> np.ndarray:
    """Exact TreeSHAP contributions (n_rows, n_features + 1), last column is the bias."""
    features = frame[columns].to_numpy(dtype=np.float32)
    matrix = xgb.DMatrix(features, feature_names=columns, missing=np.nan)
    return booster.predict(matrix, pred_contribs=True)


def importance(booster: xgb.Booster) -> dict[str, float]:
    """Total gain per feature, normalised to sum to 1."""
    gains = booster.get_score(importance_type="total_gain")
    total = sum(gains.values()) or 1.0
    return {name: value / total for name, value in gains.items()}


def pick_device() -> str:
    """XGBoost device: "cuda" when this machine has CUDA, otherwise "cpu"."""
    return "cuda" if torch.cuda.is_available() else "cpu"


def recency_weights(seasons: np.ndarray, decay: float) -> np.ndarray:
    latest = seasons.max()
    age = latest - seasons
    return np.power(decay, age).astype(float)


def _booster_params(params: dict, seed: int) -> dict:
    return {
        "device": pick_device(),
        "tree_method": "hist",
        "eta": params["eta"],
        "max_depth": int(params["max_depth"]),
        "min_child_weight": params["min_child_weight"],
        "subsample": params["subsample"],
        "colsample_bytree": params["colsample_bytree"],
        "lambda": params["lambda"],
        "alpha": params["alpha"],
        "seed": seed,
        "verbosity": 0,
    }


DNF_LOGIT_COLUMNS = ["s_dnf_rate", "t_dnf_s", "d_dnf_e", "t_mech_e", "d_acc_rate", "d_q_e10",
                     "c_dnf_rate", "t_qgap_e8"]


class DnfLogit:
    """Small L2 logistic model for retirements (interpretable, better calibrated level).

    Retirements are close to unpredictable per car (AUC about 0.55 to 0.62); what matters is
    the level (season, circuit, team reliability) plus a little for running position, so a
    linear model on a handful of rates beats the GBM out of sample in 2024 and 2026.
    """

    def __init__(self, with_grid: bool, decay: float):
        from sklearn.linear_model import LogisticRegression

        self.with_grid = with_grid
        self.decay = decay
        self.model = LogisticRegression(C=1.0, max_iter=1000)

    def fit(self, frame: pd.DataFrame) -> "DnfLogit":
        usable = frame[frame["y_dnf"].notna()]
        design = self._design(usable)
        weights = recency_weights(usable["season"].to_numpy(), self.decay)
        self.model.fit(design, usable["y_dnf"].to_numpy(dtype=int), sample_weight=weights)
        return self

    def predict(self, frame: pd.DataFrame) -> np.ndarray:
        design = self._design(frame)
        return self.model.predict_proba(design)[:, 1]

    def _design(self, frame: pd.DataFrame) -> np.ndarray:
        season_rate = frame["s_dnf_rate"].fillna(0.12).clip(0.01, 0.6)
        columns = [
            np.log(season_rate / (1 - season_rate)),
            frame["t_dnf_s"].fillna(season_rate),
            frame["d_dnf_e"].fillna(season_rate),
            frame["t_mech_e"].fillna(0.1),
            frame["d_acc_rate"].fillna(0.1),
            frame["d_q_e10"].fillna(15.0),
            frame["c_dnf_rate"].fillna(season_rate),
            frame["t_qgap_e8"].fillna(2.5).clip(0, 5),
        ]
        if self.with_grid:
            grid = frame["grid"].fillna(frame["d_q_e10"]).fillna(15.0)
            columns.append(grid)
            columns.append(frame["pitlane"].fillna(0.0))
        return np.column_stack([np.asarray(c, dtype=float) for c in columns])
