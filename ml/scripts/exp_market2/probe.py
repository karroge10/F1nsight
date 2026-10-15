import json, re, urllib.request, urllib.parse, collections
def get(u, p):
    r = urllib.request.Request(u + '?' + urllib.parse.urlencode(p), headers={'User-Agent': 'Mozilla/5.0'})
    return json.load(urllib.request.urlopen(r, timeout=30))
ev = []
for off in range(0, 3000, 100):
    d = get('https://gamma-api.polymarket.com/events', {'tag_id': 435, 'limit': 100, 'offset': off, 'closed': 'true'})
    ev += d
    if len(d) < 100: break
print('closed F1 events', len(ev))
kinds = collections.defaultdict(list)
for e in ev:
    t = e.get('title', '')
    tl = t.lower()
    k = ('podium' if 'podium' in tl else 'pole' if 'pole' in tl else 'qualif' if 'qualif' in tl else 'fastest lap' if 'fastest lap' in tl
         else 'h2h' if ' vs' in tl else 'top' if re.search(r'top \d', tl) else 'points' if 'points' in tl else 'constructor' if 'constructor' in tl
         else 'winner' if 'winner' in tl else 'other')
    yr = (e.get('endDate') or '')[:4]
    kinds[k].append((yr, float(e.get('volume') or 0), t, e.get('markets', [{}])[0].get('clobTokenIds')))
for k, v in kinds.items():
    by = collections.Counter(y for y, vol, *_ in v if vol >= 10000)
    print(k, len(v), 'vol>=10k by year', dict(by), '| ex:', v[0][2][:60])
import sys
for k in ['podium', 'pole', 'h2h', 'top', 'points']:
    big = sorted([x for x in kinds.get(k, [])], key=lambda x: -x[1])[:1]
    for yr, vol, t, tok in big:
        tid = json.loads(tok)[0]
        h = get('https://clob.polymarket.com/prices-history', {'market': tid, 'interval': 'max', 'fidelity': 60})
        print(k, t[:50], int(vol), 'history pts', len(h.get('history', [])))
