import numpy as np, pandas as pd, warnings
warnings.filterwarnings('ignore')
from scipy.special import logsumexp
from f1ml import plackett
WINDOWS = [30, 48, 72, 96, 144]
for stage in ['pre-weekend', 'post-qualifying']:
    o = pd.read_parquet(f'cache/oos_{stage}.parquet')
    races = np.sort(o.raceId.unique())
    by = {r: g for r, g in o.groupby('raceId')}
    rows = []
    cache = {}
    for i, r in enumerate(races):
        season = r // 100
        if season < 2019: continue
        g = by[r]; s = g.s.to_numpy(); fin = g.y_finish.to_numpy()
        for name in ['const30'] + [f'sched{w}' for w in WINDOWS]:
            w = 30 if name == 'const30' else int(name[5:])
            prev = races[max(0, i - w):i]
            groups = plackett.race_groups(o[o.raceId.isin(prev)], ['s'], 'y_finish')
            if name == 'const30':
                T1 = plackett.fit_temperature(groups)
            else:
                # refit every 4 races to save time
                key = (name, i // 4)
                if key not in cache: cache[key] = plackett.fit_schedule(groups)
                T1 = cache[key][0]
            z = s * T1; p = np.exp(z - logsumexp(z))
            win = fin == 1
            rows.append(dict(stage=stage, season=season, cal=name, ll=-np.log(max(p[win].sum(), 1e-6)),
                             maxp=p.max(), fav=float(win[np.argmax(p)]), brier=((p - win) ** 2).sum()))
    d = pd.DataFrame(rows)
    d['period'] = np.where(d.season <= 2023, 'select 2019-23', 'confirm 2024-26')
    print(stage)
    print(d.groupby(['period', 'cal'])[['ll', 'maxp', 'fav', 'brier']].mean().round(3).to_string())
