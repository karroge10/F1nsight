"""Score public benchmarks (Kalshi winner and podium, Polymarket winner) against our forecasts.

Same races, same stage timing, same scores as f1ml.scorecard. Reads only cached raw responses.
Run from ml: uv run python scripts/benchmark/collect_kalshi.py, then uv run python scripts/benchmark/score.py
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from collect_kalshi import ROOT, event_markets, get, match_race  # noqa: E402
from f1ml.scorecard import binary_log_loss  # noqa: E402

STAGES = ['pre-weekend', 'post-practice', 'post-qualifying']
RUNS = {'current': 'chain_bt_cars', 'previous': 'pub64_cars'}
OUT = ROOT / 'ml/reports/benchmark'
SEED = 20261015


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    races = pd.read_parquet(ROOT / 'data/processed/races.parquet')
    drivers = pd.read_parquet(ROOT / 'data/processed/drivers.parquet')
    runs = {name: pd.read_parquet(ROOT / f'ml/reports/scorecard/{file}.parquet') for name, file in RUNS.items()}
    kalshi_win = kalshi_vectors('KXF1RACE', races, drivers, runs['current'], podium=False)
    kalshi_podium = kalshi_vectors('KXF1RACEPODIUM', races, drivers, runs['current'], podium=True)
    poly_win = polymarket_vectors()
    sources = [('Kalshi', 'win', kalshi_win), ('Kalshi', 'podium', kalshi_podium), ('Polymarket', 'win', poly_win)]
    results = []
    for source, kind, vectors in sources:
        for stage in STAGES:
            for run_name, cars in runs.items():
                rows = paired_rows(vectors, cars, stage, kind)
                if rows.empty:
                    continue
                results.extend(summaries(rows, source, kind, stage, run_name))
    table = pd.DataFrame(results)
    table.to_csv(OUT / 'benchmark_scores.csv', index=False)
    coverage = {'kalshi_win': sorted(f'{r} {s}' for r, s in kalshi_win),
                'kalshi_podium': sorted(f'{r} {s}' for r, s in kalshi_podium)}
    (OUT / 'coverage.json').write_text(json.dumps(coverage, indent=1))
    pd.set_option('display.width', 250)
    print(table.round(4).to_string(index=False))


def kalshi_vectors(series, races, drivers, cars, podium):
    """{(raceId, stage): {driverId: probability}} from bid/ask midpoints at the stage cutoff."""
    codes = drivers.set_index('driverId')['code'].to_dict()
    events = get('/events', {'series_ticker': series, 'limit': 200})['events']
    vectors = {}
    for event in events:
        markets = event_markets(event['event_ticker'])
        race = match_race(event, markets, races)
        if race is None:
            continue
        race_ts = int(pd.Timestamp(race.raceUtc).timestamp())
        field = cars[(cars.raceId == race.raceId) & (cars.stage == 'pre-weekend')].driverId.tolist()
        if not field:
            continue
        by_code = {codes.get(d): d for d in field}
        histories = {}
        for market in markets:
            code = market['ticker'].split('-')[-1]
            driver = by_code.get(code) or match_name(market.get('yes_sub_title', ''), field, drivers)
            if driver is None:
                continue
            data = candles_cached(series, market['ticker'], race_ts)
            histories[driver] = data.get('candlesticks') or []
        for stage in STAGES:
            cutoff, lower = stage_window(race, stage)
            if cutoff is None:
                continue
            prices = {d: mid_at(h, lower, cutoff) for d, h in histories.items()}
            prices = {d: p for d, p in prices.items() if p is not None}
            target = 3.0 if podium else 1.0
            vector = complete(prices, field, target)
            if vector is not None:
                vectors[(int(race.raceId), stage)] = vector
    return vectors


def polymarket_vectors():
    """Reuse the earlier Polymarket winner extraction (same stage windows)."""
    path = ROOT / 'ml/reports/exp/market/matched_probabilities.json'
    vectors = {}
    for item in json.loads(path.read_text()):
        vectors[(item['raceId'], item['stage'])] = dict(zip(item['driverIds'], item['market']))
    return vectors


def paired_rows(vectors, cars, stage, kind):
    rows = []
    column = 'pWin' if kind == 'win' else 'pPodium'
    for (race_id, vector_stage), vector in vectors.items():
        if vector_stage != stage:
            continue
        group = cars[(cars.raceId == race_id) & (cars.stage == stage)]
        if group.empty:
            continue
        actual = group.actual.to_numpy(dtype=float)
        ours = group[column].to_numpy(dtype=float)
        market = np.array([vector.get(d, 0.002) for d in group.driverId])
        ours_scores = race_metrics(ours, actual, kind)
        market_scores = race_metrics(market, actual, kind)
        row = {'raceId': race_id, 'season': int(group.season.iloc[0])}
        row.update({f'ours_{k}': v for k, v in ours_scores.items()})
        row.update({f'market_{k}': v for k, v in market_scores.items()})
        rows.append(row)
    return pd.DataFrame(rows)


def race_metrics(p, actual, kind):
    if kind == 'win':
        winner = actual == 1
        clipped = np.clip(p / p.sum(), 1e-6, 1 - 1e-6)
        return {'logLoss': float(-np.log(clipped[winner]).sum()), 'favouriteWon': float(winner[np.argmax(p)])}
    podium = actual <= 3
    top3 = np.argsort(-p)[:3]
    return {'logLoss': binary_log_loss(p, podium), 'picksRight': float(podium[top3].sum())}


def summaries(rows, source, kind, stage, run_name):
    rng = np.random.default_rng(SEED)
    draws = rng.integers(0, len(rows), size=(4000, len(rows)))
    metrics = ['logLoss', 'favouriteWon'] if kind == 'win' else ['logLoss', 'picksRight']
    out = []
    for metric in metrics:
        ours = rows[f'ours_{metric}'].to_numpy()
        market = rows[f'market_{metric}'].to_numpy()
        diff = market - ours
        boot = diff[draws].mean(axis=1)
        low, high = np.percentile(boot, [2.5, 97.5])
        seasons = ','.join(str(s) for s in sorted(rows.season.unique()))
        out.append({'source': source, 'target': kind, 'stage': stage, 'ours': run_name, 'metric': metric,
                    'races': len(rows), 'oursMean': ours.mean(), 'marketMean': market.mean(),
                    'diffLow': low, 'diffHigh': high, 'seasons': seasons})
    return out


def candles_cached(series, ticker, race_ts):
    params = {'start_ts': race_ts - 8 * 86400, 'end_ts': race_ts, 'period_interval': 60}
    data = get(f'/historical/markets/{ticker}/candlesticks', params)
    if not data.get('candlesticks'):
        data = get(f'/series/{series}/markets/{ticker}/candlesticks', params)
    return data


def mid_at(history, lower, cutoff):
    """Bid/ask midpoint of the last hourly candle ending inside the stage window."""
    eligible = [c for c in history if lower <= c['end_period_ts'] <= cutoff]
    if not eligible:
        return None
    candle = max(eligible, key=lambda c: c['end_period_ts'])
    bid = to_float((candle.get('yes_bid') or {}).get('close'))
    ask = to_float((candle.get('yes_ask') or {}).get('close'))
    if bid is not None and ask is not None and ask > 0:
        return (bid + ask) / 2
    price = candle.get('price') or {}
    return to_float(price.get('close')) or to_float(price.get('previous'))


def complete(prices, field, total):
    """Scale midpoints to the target total over the field; unpriced drivers get a small floor."""
    priced = [d for d in field if d in prices]
    if not priced or len(priced) < len(field) - 4:
        return None
    raw = sum(prices[d] for d in priced)
    if not 0.7 * total <= raw <= 1.5 * total:
        return None
    vector = {d: prices.get(d, 0.005) for d in field}
    scale = total / sum(vector.values())
    return {d: float(np.clip(v * scale, 0.001, 0.999)) for d, v in vector.items()}


def match_name(text, field, drivers):
    names = drivers.set_index('driverId')['familyName'].to_dict()
    hits = [d for d in field if str(names.get(d, d)).lower() in text.lower()]
    return hits[0] if len(hits) == 1 else None


def to_float(value):
    return float(value) if value not in (None, '') else None


def stage_window(race, stage):
    """Same windows as scripts/exp_market/research.py stage_window."""
    def stamp(value):
        return None if pd.isna(value) else int(pd.Timestamp(value).timestamp())
    if stage == 'pre-weekend':
        cutoff = stamp(race.fp1Utc)
        lower = cutoff - 21600 if cutoff is not None else None
    elif stage == 'post-practice':
        practices = [v for v in (stamp(race.fp1Utc), stamp(race.fp2Utc), stamp(race.fp3Utc)) if v is not None]
        lower = max(practices) + 3600 if practices else None
        cutoff = stamp(race.qualifyingUtc)
        if cutoff is not None and lower is not None:
            cutoff = min(cutoff, lower + 1800)
    else:
        qualifying = stamp(race.qualifyingUtc)
        lower = qualifying + 7200 if qualifying is not None else None
        cutoff = lower + 3600 if lower is not None else None
        race_start = stamp(race.raceUtc)
        if cutoff is not None and race_start is not None:
            cutoff = min(cutoff, race_start)
    if cutoff is None or lower is None or cutoff <= lower:
        return None, None
    return cutoff, lower


if __name__ == '__main__':
    main()
