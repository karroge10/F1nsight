import pandas as pd, numpy as np
for tag, suffix in [('before', '_before'), ('after', '')]:
    r = pd.read_parquet(f'reports/backtest_driver_rows{suffix}.parquet')
    print('=====', tag)
    for st in ['pre-weekend', 'post-qualifying']:
        x = r[r.stage == st].copy()
        x['bin'] = pd.cut(x.expectedPoints, [-1, 1, 3, 6, 10, 15, 20, 40])
        t = x.groupby('bin', observed=True).agg(n=('actualPoints', 'size'), predicted=('expectedPoints', 'mean'), actual=('actualPoints', 'mean')).round(2)
        print(st); print(t.T.to_string())
        # top 8 by predicted season total
        for season, g in x.groupby('season'):
            tot = g.groupby('driverId')[['expectedPoints', 'actualPoints']].sum()
            top = tot.sort_values('expectedPoints', ascending=False).head(8)
            print('  ', season, 'top8 by PREDICTED: expected/actual', round(top.expectedPoints.sum() / top.actualPoints.sum(), 3))
