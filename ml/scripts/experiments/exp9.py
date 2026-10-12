import numpy as np, pandas as pd, warnings, torch
warnings.filterwarnings('ignore')
from f1ml import plackett, simulate
feats = pd.read_parquet('cache/features.parquet'); feats = feats[feats.y_finish.notna() & (feats.season >= 2012)].reset_index(drop=True)
PTS = np.zeros(30); PTS[:10] = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]
for stage in ['pre-weekend', 'post-qualifying']:
    o = pd.read_parquet(f'cache/oos_{stage}.parquet').reset_index(drop=True)
    o['cls'] = feats.y_classified.values; o['fin_cls'] = o.y_finish.where(o.cls == 1)
    races = np.sort(o.raceId.unique()); by = {r: g for r, g in o.groupby('raceId')}
    res = []
    cache = {}
    for i, r in enumerate(races):
        if r // 100 < 2019: continue
        g = by[r]; g = g[g.cls == 1]
        for variant, col in (('all cars', 'y_finish'), ('finishers only', 'fin_cls')):
            key = (variant, i // 6)
            if key not in cache:
                w = o[o.raceId.isin(races[max(0, i - 96):i])]
                sched = plackett.fit_schedule(plackett.race_groups(w, ['s'], col))
                w48 = o[o.raceId.isin(races[max(0, i - 48):i])]
                sched[0] = plackett.fit_first_pick(plackett.race_groups(w48, ['s'], col))
                cache[key] = sched
            sched = cache[key]
            strength = torch.as_tensor(g.s.to_numpy(), dtype=torch.float32, device='cuda').expand(3000, len(g))
            gen = torch.Generator(device='cuda'); gen.manual_seed(int(r))
            pos = simulate.sample_order(strength, sched, None, gen).cpu().numpy()
            exp_pts = PTS[pos - 1].mean(0); act = PTS[g.y_finish.rank(method='first').astype(int).to_numpy() - 1]
            for e, a in zip(exp_pts, act):
                res.append(dict(variant=variant, period='select' if r // 100 <= 2023 else 'confirm', e=e, a=a, b=sched[1]))
    d = pd.DataFrame(res); d['bin'] = pd.cut(d.e, [-1, 1, 3, 6, 10, 15, 20, 40])
    print(stage)
    print(d.groupby(['period', 'variant', 'bin'], observed=True).agg(n=('a', 'size'), pred=('e', 'mean'), act=('a', 'mean')).round(2).unstack('bin').to_string())
    print(d.groupby(['period', 'variant']).b.mean().round(3).to_string())
