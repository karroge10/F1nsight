"""Scorecard: proper scores of a walk-forward backtest run, so before/after is one command.

    uv run python -m f1ml.backtest --label baseline          # rows for the scorecard, no site files
    uv run python -m f1ml.scorecard baseline                  # reports/scorecard/baseline.{json,md}
    uv run python -m f1ml.scorecard candidate --against baseline

Locked protocol (see research/evaluation-protocol.md): walk-forward over 2024, 2025 and 2026
R1 to R16, retrain every 3 rounds, 20,000 simulations per stage, seed = raceId. Every score is
computed per race and averaged over races; differences between two runs use a paired bootstrap
over races (the same races in both runs).

Scores per stage (lower is better unless marked):
- rps: ranked probability score of the full position distribution, mean over cars;
- nll: negative log likelihood of the realised outcome under the simulator's own model:
  retirements (Bernoulli per car) plus the Plackett-Luce order of classified cars with the
  position dependent temperature and the grid bonus (orderNll + dnfNll);
- logLossWin: -log pWin of the winner; logLossPodium, logLossPoints: binary, mean over cars;
- spearman (higher is better): expected position against the classification;
- maePoints: expected championship points (race + sprint) against the real points, per car;
- calibration (pooled over cars): expected calibration error, logistic slope and intercept;
- fantasy: driver and constructor MAE at the team lock (practice known, no qualifying).
"""

from __future__ import annotations

import argparse
import json

import numpy as np
import pandas as pd
from scipy.special import logit, logsumexp

from f1ml import metrics, paths

SCORECARD_DIR = paths.REPORTS_DIR / "scorecard"
STAGES = ("pre-weekend", "post-practice", "post-qualifying")
RACE_SCORES = ("rps", "nll", "orderNll", "dnfNll", "logLossWin", "logLossPodium",
               "logLossPoints", "spearman", "maePoints")
HIGHER_IS_BETTER = {"spearman"}
BOOTSTRAP_DRAWS = 4000
EPS = 1e-6


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("label", help="run label given to f1ml.backtest --label")
    parser.add_argument("--against", help="label of the run to compare with (paired bootstrap)")
    args = parser.parse_args()
    card = build_scorecard(args.label)
    comparison = None
    if args.against:
        comparison = compare_runs(args.against, args.label)
        card["against"] = comparison
    write_scorecard(args.label, card, comparison)
    print(markdown(args.label, card, comparison))


def build_scorecard(label: str) -> dict:
    """Aggregate scores of one run: per stage, per season, calibration, fantasy."""
    per_race = race_scores(label)
    cars = load_rows(label, "cars")
    card = {"label": label, "races": int(per_race["raceId"].nunique()), "stages": {},
            "bySeason": {}, "calibration": {}, "fantasy": fantasy_scores(label)}
    for stage in STAGES:
        stage_rows = per_race[per_race["stage"] == stage]
        card["stages"][stage] = _means(stage_rows)
        card["bySeason"][stage] = {str(season): _means(rows)
                                   for season, rows in stage_rows.groupby("season")}
        card["calibration"][stage] = calibration(cars[cars["stage"] == stage])
    return card


def race_scores(label: str) -> pd.DataFrame:
    """One row per (race, stage) with every race-level score."""
    cars = load_rows(label, "cars")
    races = load_rows(label, "races")
    rows = []
    for (race_id, stage), group in cars.groupby(["raceId", "stage"], sort=True):
        scores = car_scores(group)
        scores.update({"raceId": int(race_id), "stage": stage,
                       "season": int(group["season"].iloc[0])})
        rows.append(scores)
    frame = pd.DataFrame(rows)
    likelihood = races[["raceId", "stage", "orderNll", "dnfNll"]]
    frame = frame.merge(likelihood, on=["raceId", "stage"], how="left")
    frame["nll"] = frame["orderNll"] + frame["dnfNll"]
    return frame


def car_scores(group: pd.DataFrame) -> dict:
    """Race-level scores from the per-car rows of one race and stage."""
    actual = group["actual"].to_numpy(dtype=float)
    distribution = np.stack(group["dist"].to_numpy())
    p_win = np.clip(group["pWin"].to_numpy(dtype=float), EPS, 1 - EPS)
    p_podium = group["pPodium"].to_numpy(dtype=float)
    p_points = group["pPoints"].to_numpy(dtype=float)
    expected = group["expectedPosition"].to_numpy(dtype=float)
    winner = actual == 1
    rank_spearman = pd.Series(expected).corr(pd.Series(actual), method="spearman")
    points_error = group["expectedPoints"] - group["actualPoints"]
    return {
        "rps": ranked_probability_score(distribution, actual),
        "logLossWin": float(-np.log(p_win[winner]).sum()),
        "logLossPodium": binary_log_loss(p_podium, actual <= 3),
        "logLossPoints": binary_log_loss(p_points, actual <= 10),
        "spearman": float(rank_spearman),
        "maePoints": float(points_error.abs().mean()),
    }


def compare_runs(before: str, after: str) -> dict:
    """Paired bootstrap over races of (after - before) for every race-level score."""
    first = race_scores(before)
    second = race_scores(after)
    merged = first.merge(second, on=["raceId", "stage", "season"], suffixes=("_a", "_b"))
    rng = np.random.default_rng(20261008)
    result = {"before": before, "after": after, "stages": {}}
    for stage in STAGES:
        rows = merged[merged["stage"] == stage]
        if not len(rows):
            continue
        draws = rng.integers(0, len(rows), size=(BOOTSTRAP_DRAWS, len(rows)))
        entry = {"races": int(len(rows))}
        for score in RACE_SCORES:
            difference = (rows[f"{score}_b"] - rows[f"{score}_a"]).to_numpy(dtype=float)
            boot = difference[draws].mean(axis=1)
            low, high = np.percentile(boot, [2.5, 97.5])
            entry[score] = {"before": float(rows[f"{score}_a"].mean()),
                            "after": float(rows[f"{score}_b"].mean()),
                            "diff": float(difference.mean()), "low": float(low),
                            "high": float(high)}
        result["stages"][stage] = entry
    fantasy_before = fantasy_scores(before)
    fantasy_after = fantasy_scores(after)
    result["fantasy"] = {"before": fantasy_before, "after": fantasy_after}
    return result


def ranked_probability_score(distribution: np.ndarray, actual: np.ndarray) -> float:
    """Mean RPS over cars; distribution (cars, positions), actual 1-based positions."""
    cars, positions = distribution.shape
    cumulative = np.cumsum(distribution, axis=1)[:, :-1]
    steps = np.arange(1, positions)
    observed = (actual[:, None] <= steps[None, :]).astype(float)
    per_car = ((cumulative - observed) ** 2).sum(axis=1) / (positions - 1)
    return float(per_car.mean())


def order_log_likelihood(strength: np.ndarray, schedule, first_bonus, finish: np.ndarray,
                         classified: np.ndarray, p_dnf: np.ndarray) -> tuple[float, float]:
    """(order NLL, retirement NLL) of a realised race under the simulator's model.

    The simulator draws retirements per car, then picks classified cars one by one with
    softmax(T_k * strength) (+ the grid bonus on the first pick). This is the exact likelihood
    of that generative model for the classified order and the set of retired cars.
    """
    count = len(strength)
    params = np.array([1.0, 1.0, 1.0]) if schedule is None else np.asarray(schedule, float)
    first, last, tau = params
    temperatures = last + (first - last) * np.exp(-np.arange(count, dtype=float) / tau)
    finishers = np.where(classified & ~np.isnan(finish))[0]
    order = finishers[np.argsort(finish[finishers], kind="stable")]
    bonus = np.zeros(count) if first_bonus is None else np.asarray(first_bonus, dtype=float)
    order_ll = 0.0
    for step in range(len(order) - 1):
        remaining = order[step:]
        logits = strength[remaining] * temperatures[step]
        if step == 0:
            logits = logits + bonus[remaining]
        order_ll += float(logits[0] - logsumexp(logits))
    clipped = np.clip(p_dnf, EPS, 1 - EPS)
    dnf_ll = np.where(classified, np.log(1 - clipped), np.log(clipped)).sum()
    return -order_ll, -float(dnf_ll)


def binary_log_loss(probabilities: np.ndarray, outcomes: np.ndarray) -> float:
    clipped = np.clip(probabilities, EPS, 1 - EPS)
    losses = outcomes * np.log(clipped) + (~outcomes) * np.log(1 - clipped)
    return float(-losses.mean())


def calibration(cars: pd.DataFrame) -> dict:
    """ECE, logistic calibration slope / intercept and bins (n per bin) for win, podium,
    points; expected points by predicted bin."""
    actual = cars["actual"].to_numpy(dtype=float)
    targets = {"win": ("pWin", actual == 1), "podium": ("pPodium", actual <= 3),
               "points": ("pPoints", actual <= 10)}
    result = {}
    for name, (column, outcome) in targets.items():
        probabilities = cars[column].to_numpy(dtype=float)
        table = metrics.calibration_table(probabilities, outcome)
        slope, intercept = calibration_slope(probabilities, outcome)
        result[name] = {"ece": table["ece"], "slope": slope, "intercept": intercept,
                        "bins": table["bins"]}
    result["expectedPoints"] = points_bins(cars)
    return result


def calibration_slope(probabilities: np.ndarray, outcomes: np.ndarray) -> tuple[float, float]:
    """Logistic recalibration y ~ a + b * logit(p): b = 1, a = 0 is perfect."""
    from sklearn.linear_model import LogisticRegression

    clipped = np.clip(probabilities, 1e-4, 1 - 1e-4)
    features = logit(clipped).reshape(-1, 1)
    model = LogisticRegression(C=1e6)
    model.fit(features, outcomes.astype(int))
    return round(float(model.coef_[0][0]), 3), round(float(model.intercept_[0]), 3)


def points_bins(cars: pd.DataFrame) -> list[dict]:
    edges = (0, 1, 3, 6, 10, 15, 20, 100)
    bins = pd.cut(cars["expectedPoints"], edges, right=False)
    rows = []
    for interval, group in cars.groupby(bins, observed=True):
        rows.append({"bin": f"{interval.left:g}-{interval.right:g}", "n": int(len(group)),
                     "predicted": round(float(group["expectedPoints"].mean()), 2),
                     "actual": round(float(group["actualPoints"].mean()), 2)})
    return rows


def fantasy_scores(label: str) -> dict:
    """Fantasy MAE at the team lock and after qualifying, drivers and constructors."""
    path = SCORECARD_DIR / f"{label}_fantasy.parquet"
    if not path.exists():
        return {}
    rows = pd.read_parquet(path)
    result = {}
    for (stage, kind), group in rows.groupby(["stage", "kind"]):
        if stage not in ("lock", "post-qualifying"):
            continue
        error = (group["expected"] - group["actual"]).abs()
        inside = (group["actual"] >= group["p10"]) & (group["actual"] <= group["p90"])
        result[f"{stage}:{kind}"] = {"n": int(len(group)), "mae": round(float(error.mean()), 3),
                                     "p10p90Coverage": round(float(inside.mean()), 3)}
    return result


def load_rows(label: str, kind: str) -> pd.DataFrame:
    return pd.read_parquet(SCORECARD_DIR / f"{label}_{kind}.parquet")


def write_scorecard(label: str, card: dict, comparison: dict | None) -> None:
    SCORECARD_DIR.mkdir(parents=True, exist_ok=True)
    text = json.dumps(card, indent=2, default=float)
    (SCORECARD_DIR / f"{label}.json").write_text(text, encoding="utf-8")
    report = markdown(label, card, comparison)
    (SCORECARD_DIR / f"{label}.md").write_text(report, encoding="utf-8")


def markdown(label: str, card: dict, comparison: dict | None) -> str:
    lines = [f"# Scorecard: {label}", "",
             f"{card['races']} races, walk-forward (protocol: research/evaluation-protocol.md).",
             "Lower is better except Spearman.", "",
             "| stage | RPS | NLL | order NLL | DNF NLL | log loss win | log loss podium "
             "| log loss points | Spearman | MAE points |",
             "|---|---|---|---|---|---|---|---|---|---|"]
    for stage, values in card["stages"].items():
        cells = " | ".join(_fmt(values.get(score)) for score in RACE_SCORES)
        lines.append(f"| {stage} | {cells} |")
    lines += ["", "| stage | ECE win | slope win | ECE podium | slope podium | ECE points "
              "| slope points |", "|---|---|---|---|---|---|---|"]
    for stage, values in card["calibration"].items():
        cells = [_fmt(values[name][field]) for name in ("win", "podium", "points")
                 for field in ("ece", "slope")]
        lines.append(f"| {stage} | {' | '.join(cells)} |")
    if card["fantasy"]:
        lines += ["", "| fantasy | n | MAE | p10-p90 coverage |", "|---|---|---|---|"]
        for key, values in card["fantasy"].items():
            lines.append(f"| {key} | {values['n']} | {values['mae']:.3f} "
                         f"| {values['p10p90Coverage']:.3f} |")
    if comparison:
        lines += _comparison_lines(comparison)
    return "\n".join(lines) + "\n"


# ----------------------------------------------------------------------------------------------
# helpers


def _comparison_lines(comparison: dict) -> list[str]:
    lines = ["", f"## {comparison['after']} against {comparison['before']} "
             "(paired bootstrap over races, 95% interval of the mean difference)", "",
             "| stage | score | before | after | diff | 95% interval | better |",
             "|---|---|---|---|---|---|---|"]
    for stage, entry in comparison["stages"].items():
        for score in RACE_SCORES:
            values = entry[score]
            better = _verdict(score, values)
            lines.append(f"| {stage} | {score} | {_fmt(values['before'])} "
                         f"| {_fmt(values['after'])} | {values['diff']:+.4f} "
                         f"| [{values['low']:+.4f}, {values['high']:+.4f}] | {better} |")
    before = comparison["fantasy"]["before"]
    after = comparison["fantasy"]["after"]
    for key in sorted(set(before) & set(after)):
        lines.append(f"| fantasy | {key} MAE | {before[key]['mae']:.3f} "
                     f"| {after[key]['mae']:.3f} "
                     f"| {after[key]['mae'] - before[key]['mae']:+.3f} | | |")
    return lines


def _verdict(score: str, values: dict) -> str:
    sign = 1.0 if score in HIGHER_IS_BETTER else -1.0
    if sign * values["low"] > 0 and sign * values["high"] > 0:
        return "yes"
    if sign * values["low"] < 0 and sign * values["high"] < 0:
        return "worse"
    return "n.s."


def _means(rows: pd.DataFrame) -> dict:
    return {score: float(rows[score].mean()) for score in RACE_SCORES if score in rows}


def _fmt(value) -> str:
    if value is None or value != value:
        return "n/a"
    return f"{value:.4f}"


if __name__ == "__main__":
    main()
