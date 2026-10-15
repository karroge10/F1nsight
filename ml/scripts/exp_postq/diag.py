import numpy as np, pandas as pd
from scipy.stats import spearmanr
c = pd.read_parquet('reports/scorecard/pub64_cars.parquet')
c = c[(c.stage=='post-qualifying') & (c.raceId < 202617) & c.classified.astype(bool)].copy()
f = pd.read_parquet('cache/features.parquet')
c = c.merge(f, on=['raceId','driverId'], how='left')
c['res'] = c['actual'] - c['expectedPosition']   # + = finished worse than expected
c['res_r'] = c.groupby('raceId')['actual'].rank() - c.groupby('raceId')['expectedPosition'].rank()
print('n', len(c), 'mean res', c.res.mean().round(3))
cols = ['grid','q_gap','q_tm_delta','q_vs_form','lr_gap','lr_rank','lr_deg','fp_best_gap','fp_vs_form',
        'd_gain_e','d_circ_gain','c_grid_corr','c_street','c_abs_change','dp_total','t_qgap_e3','grid_pen','d_tm_fin_e']
c['lr_minus_grid'] = c['lr_rank'] - c.groupby('raceId')['grid'].rank()
c['grid_x_corr'] = c['grid'] * c['c_grid_corr']
for k in cols+['lr_minus_grid','grid_x_corr']:
    s = c[[k,'res_r']].dropna()
    if len(s)>50:
        r = spearmanr(s[k], s.res_r)
        print(f'{k:14s} n={len(s):4d} rho={r.statistic:+.3f} p={r.pvalue:.3f}  by season', 
              {y: round(spearmanr(g[k], g.res_r, nan_policy="omit").statistic,3) for y,g in c.groupby('season_x')})
print(c.groupby(pd.cut(c.grid,[0,1,3,6,10,15,22])).res.agg(['mean','count']).round(2))
c['lrbin']=pd.qcut(c.lr_minus_grid,5,duplicates='drop')
print(c.groupby('lrbin').res.agg(['mean','count']).round(2))
print(c.groupby('team').res.agg(['mean','count']).sort_values('mean').round(2))
