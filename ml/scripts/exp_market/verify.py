import json
import math
from pathlib import Path

import numpy as np


def main():
    root = Path(__file__).resolve().parents[2]
    output = root / 'reports/exp/market'
    summary = read(output / 'summary.json')
    probabilities = read(output / 'matched_probabilities.json')
    scores = {(row['raceId'], row['stage']): row for row in summary['perRace']}
    for row in probabilities:
        assert len(row['driverIds']) == len(row['ours']) == len(row['market']) == len(row['winner'])
        assert sum(row['winner']) == 1
        for model in ['ours', 'market']:
            array = np.array(row[model])
            assert np.isfinite(array).all()
            assert (array >= 0).all() and (array <= 1).all()
            probability_sum = array.sum()
            total = float(probability_sum)
            assert abs(total - 1) < 1e-10
            winner = row['winner'].index(True)
            capped_probability = min(1 - 1e-6, row[model][winner])
            probability = max(1e-6, capped_probability)
            loss = -math.log(probability)
            saved = scores[(row['raceId'], row['stage'])][model + 'LogLossWin']
            assert abs(loss - saved) < 1e-10
    for race in summary['coverage']['races']:
        for stage in race['stages'].values():
            if not stage['usable']:
                continue
            for timestamp in stage['timestamps'].values():
                assert stage['windowStart'] <= timestamp < stage['cutoff']
    summary['reliabilityBySeason'] = {}
    for stage in summary['coverage']['byStage']:
        stage_rows = [row for row in probabilities if row['stage'] == stage and row['raceId'] < 202617]
        expected_count = sum(len(row['ours']) for row in stage_rows)
        for model in ['ours', 'market']:
            actual_count = sum(item['count'] for item in summary['reliability'][stage][model])
            assert actual_count == expected_count
        previous = 0
        for weight in summary['blendWeights']:
            if weight['stage'] != stage:
                continue
            assert weight['trainingRaces'] == previous
            if previous < 10:
                assert weight['oursWeight'] == 1
            if weight['raceId'] < 202617:
                previous += 1
        summary['reliabilityBySeason'][stage] = {}
        for season in [2024, 2025, 2026]:
            rows = [row for row in stage_rows if row['season'] == season]
            summary['reliabilityBySeason'][stage][str(season)] = {model: bins(rows, model) for model in ['ours', 'market']}
    summary['verification'] = {'matchedRaceStagesChecked': len(probabilities), 'probabilitySums': 'passed', 'winnerLogLossRecomputed': 'passed', 'snapshotTimestamps': 'passed', 'blendTrainingChronology': 'passed', 'reliabilityCounts': 'passed'}
    text = json.dumps(summary, indent=2, allow_nan=False)
    (output / 'summary.json').write_text(text, encoding='utf-8')
    print(summary['verification'])
    print(summary['coverage']['bySeason'])
    print(summary['normalizationDiagnostics'])


def read(path):
    text = path.read_text(encoding='utf-8')
    return json.loads(text)


def bins(rows, model):
    output = []
    for index in range(10):
        low = index / 10
        high = (index + 1) / 10
        predictions = []
        outcomes = []
        for row in rows:
            for prediction, outcome in zip(row[model], row['winner']):
                if low <= prediction < high or index == 9 and prediction == 1:
                    predictions.append(prediction)
                    outcomes.append(outcome)
        count = len(predictions)
        prediction_sum = sum(predictions)
        outcome_sum = sum(outcomes)
        output.append({'low': low, 'high': high, 'meanPredicted': prediction_sum / count if count else None, 'observedRate': outcome_sum / count if count else None, 'count': count})
    return output


if __name__ == '__main__':
    main()
