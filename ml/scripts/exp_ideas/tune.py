import json
from pathlib import Path

import numpy as np

from f1ml import features, team_ideas


def main():
    history = features.History.load()
    samples = []
    for team, rows in history.team_rows.items():
        row_count = len(rows)
        for index in range(8, row_count):
            row = rows[index]
            race_id = history.team_race[row]
            season = race_id // 100
            if not 2019 <= season <= 2023:
                continue
            past = rows[max(0, index - 40):index]
            qgap = history.team_arrays['best_qgap'][past]
            finish = history.team_arrays['best_fin'][past]
            seasons = history.team_arrays['season'][past]
            actual = history.team_arrays['best_qgap'][row]
            if not np.isfinite(actual):
                continue
            samples.append((race_id, past, qgap, finish, seasons, actual))
    form_results = []
    for half_life in (1.5, 3.0, 5.0):
        for threshold in (0.25, 0.5, 1.0):
            params = dict(half_life=half_life, threshold=threshold, reset_discount=0.25, old_discount=0.25)
            errors = []
            for race_id, past, qgap, finish, seasons, actual in samples:
                predicted = team_ideas.form_features(qgap, finish, seasons, race_id // 100, params)
                error = (predicted['t_fast_qgap'] - actual) ** 2
                errors.append(error)
            mean_error = np.nanmean(errors)
            loss = float(mean_error)
            result = dict(params=params, mse=loss)
            form_results.append(result)
    sim_results = []
    for bandwidth in (0.5, 1.0, 2.0):
        for shrinkage in (1.0, 3.0, 6.0):
            params = dict(bandwidth=bandwidth, shrinkage=shrinkage)
            errors = []
            for race_id, past, qgap, finish, seasons, actual in samples:
                race_ids = history.team_race[past]
                extra = team_ideas.similarity_features(qgap, race_ids, history.races, race_id, params)
                count = len(qgap)
                ages = np.arange(count)[::-1]
                weights = np.power(0.5, ages / 3.0)
                base = team_ideas.weighted_mean(qgap, weights)
                adjustment = extra['t_sim_qgap']
                if not np.isfinite(adjustment):
                    adjustment = 0.0
                errors.append((base + adjustment - actual) ** 2)
            mean_error = np.nanmean(errors)
            loss = float(mean_error)
            result = dict(params=params, mse=loss)
            sim_results.append(result)
    form_results.sort(key=lambda item: item['mse'])
    sim_results.sort(key=lambda item: item['mse'])
    params = dict(fastform=form_results[0]['params'], similarity=sim_results[0]['params'])
    path = Path('scripts/exp_ideas/params.json')
    params_text = json.dumps(params, indent=2)
    path.write_text(params_text, encoding='utf-8')
    sample_count = len(samples)
    report = dict(split='2019-2023 only', target='next team best qualifying gap, walk-forward squared error proxy', samples=sample_count, fastform=form_results, similarity=sim_results)
    text = json.dumps(report, indent=2)
    Path('reports/exp/ideas/tuning.json').write_text(text, encoding='utf-8')
    print(text)


if __name__ == '__main__':
    main()
