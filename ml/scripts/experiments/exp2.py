import numpy as np, pandas as pd, warnings
warnings.filterwarnings('ignore')
from scipy.optimize import minimize_scalar
from scipy.special import logsumexp
from f1ml import gbm, features as feat, plackett, train
f = pd.read_parquet('cache/features.parquet'); f=f[f.y_finish.notna()]
p = train.default_params()['rank']['default']
def topk_nll(groups, scale, k):
    tot=0
    for (s,) in groups:
        s=s*scale; run=np.logaddexp.accumulate(s[::-1])[::-1]
        tot -= (s-run)[:k].sum()
    return tot/len(groups)
def win_ll(groups_all, scale):
    # groups_all: (scores, finish) incl dnf; winner = finish==1
    tot=0
    for s, fin in groups_all:
        z=s*scale; tot -= z[fin==1].sum() - logsumexp(z)
    return tot/len(groups_all)
for stage in ['pre-weekend','post-qualifying']:
  for vs in [2022, 2023, 2024, 2025]:
    tr=feat.stage_frame(f[f.season<vs-1],stage); va=feat.stage_frame(f[f.season==vs-1],stage); te=feat.stage_frame(f[f.season==vs],stage)
    cols=feat.stage_columns(stage)
    b=gbm.train_ranker(tr, cols,'y_finish',p)
    va=va.assign(s=gbm.predict(b,va,cols)); te=te.assign(s=gbm.predict(b,te,cols))
    gv=plackett.race_groups(va,['s'],'y_finish')
    gt=[(r.s.to_numpy(), r.y_finish.to_numpy()) for _,r in te.groupby('raceId')]
    out=[]
    for k in [3, 6, 30]:
        sc=minimize_scalar(lambda x: topk_nll(gv, np.exp(x), k), bounds=(-5,4), method='bounded').x
        out.append((k, round(np.exp(sc),2), round(win_ll(gt, np.exp(sc)),3)))
    best=minimize_scalar(lambda x: win_ll(gt, np.exp(x)), bounds=(-5,4), method='bounded').x
    print(stage, vs, out, 'oracle', round(np.exp(best),2), round(win_ll(gt,np.exp(best)),3))
