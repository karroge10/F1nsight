"""Per race accuracy metrics, baselines and calibration tables."""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.stats import spearmanr

EPS = 1e-6
CALIBRATION_BINS = (0.0, 0.02, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0)


def race_metrics(expected_position: np.ndarray, p_win: np.ndarray, p_podium: np.ndarray,
                 p_points: np.ndarray, p_dnf: np.ndarray, actual: np.ndarray,
                 dnf: np.ndarray) -> dict:
    """Metrics of one race. `actual` is the classification order (positionOrder, all cars)."""
    winner = actual == 1
    podium = actual <= 3
    points = actual <= 10
    predicted_winner = int(np.argmax(p_win))
    top3 = np.argsort(-p_podium)[:3]
    clipped_win = np.clip(p_win, EPS, 1 - EPS)
    clipped_podium = np.clip(p_podium, EPS, 1 - EPS)
    return {
        "winnerCorrect": float(winner[predicted_winner]),
        "podiumHits": float(podium[top3].sum() / 3.0),
        "mae": float(np.abs(expected_position - actual).mean()),
        "spearman": float(spearmanr(expected_position, actual).statistic),
        "brierWin": float(((p_win - winner) ** 2).mean()),
        "logLossWin": float(-np.log(clipped_win[winner]).sum()),
        "brierPodium": float(((p_podium - podium) ** 2).mean()),
        "logLossPodium": float(-(podium * np.log(clipped_podium)
                                 + (~podium) * np.log(1 - clipped_podium)).mean()),
        "brierPoints": float(((p_points - points) ** 2).mean()),
        "brierDnf": float(((p_dnf - dnf) ** 2).mean()),
        "pWinActualWinner": float(p_win[winner].sum()),
        "maxPWin": float(p_win.max()),
        "favouritePodium": float(podium[predicted_winner]),
        "pDnfMean": float(p_dnf.mean()),
        "dnfRate": float(dnf.mean()),
    }


def order_metrics(predicted_rank: np.ndarray, actual: np.ndarray) -> dict:
    """Metrics for a deterministic baseline order (1 = predicted winner)."""
    winner_index = int(np.argmin(predicted_rank))
    top3 = np.argsort(predicted_rank)[:3]
    return {
        "winnerCorrect": float(actual[winner_index] == 1),
        "podiumHits": float((actual[top3] <= 3).sum() / 3.0),
        "mae": float(np.abs(predicted_rank - actual).mean()),
        "spearman": float(spearmanr(predicted_rank, actual).statistic),
    }


def slot_probabilities(table: pd.DataFrame, slots: np.ndarray, column: str) -> np.ndarray:
    """Look up empirical probabilities by slot (grid or standings position), normalised so
    win probabilities sum to 1 in a race."""
    lookup = table[column]
    values = np.array([lookup.get(int(slot), lookup.iloc[-1]) for slot in slots], dtype=float)
    return values


def empirical_slot_table(frame: pd.DataFrame, slot_col: str, seasons: tuple) -> pd.DataFrame:
    """P(win), P(podium), P(points) by slot value over the given seasons."""
    rows = frame[frame["season"].between(seasons[0], seasons[1]) & frame[slot_col].notna()
                 & frame["y_finish"].notna()].copy()
    rows["slot"] = rows[slot_col].round().clip(1, 24).astype(int)
    grouped = rows.groupby("slot")["y_finish"]
    table = pd.DataFrame({
        "pWin": grouped.apply(lambda s: (s == 1).mean()),
        "pPodium": grouped.apply(lambda s: (s <= 3).mean()),
        "pPoints": grouped.apply(lambda s: (s <= 10).mean()),
    })
    return table.reindex(range(1, 25)).ffill().fillna(0.0)


def calibration_table(probabilities: np.ndarray, outcomes: np.ndarray) -> dict:
    """Reliability bins and expected calibration error."""
    bins = np.array(CALIBRATION_BINS)
    index = np.clip(np.digitize(probabilities, bins) - 1, 0, len(bins) - 2)
    rows = []
    ece = 0.0
    total = len(probabilities)
    for b in range(len(bins) - 1):
        mask = index == b
        count = int(mask.sum())
        if not count:
            continue
        predicted = float(probabilities[mask].mean())
        observed = float(outcomes[mask].mean())
        ece += count / total * abs(predicted - observed)
        rows.append({"bin": f"{bins[b]:.2f}-{bins[b + 1]:.2f}", "n": count,
                     "predicted": round(predicted, 4), "observed": round(observed, 4)})
    return {"bins": rows, "ece": round(ece, 4)}


def mean_metrics(rows: list[dict]) -> dict:
    if not rows:
        return {}
    keys = rows[0].keys()
    result = {}
    for key in keys:
        values = [row[key] for row in rows if row.get(key) is not None
                  and row[key] == row[key]]
        result[key] = float(np.mean(values)) if values else None
    return result
