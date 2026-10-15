import json
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.optimize import minimize_scalar

from f1ml import scorecard
from scripts.exp_calibration.run import balance_power, training_loss, update_rows
from scripts.exp_market.research import pool, scores


def main():
    output = Path('reports/exp/combo')
    output.mkdir(parents=True, exist_ok=True)
    market_path = Path('reports/exp/market/matched_probabilities.json')
    market_text = market_path.read_text(encoding='utf-8')
    market_rows = json.loads(market_text)
    markets = {(row['stage'], row['raceId']): row for row in market_rows if row['raceId'] <= 202616}
    records = []
    parameters = []
    for model in ('exp_bestcar', 'exp_dynpl'):
        path = Path('reports/scorecard') / (model + '_cars.parquet')
        cars = pd.read_parquet(path)
        cars = cars[cars.season.isin([2024, 2025, 2026]) & (cars.raceId <= 202616)].copy()
        for stage in scorecard.STAGES:
            rows = cars[cars.stage == stage]
            grouped = rows.groupby('raceId', sort=True)
            groups = list(grouped)
            assert len(groups) == 64
            for calibration in (False, True):
                for blend in (False, True):
                    variant = variant_name(model, calibration, blend)
                    calibration_history = []
                    market_history = []
                    for race_id, group in groups:
                        race_number = int(race_id)
                        arrays = group.dist.to_numpy()
                        original = np.stack(arrays)
                        actual = group.actual.to_numpy(dtype=float)
                        power = 1.0
                        if calibration and len(calibration_history) >= 12:
                            objective = lambda value: training_loss(value, calibration_history)
                            fitted = minimize_scalar(objective, bounds=(0.5, 2.0), method='bounded')
                            power = float(fitted.x)
                        changed = balance_power(original, power)
                        p = changed[:, 0].copy()
                        y = actual == 1
                        market = markets.get((stage, race_id))
                        weight = 1.0
                        last_market = None
                        if market_history:
                            last_market = market_history[-1][3]
                        if blend and market is not None:
                            pairs = zip(market['driverIds'], market['market'])
                            mapping = dict(pairs)
                            values = [mapping[driver] for driver in group.driverId]
                            q = np.asarray(values, dtype=float)
                            weight = fit_weight(market_history)
                            target = pool(p, q, weight)
                            changed = propagate(changed, target)
                            market_history.append((p, q, y, race_number))
                        updated = update_rows(group, original, changed)
                        values = scorecard.car_scores(updated)
                        win = updated.pWin.to_numpy(dtype=float)
                        win_scores = scores(win, y)
                        values['winnerHitRate'] = win_scores['winnerHitRate']
                        values.update({'variant': variant, 'stage': stage, 'raceId': race_number, 'marketAvailable': market is not None})
                        records.append(values)
                        calibration_count = len(calibration_history)
                        last_calibration = None
                        if calibration_history:
                            last_calibration = int(calibration_history[-1][2])
                        market_count = len(market_history)
                        if blend and market is not None:
                            market_count -= 1
                        parameters.append({'variant': variant, 'stage': stage, 'raceId': race_number, 'power': power, 'oursWeight': weight, 'calibrationTrainingRaces': calibration_count if calibration else 0, 'lastCalibrationTrainingRaceId': last_calibration if calibration else None, 'marketTrainingRaces': market_count, 'lastMarketTrainingRaceId': last_market})
                        calibration_history.append((original, actual, race_id))
                    print(variant, stage, 'finished', flush=True)
    per_race = pd.DataFrame(records)
    result = summarize(per_race)
    result['fittedParameters'] = parameters
    result['method'] = {
        'order': 'Base forecast, then calibration, then market blend.',
        'selection': '2024 and 2025 plus 2026 R1 to R16, 64 races. R17 onward excluded before fitting or scoring.',
        'calibration': 'Imported original power transform and Sinkhorn balancing; independent expanding prior-race RPS fit per variant and stage, bounds 0.5 to 2, identity for first 12, penalty 0.001 * log(power)^2.',
        'blend': 'Imported original logarithmic pool with probability floor 1e-6. Model weight selected from 0 to 1 in steps of 0.01 using prior available-market winner log loss; model-only warmup for first 10 matched races. Independent fit per variant and stage. Historical inputs are their own out-of-time calibrated predictions.',
        'propagation': 'Approximation, not a Plackett-Luce reconstruction. Fix win column exactly to pooled probabilities. Floor remaining cells at 1e-10 and iteratively scale remaining rows to 1 minus win probability and remaining columns to one. This preserves the saved higher-position structure while enforcing coherent marginal totals. A model weight of one still uses the original pool normalization and floor.',
        'points': 'Recompute race position points [25,18,15,12,10,8,6,4,2,1]; retain original expected sprint and fastest-lap contribution. MAE is mean driver error within race, then mean over races, against saved actual championship points.',
        'metrics': 'Original scorecard RPS, binary podium and points log loss, Spearman expected versus actual position, and expected points MAE. Headline is exp(-mean winner log loss); hit rate uses highest win probability.',
        'bootstrap': '10000 paired race resamples, seed 20261013, percentile 95% intervals. Headline difference recomputes both geometric means on each common resample. RPS difference uses paired race differences. All comparisons use exp_bestcar without calibration or blend on the identical race set.',
        'marketSubset': 'Stage-specific complete market fields: 40 pre-weekend, 42 post-practice, 42 post-qualifying. All-race results fall back to the pre-blend forecast when market unavailable.',
        'limitations': 'Post-hoc selection comparison of eight candidates, without multiplicity correction. No untouched holdout or joint simulator NLL scored. Market timing, coverage and explicit Other allocation limitations carry over from the market experiment. No backtest rerun.'
    }
    text = json.dumps(result, indent=2, allow_nan=False)
    summary_path = output / 'summary.json'
    summary_path.write_text(text, encoding='utf-8')
    scores_path = output / 'race_scores.csv'
    per_race.to_csv(scores_path, index=False)
    write_report(output, result)


def variant_name(model, calibration, blend):
    return f'{model}_cal{int(calibration)}_market{int(blend)}'


def fit_weight(history):
    if len(history) < 10:
        return 1.0
    weights = np.linspace(0, 1, 101)
    losses = []
    for weight in weights:
        race_losses = []
        for p, q, y, race_id in history:
            prediction = pool(p, q, weight)
            values = scores(prediction, y)
            race_losses.append(values['logLossWin'])
        average = np.mean(race_losses)
        losses.append(average)
    index = np.argmin(losses)
    return float(weights[index])


def propagate(distribution, win):
    rest = np.maximum(distribution[:, 1:], 1e-10)
    row_targets = 1.0 - win
    for iteration in range(2000):
        row_sums = rest.sum(axis=1)
        rest *= (row_targets / row_sums)[:, None]
        column_sums = rest.sum(axis=0)
        rest /= column_sums[None, :]
        row_sums = rest.sum(axis=1)
        errors = np.abs(row_sums - row_targets)
        residual = errors.max()
        if residual < 1e-10:
            break
    if residual >= 1e-8:
        raise ValueError('Market propagation did not converge')
    changed = np.column_stack((win, rest))
    row_sums = changed.sum(axis=1)
    column_sums = changed.sum(axis=0)
    np.testing.assert_allclose(row_sums, 1.0, atol=1e-8, rtol=0)
    np.testing.assert_allclose(column_sums, 1.0, atol=1e-8, rtol=0)
    np.testing.assert_allclose(changed[:, 0], win, atol=1e-12, rtol=0)
    return changed


def summarize(rows):
    result = {'raceSets': {}}
    rng = np.random.default_rng(20261013)
    for race_set in ('all_selection', 'market_available'):
        stages = {}
        for stage in scorecard.STAGES:
            subset = rows[rows.stage == stage]
            if race_set == 'market_available':
                subset = subset[subset.marketAvailable]
            baseline = subset[subset.variant == 'exp_bestcar_cal0_market0'].set_index('raceId').sort_index()
            count = len(baseline)
            draws = rng.integers(0, count, size=(10000, count))
            variants = {}
            for variant, group in subset.groupby('variant'):
                candidate = group.set_index('raceId').loc[baseline.index]
                names = ['logLossWin', 'winnerHitRate', 'rps', 'logLossPodium', 'logLossPoints', 'maePoints', 'spearman']
                averages = candidate[names].mean().to_dict()
                headline = np.exp(-averages['logLossWin'])
                averages['winnerGeometricMeanProbability'] = float(headline)
                intervals = {}
                for metric in ('winnerGeometricMeanProbability', 'rps'):
                    if metric == 'rps':
                        differences = candidate.rps.to_numpy() - baseline.rps.to_numpy()
                        boot = differences[draws].mean(axis=1)
                        difference = differences.mean()
                    else:
                        candidate_loss = candidate.logLossWin.to_numpy()
                        baseline_loss = baseline.logLossWin.to_numpy()
                        candidate_mean = candidate_loss[draws].mean(axis=1)
                        baseline_mean = baseline_loss[draws].mean(axis=1)
                        boot = np.exp(-candidate_mean) - np.exp(-baseline_mean)
                        baseline_average = baseline_loss.mean()
                        baseline_headline = np.exp(-baseline_average)
                        difference = headline - baseline_headline
                    low, high = np.percentile(boot, [2.5, 97.5])
                    intervals[metric] = {'diff': float(difference), 'ci_low': float(low), 'ci_high': float(high)}
                race_ids = baseline.index.tolist()
                variants[variant] = {'races': count, 'raceIds': race_ids, 'scores': averages, 'intervalsVsBase': intervals}
            stages[stage] = variants
        result['raceSets'][race_set] = stages
    result['bestByStage'] = {}
    for race_set, stages in result['raceSets'].items():
        winners = {}
        for stage, variants in stages.items():
            headline_winner = max(variants, key=lambda name: variants[name]['scores']['winnerGeometricMeanProbability'])
            rps_winner = min(variants, key=lambda name: variants[name]['scores']['rps'])
            winners[stage] = {'headline': headline_winner, 'rps': rps_winner}
        result['bestByStage'][race_set] = winners
    return result


def write_report(output, summary):
    lines = ['# Eight forecast combinations', '', 'Winner probability is the geometric mean probability assigned to the actual winner, higher is better. RPS measures the full finishing distribution, lower is better. C means calibration, M means market blend.', '', '64 selection races only. No backtest rerun and no holdout scored. Each fit uses earlier races only. Market coverage differs by stage: 40, 42, 42 races.', '', 'The blend fixes each driver win probability to the log-pooled value, then balances the remaining position probabilities to driver and position totals. This is an approximation, not a reconstruction of the simulator. Expected sprint and fastest-lap contributions are retained.', '']
    for race_set, stages in summary['raceSets'].items():
        lines.extend([f'## {race_set}', '', '| Stage | Model | C | M | Winner probability | Hit rate | RPS | Podium loss | Points loss | Points MAE | Spearman | Winner change 95% interval | RPS change 95% interval |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|'])
        for stage, variants in stages.items():
            for variant, entry in variants.items():
                model, calibration, market = variant.rsplit('_', 2)
                s = entry['scores']
                h = entry['intervalsVsBase']['winnerGeometricMeanProbability']
                r = entry['intervalsVsBase']['rps']
                lines.append(f"| {stage} | {model} | {calibration[-1]} | {market[-1]} | {s['winnerGeometricMeanProbability']:.2%} | {s['winnerHitRate']:.2%} | {s['rps']:.6f} | {s['logLossPodium']:.4f} | {s['logLossPoints']:.4f} | {s['maePoints']:.3f} | {s['spearman']:.4f} | {h['diff']:+.2%} [{h['ci_low']:+.2%}, {h['ci_high']:+.2%}] | {r['diff']:+.6f} [{r['ci_low']:+.6f}, {r['ci_high']:+.6f}] |")
        lines.append('')
    lines.extend(['Intervals compare with bestcar C0 M0 on the same races. Winner changes are percentage points. These are selection results across eight candidates, without multiplicity correction, and do not establish deployment readiness.', '', 'Run from ml: `uv run python -m scripts.exp_combo.run`. Full scores, fitted parameters and method notes are in summary.json; paired race scores are in race_scores.csv.'])
    lines.extend(['', 'On all 64 races, dynamic strengths plus market blend without calibration gives the highest winner probability at every stage. Adding calibration gives the lowest RPS at every stage. There is no single winner across both metrics.', '', 'On the market subset, the best winner probability uses dynamic strengths plus market before the weekend, all three after practice, and dynamic strengths plus calibration after qualifying. All three still give the lowest RPS at every stage.'])
    report = '\n'.join(lines) + '\n'
    report_path = output / 'REPORT.md'
    report_path.write_text(report, encoding='utf-8')


if __name__ == '__main__':
    main()
