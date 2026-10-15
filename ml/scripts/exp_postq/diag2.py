import numpy as np, pandas as pd
import statsmodels.api as sm
c = pd.read_parquet('reports/scorecard/pub64_cars.parquet')
c = c[(c.stage=='post-qualifying') & (c.raceId < 202617) & c.classified.astype(bool)].copy()
f = pd.read_parquet('cache/features.parquet')
c = c.merge(f, on=['raceId','driverId'], how='left', suffixes=('','_f'))
g = c.groupby('raceId')
c['ar'] = g['actual'].rank(); c['pr'] = g['expectedPosition'].rank(); c['n']=g['actual'].transform('size')
c['ar']/=c.n; c['pr']/=c.n
c['grid_r'] = g['grid'].rank()/c.n
c['lr_r'] = c['lr_rank']/c['field']
c['lr_m_grid'] = c.lr_r - c.grid_r
c['fp_r'] = g['fp_best_gap'].rank()/c.n
c['fp_m_grid'] = c.fp_r - c.grid_r
c['gridxcorr'] = c.grid_r*c.c_grid_corr
for k in ['grid_r','lr_m_grid','fp_m_grid','lr_gap','lr_deg','q_tm_delta','gridxcorr','d_gain_e','dp_total','fp_vs_form','q_vs_form']:
    s = c[['ar','pr','season',k]].dropna()
    X = sm.add_constant(s[['pr',k]]); m = sm.OLS(s.ar, X).fit(cov_type='cluster', cov_kwds={'groups': c.loc[s.index,'raceId']})
    per = {}
    for y, h in s.groupby('season'):
        mm = sm.OLS(h.ar, sm.add_constant(h[['pr',k]])).fit(); per[y]=round(mm.params[k],3)
    print(f'{k:12s} n={len(s)} b_pr={m.params.pr:.3f} b={m.params[k]:+.4f} t={m.tvalues[k]:+.2f}', per)
