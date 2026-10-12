import json, glob, numpy as np, pandas as pd, sys
season = sys.argv[1] if len(sys.argv) > 1 else '2024'
rows = []
for path in sorted(glob.glob(f'../data/predictions/history/{season}-*.json')):
    d = json.load(open(path, encoding='utf-8'))
    if 'otherStages' not in d: continue
    act = {r['driverId']: r for r in d['actual']['results']}
    stages = {'post-qualifying': d['drivers']}
    for st, block in d['otherStages'].items(): stages[st] = block['drivers']
    for st, drivers in stages.items():
        fav = max(drivers, key=lambda x: x['pWin'])
        rows.append(dict(race=path[-12:-5], stage=st, maxp=fav['pWin'], favwon=act[fav['driverId']]['position']==1,
                         pwin_actual=next(x['pWin'] for x in drivers if act[x['driverId']]['position']==1)))
f = pd.DataFrame(rows)
pd.set_option("display.width",200); print(f.groupby('stage').agg(races=('race','nunique'), mean_max_pwin=('maxp','mean'), fav_win_rate=('favwon','mean'), mean_p_actual_winner=('pwin_actual','mean'), logloss=('pwin_actual', lambda s: -np.log(np.clip(s,1e-4,1)).mean())).to_string())
