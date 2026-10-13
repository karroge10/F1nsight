import json
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import spearmanr

from f1ml import dynpl, features, gbm, train


def main():
    history = features.History.load()
    params = dynpl.load_params()
    original = dynpl.Filter(history.events, params)
    checks = []
    for race_id in (202201, 202501, 202601, 202608):
        entrants = history.events[history.events["raceId"] == race_id]
        removed_events = history.events[history.events["raceId"] != race_id]
        removed = dynpl.Filter(removed_events, params)
        first = original.features(entrants, race_id)
        second = removed.features(entrants, race_id)
        np.testing.assert_array_equal(first.values, second.values)
        checks.append({"raceId": race_id, "unchanged": True})
    candidate = pd.read_parquet("cache/features_dynpl.parquet")
    for race_id, rows in candidate.groupby("raceId"):
        cutoff = int(race_id)
        strengths = original.features(rows, cutoff)
        candidate.loc[rows.index, dynpl.COLS] = strengths
    selection = candidate[candidate["raceId"] < 202617]
    selection.to_parquet("cache/features_dynpl.parquet", index=False)
    candidate = selection
    baseline = candidate.drop(columns=dynpl.COLS)
    results = {}
    params = train.load_params()
    rank_params = params["rank"].get("pre-weekend", params["rank"]["default"])
    for name, table in (("baseline", baseline), ("dynpl", candidate)):
        columns = features.stage_columns("pre-weekend")
        columns = [column for column in columns if column in table.columns]
        fitting = table[table["season"] < 2023].copy()
        fitting["order"] = fitting["y_finish"].where(fitting["y_classified"] == 1)
        model = gbm.train_ranker(fitting, columns, "order", rank_params)
        validation = table[(table["season"] == 2023) & (table["y_classified"] == 1)].copy()
        scores = gbm.predict(model, validation, columns)
        validation["score"] = scores
        correlations = []
        for _, race in validation.groupby("raceId"):
            correlation = spearmanr(-race["score"], race["y_finish"]).statistic
            correlations.append(correlation)
        mean_correlation = np.mean(correlations)
        results[name] = float(mean_correlation)
    top = []
    for season, rows in candidate[candidate["season"] >= 2019].groupby("season"):
        last_round = rows["round"].max()
        last = rows[rows["round"] == last_round]
        strengths = last.groupby("team")["dp_team"].mean().sort_values(ascending=False)
        leading = strengths.head(4).to_dict()
        print(f"{season} top teams before round {last_round}: {leading}")
        entry = {"season": int(season), "round": int(last_round), "teams": strengths.to_dict()}
        top.append(entry)
    result = {"leakage_checks": checks, "cheap_2023_preweekend_spearman": results,
              "top_teams": top, "uncertainty": "Diagonal Laplace approximation; driver-team covariance is omitted."}
    text = json.dumps(result, indent=2)
    Path("reports/exp/dynpl/sanity.json").write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
