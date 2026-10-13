import argparse
import json
from pathlib import Path

import pandas as pd

from f1ml import features, team_ideas


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('idea', choices=['fastform', 'similarity'])
    args = parser.parse_args()
    path = Path(f'cache/features_{args.idea}.parquet')
    candidate = pd.read_parquet(path)
    baseline = pd.read_parquet('cache/features_bestcar.parquet')
    baseline = baseline[baseline.raceId < 202617].copy()
    columns = team_ideas.FORM_COLS if args.idea == 'fastform' else team_ideas.SIM_COLS
    keys = ['raceId', 'driverId']
    extra = candidate[keys + columns]
    isolated = baseline.merge(extra, on=keys, how='left', validate='one_to_one')
    expected = baseline.reset_index(drop=True)
    pd.testing.assert_frame_equal(isolated[baseline.columns], expected)
    history = features.History.load()
    targets = history.historical_targets(2022)
    checks = []
    for race_id in (202201, 202401, 202412, 202601, 202608):
        matches = [item for item in targets if item.race_id == race_id]
        target = matches[0]
        first = history._target_features(target)[keys + columns]
        old_arrays = {key: value.copy() for key, value in history.team_arrays.items()}
        history.team_arrays = {key: value.copy() for key, value in old_arrays.items()}
        future = history.team_race >= race_id
        for key in ('best_qgap', 'best_fin', 'season'):
            history.team_arrays[key][future] = 9999.0
        second = history._target_features(target)[keys + columns]
        pd.testing.assert_frame_equal(first, second)
        history.team_arrays = old_arrays
        check = dict(raceId=race_id, future_team_results_perturbed=True, unchanged=True)
        checks.append(check)
    gated = features.stage_frame(isolated, 'pre-weekend')
    pd.testing.assert_frame_equal(gated[columns], isolated[columns])
    assert isolated.raceId.max() == 202616
    selection = isolated[isolated.season >= 2024]
    assert selection.raceId.nunique() == 64
    isolated.to_parquet(path, index=False)
    coverage = isolated.groupby('season')[columns].count()
    coverage_values = coverage.to_dict()
    report = dict(idea=args.idea, all_existing_columns_identical_to_saved_baseline=True, cutoff_checks=checks, selection_races=64, max_race=202616, coverage=coverage_values, limitations=['Existing baseline c_speed is computed from all loaded fastest laps. New similarity uses static length, turns and street status only; inherited baseline issue is unchanged.', 'Circuit metadata is the current data snapshot; no historical versioned metadata is available.'])
    text = json.dumps(report, indent=2)
    Path(f'reports/exp/ideas/{args.idea}_checks.json').write_text(text, encoding='utf-8')
    print(text)


if __name__ == '__main__':
    main()
