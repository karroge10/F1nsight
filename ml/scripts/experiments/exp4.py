import numpy as np, pandas as pd, warnings
warnings.filterwarnings('ignore')
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from scipy.special import logit, expit
from f1ml import gbm, train
f = pd.read_parquet('cache/features.parquet'); f=f[f.y_dnf.notna()]
params = train.load_params()['dnf']
def ll(p,y): p=np.clip(p,1e-4,1-1e-4); return -(y*np.log(p)+(1-y)*np.log(1-p)).mean()
LR = ['s_dnf_rate_logit','t_dnf_s','d_dnf_e','t_mech_e','d_acc_rate','d_q_e10','c_dnf_rate','t_qgap_e8']
def prep(d):
    X = d.copy(); X['s_dnf_rate_logit']=logit(X.s_dnf_rate.clip(0.01,0.6))
    X['t_dnf_s']=X.t_dnf_s.fillna(X.s_dnf_rate); X['d_dnf_e']=X.d_dnf_e.fillna(X.s_dnf_rate)
    X['t_mech_e']=X.t_mech_e.fillna(0.1); X['d_acc_rate']=X.d_acc_rate.fillna(0.1); X['d_q_e10']=X.d_q_e10.fillna(15)
    X['c_dnf_rate']=X.c_dnf_rate.fillna(X.s_dnf_rate); X['t_qgap_e8']=X.t_qgap_e8.fillna(2.5).clip(0,5)
    return X[LR].to_numpy()
for vs in [2024,2025,2026]:
    tr=f[(f.season<vs)&(f.season>=2006)]; te=f[f.season==vs]; y=te.y_dnf.to_numpy()
    out={'actual':round(y.mean(),3)}
    out['seasonrate']=ll(te.s_dnf_rate.to_numpy(),y)
    b=gbm.train_dnf(tr, gbm.DNF_COLUMNS, params); pg=gbm.predict(b,te,gbm.DNF_COLUMNS,margin=False); out['gbm']=ll(pg,y); out['gbm_mean']=pg.mean(); out['gbm_auc']=roc_auc_score(y,pg)
    w=gbm.recency_weights(tr.season.to_numpy(),0.85)
    lr=LogisticRegression(C=1.0, max_iter=1000).fit(prep(tr), tr.y_dnf, sample_weight=w); pl=lr.predict_proba(prep(te))[:,1]
    out['logit']=ll(pl,y); out['logit_mean']=pl.mean(); out['logit_auc']=roc_auc_score(y,pl)
    print(vs, {k:round(float(v),4) for k,v in out.items()})
    if vs==2026: print(dict(zip(LR, lr.coef_[0].round(3))))
