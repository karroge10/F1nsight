import json
import argparse

import numpy as np
import pandas as pd

from f1ml import paths, weather
from f1ml import features as feat


INPUT = paths.REPORTS_DIR / "v2" / "eval_v2.json"
PRODUCTION_INPUT = paths.PREDICTIONS_DIR / "backtest.json"
FEATURES = paths.FEATURES_PATH
OUT_DIR = paths.ML_DIR / "research"
OUT_JSON = OUT_DIR / "year_condition.json"
OUT_MD = OUT_DIR / "year_condition.md"
SEED = 73021
BOOTSTRAPS = 5000
STACK_WINDOWS = (3, 5, 10)
WINDOW_SIMS = 5000
STAGES = feat.STAGES
METRICS = ("winnerCorrect", "spearman", "logLossWin", "brierWin", "mae")
ERA_WINDOWS = {
    "2019-2021": (2019, 2021),
    "2022-2025": (2022, 2025),
    "2026 partial": (2026, 2026),
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-windows", action="store_true")
    args = parser.parse_args()
    payload = json.loads(INPUT.read_text(encoding="utf-8"))
    races = pd.DataFrame(payload["races"])
    feature_data = pd.read_parquet(FEATURES)
    race_features = feature_data.drop_duplicates("raceId").set_index("raceId")
    weather_data = weather.race_weather().set_index("raceId")
    races["raceId"] = races["raceId"].astype(int)
    races["hasSprint"] = races["hasSprint"].astype(bool)
    races["rainActual"] = races["raceId"].map(weather_data["rain_actual"])
    races["rainCondition"] = np.select(
        [races["rainActual"].isna(), races["rainActual"] >= 1.0],
        ["unknown", "wet"],
        default="dry",
    )
    races["era"] = races["season"].map(era_for)
    races["featureSprint"] = races["raceId"].map(race_features["has_sprint"]).fillna(0).astype(bool)
    if len(races) != races["raceId"].nunique():
        raise ValueError("evaluation contains duplicate race records")
    if not races["featureSprint"].equals(races["hasSprint"]):
        raise ValueError("cached race conditions disagree with the feature table")
    if races["rainActual"].notna().sum() < len(races) * 0.9:
        raise ValueError("archived weather coverage below 90 percent")
    if args.skip_windows:
        window_comparison = {
            "status": "incomplete",
            "attempt": "The 3/5/10 season stack sweep was canceled after 150 seconds during the first configuration. Window 3 completed scoring 64 saved holdout race IDs, but its metrics were not persisted before cancellation. Windows 5 and 10 did not complete.",
            "numbersReported": False,
        }
    else:
        window_comparison = compare_stack_windows(
            feature_data, races[races["season"].between(2024, 2026)])
        window_comparison["status"] = "completed"
    production = production_breakdown()
    groups = {
        "All races": races,
        **{name: races[races["season"].between(*years)] for name, years in ERA_WINDOWS.items()},
        **{str(year): races[races["season"] == year] for year in sorted(races["season"].unique())},
        "Sprint": races[races["hasSprint"]],
        "No sprint": races[~races["hasSprint"]],
        "Wet, ERA5 >= 1 mm": races[races["rainCondition"] == "wet"],
        "Dry, ERA5 < 1 mm": races[races["rainCondition"] == "dry"],
        "Sprint and wet": races[races["hasSprint"] & (races["rainCondition"] == "wet")],
    }
    rng = np.random.default_rng(SEED)
    result = {
        "source": str(INPUT.relative_to(paths.ROOT_DIR)),
        "weatherSource": "data/raw/openmeteo/archive, summarized by f1ml.weather.race_weather",
        "featureSource": str(FEATURES.relative_to(paths.ROOT_DIR)),
        "method": {
            "evaluation": "existing v2 walk-forward predictions; window comparison refits only the meta-stack, not GBM base models",
            "eraWindows": {key: list(value) for key, value in ERA_WINDOWS.items()},
            "wetThresholdMm": 1.0,
            "aggregation": "equal-weight mean of per-race metrics",
            "interval": "paired percentile bootstrap of per-race difference, 5000 resamples, seed 73021",
            "limit": "2026 is partial; ERA5 rainfall is a noisy condition label; small slices are descriptive; 2019-2023 were hyperparameter development years and are not untouched test data",
        },
        "nRaces": len(races),
        "rainCoverage": int(races["rainActual"].notna().sum()),
        "stackWindowComparison": window_comparison,
        "productionBacktest": production,
        "groups": {},
    }
    for group_name, group in groups.items():
        group_ids = set(group["raceId"])
        group_out = {"nRaces": len(group), "nWet": int((group["rainCondition"] == "wet").sum()),
                     "nSprint": int(group["hasSprint"].sum()), "stages": {}}
        for stage in STAGES:
            rows = []
            for race in group.itertuples():
                stage_metrics = race.stages[stage]
                record = {metric: stage_metrics[metric] for metric in METRICS}
                baseline = race.baselines.get("grid", {})
                record["gridLogLossWin"] = baseline.get("logLossWin", np.nan)
                rows.append(record)
            frame = pd.DataFrame(rows)
            stage_out = {metric: float(frame[metric].mean()) for metric in METRICS}
            stage_out["nRaces"] = len(frame)
            if stage == "post-qualifying":
                pair = frame.dropna(subset=["logLossWin", "gridLogLossWin"])
                diffs = (pair["logLossWin"] - pair["gridLogLossWin"]).to_numpy()
                stage_out["gridLogLossWin"] = float(pair["gridLogLossWin"].mean())
                stage_out["logLossWinMinusGrid"] = float(diffs.mean()) if len(diffs) else None
                if len(diffs) >= 3:
                    draws = rng.choice(diffs, size=(BOOTSTRAPS, len(diffs)), replace=True).mean(axis=1)
                    stage_out["logLossWinMinusGrid95"] = [float(np.quantile(draws, 0.025)),
                                                           float(np.quantile(draws, 0.975))]
                else:
                    stage_out["logLossWinMinusGrid95"] = None
            group_out["stages"][stage] = stage_out
        result["groups"][group_name] = group_out
    write_outputs(result)
    print(f"races={result['nRaces']} weather={result['rainCoverage']} wet={int((races['rainCondition'] == 'wet').sum())} sprint={int(races['hasSprint'].sum())}")
    if result["stackWindowComparison"]["status"] == "completed":
        for window in STACK_WINDOWS:
            values = result["stackWindowComparison"]["holdout2024to2026"][str(window)]
            print(f"stack_window={window} seasons=prior-{window} test_n={values['nRaces']} pq_logloss={values['postQualifyingLogLoss']:.3f} grid={values['gridLogLossWin']:.3f} delta={values['logLossWinMinusGrid']:.3f}")
    else:
        print("stack_window_sweep=incomplete; no window metrics persisted")
    for name in ("2019-2021", "2022-2025", "2026 partial", *[str(year) for year in sorted(races["season"].unique())], "Sprint", "No sprint", "Wet, ERA5 >= 1 mm", "Dry, ERA5 < 1 mm", "Sprint and wet"):
        group = result["groups"][name]
        pq = group["stages"]["post-qualifying"]
        print(f"{name}: n={group['nRaces']} wet={group['nWet']} sprint={group['nSprint']} pq_logloss={pq['logLossWin']:.3f} grid={pq['gridLogLossWin']:.3f} delta={pq['logLossWinMinusGrid']}")
    print(f"wrote {OUT_JSON.relative_to(paths.ROOT_DIR)} and {OUT_MD.relative_to(paths.ROOT_DIR)}")


def compare_stack_windows(features, race_table):
    from f1ml import evaluate, metrics, stack2, train

    oos = stack2.oos_scores(features, train.load_params(), verbose=False)
    context = stack2.race_context(features)
    seasons = sorted(int(year) for year in race_table["season"].unique())
    expected_ids = set(race_table["raceId"].astype(int))
    labelled = features[features["y_finish"].notna()]
    missing = expected_ids - set(labelled["raceId"].astype(int))
    if missing:
        raise ValueError(f"cached evaluation races missing labels: {sorted(missing)}")
    output = {"method": "Refit v2 stack terms on prior N seasons of cached point-in-time OOS base-model scores, then predict exactly the raceIds in eval_v2.json.",
              "windowsSeasons": list(STACK_WINDOWS), "testSeasons": seasons,
              "testRaceIds": sorted(expected_ids), "simsPerRace": WINDOW_SIMS,
              "holdout2024to2026": {}, "byYear": {}}
    window_rows = {}
    rng = np.random.default_rng(SEED)
    for window in STACK_WINDOWS:
        config = stack2.StackConfig(window=window)
        race_rows = []
        for season in seasons:
            season_ids = set(labelled.loc[labelled["season"] == season, "raceId"].astype(int))
            race_ids = sorted(expected_ids.intersection(season_ids))
            slot_table = metrics.empirical_slot_table(labelled, "grid", (season - 10, season - 1))
            stacks = None
            for index, race_id in enumerate(race_ids):
                if stacks is None or index % stack2.RACE_BLOCK == 0:
                    stacks = {stage: stack2.fit_stage(stage, oos, context, features,
                                                      int(race_id), config)
                              for stage in feat.STAGES}
                race, _ = evaluate.evaluate_race(int(race_id), stacks, features, oos, context,
                                                 config, slot_table, WINDOW_SIMS)
                stage = race["stages"]["post-qualifying"]
                race_rows.append({"raceId": race_id, "season": season,
                                  "logLoss": stage["logLossWin"], "spearman": stage["spearman"],
                                  "gridLogLoss": race["baselines"]["grid"]["logLossWin"]})
        scored = pd.DataFrame(race_rows)
        if scored["raceId"].nunique() != len(expected_ids) or set(scored["raceId"].astype(int)) != expected_ids:
            raise ValueError(f"stack window {window} did not score exactly the cached test race IDs")
        window_rows[str(window)] = scored
        output["holdout2024to2026"][str(window)] = summarize_window(scored)
        print(f"completed stack window {window}, exact test races={len(scored)}", flush=True)
        for year, year_rows in scored.groupby("season"):
            output["byYear"].setdefault(str(int(year)), {})[str(window)] = summarize_window(year_rows)
    output["holdout2024to2026"]["pairedVs10Year"] = {}
    baseline = window_rows["10"]
    for window in STACK_WINDOWS:
        if window == 10:
            continue
        alternate = window_rows[str(window)]
        joined = alternate.merge(baseline, on="raceId", suffixes=("_alt", "_base"))
        differences = (joined["logLoss_alt"] - joined["logLoss_base"]).to_numpy()
        draws = rng.choice(differences, size=(BOOTSTRAPS, len(differences)), replace=True).mean(axis=1)
        output["holdout2024to2026"]["pairedVs10Year"][str(window)] = {
            "meanLogLossDifference": float(differences.mean()),
            "interval95": [float(np.quantile(draws, 0.025)), float(np.quantile(draws, 0.975))],
            "nRaces": len(differences),
        }
    return output


def summarize_window(rows):
    delta = (rows["logLoss"] - rows["gridLogLoss"]).to_numpy()
    return {"nRaces": len(rows), "postQualifyingLogLoss": float(rows["logLoss"].mean()),
            "gridLogLossWin": float(rows["gridLogLoss"].mean()),
            "logLossWinMinusGrid": float(delta.mean()),
            "postQualifyingSpearman": float(rows["spearman"].mean())}


def production_breakdown():
    payload = json.loads(PRODUCTION_INPUT.read_text(encoding="utf-8"))
    races = pd.DataFrame(payload["races"])
    archived = weather.race_weather().set_index("raceId")["rain_actual"]
    races["rainActual"] = races["raceId"].map(archived)
    races["wet"] = races["rainActual"] >= 1.0
    groups = {
        "all": races,
        **{str(year): races[races["season"] == year]
           for year in sorted(races["season"].unique())},
        "sprint": races[races["hasSprint"]],
        "no_sprint": races[~races["hasSprint"]],
        "wet": races[races["wet"]],
        "dry": races[races["rainActual"].notna() & ~races["wet"]],
    }
    output = {"source": str(PRODUCTION_INPUT.relative_to(paths.ROOT_DIR)),
              "generatedAt": payload["generatedAt"], "nRaces": len(races),
              "raceIds": [int(value) for value in races["raceId"]],
              "rainCoverage": int(races["rainActual"].notna().sum()), "groups": {}}
    rng = np.random.default_rng(SEED + 1)
    for name, group in groups.items():
        metrics = pd.DataFrame([{
            "logLoss": race["stages"]["post-qualifying"]["logLossWin"],
            "winnerCorrect": race["stages"]["post-qualifying"]["winnerCorrect"],
            "spearman": race["stages"]["post-qualifying"]["spearman"],
            "gridLogLoss": race["baselines"]["grid"]["logLossWin"],
        } for race in group.to_dict("records")])
        differences = (metrics["logLoss"] - metrics["gridLogLoss"]).to_numpy()
        draws = rng.choice(differences, size=(BOOTSTRAPS, len(differences)), replace=True).mean(axis=1) if len(differences) else np.array([])
        output["groups"][name] = {
            "nRaces": len(group), "nWet": int(group["wet"].sum()),
            "nSprint": int(group["hasSprint"].sum()),
            "postQualifyingWinLogLoss": float(metrics["logLoss"].mean()) if len(metrics) else None,
            "gridWinLogLoss": float(metrics["gridLogLoss"].mean()) if len(metrics) else None,
            "logLossMinusGrid": float(differences.mean()) if len(differences) else None,
            "logLossMinusGrid95": [float(np.quantile(draws, 0.025)), float(np.quantile(draws, 0.975))] if len(draws) else None,
            "winnerCorrect": float(metrics["winnerCorrect"].mean()) if len(metrics) else None,
            "spearman": float(metrics["spearman"].mean()) if len(metrics) else None,
        }
    return output


def era_for(season):
    if season <= 2021:
        return "2019-2021"
    if season <= 2025:
        return "2022-2025"
    return "2026 partial"


def write_outputs(result):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(result, indent=2), encoding="utf-8")
    lines = [
        "# Year, regulation era, and condition evaluation",
        "",
        "This report separates the current pipeline's saved production backtest from the v2 research evaluation. The v2 evaluation is experimental and is not the deployed model. The stack-window refit is incomplete, no GBM base models were retrained, and no model is promoted.",
        "",
        f"Research source: `{result['source']}`; {result['nRaces']} races from 2019 R1 through 2026 R16, with archived rain available for {result['rainCoverage']}. Rain uses ERA5 precipitation in the race window; wet means at least 1 mm.",
        "",
        "Metrics are equal-weight means across races. Post-qualifying log-loss difference is model minus the race-specific grid baseline. Negative values favor the model. Intervals bootstrap paired race differences with 5,000 resamples and seed 73021.",
        "",
        "## Current pipeline backtest",
        "",
        f"Source: `{result['productionBacktest']['source']}`, generated {result['productionBacktest']['generatedAt']}; {result['productionBacktest']['nRaces']} races from 2024 R1 through 2026 R{max(result['productionBacktest']['raceIds']) % 100}. This is the current pipeline's saved backtest, not a verified live-publication audit. Rain is available for {result['productionBacktest']['rainCoverage']} races.",
        "",
        "| Slice | Races | Wet | Sprint | PQ win LL | Grid LL | PQ minus grid, 95% interval | Winner accuracy | PQ Spearman |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    production_names = ["all", "2024", "2025", "2026", "sprint", "no_sprint", "wet", "dry"]
    production_labels = {"all": "All", "sprint": "Sprint", "no_sprint": "No sprint", "wet": "Wet, ERA5 >= 1 mm", "dry": "Dry, ERA5 < 1 mm"}
    for name in production_names:
        values = result["productionBacktest"]["groups"][name]
        interval = values["logLossMinusGrid95"]
        interval_text = "n/a" if interval is None else f"[{interval[0]:.3f}, {interval[1]:.3f}]"
        label = production_labels.get(name, name)
        lines.append(f"| {label} | {values['nRaces']} | {values['nWet']} | {values['nSprint']} | {values['postQualifyingWinLogLoss']:.3f} | {values['gridWinLogLoss']:.3f} | {values['logLossMinusGrid']:.3f} {interval_text} | {values['winnerCorrect']:.3f} | {values['spearman']:.3f} |")
    lines += [
        "",
        "## v2 research evaluation",
        "",
        "| Slice | Races | Wet | Sprint | Pre-weekend win LL | Post-practice win LL | Post-qualifying win LL | Grid LL | PQ minus grid, 95% interval | PQ Spearman |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    names = ["All races", "2019-2021", "2022-2025", "2026 partial", *[str(year) for year in range(2019, 2027)], "Sprint", "No sprint", "Wet, ERA5 >= 1 mm", "Dry, ERA5 < 1 mm", "Sprint and wet"]
    for name in names:
        group = result["groups"][name]
        stages = group["stages"]
        pq = stages["post-qualifying"]
        interval = pq["logLossWinMinusGrid95"]
        interval_text = "n/a" if interval is None else f"[{interval[0]:.3f}, {interval[1]:.3f}]"
        grid = "n/a" if pq.get("gridLogLossWin") is None else f"{pq['gridLogLossWin']:.3f}"
        values = [name, str(group["nRaces"]), str(group["nWet"]), str(group["nSprint"]),
                  f"{stages['pre-weekend']['logLossWin']:.3f}", f"{stages['post-practice']['logLossWin']:.3f}",
                  f"{pq['logLossWin']:.3f}", grid,
                  f"{pq['logLossWinMinusGrid']:.3f} {interval_text}", f"{pq['spearman']:.3f}"]
        lines.append("| " + " | ".join(values) + " |")
    lines += [
        "",
        "## Stack training window comparison",
        "",
        f"The script refits only the v2 meta-stack using its prior N seasons of the same cached point-in-time out-of-sample base-model scores, then tests identical races. Each window uses {WINDOW_SIMS:,} simulations per race. This tests the stack's history window, not the GBM base-model training history.",
        "",
    ]
    if result["stackWindowComparison"]["status"] == "completed":
        lines += ["| Prior seasons in stack fit | Races | PQ win log loss | Grid win log loss | PQ minus grid | PQ Spearman |",
                  "|---:|---:|---:|---:|---:|---:|"]
        for window in STACK_WINDOWS:
            values = result["stackWindowComparison"]["holdout2024to2026"][str(window)]
            lines.append(f"| {window} | {values['nRaces']} | {values['postQualifyingLogLoss']:.3f} | {values['gridLogLossWin']:.3f} | {values['logLossWinMinusGrid']:.3f} | {values['postQualifyingSpearman']:.3f} |")
    else:
        lines.append(result["stackWindowComparison"]["attempt"])
    lines += [
        "",
        "No window performance metrics were persisted, so this sweep supports no choice of stack history or deployment recommendation.",
        "",
        "## Reading this result",
        "",
        "The era groups are proxies for broad regulation periods: 2019-2021, 2022-2025, and the partial 2026 season. They are not causal estimates of regulation effects. Calendar-year changes in entrants, circuits, sprint format, training history, and data coverage are mixed together.",
        "",
        "The period boundaries follow FIA/F1 descriptions of the 2022 ground-effect technical rules and the new 2026 chassis and power-unit package: [FIA 2022 technical regulations](https://www.fia.com/sites/default/files/2022_formula_1_technical_regulations_-_iss_6_-_2021-09-13_0.pdf), [FIA 2026 regulations overview](https://www.fia.com/news/new-era-competition-fia-showcases-future-focused-formula-1-regulations-2026-and-beyond). The FIA also approved 2026 amendments after pre-season testing and early rounds, so the partial 2026 group is not a single immutable ruleset: [FIA 2026 amendments](https://api.fia.com/news/fia-statement-amendments-2026-f1-regulations).",
        "",
        "The feature pipeline already exposes regulation-reset proxies: `ERA_STARTS=(2006, 2009, 2014, 2017, 2022, 2026)`, `rounds_since_reset`, and `reset_season`. Its current `ERA_DISCOUNT=1.0` leaves optional pre-era form downweighting off. No direct power-unit or aerodynamic design feature represents the technical rule changes. Hyperparameters were tuned on 2021-2023, so 2019-2023 results are development diagnostics; 2024-2026 is the cleaner post-tuning holdout window.",
        "",
        "Condition slices overlap the era slices and each other. Sprint counts are explicit. Weather uses realized ERA5 precipitation, not the forecast the model received, so wet/dry grouping is for post-hoc robustness checks only. Sprint-and-wet is especially small and should not be read as a stable performance estimate.",
        "",
        "This experiment does not compare alternative GBM base-model training histories, and it does not establish that adding older years or a specific era improves a new base model. Those require rerunning the same candidate under frozen time-based train/validation splits.",
        "",
        "Rebuild the report and saved-data breakdown without starting the long stack refit with `uv run python -m scripts.exp_year_condition --skip-windows` from `ml/`.",
        "",
        "For each stage, the JSON also records winner accuracy, Brier score, MAE, and per-slice sample counts.",
    ]
    OUT_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
