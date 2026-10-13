import hashlib
import json
import subprocess
import time
import unicodedata
from pathlib import Path
from urllib.parse import urlencode

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'reports/exp/market'
RAW = OUT / 'raw'
STAGES = ['pre-weekend', 'post-practice', 'post-qualifying']


def main():
    RAW.mkdir(parents=True, exist_ok=True)
    cars = pd.read_parquet(ROOT / 'reports/scorecard/exp_bestcar_cars.parquet')
    races = pd.read_parquet(ROOT.parent / 'data/processed/races.parquet')
    drivers = pd.read_parquet(ROOT.parent / 'data/processed/drivers.parquet')
    ids = cars.raceId.unique()
    races = races[races.raceId.isin(ids)].sort_values('raceUtc')
    names = drivers.set_index('driverId').fullName.to_dict()
    catalog = []
    for tag in [435, 100389]:
        for offset in range(0, 2000, 100):
            response = fetch('https://gamma-api.polymarket.com/events', {'tag_id': tag, 'limit': 100, 'offset': offset, 'closed': 'true'})
            data = response.get('data') or []
            if not isinstance(data, list):
                break
            catalog.extend(data)
            if len(data) < 100:
                break
    audit = []
    samples = []
    for race in races.itertuples():
        base = race.raceName.lower().replace(' ', '-')
        date = str(race.date)[:10]
        slugs = ['f1-' + base + '-winner', base + '-winner', 'f1-' + base + '-winner-' + date]
        if 'brazilian' in base:
            slugs.append('brazlian-grand-prix-winner')
        if 'azerbaijan' in base:
            slugs.append('azerbijan-grand-prix-winner')
        events = []
        for event in catalog:
            title_text = event.get('title', '')
            title = normalize(title_text)
            race_name = normalize(race.raceName)
            race_name = race_name.replace('sao paulo', 'brazilian').replace('chinese', 'china').replace('australian', 'australia')
            race_name = race_name.replace('barcelona grand prix', 'spanish grand prix').replace('bahrain grand prix in malaysia', 'bahrain grand prix').replace('mexico city', 'mexican')
            title = title.replace('brazlian', 'brazilian').replace('chinese', 'china').replace('australian', 'australia')
            title = title.replace('mexico city', 'mexican')
            excluded = any(word in title for word in ['sprint', 'pole', 'qualifying'])
            if race_name in title and 'winner' in title and not excluded:
                events.append(event)
        for slug in slugs:
            response = fetch('https://gamma-api.polymarket.com/events', {'slug': slug})
            data = response.get('data', [])
            if isinstance(data, list):
                events.extend(data)
        valid = []
        for event in events:
            description = event.get('description', '')
            for market in event.get('markets', []):
                description += market.get('description', '')
            event_end_text = event.get('endDate')
            event_end = stamp(event_end_text)
            race_time = stamp(race.raceUtc)
            date_match = event_end is not None and race_time - 86400 <= event_end <= race_time + 14 * 86400
            if str(race.season) in description and date_match:
                valid.append(event)
        unique = {event['id']: event for event in valid}
        unique_events = unique.values()
        valid = list(unique_events)
        if valid:
            valid.sort(key=lambda event: float(event.get('volume') or 0), reverse=True)
            valid = valid[:1]
        entry = {'raceId': int(race.raceId), 'season': int(race.season), 'raceName': race.raceName, 'events': [], 'stages': {}}
        field = cars[cars.raceId == race.raceId].driverId.unique()
        histories = {}
        for event in valid:
            entry['events'].append({'id': event['id'], 'slug': event['slug'], 'volume': event.get('volume'), 'liquidity': event.get('liquidity'), 'note': 'retrieval-time totals, not stage-time liquidity'})
            for market in event.get('markets', []):
                label = market.get('groupItemTitle', '')
                question = market.get('question', '')
                driver = match_driver(label + ' ' + question, field, names)
                if driver is None and label.lower() == 'other':
                    driver = '__other__'
                if driver is None:
                    continue
                token_text = market.get('clobTokenIds', '[]')
                outcome_text = market.get('outcomes', '[]')
                tokens = decode(token_text)
                outcomes = decode(outcome_text)
                if 'Yes' not in outcomes:
                    continue
                index = outcomes.index('Yes')
                token = tokens[index]
                race_stamp = stamp(race.raceUtc)
                params = {'market': token, 'startTs': race_stamp - 86400 * 7, 'endTs': race_stamp, 'fidelity': 5}
                response = fetch('https://clob.polymarket.com/prices-history', params)
                data = response.get('data') or {}
                history = data.get('history', [])
                histories[driver] = history
        for stage in STAGES:
            cutoff, lower = stage_window(race, stage)
            prices = {}
            stamps = {}
            if cutoff is not None:
                for driver, history in histories.items():
                    eligible = [point for point in history if lower <= point['t'] < cutoff]
                    if eligible:
                        point = max(eligible, key=lambda item: item['t'])
                        prices[driver] = float(point['p'])
                        stamps[driver] = point['t']
            other = prices.pop('__other__', None)
            missing = [driver for driver in field if driver not in prices]
            unlisted = [driver for driver in missing if driver not in histories]
            if other is not None and len(unlisted) == len(missing) and missing:
                for driver in missing:
                    prices[driver] = other / len(missing)
            raw_prices = prices.values()
            price_sum = sum(raw_prices)
            usable = len(prices) == len(field) and price_sum > 0
            entry['stages'][stage] = {'usable': usable, 'pricedDrivers': len(prices), 'fieldDrivers': len(field), 'otherMass': other, 'otherAllocatedDrivers': unlisted if other is not None else [], 'cutoff': cutoff, 'windowStart': lower, 'priceSum': price_sum, 'timestamps': stamps, 'reason': 'complete field' if usable else 'no complete fresh pre-cutoff history'}
            if usable:
                group = cars[(cars.raceId == race.raceId) & (cars.stage == stage)]
                p = group.pWin.to_numpy(dtype=float)
                q = np.array([prices[driver] for driver in group.driverId])
                q = q / q.sum()
                y = group.actual.to_numpy() == 1
                samples.append({'raceId': int(race.raceId), 'season': int(race.season), 'stage': stage, 'driverIds': group.driverId.tolist(), 'p': p, 'q': q, 'y': y})
        audit.append(entry)
        event_count = len(valid)
        driver_count = len(histories)
        point_counts = [len(h) for h in histories.values()]
        point_count = sum(point_counts)
        print(race.raceId, event_count, driver_count, point_count, flush=True)
    summary = analyze(samples, audit, cars)
    write_json(OUT / 'coverage.json', audit)
    write_json(OUT / 'summary.json', summary)
    matched = []
    for sample in samples:
        matched.append({'raceId': sample['raceId'], 'season': sample['season'], 'stage': sample['stage'], 'driverIds': sample['driverIds'], 'ours': sample['p'].tolist(), 'market': sample['q'].tolist(), 'winner': sample['y'].tolist()})
    write_json(OUT / 'matched_probabilities.json', matched)


def fetch(base, params):
    query = urlencode(params)
    url = base + '?' + query
    encoded_url = url.encode()
    hashed_url = hashlib.sha256(encoded_url)
    digest = hashed_url.hexdigest()
    path = RAW / (digest + '.json')
    if path.exists():
        text = path.read_text(encoding='utf-8')
        return json.loads(text)
    command = ['curl.exe', '-sS', '--max-time', '35', '-w', '\n%{http_code}', url]
    result = subprocess.run(command, capture_output=True, text=True, encoding='utf-8')
    body, separator, status = result.stdout.rpartition('\n')
    try:
        data = json.loads(body)
    except ValueError:
        data = None
    record = {'url': url, 'retrievedAtUtc': pd.Timestamp.now(tz='UTC').isoformat(), 'status': status, 'data': data, 'body': body if data is None else None, 'stderr': result.stderr}
    write_json(path, record)
    time.sleep(0.15)
    return record


def decode(value):
    if isinstance(value, str):
        return json.loads(value)
    return value


def match_driver(text, field, names):
    text = normalize(text)
    matches = []
    for driver in field:
        name = names.get(driver, driver)
        name = normalize(name)
        surname = name.split()[-1]
        if surname in text or name in text:
            matches.append(driver)
    if len(matches) == 1:
        return matches[0]
    return None


def normalize(text):
    text = unicodedata.normalize('NFKD', text)
    text = text.encode('ascii', 'ignore').decode('ascii')
    return text.lower()


def stamp(value):
    if pd.isna(value):
        return None
    timestamp = pd.Timestamp(value)
    seconds = timestamp.timestamp()
    return int(seconds)


def stage_window(race, stage):
    if stage == 'pre-weekend':
        cutoff = stamp(race.fp1Utc)
        lower = cutoff - 21600 if cutoff is not None else None
    elif stage == 'post-practice':
        practices = [stamp(race.fp1Utc), stamp(race.fp2Utc), stamp(race.fp3Utc)]
        practices = [value for value in practices if value is not None]
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


def scores(p, y):
    clipped = np.clip(p, 1e-6, 1 - 1e-6)
    loss = -np.log(clipped[y]).sum()
    brier = ((p - y) ** 2).mean()
    hit = float(y[p.argmax()])
    return {'logLossWin': float(loss), 'brierWin': float(brier), 'winnerHitRate': hit}


def analyze(samples, audit, cars):
    summary = {'source': 'Polymarket Gamma and CLOB public APIs', 'sourceDocumentation': ['https://docs.polymarket.com/api-reference/markets/get-prices-history'], 'coverage': {'totalRaces': len(audit), 'totalRaceStages': len(audit) * 3, 'usableRaces': len({s['raceId'] for s in samples}), 'usableRaceStages': len(samples), 'byStage': {}, 'races': audit}, 'comparison': [], 'bySeason': {}, 'perRace': [], 'reliability': {}, 'blendWeights': [], 'verdict': 'insufficient historical coverage', 'reason': 'No complete stage-matched field was recovered. Market superiority and blend improvement cannot be estimated; missing evidence is not equality. Archive public market prices prospectively before adopting a blend.', 'normalization': 'Require a fresh price for every named entrant. Divide by the raw field sum and retain that sum as overround. Do not fabricate missing driver prices or use resolved prices. Other mass can be split uniformly among genuinely unlisted entrants only if an explicit Other token has fresh history; this run excludes incomplete fields.', 'timing': 'Pre-weekend uses latest price in six hours before FP1; post-practice uses latest price after final practice start plus one hour and before qualifying; post-qualifying uses latest price two to three hours after qualifying start. Session ends are unavailable, so conservative scheduled-duration assumptions apply. Never use future samples.', 'protocol': 'Selection excludes 2026 round 17 onward; holdout is descriptive only. Win-only results cannot satisfy the full-position RPS/NLL acceptance rule.'}
    rng = np.random.default_rng(20261008)
    for stage in STAGES:
        rows = [s for s in samples if s['stage'] == stage]
        summary['coverage']['byStage'][stage] = len(rows)
        prior = []
        for row in rows:
            weights = np.linspace(0, 1, 101)
            best = 1.0
            if len(prior) >= 10:
                losses = []
                for weight in weights:
                    values = [pool(s['p'], s['q'], weight) for s in prior]
                    loss = [scores(value, s['y'])['logLossWin'] for value, s in zip(values, prior)]
                    average_loss = np.mean(loss)
                    losses.append(average_loss)
                best = float(weights[np.argmin(losses)])
            blend = pool(row['p'], row['q'], best)
            row['b'] = blend
            row['scores'] = {name: scores(row[key], row['y']) for name, key in [('ours', 'p'), ('market', 'q'), ('blend', 'b')]}
            summary['blendWeights'].append({'raceId': row['raceId'], 'stage': stage, 'oursWeight': best, 'trainingRaces': len(prior)})
            summary['perRace'].append({'raceId': row['raceId'], 'season': row['season'], 'stage': stage, 'split': 'holdout' if row['raceId'] >= 202617 else 'selection', 'oursLogLossWin': row['scores']['ours']['logLossWin'], 'marketLogLossWin': row['scores']['market']['logLossWin'], 'blendLogLossWin': row['scores']['blend']['logLossWin']})
            if row['raceId'] < 202617:
                prior.append(row)
        selection = [row for row in rows if row['raceId'] < 202617]
        comparison = compare(selection, stage, rng)
        summary['comparison'].extend(comparison)
        summary['bySeason'][stage] = {}
        for season in [2024, 2025, 2026]:
            subset = [row for row in selection if row['season'] == season]
            summary['bySeason'][stage][str(season)] = compare(subset, stage, rng)
        summary['reliability'][stage] = {name: reliability(selection, key) for name, key in [('ours', 'p'), ('market', 'q')]}
    if samples:
        summary['verdict'] = 'limited coverage, inspect paired intervals'
        summary['reason'] = 'Comparison is conditional on recovered complete fields, not all 65 races. Blend weights use only earlier selection races, with ours-only for the first ten. Reported win scores cannot establish full-position acceptance. Archive prices prospectively to improve coverage and preserve a clean holdout.'
    return summary


def pool(p, q, weight):
    p = np.maximum(p, 1e-6)
    q = np.maximum(q, 1e-6)
    values = p ** weight * q ** (1 - weight)
    return values / values.sum()


def compare(rows, stage, rng):
    output = []
    for metric in ['logLossWin', 'brierWin', 'winnerHitRate']:
        entry = {'stage': stage, 'metric': metric, 'races': len(rows), 'ours': None, 'market': None, 'blend': None, 'marketMinusOurs': None, 'blendMinusOurs': None}
        if rows:
            values = {name: np.array([row['scores'][name][metric] for row in rows]) for name in ['ours', 'market', 'blend']}
            for name, array in values.items():
                average = array.mean()
                entry[name] = float(average)
            count = len(rows)
            draws = rng.integers(0, count, size=(4000, count))
            for name in ['market', 'blend']:
                difference = values[name] - values['ours']
                boot = difference[draws].mean(axis=1)
                low, high = np.percentile(boot, [2.5, 97.5])
                average_difference = difference.mean()
                entry[name + 'MinusOurs'] = {'diff': float(average_difference), 'ci_low': float(low), 'ci_high': float(high)}
        output.append(entry)
    return output


def reliability(rows, key):
    bins = []
    for index in range(10):
        low = index / 10
        high = (index + 1) / 10
        predicted = []
        observed = []
        for row in rows:
            mask = (row[key] >= low) & (row[key] < high if index < 9 else row[key] <= high)
            predicted_values = row[key][mask].tolist()
            observed_values = row['y'][mask].tolist()
            predicted.extend(predicted_values)
            observed.extend(observed_values)
        count = len(predicted)
        predicted_average = np.mean(predicted) if count else None
        observed_average = np.mean(observed) if count else None
        mean = float(predicted_average) if count else None
        rate = float(observed_average) if count else None
        bins.append({'low': low, 'high': high, 'meanPredicted': mean, 'observedRate': rate, 'count': count})
    return bins


def write_json(path, value):
    text = json.dumps(value, indent=2, allow_nan=False)
    path.write_text(text, encoding='utf-8')


if __name__ == '__main__':
    main()
