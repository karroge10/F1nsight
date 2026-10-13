import json
import math
from pathlib import Path

import numpy as np

from f1ml import scorecard


def main():
    root = Path('reports/exp/ideas')
    entries = []
    descriptions = {'fastform': 'Team form that discounts history after detected gap changes and regulation resets.', 'similarity': 'Recent team qualifying residuals at circuits with similar length, turns and street status.'}
    for idea in descriptions:
        path = Path(f'reports/scorecard/exp_{idea}.json')
        if not path.exists():
            continue
        card_text = path.read_text()
        card = json.loads(card_text)
        comparison = card['against']['stages']
        before = scorecard.race_scores('exp_bestcar')
        after = scorecard.race_scores(f'exp_{idea}')
        paired = before.merge(after, on=['raceId', 'stage', 'season'], suffixes=('_before', '_after'))
        assert paired.raceId.nunique() == 64
        stages = {}
        for stage in scorecard.STAGES:
            rows = paired[paired.stage == stage]
            count = len(rows)
            rng = np.random.default_rng(20261008)
            draws = rng.integers(0, count, size=(4000, count))
            entry = dict(rps=comparison[stage]['rps'], nll=comparison[stage]['nll'], win_log_loss=comparison[stage]['logLossWin'])
            entry['winner_probability_geometric_mean'] = {key: math.exp(-comparison[stage]['logLossWin'][key]) for key in ('before', 'after')}
            entry['winner_probability_arithmetic_mean'] = {}
            for key in ('before', 'after'):
                values = rows[f'rps_{key}'].to_numpy()
                boots = values[draws].mean(axis=1)
                interval = np.percentile(boots, [2.5, 97.5]).tolist()
                entry['rps'][f'{key}_interval95'] = interval
                losses = rows[f'logLossWin_{key}'].to_numpy()
                probabilities = np.exp(-losses)
                mean_probability = probabilities.mean()
                entry['winner_probability_arithmetic_mean'][key] = float(mean_probability)
            stages[stage] = entry
        protected = ('pre-weekend', 'post-qualifying')
        worse = any(stages[stage][metric]['low'] > 0 for stage in protected for metric in ('rps', 'nll'))
        improved = any(stages[stage][metric]['high'] < 0 for stage in protected for metric in ('rps', 'nll'))
        season_deltas = {}
        for (stage, season), rows in paired.groupby(['stage', 'season']):
            delta = (rows.rps_after - rows.rps_before).mean()
            season_deltas[f'{stage}/{season}'] = float(delta)
        season_failures = [value > 0.002 for value in season_deltas.values()]
        season_worse = any(season_failures)
        verdict = 'reject' if worse or season_worse else ('accept' if improved else 'neutral, keep disabled')
        runtime_path = root / f'{idea}_runtime.json'
        runtime = None
        if runtime_path.exists():
            runtime_text = runtime_path.read_text(encoding='utf-8-sig')
            runtime = json.loads(runtime_text)
        switch_suffix = idea.upper()
        entry = dict(name=idea, description=descriptions[idea], switch=f'F1ML_{switch_suffix}', default='OFF', verdict=verdict, significant_worsening=worse, significant_improvement=improved, season_guardrail_failed=season_worse, season_rps_deltas=season_deltas, stages=stages, runtime=runtime)
        entries.append(entry)
    result = dict(baseline='exp_bestcar', selection='2024-2025 and 2026 R1-R16, 64 paired races; baseline R17 excluded', probability_definition='exp(-mean win log loss) is geometric, not arithmetic average winner probability', ideas=entries)
    text = json.dumps(result, indent=2)
    (root / 'summary.json').write_text(text, encoding='utf-8')
    print(text)


if __name__ == '__main__':
    main()
