import ast
import json
from pathlib import Path

import numpy as np
import pandas as pd

from scripts.exp_combo.run import propagate


def main():
    path = Path('reports/exp/combo/summary.json')
    text = path.read_text(encoding='utf-8')
    summary = json.loads(text)
    parameters = summary['fittedParameters']
    assert len(parameters) == 8 * 3 * 64
    for row in parameters:
        assert row['raceId'] <= 202616
        for key in ('lastCalibrationTrainingRaceId', 'lastMarketTrainingRaceId'):
            prior = row[key]
            assert prior is None or prior < row['raceId']
    for race_set, stages in summary['raceSets'].items():
        for stage, variants in stages.items():
            assert len(variants) == 8
            baseline = variants['exp_bestcar_cal0_market0']
            for entry in variants.values():
                assert entry['raceIds'] == baseline['raceIds']
                expected_count = 64 if race_set == 'all_selection' else 40 if stage == 'pre-weekend' else 42
                assert entry['races'] == expected_count
            intervals = baseline['intervalsVsBase']
            for interval in intervals.values():
                assert interval == {'diff': 0.0, 'ci_low': 0.0, 'ci_high': 0.0}
    saved_path = Path('reports/exp/calibration/race_scores.csv')
    saved = pd.read_csv(saved_path)
    current = pd.read_csv('reports/exp/combo/race_scores.csv')
    saved = saved[saved.version == 'after'].sort_values(['stage', 'raceId'])
    calibrated = current[current.variant == 'exp_bestcar_cal1_market0'].sort_values(['stage', 'raceId'])
    names = ['rps', 'logLossWin', 'logLossPodium', 'logLossPoints', 'maePoints', 'spearman']
    first = saved[names].to_numpy()
    second = calibrated[names].to_numpy()
    np.testing.assert_allclose(first, second, atol=1e-10, rtol=0)
    market_path = Path('reports/exp/market/summary.json')
    market_text = market_path.read_text(encoding='utf-8')
    market_summary = json.loads(market_text)
    existing_weights = {(row['stage'], row['raceId']): row['oursWeight'] for row in market_summary['blendWeights'] if row['raceId'] <= 202616}
    for row in parameters:
        key = (row['stage'], row['raceId'])
        if row['variant'] == 'exp_bestcar_cal0_market1' and key in existing_weights:
            assert row['oursWeight'] == existing_weights[key]
    original_path = Path('reports/scorecard/exp_bestcar_cars.parquet')
    original = pd.read_parquet(original_path)
    sample = original[(original.raceId == 202401) & (original.stage == 'pre-weekend')]
    arrays = sample.dist.to_numpy()
    distribution = np.stack(arrays)
    target = np.linspace(1, 20, 20)
    target /= target.sum()
    changed = propagate(distribution, target)
    assert changed.min() >= 0
    for source in Path('scripts/exp_combo').glob('*.py'):
        source_text = source.read_text(encoding='utf-8')
        assert chr(8212) not in source_text
        tree = ast.parse(source_text)
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                arguments = list(node.args)
                keyword_values = [keyword.value for keyword in node.keywords]
                arguments.extend(keyword_values)
                for argument in arguments:
                    descendants = ast.walk(argument)
                    call_flags = [isinstance(child, ast.Call) for child in descendants]
                    assert not any(call_flags), (source, node.lineno)
    print('PASS: 1536 variant-race-stage rows; chronology, paired sets, zero baseline intervals, existing calibration reproduction, propagation constraints and code style')


if __name__ == '__main__':
    main()
