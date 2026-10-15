import pandas as pd, numpy as np
from f1ml import data, fantasy
from f1ml.fantasy_rules import scoring
core=data.load_core(); sr=core["sprint_results"]; rr=core["results"]
rows=[]
for rid in sorted(sr.raceId.unique()):
    if rid<202400: continue
    ex=fantasy.fit_extras(rid); rules=scoring.rules_for(rid//100)
    s=sr[sr.raceId==rid][["driverId","grid","positionOrder","position"]]
    r=rr[rr.raceId==rid][["driverId","positionOrder"]].rename(columns={"positionOrder":"gp"})
    s=s.merge(r,on="driverId"); n=len(s)
    s=s.sort_values("gp"); s["gp"]=np.arange(1,n+1)  # GP order as an independent draw
    g=s.grid.where(s.grid>0,n).to_numpy(float); cl=s.position.notna().to_numpy()
    chg=fantasy._abs_change_by_race(pd.Series([rid]))[0]
    for lab,fin in (("real",s.positionOrder.to_numpy(float)),("indep",s.gp.to_numpy(float))):
        X=fantasy._overtake_design(g,fin,cl,n,chg); rate=ex.sprint_overtakes.predict(X)
        gl=np.where(cl,np.maximum(g-fin,-rules.sprint_lost_cap),0)
        rows.append(dict(raceId=rid,lab=lab,ot=rate.mean(),absd=np.abs(g-fin).mean(),gl=gl.mean(),
            ot_top=rate[g<=6].mean(),ot_back=rate[g>10].mean()))
d=pd.DataFrame(rows); d["season"]=d.raceId//100
print(d.groupby(["season","lab"])[["absd","ot","gl","ot_top","ot_back"]].mean().round(2))
