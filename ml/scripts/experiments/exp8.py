import numpy as np, pandas as pd, warnings
warnings.filterwarnings('ignore')
from scipy.special import logsumexp
from scipy.optimize import minimize
from f1ml import plackett
f = pd.read_parquet('cache/features.parquet')[['raceId','driverId','grid']]
o = pd.read_parquet('cache/oos_post-qualifying.parquet')
o = o.merge(f.drop_duplicates(['raceId','driverId']), left_index=False, right_index=False, how='left', on=None, left_on=None) if False else o
# re-attach grid by order (oos rows keep feature row order per race)
feats = pd.read_parquet('cache/features.parquet'); feats = feats[feats.y_finish.notna() & (feats.season >= 2012)]
o = o.reset_index(drop=True); feats = feats.reset_index(drop=True)
assert len(o) == len(feats) and (o.raceId.values == feats.raceId.values).all()
o['grid'] = feats.grid.values
races = np.sort(o.raceId.unique()); by = {r: g for r, g in o.groupby('raceId')}
def first_logits(g, T1, gamma):
    z = T1 * g.s.to_numpy(); grid = g.grid.fillna(30).to_numpy()
    for k, v in enumerate(gamma): z = z + v * (grid == k + 1)
    return z
def nll(params, gs):
    T1 = np.exp(params[0]); gamma = params[1:]
    tot = 0
    for g in gs:
        z = first_logits(g, T1, gamma); win = g.y_finish.to_numpy() == 1
        tot -= z[win].sum() - logsumexp(z)
    return tot / len(gs) + 0.05 * (gamma ** 2).sum()
rows = []
cache = {}
for i, r in enumerate(races):
    season = r // 100
    if season < 2019: continue
    prev = [by[x] for x in races[max(0, i - 48):i]]
    key = i // 4
    if key not in cache:
        a = minimize(lambda p: nll(np.r_[p[0], 0, 0, 0], prev), [1.0], method='Nelder-Mead').x
        b = minimize(lambda p: nll(p, prev), [1.0, 0, 0, 0], method='Nelder-Mead', options={'maxiter': 2000}).x
        cache[key] = (a, b)
    a, b = cache[key]; g = by[r]; win = g.y_finish.to_numpy() == 1; pole = g.grid.to_numpy() == 1
    for name, p in (('T1 only', np.r_[a[0], 0, 0, 0]), ('T1 + grid 1-3 bonus', b)):
        z = first_logits(g, np.exp(p[0]), p[1:]); pr = np.exp(z - logsumexp(z))
        rows.append(dict(season=season, cal=name, ll=-np.log(max(pr[win].sum(), 1e-6)), maxp=pr.max(), fav=float(win[np.argmax(pr)]),
                         pole_p=pr[pole].sum(), pole_won=float(win[pole].any()), brier=((pr - win) ** 2).sum(), g1=p[1]))
d = pd.DataFrame(rows); d['period'] = np.where(d.season <= 2023, 'select 2019-23', 'confirm 2024-26')
print(d.groupby(['period', 'cal'])[['ll', 'brier', 'maxp', 'fav', 'pole_p', 'pole_won', 'g1']].mean().round(3).to_string())
