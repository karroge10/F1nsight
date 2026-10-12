import numpy as np, pandas as pd, warnings
warnings.filterwarnings('ignore')
from scipy.special import logsumexp
from scipy.optimize import minimize_scalar
from f1ml import plackett
def win_nll(groups, T):
    return np.mean([-(T*s[0] - logsumexp(T*s)) for (s,) in groups])
for stage in ['pre-weekend', 'post-qualifying']:
    o = pd.read_parquet(f'cache/oos_{stage}.parquet')
    races = np.sort(o.raceId.unique()); by = {r: g for r, g in o.groupby('raceId')}
    rows = []; cache = {}
    for i, r in enumerate(races):
        season = r // 100
        if season < 2019: continue
        g = by[r]; s = g.s.to_numpy(); win = g.y_finish.to_numpy() == 1
        for name, w in [('sched96', 96), ('win24', 24), ('win48', 48), ('win96', 96)]:
            key = (name, i // 4)
            if key not in cache:
                groups = plackett.race_groups(o[o.raceId.isin(races[max(0, i - w):i])], ['s'], 'y_finish')
                if name.startswith('sched'):
                    cache[key] = plackett.fit_schedule(groups)[0]
                else:
                    cache[key] = np.exp(minimize_scalar(lambda x: win_nll(groups, np.exp(x)), bounds=(-4, 4), method='bounded').x)
            T1 = cache[key]; z = s * T1; p = np.exp(z - logsumexp(z))
            rows.append(dict(season=season, cal=name, ll=-np.log(max(p[win].sum(), 1e-6)), maxp=p.max(), fav=float(win[np.argmax(p)]), brier=((p - win) ** 2).sum(), T1=T1))
    d = pd.DataFrame(rows); d['period'] = np.where(d.season <= 2023, 'select 2019-23', 'confirm 2024-26')
    print(stage); print(d.groupby(['period', 'cal'])[['ll', 'maxp', 'fav', 'brier', 'T1']].mean().round(3).to_string())
    print(d[d.cal=='win48'].groupby('season')[['ll','maxp','fav','T1']].mean().round(3).to_string())
