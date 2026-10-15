import json, urllib.request, urllib.parse, datetime
def get(u, p):
    r = urllib.request.Request(u + '?' + urllib.parse.urlencode(p), headers={'User-Agent': 'Mozilla/5.0'})
    return json.load(urllib.request.urlopen(r, timeout=30))
for q in ['podium', 'pole winner']:
    ev = [e for off in range(0, 500, 100) for e in get('https://gamma-api.polymarket.com/events', {'tag_id': 435, 'limit': 100, 'offset': off, 'closed': 'true'}) if q in e['title'].lower()]
    ev.sort(key=lambda e: -float(e.get('volume') or 0))
    for e in ev[:3]:
        m = max(e['markets'], key=lambda m: float(m.get('volume') or 0))
        tid = json.loads(m['clobTokenIds'])[0]
        end = int(datetime.datetime.fromisoformat(e['endDate'].replace('Z', '+00:00')).timestamp())
        h = get('https://clob.polymarket.com/prices-history', {'market': tid, 'startTs': end - 86400 * 7, 'endTs': end, 'fidelity': 60}).get('history', [])
        print(e['title'][:45], len(e['markets']), 'mkts', int(float(e['volume'])), 'pts', len(h), h[:1], h[-1:] )
