import pandas as pd, numpy as np
from f1ml import data, fantasy
from f1ml.fantasy_rules import scoring
core=data.load_core(); sr=core["sprint_results"]
f=pd.read_parquet("../data/processed/fantasy_points.parquet"); f=f[f.kind=="driver"]
f["raceId"]=f.season*100+f["round"]
out=[]
for rid in sorted(sr.raceId.unique()):
    if rid<202400: continue
    a=f[f.raceId==rid]
    if a.empty: continue
    ex=fantasy.fit_extras(rid); rules=scoring.rules_for(rid//100)
    s=sr[sr.raceId==rid].copy(); n=len(s)
    g=s.grid.where(s.grid>0,n).to_numpy(float); fin=s.positionOrder.to_numpy(float); cl=s.position.notna().to_numpy()
    chg=fantasy._abs_change_by_race(pd.Series([rid]))[0]
    X=fantasy._overtake_design(g,fin,cl,n,chg)
    rate=ex.sprint_overtakes.predict(X) if ex.sprint_overtakes is not None else np.full(n,ex.sprint_overtake_mean)
    gained=np.where(cl,np.maximum(g-fin,-rules.sprint_lost_cap),0)
    s["m_ot"]=rate*rules.overtake; s["m_gl"]=gained; s["m_nc"]=np.where(cl,0,rules.sprint_nc)
    m=s.merge(a.drop(columns=["raceId"]),on="driverId")
    m["a_gl"]=m.s_gained.fillna(0)+m.s_lost.fillna(0)
    out.append(m[["raceId","driverId","grid","positionOrder","m_ot","s_overtakes","m_gl","a_gl","m_nc","s_nc","s_fastest_lap","s_position","sprintPoints"]])
o=pd.concat(out); o["season"]=o.raceId//100
print(o.groupby("season")[["m_ot","s_overtakes","m_gl","a_gl","m_nc","s_nc","s_fastest_lap"]].mean().round(2))
o["d_ot"]=o.m_ot-o.s_overtakes
print(o.groupby(pd.cut(o.grid,[0,5,10,15,22]))[["m_ot","s_overtakes","m_gl","a_gl"]].mean().round(2))
print(o.groupby("raceId")[["m_ot","s_overtakes"]].mean().round(2).T)
print("rules", rules.sprint_lost_cap, rules.sprint_nc, rules.overtake)
tab=fantasy._lookup(scoring.SPRINT_POINTS,22)
o["cl"]=o.m_nc==0
o["m_pos"]=np.where(o.cl, tab[o.positionOrder.astype(int)-1],0)
o["m_tot"]=o.m_pos+o.m_gl+o.m_nc+o.m_ot
o["res"]=o.m_tot-o.sprintPoints
print(o.groupby("season")[["m_tot","sprintPoints","res"]].mean().round(2))
print(o.groupby(["season",pd.cut(o.grid,[0,5,10,15,22])]).res.mean().unstack().round(2))
print(o.groupby(["season","cl"]).res.agg(["mean","count"]).round(2))
o.to_parquet("scripts/exp_sprint/cond.parquet")
