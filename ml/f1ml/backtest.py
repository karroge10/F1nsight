"""Walk-forward backtest over 2024, 2025 and 2026 R1 to R16.

    uv run python -m f1ml.backtest                       # full run, retrain every 3 rounds
    uv run python -m f1ml.backtest --retrain-every 1     # retrain before every race
    uv run python -m f1ml.backtest --label NAME          # experiment: scorecard rows only
    uv run python -m f1ml.backtest --seasons 2026 --first-race 202617 --label NAME   # holdout

Every run writes scorecard rows (`ml/reports/scorecard/<label>_*.parquet`, label "published" by
default) for `f1ml.scorecard`. With `--label` the site files (history, backtest.json) and the
summary are not touched, so experiments never change what the site serves.

Before race N of season S the bundle is (re)trained on every race before N only, the fantasy
extras are refitted on rounds before N, and features are point in time by construction. Each
race is forecast at all three stages. Outputs:

- data/predictions/history/<season>-<round>.json  (post-qualifying forecast, the one that
  would have been published before the race, + other stages + actual results)
- data/predictions/backtest.json                    (per race metrics for site charts)
- ml/reports/backtest_summary.json                  (aggregates, calibration, fantasy accuracy)
"""

from __future__ import annotations

import argparse
import json
import time
import warnings
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from scipy.stats import spearmanr

from f1ml import bundle as bundle_module
from f1ml import data, export, fantasy, forecast, gpu, metrics, paths, scorecard, train
from f1ml import features as feat
from f1ml.features import History

BASELINE_SEASONS = (2014, 2023)
SIM_SEED_STRIDE = 1_000_000


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seasons", type=int, nargs="+", default=[2024, 2025, 2026])
    parser.add_argument("--retrain-every", type=int, default=3)
    parser.add_argument("--sims", type=int, default=20000)
    parser.add_argument("--no-nn", action="store_true")
    parser.add_argument("--limit", type=int, default=0, help="races per season (debug)")
    parser.add_argument("--no-history", action="store_true", help="skip history JSON files")
    parser.add_argument("--label", help="experiment run: write scorecard rows only")
    parser.add_argument("--features", help="feature parquet to use instead of the cache")
    parser.add_argument("--first-race", type=int, default=0,
                        help="score only races with raceId >= this (training still uses all "
                             "earlier races); 0 = no limit")
    train.add_ensemble_arguments(parser)
    args = parser.parse_args()
    warnings.filterwarnings("ignore", category=RuntimeWarning)
    paths.ensure_dirs()
    started = time.time()
    with gpu.GpuMonitor() as monitor:
        write_history = not args.no_history and not args.label
        result = run_backtest(args.seasons, args.retrain_every, args.sims, not args.no_nn,
                              args.limit, write_history, args.features, args,
                              args.first_race)
    result["summary"]["gpu"] = monitor.summary()
    result["summary"]["seconds"] = round(time.time() - started, 1)
    write_scorecard_rows(result, args.label or "published")
    if not args.label:
        write_outputs(result)
    print_summary(result["summary"])


def run_backtest(seasons, retrain_every: int, sims: int, use_nn: bool, limit: int,
                 write_history: bool, features_path: str | None = None,
                 ensemble: argparse.Namespace | None = None, first_race: int = 0) -> dict:
    """Walk-forward backtest. `ensemble` (--seed, --gbm-bags, --nn-seeds) also moves the
    simulation seeds, so two seeds give two independent runs end to end."""
    features = train.load_features()
    if features_path:
        features = pd.read_parquet(features_path)
    params = train.load_params()
    if ensemble is not None:
        train.apply_ensemble(params, ensemble)
    sim_offset = SIM_SEED_STRIDE * int(params.get("seed", 0))
    history = History.load()
    labelled = features[features["y_finish"].notna()]
    grid_table = metrics.empirical_slot_table(labelled, "grid", BASELINE_SEASONS)
    champ_table = metrics.empirical_slot_table(labelled, "d_champ_pos", BASELINE_SEASONS)
    races = []
    probability_rows = []
    fantasy_rows = []
    scorecard_cars = []
    scorecard_races = []
    trained = None
    trained_info = {}
    for season in seasons:
        race_ids = select_race_ids(labelled, season, limit, first_race)
        for index, race_id in enumerate(race_ids):
            if trained is None or index % retrain_every == 0:
                train_rows = labelled[labelled["raceId"] < race_id]
                fit_started = time.time()
                trained = bundle_module.fit_bundle(train_rows, params, use_nn=use_nn)
                trained_info = {
                    "version": f"backtest-r{race_id}",
                    "trainedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "notes": f"walk-forward model trained on races before {race_id}",
                    "trainSeconds": round(time.time() - fit_started, 1),
                }
                print(f"  retrained before {race_id} in {trained_info['trainSeconds']}s")
            race_started = time.time()
            record, rows, fantasy_eval, payload, scored = evaluate_race(
                trained, trained_info, history, features, race_id, grid_table, champ_table,
                sims, sim_offset)
            scorecard_cars.extend(scored["cars"])
            scorecard_races.extend(scored["races"])
            races.append(record)
            probability_rows.extend(rows)
            fantasy_rows.extend(fantasy_eval)
            if write_history:
                season_round = f"{race_id // 100}-{race_id % 100:02d}"
                target = paths.HISTORY_DIR / f"{season_round}.json"
                export.write_json(target, payload)
            stage_q = record["stages"]["post-qualifying"]
            print(f"  {race_id} {record['raceName'][:22]:22s} "
                  f"spearman {stage_q['spearman']:.3f} winner {stage_q['winnerCorrect']:.0f} "
                  f"({time.time() - race_started:.1f}s)")
    summary = summarize(races, probability_rows, fantasy_rows, seasons, retrain_every)
    return {"races": races, "summary": summary, "scorecard_cars": scorecard_cars,
            "scorecard_races": scorecard_races, "fantasy_rows": fantasy_rows}


def select_race_ids(labelled: pd.DataFrame, season: int, limit: int = 0,
                    first_race: int = 0) -> list:
    """Labelled races of the season to score, from `first_race` on, at most `limit` of them."""
    race_ids = sorted(labelled[labelled["season"] == season]["raceId"].unique())
    if first_race:
        race_ids = [race_id for race_id in race_ids if race_id >= first_race]
    if limit:
        race_ids = race_ids[:limit]
    return race_ids


def evaluate_race(trained, trained_info, history, features, race_id, grid_table, champ_table,
                  sims, sim_offset: int = 0):
    frame = features[features["raceId"] == race_id].reset_index(drop=True)
    season = race_id // 100
    round_number = race_id % 100
    extras = fantasy.fit_extras(race_id) if season >= 2023 else None
    standings = standings_before(history, frame, race_id)
    actual = frame["y_finish"].to_numpy(dtype=float)
    dnf = frame["y_dnf"].fillna(0).to_numpy(dtype=float)
    actual_points = championship_points(frame, race_id)
    race = history.races.loc[race_id]
    record = {"raceId": int(race_id), "season": int(season), "round": int(round_number),
              "raceName": race["raceName"], "circuitId": race["circuitId"],
              "hasSprint": bool(race["hasSprint"]), "stages": {}, "baselines": {},
              "components": {}}
    probability_rows = []
    forecasts = {}
    scored = {"cars": [], "races": []}
    for stage in feat.STAGES:
        with_title = stage == "post-qualifying"
        result = forecast.forecast_race(
            trained, frame, stage, extras, history=history if with_title else None,
            sims=sims, seed=race_id + sim_offset, standings=standings if with_title else None)
        forecasts[stage] = result
        summary = result.summary
        stage_metrics = metrics.race_metrics(summary["expectedPosition"], summary["pWin"],
                                             summary["pPodium"], summary["pPoints"],
                                             summary["pDnf"], actual, dnf)
        record["stages"][stage] = stage_metrics
        record["components"][stage] = component_metrics(result.prediction, actual)
        stage_cars, stage_race = scorecard_rows(trained, result, frame, actual_points)
        scored["cars"].extend(stage_cars)
        scored["races"].append(stage_race)
        for i in range(len(frame)):
            probability_rows.append((stage, summary["pWin"][i], summary["pPodium"][i],
                                     summary["pPoints"][i], summary["pDnf"][i], actual[i],
                                     dnf[i], season, frame["driverId"].iloc[i], race_id,
                                     summary["expectedPoints"][i], actual_points[i]))
    locked = forecast.lock_frame(frame)
    forecasts["lock"] = forecast.forecast_race(trained, locked, "post-practice", extras,
                                               sims=sims, seed=race_id + 7 + sim_offset)
    record["baselines"] = baseline_metrics(history, frame, race_id, actual, dnf, grid_table,
                                           champ_table)
    assets = export.AssetBook(season, round_number)
    published = forecasts["post-qualifying"]
    fantasy_eval = fantasy_evaluation(forecasts, assets, race_id)
    payload = export.race_payload(published, trained, trained_info, history, assets, None)
    payload["actual"] = export.actual_block(history, frame, race_id)
    payload["otherStages"] = other_stages(forecasts, frame)
    payload["fantasyAtLock"] = fantasy_at_lock(forecasts["lock"], assets)
    payload["metrics"] = record["stages"]
    return record, probability_rows, fantasy_eval, payload, scored


def scorecard_rows(trained, result, frame: pd.DataFrame, actual_points: np.ndarray):
    """Per-car rows (position distribution, probabilities, actual) and the race likelihood."""
    summary = result.summary
    stage = result.stage
    race_id = result.race_id
    actual = frame["y_finish"].to_numpy(dtype=float)
    classified = frame["y_classified"].fillna(0).to_numpy(dtype=float) > 0.5
    cars = []
    for i, driver_id in enumerate(frame["driverId"]):
        cars.append({"raceId": race_id, "season": race_id // 100, "stage": stage,
                     "driverId": driver_id, "dist": summary["positionDist"][i].tolist(),
                     "expectedPosition": float(summary["expectedPosition"][i]),
                     "pWin": float(summary["pWin"][i]), "pPodium": float(summary["pPodium"][i]),
                     "pPoints": float(summary["pPoints"][i]),
                     "pDnf": float(summary["pDnf"][i]),
                     "expectedPoints": float(summary["expectedPoints"][i]),
                     "actual": actual[i], "classified": bool(classified[i]),
                     "actualPoints": float(actual_points[i])})
    strength = result.prediction["race_strength"].to_numpy(dtype=float)
    p_dnf = result.prediction["p_dnf"].to_numpy(dtype=float)
    first_bonus = None
    if stage == "post-qualifying":
        grid_ranks = forecast._ranks(frame["grid"])
        first_bonus = trained.grid_bonus(stage, grid_ranks)
    schedule = trained.schedule(stage, "race")
    order_nll, dnf_nll = scorecard.order_log_likelihood(strength, schedule, first_bonus, actual,
                                                        classified, p_dnf)
    if result.chain is not None:
        order_nll, dnf_nll = scorecard.chain_log_likelihood(result.chain, actual, classified)
    race = {"raceId": race_id, "season": race_id // 100, "stage": stage, "orderNll": order_nll,
            "dnfNll": dnf_nll}
    return cars, race


def write_scorecard_rows(result: dict, label: str) -> None:
    """Rows read by `f1ml.scorecard`: <label>_cars, <label>_races, <label>_fantasy."""
    scorecard.SCORECARD_DIR.mkdir(parents=True, exist_ok=True)
    cars = pd.DataFrame(result["scorecard_cars"])
    races = pd.DataFrame(result["scorecard_races"])
    fantasy_rows = pd.DataFrame(result["fantasy_rows"])
    fantasy_columns = ["raceId", "season", "stage", "kind", "id", "expected", "p10", "p90",
                       "actual", "baseline"]
    cars.to_parquet(scorecard.SCORECARD_DIR / f"{label}_cars.parquet", index=False)
    races.to_parquet(scorecard.SCORECARD_DIR / f"{label}_races.parquet", index=False)
    if len(fantasy_rows):
        fantasy_table = fantasy_rows[fantasy_columns]
        fantasy_table.to_parquet(scorecard.SCORECARD_DIR / f"{label}_fantasy.parquet",
                                 index=False)


def standings_before(history, frame: pd.DataFrame, race_id: int) -> dict:
    """Championship points and wins of each entrant before the race (zeros at round 1)."""
    season_start = (race_id // 100) * 100
    earlier = [rid for rid in history.driver_standings if season_start < rid < race_id]
    points = np.zeros(len(frame))
    wins = np.zeros(len(frame))
    if earlier:
        table = history.driver_standings[max(earlier)]
        for i, driver_id in enumerate(frame["driverId"]):
            if driver_id in table.index:
                points[i] = table.at[driver_id, "points"]
                wins[i] = table.at[driver_id, "wins"]
    return {"points": points, "wins": wins}


def component_metrics(prediction: pd.DataFrame, actual: np.ndarray) -> dict:
    """Spearman of the GBM, the network and the blend alone (for the ensemble ablation)."""
    result = {}
    for column in ("gbm_race", "nn_race", "race_strength"):
        values = prediction[column].to_numpy(dtype=float)
        if np.allclose(values, values[0]):
            result[column] = None
            continue
        result[column] = float(spearmanr(-values, actual).statistic)
    return result


def baseline_metrics(history, frame, race_id, actual, dnf, grid_table, champ_table) -> dict:
    grid_rank = forecast._ranks(frame["grid"])
    grid_metrics = metrics.order_metrics(grid_rank, actual)
    grid_probs = _slot_probabilities(grid_table, grid_rank)
    grid_metrics.update(_probability_scores(grid_probs, actual))
    champ_key = frame["d_champ_pos"].fillna(frame["d_fin_ps"] + 100).fillna(500)
    champ_rank = forecast._ranks(champ_key + frame["d_fin_e3"].fillna(30) * 1e-3)
    champ_metrics = metrics.order_metrics(champ_rank, actual)
    champ_probs = _slot_probabilities(champ_table, champ_rank)
    champ_metrics.update(_probability_scores(champ_probs, actual))
    form = last_three_form(history, frame, race_id)
    form_rank = forecast._ranks(pd.Series(form))
    form_metrics = metrics.order_metrics(form_rank, actual)
    return {"grid": grid_metrics, "championship": champ_metrics, "form3": form_metrics}


def last_three_form(history, frame: pd.DataFrame, race_id: int) -> np.ndarray:
    """Average classification (DNF counted where it was classified) over the last 3 races."""
    events = history.events
    previous = events[events["raceId"] < race_id]
    values = []
    for driver_id in frame["driverId"]:
        rows = previous[previous["driverId"] == driver_id].tail(3)
        values.append(rows["finish"].mean() if len(rows) else 30.0)
    return np.array(values, dtype=float)


def fantasy_evaluation(forecasts: dict, assets, race_id: int) -> list[dict]:
    """Predicted vs real fantasy points (and price change) per asset, per stage."""
    season = race_id // 100
    if season < 2023:
        return []
    actual = export.fantasy_history.actual_points(season, race_id % 100)
    if not len(actual):
        return []
    prices = export.fantasy_history.price_table()
    round_prices = prices[(prices["raceId"] == race_id) & prices["active"].fillna(True)]
    rows = []
    for stage, result in forecasts.items():
        sims = result.fantasy_sims
        if sims is None:
            continue
        frame = result.frame
        assets_points = []
        for i, driver_id in enumerate(frame["driverId"]):
            assets_points.append(("driver", driver_id, sims.driver_points[:, i]))
        for t, team in enumerate(sims.teams):
            assets_points.append(("constructor", team, sims.constructor_points[:, t]))
        for kind, asset_id, points in assets_points:
            key = "driverId" if kind == "driver" else "constructorId"
            real = actual[(actual["kind"] == kind) & (actual[key] == asset_id)]
            if not len(real):
                continue
            info = assets.lookup(kind, asset_id)
            row = {"raceId": race_id, "season": season, "stage": stage, "kind": kind,
                   "id": asset_id, "expected": float(points.mean()),
                   "p10": float(np.percentile(points, 10)),
                   "p90": float(np.percentile(points, 90)),
                   "actual": float(real["points"].iloc[0]),
                   "baseline": _recent_average(info)}
            price_rows = round_prices[(round_prices["kind"] == kind)
                                      & (round_prices[key] == asset_id)]
            if info is not None and season >= 2025 and len(price_rows):
                change = fantasy.price_change_distribution(points, info["price"],
                                                           info["previous"], season)
                row["expectedChange"] = change["expected"]
                row["changeProbs"] = change["probs"]
                row["actualChange"] = _float_or_none(price_rows["priceChange"].iloc[0])
            rows.append(row)
    return rows


def other_stages(forecasts: dict, frame: pd.DataFrame) -> dict:
    result = {}
    for stage in ("pre-weekend", "post-practice"):
        summary = forecasts[stage].summary
        drivers = []
        for i, driver_id in enumerate(frame["driverId"]):
            drivers.append({"driverId": driver_id,
                            "expectedPosition": round(float(summary["expectedPosition"][i]), 3),
                            "pWin": round(float(summary["pWin"][i]), 4),
                            "pPodium": round(float(summary["pPodium"][i]), 4),
                            "pPoints": round(float(summary["pPoints"][i]), 4),
                            "pDnf": round(float(summary["pDnf"][i]), 4)})
        result[stage] = {"inputsUsed": forecasts[stage].inputs_used, "drivers": drivers}
    return result


def fantasy_at_lock(result, assets) -> dict:
    """Fantasy projections as they stood at the team lock (practice known, no qualifying)."""
    sims = result.fantasy_sims
    block = {"stage": "post-practice (team lock: before the first qualifying session)",
             "inputsUsed": result.inputs_used, "drivers": {}, "constructors": {}}
    if sims is None:
        return block
    season = assets.season
    for i, driver_id in enumerate(result.frame["driverId"]):
        info = assets.lookup("driver", driver_id)
        block["drivers"][driver_id] = export._fantasy_summary(sims.driver_points[:, i], info,
                                                              season)
    for t, team in enumerate(sims.teams):
        info = assets.lookup("constructor", team)
        block["constructors"][team] = export._fantasy_summary(sims.constructor_points[:, t],
                                                              info, season)
    return block


def summarize(races, probability_rows, fantasy_rows, seasons, retrain_every) -> dict:
    summary = {"seasons": list(seasons), "races": len(races), "retrainEvery": retrain_every,
               "stages": {}, "bySeason": {}, "baselines": {}, "components": {},
               "calibration": {}, "fantasy": {}}
    for stage in feat.STAGES:
        rows = [race["stages"][stage] for race in races]
        summary["stages"][stage] = metrics.mean_metrics(rows)
        components = [race["components"][stage] for race in races]
        summary["components"][stage] = metrics.mean_metrics(components)
        by_season = {}
        for season in seasons:
            season_rows = [race["stages"][stage] for race in races if race["season"] == season]
            by_season[str(season)] = metrics.mean_metrics(season_rows)
        summary["bySeason"][stage] = by_season
    for name in ("grid", "championship", "form3"):
        rows = [race["baselines"][name] for race in races]
        summary["baselines"][name] = metrics.mean_metrics(rows)
        by_season = {}
        for season in seasons:
            season_rows = [race["baselines"][name] for race in races if race["season"] == season]
            by_season[str(season)] = metrics.mean_metrics(season_rows)
        summary["baselines"][f"{name}BySeason"] = by_season
    probabilities = pd.DataFrame(probability_rows, columns=[
        "stage", "pWin", "pPodium", "pPoints", "pDnf", "actual", "dnf", "season", "driverId",
        "raceId", "expectedPoints", "actualPoints"])
    probabilities.to_parquet(paths.REPORTS_DIR / "backtest_driver_rows.parquet", index=False)
    summary["pointsBySeason"] = points_by_season(probabilities)
    for stage, rows in probabilities.groupby("stage"):
        actual = rows["actual"].to_numpy()
        summary["calibration"][stage] = {
            "win": metrics.calibration_table(rows["pWin"].to_numpy(), actual == 1),
            "podium": metrics.calibration_table(rows["pPodium"].to_numpy(), actual <= 3),
            "points": metrics.calibration_table(rows["pPoints"].to_numpy(), actual <= 10),
            "dnf": metrics.calibration_table(rows["pDnf"].to_numpy(), rows["dnf"].to_numpy()),
        }
    summary["fantasy"] = fantasy_summary(fantasy_rows)
    return summary


def championship_points(frame: pd.DataFrame, race_id: int) -> np.ndarray:
    """Race plus sprint points each entrant actually scored."""
    core = data.load_core()
    sprint = core["sprint_results"]
    sprint_points = sprint[sprint["raceId"] == race_id].set_index("driverId")["points"]
    race_points = frame["y_points"].fillna(0).to_numpy(dtype=float)
    extra = frame["driverId"].map(sprint_points).fillna(0).to_numpy(dtype=float)
    return race_points + extra


def points_by_season(rows: pd.DataFrame) -> dict:
    """Sum of predicted expected points vs actual per driver and season (top 8 by actual)."""
    result = {}
    for (stage, season), group in rows.groupby(["stage", "season"]):
        totals = group.groupby("driverId")[["expectedPoints", "actualPoints"]].sum()
        races = group.groupby("driverId")["raceId"].nunique()
        totals["races"] = races
        top = totals.sort_values("actualPoints", ascending=False).head(8)
        ratio = float(top["expectedPoints"].sum() / max(top["actualPoints"].sum(), 1.0))
        result[f"{stage}:{season}"] = {
            "top8ExpectedOverActual": round(ratio, 3),
            "drivers": {driver: {"expected": round(float(row.expectedPoints), 1),
                                 "actual": round(float(row.actualPoints), 1),
                                 "races": int(row.races)}
                        for driver, row in top.iterrows()},
        }
    return result


def fantasy_summary(rows: list[dict]) -> dict:
    if not rows:
        return {}
    frame = pd.DataFrame(rows)
    result = {}
    for (stage, kind), group in frame.groupby(["stage", "kind"]):
        error = (group["expected"] - group["actual"]).abs()
        baseline = group.dropna(subset=["baseline"])
        baseline_error = (baseline["baseline"] - baseline["actual"]).abs()
        model_on_baseline = (baseline["expected"] - baseline["actual"]).abs()
        inside = (group["actual"] >= group["p10"]) & (group["actual"] <= group["p90"])
        per_race = []
        for _, race in group.groupby("raceId"):
            if len(race) >= 5:
                per_race.append(spearmanr(race["expected"], race["actual"]).statistic)
        entry = {
            "n": int(len(group)),
            "mae": round(float(error.mean()), 2),
            "maeBaselineLast3": round(float(baseline_error.mean()), 2) if len(baseline) else None,
            "maeModelSameRows": round(float(model_on_baseline.mean()), 2) if len(baseline)
            else None,
            "bias": round(float((group["expected"] - group["actual"]).mean()), 2),
            "spearmanPerRace": round(float(np.nanmean(per_race)), 3) if per_race else None,
            "p10p90Coverage": round(float(inside.mean()), 3),
        }
        by_season = {}
        for season, season_rows in group.groupby("season"):
            season_error = (season_rows["expected"] - season_rows["actual"]).abs()
            by_season[str(season)] = round(float(season_error.mean()), 2)
        entry["maeBySeason"] = by_season
        if "actualChange" in group:
            priced = group.dropna(subset=["actualChange"])
            priced = priced[priced["changeProbs"].map(lambda probs: isinstance(probs, dict)
                                                      and len(probs) > 0)]
            if len(priced):
                predicted_mode = priced["changeProbs"].map(
                    lambda probs: float(max(probs, key=probs.get)))
                hits = np.isclose(predicted_mode, priced["actualChange"])
                change_error = (priced["expectedChange"] - priced["actualChange"]).abs()
                entry["priceChange"] = {
                    "n": int(len(priced)),
                    "modeAccuracy": round(float(hits.mean()), 3),
                    "maeExpected": round(float(change_error.mean()), 3),
                    "pActual": round(float(np.mean([
                        probs.get(_key(change), 0.0) for probs, change in
                        zip(priced["changeProbs"], priced["actualChange"])])), 3),
                }
        result[f"{stage}:{kind}"] = entry
    return result


def write_outputs(result: dict) -> None:
    summary = result["summary"]
    public_races = []
    for race in result["races"]:
        public_races.append({key: race[key] for key in ("raceId", "season", "round", "raceName",
                                                         "circuitId", "hasSprint", "stages",
                                                         "baselines")})
    payload = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "seasons": summary["seasons"],
        "retrainEvery": summary["retrainEvery"],
        "summary": {"stages": summary["stages"], "baselines": {
            key: value for key, value in summary["baselines"].items()
            if not key.endswith("BySeason")}},
        "calibration": summary["calibration"],
        "fantasy": summary["fantasy"],
        "races": public_races,
    }
    export.write_json(paths.PREDICTIONS_DIR / "backtest.json", payload)
    summary_text = json.dumps(summary, indent=2, default=float)
    (paths.REPORTS_DIR / "backtest_summary.json").write_text(summary_text, encoding="utf-8")


def print_summary(summary: dict) -> None:
    print("\nstage            winner podium  spearman   mae   brierWin  logLossWin")
    for stage, values in summary["stages"].items():
        print(f"{stage:16s} {values['winnerCorrect']:.3f}  {values['podiumHits']:.3f}  "
              f"{values['spearman']:.3f}   {values['mae']:.2f}   {values['brierWin']:.4f}"
              f"    {values['logLossWin']:.3f}")
    for name in ("grid", "championship", "form3"):
        values = summary["baselines"][name]
        print(f"baseline {name:7s} {values['winnerCorrect']:.3f}  {values['podiumHits']:.3f}  "
              f"{values['spearman']:.3f}   {values['mae']:.2f}   "
              f"{values.get('brierWin', float('nan')):.4f}")
    print("components:", json.dumps(summary["components"], default=float))
    print("gpu:", summary.get("gpu"), "seconds:", summary.get("seconds"))


# ----------------------------------------------------------------------------------------------
# helpers


def _slot_probabilities(table: pd.DataFrame, ranks: np.ndarray) -> dict:
    win = metrics.slot_probabilities(table, ranks, "pWin")
    podium = metrics.slot_probabilities(table, ranks, "pPodium")
    total = win.sum()
    if total > 0:
        win = win / total
    return {"win": win, "podium": podium}


def _probability_scores(probabilities: dict, actual: np.ndarray) -> dict:
    winner = actual == 1
    podium = actual <= 3
    win = np.clip(probabilities["win"], 1e-6, 1 - 1e-6)
    pod = np.clip(probabilities["podium"], 1e-6, 1 - 1e-6)
    return {
        "brierWin": float(((probabilities["win"] - winner) ** 2).mean()),
        "logLossWin": float(-np.log(win[winner]).sum()),
        "brierPodium": float(((probabilities["podium"] - podium) ** 2).mean()),
        "logLossPodium": float(-(podium * np.log(pod) + (~podium) * np.log(1 - pod)).mean()),
    }


def _recent_average(info: dict | None) -> float | None:
    if not info or not info["previous"]:
        return None
    recent = info["previous"][-3:]
    return float(np.mean(recent))


def _float_or_none(value):
    if value is None or value != value:
        return None
    return float(value)


def _key(change: float) -> str:
    text = f"{change:+.1f}"
    return "0.0" if text in ("+0.0", "-0.0") else text


if __name__ == "__main__":
    main()
