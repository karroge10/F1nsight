import pandas as pd, numpy as np
p=pd.read_parquet("reports/scorecard/published_fantasy.parquet"); p=p[p.stage=="lock"].dropna(subset=["actual"])
f=pd.read_parquet("../data/processed/fantasy_points.parquet")
sp=f.groupby(["season","round"]).sprintPoints.apply(lambda s:(s.abs()>0).any()).rename("sprint").reset_index()
sp["raceId"]=sp.season*100+sp["round"]
p=p.merge(sp[["raceId","sprint"]],on="raceId")
p["err"]=p.expected-p.actual
print(p.groupby(["season","kind","sprint"]).err.agg(["mean","count"]).round(2))
# per weekend bias spread on sprint weekends
w=p[p.sprint].groupby(["raceId","kind"]).err.mean().unstack().round(1); print(w)
# concentration: band by expected rank within weekend
p["rk"]=p.groupby(["raceId","kind"]).expected.rank(ascending=False)
p["band"]=pd.cut(p.rk,[0,3,6,10,15,20],labels=["1-3","4-6","7-10","11-15","16-20"])
d=p[p.kind=="driver"]
print(d.groupby(["sprint","band"]).err.mean().unstack(0).round(2))
c=p[p.kind=="constructor"]; c["band"]=pd.cut(c.rk,[0,2,4,7,10])
print(c.groupby(["sprint","band"]).err.mean().unstack(0).round(2))
# within-weekend demeaned
p["dm"]=p.err-p.groupby(["raceId","kind"]).err.transform("mean")
print("demeaned", p.groupby(["kind","sprint",p.rk.le(5)]).dm.mean().round(2))
