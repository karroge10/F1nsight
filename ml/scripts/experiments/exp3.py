import numpy as np, pandas as pd, warnings
warnings.filterwarnings('ignore')
from scipy.special import logsumexp
from f1ml import gbm, features as feat, plackett, train
f = pd.read_parquet('cache/features.parquet'); f=f[f.y_finish.notna()]
p = train.default_params()['rank']['default']
def win_ll(gt, a):
    tot=0
    for s, fin in gt:
        z=s*a; tot -= z[fin==1].sum() - logsumexp(z)
    return tot/len(gt)
def full_nll(groups, params):
    return -np.mean([plackett.loglik_schedule(s, plackett.schedule(params, len(s))) for (s,) in groups])
for stage in ['pre-weekend','post-qualifying']:
  for vs in [2022, 2023, 2024, 2025]:
    tr=feat.stage_frame(f[f.season<vs-1],stage); va=feat.stage_frame(f[f.season==vs-1],stage); te=feat.stage_frame(f[f.season==vs],stage)
    cols=feat.stage_columns(stage)
    b=gbm.train_ranker(tr, cols,'y_finish',p)
    va=va.assign(s=gbm.predict(b,va,cols)); te=te.assign(s=gbm.predict(b,te,cols))
    gv=plackett.race_groups(va,['s'],'y_finish'); gte=plackett.race_groups(te,['s'],'y_finish')
    gt=[(r.s.to_numpy(), r.y_finish.to_numpy()) for _,r in te.groupby('raceId')]
    T=plackett.fit_temperature(gv); sch=plackett.fit_schedule(gv)
    print(stage, vs, 'const T', round(T,2), 'win', round(win_ll(gt,T),3), 'full', round(full_nll(gte, np.array([T,T,1.0])),3), '| schedule', sch.round(2), 'win', round(win_ll(gt,sch[0]),3), 'full', round(full_nll(gte, sch),3))
