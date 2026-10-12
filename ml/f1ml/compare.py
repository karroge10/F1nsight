"""Compare v1 (published) and v2 backtests with bootstrap confidence intervals over races.

    uv run python -m f1ml.compare --tag v2

Inputs (all under reports/v2/): v1 per race records for 2024-2026 (snapshot of the published
backtest.json) and 2019-2023 (`scripts/v2/v1_backtest_extended.py`), v2 records from
`f1ml.evaluate`. Every interval is a 95% percentile bootstrap over races (5,000 resamples);
differences are paired (the same resampled races for both models), so they are much tighter
than the two marginal intervals suggest. Writes reports/v2/compare_<tag>.md and .json.
"""

from __future__ import annotations

import argparse
import json

import numpy as np
import pandas as pd

from f1ml import paths

V2_DIR = paths.REPORTS_DIR / "v2"
METRICS = ("winnerCorrect", "podiumHits", "spearman", "mae", "brierWin", "logLossWin",
           "pointsMae")
LOWER_IS_BETTER = {"mae", "brierWin", "logLossWin", "pointsMae"}
STAGES = ("pre-weekend", "post-practice", "post-qualifying")
PERIODS = {"2024-26": (2024, 2026), "2019-23": (2019, 2023), "2019-26": (2019, 2026)}
RESAMPLES = 5000


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", default="v2")
    parser.add_argument("--against", default="v1", help="v1 or another eval tag")
    args = parser.parse_args()
    result = compare(args.tag, args.against)
    text = render(result, args.tag, args.against)
    (V2_DIR / f"compare_{args.tag}.md").write_text(text, encoding="utf-8")
    (V2_DIR / f"compare_{args.tag}.json").write_text(json.dumps(result, indent=1),
                                                    encoding="utf-8")
    print(text)


def compare(tag: str, against: str = "v1") -> dict:
    new = eval_records(tag)
    old = v1_records() if against == "v1" else eval_records(against)
    grid = grid_records(tag)
    common = sorted(set(new["raceId"]) & set(old["raceId"]))
    new = new[new["raceId"].isin(common)]
    old = old[old["raceId"].isin(common)]
    grid = grid[grid["raceId"].isin(common)]
    result = {"races": len(common), "periods": {}}
    for period, (first, last) in PERIODS.items():
        ids = [r for r in common if first <= r // 100 <= last]
        if not ids:
            continue
        rng = np.random.default_rng(17)
        samples = rng.integers(0, len(ids), size=(RESAMPLES, len(ids)))
        block = {"races": len(ids), "stages": {}}
        for stage in STAGES:
            block["stages"][stage] = stage_table(new, old, stage, ids, samples)
        block["grid"] = model_table(grid, ids, samples)
        block["v1Grid"] = model_table(old_grid_records(ids), ids, samples)
        block["pointsBins"] = points_bins(tag, ids)
        result["periods"][period] = block
    return result


def stage_table(new: pd.DataFrame, old: pd.DataFrame, stage: str, ids: list,
                samples: np.ndarray) -> dict:
    a = new[new["stage"] == stage].set_index("raceId").loc[ids]
    b = old[old["stage"] == stage].set_index("raceId").loc[ids]
    table = {}
    for metric in METRICS:
        if metric not in a or metric not in b:
            continue
        x = a[metric].to_numpy(dtype=float)
        y = b[metric].to_numpy(dtype=float)
        if np.isnan(y).all():
            continue
        diff = x - y
        table[metric] = {
            "new": _interval(x, samples),
            "old": _interval(y, samples),
            "diff": _interval(diff, samples),
        }
    return table


def model_table(records: pd.DataFrame, ids: list, samples: np.ndarray) -> dict:
    rows = records.set_index("raceId").loc[ids]
    table = {}
    for metric in METRICS:
        if metric in rows and rows[metric].notna().all():
            table[metric] = _interval(rows[metric].to_numpy(dtype=float), samples)
    return table


def eval_records(tag: str) -> pd.DataFrame:
    payload = json.loads((V2_DIR / f"eval_{tag}.json").read_text(encoding="utf-8"))
    rows = []
    for race in payload["races"]:
        for stage, values in race["stages"].items():
            rows.append({"raceId": race["raceId"], "stage": stage, **values})
    return pd.DataFrame(rows)


def grid_records(tag: str) -> pd.DataFrame:
    payload = json.loads((V2_DIR / f"eval_{tag}.json").read_text(encoding="utf-8"))
    rows = [{"raceId": race["raceId"], **race["baselines"]["grid"]} for race in payload["races"]]
    return pd.DataFrame(rows)


def v1_records() -> pd.DataFrame:
    """v1 per race stage metrics, 2019-2026, with points MAE from the driver rows."""
    frames = []
    recent = json.loads((V2_DIR / "v1_backtest_2024_2026.json").read_text(encoding="utf-8"))
    frames.append(_v1_frame(recent["races"]))
    early_path = V2_DIR / "v1_races_2019_2023.json"
    if early_path.exists():
        early = json.loads(early_path.read_text(encoding="utf-8"))
        frames.append(_v1_frame(early))
    records = pd.concat(frames, ignore_index=True)
    points = _v1_points_mae()
    return records.merge(points, on=["raceId", "stage"], how="left")


def old_grid_records(ids: list) -> pd.DataFrame:
    """v1's own grid baseline (slot table 2014-2023: leaks into 2019-2023 probabilities)."""
    rows = []
    recent = json.loads((V2_DIR / "v1_backtest_2024_2026.json").read_text(encoding="utf-8"))
    races = list(recent["races"])
    early_path = V2_DIR / "v1_races_2019_2023.json"
    if early_path.exists():
        races += json.loads(early_path.read_text(encoding="utf-8"))
    for race in races:
        rows.append({"raceId": race["raceId"], **race["baselines"]["grid"]})
    frame = pd.DataFrame(rows).drop_duplicates("raceId")
    return frame[frame["raceId"].isin(ids)]


def points_bins(tag: str, ids: list) -> dict:
    """Mean predicted vs actual points by predicted bin (pre-weekend and post-qualifying)."""
    bins = [-1, 1, 3, 6, 10, 15, 20, 60]
    labels = ["0-1", "1-3", "3-6", "6-10", "10-15", "15-20", "20+"]
    result = {}
    sources = {"new": pd.read_parquet(V2_DIR / f"eval_{tag}_rows.parquet"), "old": _v1_rows()}
    for name, rows in sources.items():
        rows = rows[rows["raceId"].isin(ids)]
        for stage in ("pre-weekend", "post-qualifying"):
            stage_rows = rows[rows["stage"] == stage].copy()
            if not len(stage_rows):
                continue
            stage_rows["bin"] = pd.cut(stage_rows["expectedPoints"], bins, labels=labels)
            grouped = stage_rows.groupby("bin", observed=True).agg(
                n=("actualPoints", "size"), predicted=("expectedPoints", "mean"),
                actual=("actualPoints", "mean"))
            result[f"{name}:{stage}"] = {str(k): {c: round(float(v), 2) for c, v in row.items()}
                                         for k, row in grouped.iterrows()}
    return result


def render(result: dict, tag: str, against: str) -> str:
    lines = [f"# {tag} vs {against}: walk-forward backtest, 95% bootstrap intervals over races", ""]
    for period, block in result["periods"].items():
        lines.append(f"## {period} ({block['races']} races)")
        lines.append("")
        lines.append("| stage | metric | " + against + " | " + tag + " | difference |")
        lines.append("|---|---|---|---|---|")
        for stage, table in block["stages"].items():
            for metric, values in table.items():
                diff = values["diff"]
                flag = _flag(metric, diff)
                lines.append(f"| {stage} | {metric} | {_fmt(values['old'])} | "
                             f"{_fmt(values['new'])} | {_fmt(diff, signed=True)} {flag} |")
        lines.append("")
        lines.append("Grid order baseline (walk-forward slot table): " + ", ".join(
            f"{m} {_fmt(v)}" for m, v in block["grid"].items()))
        lines.append("")
    return "\n".join(lines)


# ----------------------------------------------------------------------------------------------
# helpers


def _interval(values: np.ndarray, samples: np.ndarray) -> dict:
    means = values[samples].mean(axis=1)
    low, high = np.percentile(means, [2.5, 97.5])
    return {"mean": round(float(values.mean()), 4), "low": round(float(low), 4),
            "high": round(float(high), 4)}


def _fmt(values: dict, signed: bool = False) -> str:
    sign = "+" if signed else ""
    return (f"{values['mean']:{sign}.3f} [{values['low']:{sign}.3f}, "
            f"{values['high']:{sign}.3f}]")


def _flag(metric: str, diff: dict) -> str:
    better_low = metric in LOWER_IS_BETTER
    if diff["high"] < 0:
        return "(better)" if better_low else "(worse)"
    if diff["low"] > 0:
        return "(worse)" if better_low else "(better)"
    return ""


def _v1_frame(races: list) -> pd.DataFrame:
    rows = []
    for race in races:
        for stage, values in race["stages"].items():
            rows.append({"raceId": race["raceId"], "stage": stage, **values})
    return pd.DataFrame(rows)


def _v1_rows() -> pd.DataFrame:
    frames = [pd.read_parquet(V2_DIR / "v1_driver_rows_2024_2026.parquet")]
    early = V2_DIR / "v1_driver_rows_2019_2023.parquet"
    if early.exists():
        frames.append(pd.read_parquet(early))
    return pd.concat(frames, ignore_index=True)


def _v1_points_mae() -> pd.DataFrame:
    rows = _v1_rows()
    rows["error"] = (rows["expectedPoints"] - rows["actualPoints"]).abs()
    grouped = rows.groupby(["raceId", "stage"], as_index=False)["error"].mean()
    return grouped.rename(columns={"error": "pointsMae"})


if __name__ == "__main__":
    main()
