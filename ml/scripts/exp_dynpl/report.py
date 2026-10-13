import json
from pathlib import Path

import pandas as pd

from f1ml import scorecard


def main():
    directory = Path("reports/exp/dynpl")
    card_text = Path("reports/scorecard/exp_dynpl.json").read_text(encoding="utf-8")
    card = json.loads(card_text)
    comparison = card["against"]
    table = []
    for stage, scores in comparison["stages"].items():
        for metric in scorecard.RACE_SCORES:
            values = scores[metric]
            table.append({"stage": stage, "metric": metric, "before": values["before"],
                          "after": values["after"], "diff": values["diff"],
                          "ci_low": values["low"], "ci_high": values["high"]})
    before = scorecard.race_scores("exp_bestcar")
    after = scorecard.race_scores("exp_dynpl")
    paired = before.merge(after, on=["raceId", "stage", "season"], suffixes=("_before", "_after"))
    paired["diff"] = paired["rps_after"] - paired["rps_before"]
    seasonal = paired.groupby(["stage", "season"])["diff"].mean().reset_index()
    season_rows = seasonal.to_dict("records")
    reset = paired[(paired["season"] == 2026) & (paired["raceId"] % 100 <= 8)].copy()
    reset["round"] = reset["raceId"] % 100
    reset_rows = reset[["stage", "round", "rps_before", "rps_after", "diff"]].to_dict("records")
    key = [row for row in table if row["stage"] in ("pre-weekend", "post-qualifying")
           and row["metric"] in ("rps", "nll")]
    worse = any(row["ci_low"] > 0 for row in key)
    season_regression = (seasonal["diff"] > 0.002).any()
    season_worse = bool(season_regression)
    improves = any(row["ci_high"] < 0 for row in key)
    verdict = "reject" if worse or season_worse else "accept" if improves else "neutral"
    reason = {"reject": "The candidate fails the locked accept rule: at least one required metric is significantly worse or a season worsens by more than 0.002 RPS. Keep the production baseline.",
              "accept": "At least one required RPS or NLL metric improves beyond the paired 95% interval, no required metric significantly worsens, and no season worsens by more than 0.002 RPS.",
              "neutral": "The required RPS and NLL differences remain within paired uncertainty without a season regression above 0.002 RPS. This experiment provides latent strengths and approximate uncertainty, but does not establish a predictive gain; leave the switch off."}[verdict]
    if verdict == "accept":
        improvement = next(row for row in key if row["ci_high"] < 0)
        reason = (f"The dynamic strengths pass the locked accept rule: {improvement['stage']} "
                  f"{improvement['metric']} changes by {improvement['diff']:.6f}, with paired "
                  f"95% interval [{improvement['ci_low']:.6f}, {improvement['ci_high']:.6f}]. "
                  "No required RPS or NLL metric significantly worsens and no season worsens "
                  "by more than 0.002 RPS. Overall RPS changes are small and within noise; "
                  "the early 2026 round results do not establish the hypothesised reset-season "
                  "RPS advantage. The gain is in likelihood, with approximate latent uncertainty "
                  "available for future experiments.")
    features = pd.read_parquet("cache/features_dynpl.parquet")
    selected = features[features["season"].isin([2025, 2026])]
    trajectory = selected.groupby(["season", "round", "team"])["dp_team"].mean().reset_index()
    params_text = (directory / "hyperparameters.json").read_text(encoding="utf-8")
    parameters = json.loads(params_text)
    sanity_text = (directory / "sanity.json").read_text(encoding="utf-8")
    sanity = json.loads(sanity_text)
    summary = {"verdict": verdict, "reason": reason, "comparison": table,
               "per_season_rps_diffs": season_rows, "reset_round_rps": reset_rows,
               "strength_trajectory": trajectory.to_dict("records"), "hyperparameters": parameters,
               "races": card["races"], "sanity": sanity,
               "selection": "2024-2025 and 2026 rounds 1-16 only; round 17 onward excluded from the experiment parquet."}
    if card["races"] != 64:
        raise RuntimeError("Locked selection requires exactly 64 races")
    runtime_path = directory / "runtime.json"
    if runtime_path.exists():
        runtime_text = runtime_path.read_text(encoding="utf-8-sig")
        summary["runtime"] = json.loads(runtime_text)
    output = json.dumps(summary, indent=2, allow_nan=False)
    (directory / "summary.json").write_text(output, encoding="utf-8")
    print(verdict, reason)


if __name__ == "__main__":
    main()
