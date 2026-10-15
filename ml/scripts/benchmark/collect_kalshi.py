"""Collect Kalshi F1 race winner and podium market history (public read-only API, no login).

Writes raw JSON responses to data/raw/benchmarks/kalshi/, one file per request, reused on rerun.
Run from ml: uv run python scripts/benchmark/collect_kalshi.py
"""
import hashlib
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[3]
RAW = ROOT / 'data/raw/benchmarks/kalshi'
BASE = 'https://api.elections.kalshi.com/trade-api/v2'
SERIES = ['KXF1RACE', 'KXF1RACEPODIUM']


def main():
    RAW.mkdir(parents=True, exist_ok=True)
    races = pd.read_parquet(ROOT / 'data/processed/races.parquet')
    for series in SERIES:
        events = get('/events', {'series_ticker': series, 'limit': 200})['events']
        for event in events:
            markets = event_markets(event['event_ticker'])
            race = match_race(event, markets, races)
            if race is None:
                print('no race for', event['event_ticker'])
                continue
            race_ts = int(pd.Timestamp(race.raceUtc).timestamp())
            for market in markets:
                candles(series, market['ticker'], race_ts - 8 * 86400, race_ts)
            print(series, event['event_ticker'], race.raceId, len(markets))


def event_markets(event_ticker):
    live = get('/markets', {'event_ticker': event_ticker, 'limit': 100})['markets']
    if live:
        return live
    return get('/historical/markets', {'event_ticker': event_ticker, 'limit': 100})['markets']


def match_race(event, markets, races):
    """The race whose start is closest before the markets' close time (within 3 days)."""
    closes = [pd.Timestamp(m['close_time']).tz_localize(None) for m in markets if m.get('close_time')]
    if not closes:
        return None
    close = min(closes)
    gaps = (close - races.raceUtc).dt.total_seconds()
    near = races[(gaps > -86400 * 3) & (gaps < 86400 * 3)]
    if near.empty:
        return None
    return near.loc[(near.raceUtc - close).abs().idxmin()]


def candles(series, ticker, start, end):
    params = {'start_ts': start, 'end_ts': end, 'period_interval': 60}
    data = get(f'/historical/markets/{ticker}/candlesticks', params)
    if not data.get('candlesticks'):
        data = get(f'/series/{series}/markets/{ticker}/candlesticks', params)
    return data


def get(path, params):
    url = BASE + path + '?' + urllib.parse.urlencode(params)
    key = hashlib.sha256(url.encode()).hexdigest()[:24]
    file = RAW / f'{key}.json'
    if file.exists():
        return json.loads(file.read_text())['body']
    time.sleep(0.25)
    request = urllib.request.Request(url, headers={'User-Agent': 'F1nsight research'})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = json.load(response)
    except urllib.error.HTTPError as error:
        body = {'error': error.code}
    file.write_text(json.dumps({'url': url, 'body': body}))
    return body


if __name__ == '__main__':
    main()
