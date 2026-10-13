import json
from pathlib import Path

import numpy as np
import pandas as pd

from f1ml import scorecard, weather


def main():
    out = Path('reports/exp/ideas')
    out.mkdir(parents=True, exist_ok=True)
    scores = scorecard.race_scores('exp_bestcar')
    cars = scorecard.load_rows('exp_bestcar', 'cars')
    scores = scores[scores.raceId <= 202616]
    cars = cars[cars.raceId <= 202616]
    features = pd.read_parquet('cache/features_bestcar.parquet')
    columns = ['raceId', 'driverId', 'team', 'circuitId', 'round', 'has_sprint', 'c_street', 'c_speed']
    cars = cars.merge(features[columns], on=['raceId', 'driverId'])
    meta = features.drop_duplicates('raceId')
    meta = meta.drop(columns=['season'])
    scores = scores.merge(meta[['raceId', 'round', 'circuitId', 'has_sprint', 'c_street', 'c_speed']], on='raceId')
    rain = weather.race_weather()
    scores = scores.merge(rain[['raceId', 'rain_actual']], on='raceId', how='left')
    pre = scores[scores.stage == 'pre-weekend'].copy()
    pre['period'] = pd.cut(pre['round'], [0, 4, 12, 30], labels=['R1-4', 'R5-12', 'R13+'])
    pre['wet'] = pre.rain_actual >= 0.5
    pre['speed_band'] = pd.cut(pre.c_speed, [0, 200, 225, 400], labels=['slow', 'medium', 'fast'])
    lines = ['# Pre-weekend error analysis', '', 'Saved exp_bestcar run, 64 selection races. The saved baseline has 65 races: R17 is excluded here and from candidate runs. An initial unrestricted read exposed R17; it was excluded immediately and never used to choose parameters. Subgroups are descriptive, not tuning folds. Rain uses realised ERA5 only as an analysis label. No upgrade-news dates are available, so round bins are not evidence of specific upgrades.', '', '## Findings and experiments', '', '- Stale team hierarchy is the strongest actionable pattern: 2024 Red Bull points bias is +3.97 per driver-race, McLaren -3.59, Ferrari -2.95 and Mercedes -2.52. Market advantages include late-2024 Norris and early-2025 Piastri. Test additional team form features with short-window change detection and reset discount (F1ML_FASTFORM).', '- Street circuits have mean RPS 0.1334 versus 0.1227 elsewhere. Montreal, Melbourne, Monaco and Baku have large errors. Test recent qualifying-gap residuals weighted by circuit length, turn count and street status (F1ML_SIMILARITY). Residuals separate track preference from changing overall team strength.', '- Early rounds are not worse in aggregate (RPS 0.1229 versus 0.1284 in R5-12). Late rounds have worse win log loss (2.024 versus 1.658 in R1-4), consistent with form drift but not proof of upgrades.', '- Rain races do not have worse overall RPS (0.1255 versus 0.1266 dry); sprint RPS is only modestly worse (0.1285 versus 0.1256). Defer weather dispersion because this sample provides weak support.', '- The 40-race market sample has model top-pick accuracy 17.5% versus market 32.5%. Using exp_bestcar rather than the older embedded ours arrays gives arithmetic winner probability 17.9% versus 21.6% market. These arithmetic values differ from exp(-mean win log loss).', '', '## Design and validation', '', 'Each switch defaults OFF and adds columns without changing existing baseline columns. The feature files retain the saved bestcar columns exactly, avoiding unrelated source-data refreshes. Hyperparameter selection uses only 1,040 team-race next-gap observations from 2019-2023. This is a cheap predictive proxy, not a full-model tuning backtest. Fixed regularisation assumptions: 0.25 reset and old-history discount, 12-race similarity recency. Grid results are in tuning.json.', '', 'Point-in-time checks perturb current and future team results at five cutoffs. New features only read team rows with raceId < cutoff. Similarity deliberately excludes the existing all-history c_speed feature, which has an inherited point-in-time limitation. Static circuit metadata lacks historical versioning. Existing baseline behaviour and F1ML_DYNPL are unchanged.', '', 'FastF1 laps for FP1, FP2 and FP3 are present locally for 2018-2022. Long-run coverage is feasible, but the two selected experiments address the pre-weekend deficit directly. No data tables are modified.', '']
    for key in ['season', 'period', 'c_street', 'speed_band', 'has_sprint', 'wet', 'circuitId']:
        grouped = pre.groupby(key, observed=True).agg(n=('raceId', 'size'), rps=('rps', 'mean'), win_ll=('logLossWin', 'mean'))
        table = grouped.to_string()
        lines.extend([f'## {key}', '', '```text', table, '```', ''])
    pre_cars = cars[cars.stage == 'pre-weekend'].copy()
    pre_cars['points_bias'] = pre_cars.expectedPoints - pre_cars.actualPoints
    teams = pre_cars.groupby(['season', 'team']).agg(n=('raceId', 'size'), points_bias=('points_bias', 'mean'))
    team_text = teams.to_string()
    lines.extend(['## Team points bias (predicted minus actual)', '', '```text', team_text, '```', ''])
    market_path = Path('reports/exp/market/matched_probabilities.json')
    market_text = market_path.read_text()
    market = json.loads(market_text)
    market_rows = []
    for item in market:
        if item['stage'] != 'pre-weekend':
            continue
        race = pre_cars[pre_cars.raceId == item['raceId']].set_index('driverId')
        ids = item['driverIds']
        if not set(ids).issubset(race.index):
            continue
        ours = race.loc[ids, 'pWin'].to_numpy()
        prices = np.asarray(item['market'])
        winner = np.asarray(item['winner'], dtype=bool)
        actual = ids[np.flatnonzero(winner)[0]]
        top_ours = ids[np.argmax(ours)]
        top_market = ids[np.argmax(prices)]
        ours_probability = float(ours[winner][0])
        market_probability = float(prices[winner][0])
        market_row = {'raceId': item['raceId'], 'winner': actual, 'model_pick': top_ours, 'market_pick': top_market, 'ours': ours_probability, 'market': market_probability, 'model_correct': top_ours == actual, 'market_correct': top_market == actual}
        market_rows.append(market_row)
    matched = pd.DataFrame(market_rows)
    clipped = matched.ours.clip(lower=1e-6)
    matched['ll_gap'] = np.log(matched.market) - np.log(clipped)
    market_summary = f'{len(matched)} races. Arithmetic winner probability: model {matched.ours.mean():.4f}, market {matched.market.mean():.4f}. Top-pick accuracy: model {matched.model_correct.mean():.4f}, market {matched.market_correct.mean():.4f}.'
    largest = matched.sort_values('ll_gap', ascending=False).head(12)
    largest_text = largest.to_string(index=False)
    disagreements = matched[matched.market_correct & ~matched.model_correct]
    disagreement_text = disagreements.to_string(index=False)
    worst = pre.sort_values('rps', ascending=False).head(12)
    worst_text = worst.to_string(index=False)
    lines.extend(['## Matched market sample', '', market_summary, '', 'Largest market advantages:', '', '```text', largest_text, '```', '', 'Market right, model wrong:', '', '```text', disagreement_text, '```', '', '## Largest full-field errors', '', '```text', worst_text, '```', ''])
    report = '\n'.join(lines)
    (out / 'ERROR_ANALYSIS.md').write_text(report, encoding='utf-8')
    pre.to_json(out / 'race_errors.json', orient='records', indent=2)
    matched.to_json(out / 'market_errors.json', orient='records', indent=2)
    print(report)


if __name__ == '__main__':
    main()

