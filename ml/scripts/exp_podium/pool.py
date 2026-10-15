"""Round 12: walk-forward log pooling of Kalshi podium and winner prices with our forecast.

Offline only, cached Kalshi responses. Run from ml: uv run python scripts/exp_podium/pool.py
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'benchmark'))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from score import ROOT, STAGES, kalshi_vectors  # noqa: E402
from f1ml.market import OURS_WEIGHT  # noqa: E402
from f1ml.scorecard import binary_log_loss  # noqa: E402

GRID = np.round(np.arange(0, 1.0001, 0.05), 2)
SEED = 20261015
OUT = ROOT / 'ml/reports/exp_podium'


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    races = pd.read_parquet(ROOT / 'data/processed/races.parquet')
    drivers = pd.read_parquet(ROOT / 'data/processed/drivers.parquet')
    cars = pd.read_parquet(ROOT / 'ml/reports/scorecard/both_cars.parquet')
    markets = {'win': kalshi_vectors('KXF1RACE', races, drivers, cars, podium=False),
               'podium': kalshi_vectors('KXF1RACEPODIUM', races, drivers, cars, podium=True)}
    results = []
    for kind, vectors in markets.items():
        for stage in STAGES:
            items = race_items(vectors, cars, stage, kind)
            if not items:
                continue
            rows = walk_forward(items, stage, kind)
            results.extend(summaries(rows, kind, stage))
            rows.to_csv(OUT / f'rows_{kind}_{stage}.csv', index=False)
    table = pd.DataFrame(results)
    table.to_csv(OUT / 'pool_scores.csv', index=False)
    pd.set_option('display.width', 250)
    print(table.round(4).to_string(index=False))


def race_items(vectors, cars, stage, kind):
    column = 'pWin' if kind == 'win' else 'pPodium'
    items = []
    for (race_id, vector_stage), vector in vectors.items():
        if vector_stage != stage:
            continue
        group = cars[(cars.raceId == race_id) & (cars.stage == stage)]
        if group.empty:
            continue
        market = np.array([vector.get(d, 0.002) for d in group.driverId])
        items.append({'raceId': race_id, 'season': int(group.season.iloc[0]),
                      'ours': group[column].to_numpy(dtype=float), 'market': market,
                      'actual': group.actual.to_numpy(dtype=float)})
    return items


def walk_forward(items, stage, kind):
    rows = []
    for season in sorted({i['season'] for i in items}):
        history = [i for i in items if i['season'] < season]
        weight = fit_weight(history, kind) if history else OURS_WEIGHT[stage]
        for item in (i for i in items if i['season'] == season):
            pooled = pool(item['ours'], item['market'], weight, kind)
            rows.append({'raceId': item['raceId'], 'season': season, 'weight': weight,
                         'ours': loss(item['ours'], item['actual'], kind),
                         'market': loss(item['market'], item['actual'], kind),
                         'pooled': loss(pooled, item['actual'], kind)})
    return pd.DataFrame(rows)


def summaries(rows, kind, stage):
    rng = np.random.default_rng(SEED)
    draws = rng.integers(0, len(rows), size=(4000, len(rows)))
    out = []
    for other in ('ours', 'market'):
        diff = (rows['pooled'] - rows[other]).to_numpy()
        low, high = np.percentile(diff[draws].mean(axis=1), [2.5, 97.5])
        out.append({'target': kind, 'stage': stage, 'vs': other, 'races': len(rows),
                    'weights': ','.join(f'{s}:{w}' for s, w in rows.groupby('season').weight.first().items()),
                    'pooledMean': rows['pooled'].mean(), 'otherMean': rows[other].mean(),
                    'diffLow': low, 'diffHigh': high})
    return out


def fit_weight(history, kind):
    losses = [np.mean([loss(pool(i['ours'], i['market'], w, kind), i['actual'], kind) for i in history])
              for w in GRID]
    return float(GRID[int(np.argmin(losses))])


def pool(ours, market, weight, kind):
    total = 1.0 if kind == 'win' else 3.0
    p = np.clip(ours, 1e-6, 1)
    m = np.clip(market, 1e-6, 1)
    pooled = np.exp(weight * np.log(p) + (1 - weight) * np.log(m))
    for _ in range(20):
        pooled = np.clip(pooled * total / pooled.sum(), 0.001, 0.999)
    return pooled


def loss(p, actual, kind):
    if kind == 'win':
        winner = actual == 1
        clipped = np.clip(p / p.sum(), 1e-6, 1 - 1e-6)
        return float(-np.log(clipped[winner]).sum())
    return binary_log_loss(p, actual <= 3)


if __name__ == '__main__':
    main()
