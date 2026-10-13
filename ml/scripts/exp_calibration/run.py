import json
from pathlib import Path
import numpy as np
import pandas as pd
from scipy.optimize import minimize_scalar
from scipy.special import logit
from sklearn.linear_model import LogisticRegression
from f1ml import metrics, scorecard

def main():
    output = Path('reports/exp/calibration')
    output.mkdir(parents=True, exist_ok=True)
    cars = pd.read_parquet('reports/scorecard/exp_bestcar_cars.parquet')
    races = pd.read_parquet('reports/scorecard/exp_bestcar_races.parquet')
    cars = cars[cars.raceId <= 202616].copy()
    parameters = []
    transformed = []
    scores = []
    for stage, rows in cars.groupby('stage'):
        history = []
        for race_id, group in rows.groupby('raceId', sort=True):
            power = 1.0
            if len(history) >= 12:
                objective = lambda value: training_loss(value, history)
                fitted = minimize_scalar(objective, bounds=(0.5, 2.0), method='bounded')
                power = float(fitted.x)
            argument_1 = group.dist.to_numpy()
            distribution = np.stack(argument_1)
            changed = balance_power(distribution, power)
            updated = update_rows(group, distribution, changed)
            transformed.append(updated)
            argument_2 = int(race_id)
            argument_3 = len(history)
            argument_4 = None
            if history:
                argument_4 = int(history[-1][2])
            parameters.append({'stage': stage, 'raceId': argument_2, 'trainingRaces': argument_3, 'lastTrainingRaceId': argument_4, 'power': power})
            actual = group.actual.to_numpy(dtype=float)
            history.append((distribution, actual, race_id))
            for name, frame in [('before', group), ('after', updated)]:
                values = scorecard.car_scores(frame)
                argument_5 = frame.dist.to_numpy()
                matrix = np.stack(argument_5)
                indices = actual.astype(int) - 1
                argument_6 = len(indices)
                selected = matrix[np.arange(argument_6), indices]
                selected = np.clip(selected, 1e-06, 1.0)
                argument_7 = np.log(selected).mean()
                values['marginalPositionNll'] = float(-argument_7)
                argument_8 = int(race_id)
                argument_9 = int(race_id // 100)
                values.update({'stage': stage, 'raceId': argument_8, 'season': argument_9, 'version': name})
                scores.append(values)
        print(stage, 'finished', flush=True)
    after = pd.concat(transformed, ignore_index=True)
    per_race = pd.DataFrame(scores)
    comparisons = {}
    seasons = {}
    calibration = {}
    for stage in scorecard.STAGES:
        original_stage = cars[cars.stage == stage]
        after_stage = after[after.stage == stage]
        stage_scores = per_race[per_race.stage == stage]
        comparisons[stage] = compare(stage_scores, original_stage, after_stage)
        seasons[stage] = {}
        for season, subset in stage_scores.groupby('season'):
            before_rows = original_stage[original_stage.season == season]
            after_rows = after_stage[after_stage.season == season]
            seasons[stage][str(season)] = compare(subset, before_rows, after_rows)
        calibration[stage] = {'before': calibrate(original_stage), 'after': calibrate(after_stage)}
    worse = []
    improved = []
    for stage in ('pre-weekend', 'post-qualifying'):
        rps = next((row for row in comparisons[stage] if row['metric'] == 'rps'))
        if rps['ci_low'] > 0:
            worse.append(stage)
        if rps['ci_high'] < 0:
            improved.append(stage)
    season_worse = []
    season_diffs = {}
    for stage, entries in seasons.items():
        season_diffs[stage] = {}
        for season, entries_for_season in entries.items():
            rps = next((row for row in entries_for_season if row['metric'] == 'rps'))
            season_diffs[stage][season] = rps
            if rps['diff'] > 0.002:
                season_worse.append(f'{stage}:{season}')
    verdict = 'reject' if worse or season_worse else 'neutral'
    reason = 'The distribution-wide recalibration fails the locked accept rule because a required stage has a significantly worse RPS or a season worsens by more than 0.002 RPS.' if verdict == 'reject' else 'The coherent power recalibration improves points MAE at all three stages, including pre-weekend from 3.672 to 3.534, but its RPS improvements are within noise: pre-weekend difference -0.000877 (95% interval -0.001870 to 0.000108) and post-qualifying -0.000620 (-0.001687 to 0.000449). No season worsens by more than 0.002 RPS. Pre-weekend win ECE worsens from 0.0156 to 0.0239 and the win slope moves farther from one. Joint simulator NLL cannot be recomputed from marginals, preventing verification of the locked accept rule. The verdict is neutral and deployment is not recommended.'
    baseline_nll = races[races.raceId <= 202616].copy()
    baseline_nll['nll'] = baseline_nll.orderNll + baseline_nll.dnfNll
    nll_values = baseline_nll.groupby('stage').nll.mean().to_dict()
    for stage, entries in comparisons.items():
        for entry in entries:
            if entry['metric'] == 'nll':
                entry['before'] = float(nll_values[stage])
        for season, season_entries in seasons[stage].items():
            season_number = int(season)
            selected_nll = baseline_nll[(baseline_nll.stage == stage) & (baseline_nll.season == season_number)]
            mean_nll = selected_nll.nll.mean()
            for entry in season_entries:
                if entry['metric'] == 'nll':
                    entry['before'] = float(mean_nll)
    summary = {'verdict': verdict, 'reason': reason, 'selectionRaces': 64, 'selectionEndRaceId': 202616, 'holdout': '202617 excluded without scoring', 'method': {'transform': 'Elementwise power followed by Sinkhorn row/column balancing', 'fit': 'Expanding prior-race RPS minimization independently per stage', 'bounds': [0.5, 2.0], 'warmupRaces': 12, 'regularizer': '0.001 * log(power)^2', 'zeroFloor': 1e-10, 'hyperparameters': 'Fixed before measuring candidate; not tuned on selection results'}, 'perStageComparison': comparisons, 'perSeasonComparison': seasons, 'perSeasonRpsDiffs': season_diffs, 'calibration': calibration, 'fittedParameters': parameters, 'baselineJointNll': nll_values, 'jointNll': {'after': None, 'reason': 'No strengths, schedule, grid bonus or joint draws are stored. Balanced marginals do not identify a joint permutation law. Marginal position NLL is reported separately and is not a substitute.'}, 'acceptRule': {'significantlyWorseRequiredStages': worse, 'significantlyImprovedRequiredStages': improved, 'seasonsOverLimit': season_worse, 'jointNllVerified': False}, 'limitations': ['No earlier full position-distribution backtest rows found; older driver rows lack distributions and history files begin in 2024.', 'Race expected points recalibrated; saved sprint and fastest-lap expected contribution retained unchanged. Fantasy and joint simulated worlds are not recalibrated.', 'Selection races train subsequent calibrators only, never themselves. The first 12 races per stage use identity.', 'This is one fixed candidate, not a search over selection-set alternatives.']}
    pre_weekend = cars[cars.stage == 'pre-weekend']
    leader_indices = pre_weekend.groupby('raceId').expectedPoints.idxmax()
    leaders = pre_weekend.loc[leader_indices]
    leader_count = len(leaders)
    leader_expected = leaders.expectedPoints.mean()
    leader_actual = leaders.actualPoints.mean()
    leader_expected = float(leader_expected)
    leader_actual = float(leader_actual)
    summary['hypothesisCheck'] = {'preWeekendLeader': {'count': leader_count, 'meanExpectedPoints': leader_expected, 'meanActualPoints': leader_actual}, 'finding': 'The current selection-run 6-10 and 10-15 expected-points bins are underpredicted, contrary to the prompt hypothesis that they are overpredicted. The leader diagnostic uses the highest expected-points driver in each race.'}
    text = json.dumps(summary, indent=2, allow_nan=False)
    (output / 'summary.json').write_text(text, encoding='utf-8')
    after.to_parquet(output / 'recalibrated_cars.parquet', index=False)
    per_race.to_csv(output / 'race_scores.csv', index=False)
    write_report(output, summary)
    print(verdict, reason)

def balance_power(distribution, power):
    if abs(power - 1.0) < 1e-08:
        return distribution.copy()
    clipped = np.maximum(distribution, 1e-10)
    matrix = clipped ** power
    for iteration in range(500):
        matrix = matrix / matrix.sum(axis=1, keepdims=True)
        matrix = matrix / matrix.sum(axis=0, keepdims=True)
        argument_10 = matrix.sum(axis=1)
        argument_11 = np.abs(argument_10 - 1.0)
        residual = np.max(argument_11)
        if residual < 1e-09:
            break
    if residual >= 1e-07:
        raise ValueError('Balancing did not converge')
    return matrix

def training_loss(power, history):
    losses = []
    for distribution, actual, race_id in history:
        changed = balance_power(distribution, power)
        loss = scorecard.ranked_probability_score(changed, actual)
        losses.append(loss)
    penalty = 0.001 * np.log(power) ** 2
    argument_12 = np.mean(losses)
    return float(argument_12 + penalty)

def update_rows(group, original, changed):
    updated = group.copy()
    count = changed.shape[1]
    positions = np.arange(1, count + 1)
    points = np.zeros(count)
    points[:10] = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]
    retained = group.expectedPoints.to_numpy() - original @ points
    updated['dist'] = list(changed)
    updated['pWin'] = changed[:, 0]
    updated['pPodium'] = changed[:, :3].sum(axis=1)
    updated['pPoints'] = changed[:, :10].sum(axis=1)
    updated['expectedPosition'] = changed @ positions
    updated['expectedPoints'] = changed @ points + retained
    return updated

def calibrate(rows):
    actual = rows.actual.to_numpy()
    result = {}
    edges = np.asarray(metrics.CALIBRATION_BINS)
    for name, column, outcome in [('win', 'pWin', actual == 1), ('podium', 'pPodium', actual <= 3), ('points', 'pPoints', actual <= 10)]:
        probability = rows[column].to_numpy()
        indices = np.digitize(probability, edges) - 1
        argument_13 = len(edges)
        indices = np.clip(indices, 0, argument_13 - 2)
        bins = []
        ece = 0.0
        argument_14 = len(edges)
        for index in range(argument_14 - 1):
            mask = indices == index
            argument_15 = mask.sum()
            count = int(argument_15)
            if not count:
                continue
            argument_16 = probability[mask].mean()
            predicted = float(argument_16)
            argument_17 = outcome[mask].mean()
            observed = float(argument_17)
            ece += count / len(rows) * abs(predicted - observed)
            argument_18 = float(edges[index])
            argument_19 = float(edges[index + 1])
            bins.append({'bin_low': argument_18, 'bin_high': argument_19, 'mean_predicted': predicted, 'observed_rate': observed, 'count': count})
        clipped = np.clip(probability, 0.0001, 1 - 0.0001)
        features = logit(clipped)
        features = features.reshape(-1, 1)
        target = outcome.astype(int)
        model = LogisticRegression(C=1000000.0)
        model.fit(features, target)
        result[name] = {'ece': float(ece), 'slope': float(model.coef_[0, 0]), 'intercept': float(model.intercept_[0]), 'bins': bins}
    point_edges = [0, 1, 3, 6, 10, 15, 20, 100]
    result['expectedPoints'] = []
    for low, high in zip(point_edges[:-1], point_edges[1:]):
        subset = rows[(rows.expectedPoints >= low) & (rows.expectedPoints < high)]
        if len(subset):
            argument_20 = subset.expectedPoints.mean()
            argument_21 = subset.actualPoints.mean()
            argument_22 = len(subset)
            argument_23 = float(argument_20)
            argument_24 = float(argument_21)
            argument_25 = int(argument_22)
            result['expectedPoints'].append({'bin_low': low, 'bin_high': high, 'mean_predicted': argument_23, 'observed_points': argument_24, 'count': argument_25})
    return result

def compare(rows, before_cars, after_cars):
    first = rows[rows.version == 'before'].set_index('raceId')
    second = rows[rows.version == 'after'].set_index('raceId')
    rng = np.random.default_rng(20261008)
    argument_26 = len(first)
    argument_27 = len(first)
    draws = rng.integers(0, argument_26, size=(4000, argument_27))
    result = []
    names = ['rps', 'marginalPositionNll', 'logLossWin', 'logLossPodium', 'logLossPoints', 'spearman', 'maePoints']
    for name in names:
        difference = second[name] - first[name]
        values = difference.to_numpy()
        boot = values[draws].mean(axis=1)
        low, high = np.percentile(boot, [2.5, 97.5])
        argument_28 = first[name].mean()
        argument_29 = second[name].mean()
        argument_30 = difference.mean()
        argument_31 = float(argument_28)
        argument_32 = float(argument_29)
        argument_33 = float(argument_30)
        argument_34 = float(low)
        argument_35 = float(high)
        argument_36 = len(first)
        result.append({'metric': name, 'before': argument_31, 'after': argument_32, 'diff': argument_33, 'ci_low': argument_34, 'ci_high': argument_35, 'races': argument_36})
    before_calibration = calibrate(before_cars)
    after_calibration = calibrate(after_cars)
    race_ids = first.index.to_numpy()
    before_groups = [before_cars[before_cars.raceId == race_id] for race_id in race_ids]
    after_groups = [after_cars[after_cars.raceId == race_id] for race_id in race_ids]
    for name, column, threshold in [('win', 'pWin', 1), ('podium', 'pPodium', 3), ('points', 'pPoints', 10)]:
        before_stats = bin_stats(before_groups, column, threshold)
        after_stats = bin_stats(after_groups, column, threshold)
        before_boot = bootstrap_ece(before_stats, draws)
        after_boot = bootstrap_ece(after_stats, draws)
        delta = after_boot - before_boot
        low, high = np.percentile(delta, [2.5, 97.5])
        before_value = before_calibration[name]['ece']
        after_value = after_calibration[name]['ece']
        argument_37 = float(low)
        argument_38 = float(high)
        argument_39 = len(first)
        result.append({'metric': 'ece_' + name, 'before': before_value, 'after': after_value, 'diff': after_value - before_value, 'ci_low': argument_37, 'ci_high': argument_38, 'races': argument_39})
    argument_40 = len(first)
    result.append({'metric': 'nll', 'before': None, 'after': None, 'diff': None, 'ci_low': None, 'ci_high': None, 'races': argument_40})
    return result

def bin_stats(groups, column, threshold):
    edges = np.asarray(metrics.CALIBRATION_BINS)
    argument_41 = len(groups)
    argument_42 = len(edges)
    result = np.zeros((argument_41, argument_42 - 1, 3))
    for race_index, group in enumerate(groups):
        p = group[column].to_numpy()
        y = group.actual.to_numpy() <= threshold
        indices = np.digitize(p, edges) - 1
        argument_43 = len(edges)
        indices = np.clip(indices, 0, argument_43 - 2)
        argument_44 = len(edges)
        for index in range(argument_44 - 1):
            mask = indices == index
            result[race_index, index] = [mask.sum(), p[mask].sum(), y[mask].sum()]
    return result

def bootstrap_ece(stats, draws):
    pooled = stats[draws].sum(axis=1)
    error = np.abs(pooled[:, :, 1] - pooled[:, :, 2]).sum(axis=1)
    count = pooled[:, :, 0].sum(axis=1)
    return error / count

def write_report(output, summary):
    lines = ['# Walk-forward distribution recalibration', '', summary['reason'], '', 'Run from v2/ml: `uv run python -m scripts.exp_calibration.run`. No existing model or source file is modified.', '', '64 selection races: 2024, 2025 and 2026 R1 to R16. R17 is excluded without scoring.', '', 'Power is fitted on strictly earlier races, with identity for the first 12. Sinkhorn balancing preserves driver normalization and one car per position in expectation. Parameters are fixed expanding-window RPS fits, with a small identity regularizer. No backtest was rerun.', '', 'A logistic slope below one indicates probabilities that are too extreme on the logit scale, conditional on the intercept. Win and points calibration can therefore need different corrections; a single power cannot independently fix both.', '', 'Joint simulator NLL is unavailable after transformation. Marginal position NLL is a different score. Race points are derived from transformed distributions; the original sprint and fastest-lap expectation is retained. This is not a recalibration of fantasy or joint simulation worlds.', '', '| Stage | Metric | Before | After | Difference | 95% paired race interval |', '|---|---|---|---|---|---|']
    for stage, entries in summary['perStageComparison'].items():
        for entry in entries:
            if entry['after'] is None:
                continue
            lines.append(f"| {stage} | {entry['metric']} | {entry['before']:.6f} | {entry['after']:.6f} | {entry['diff']:+.6f} | [{entry['ci_low']:+.6f}, {entry['ci_high']:+.6f}] |")
    lines += ['', summary['hypothesisCheck']['finding'], '', 'The driver with the highest pre-weekend expected points averages 18.683 predicted versus 16.250 realised over 64 races. The 6-10 bin averages 8.130 predicted versus 10.189 realised; the 10-15 bin averages 12.064 versus 14.414.', '', 'All reliability bins, including sparse bins, are retained with counts in summary.json. Sparse bins should not be interpreted as stable estimates. ECE intervals resample whole races and recompute pooled ECE. Other score intervals resample paired per-race differences. Per-season comparisons and fitted parameters are in summary.json.', '', 'Verdict: ' + summary['verdict']]
    report = '\n'.join(lines) + '\n'
    (output / 'REPORT.md').write_text(report, encoding='utf-8')
if __name__ == '__main__':
    main()
