import pandas as pd
o=pd.read_parquet("scripts/exp_sprint/cond.parquet")
o["imp_ot"]=o.sprintPoints-(o.m_pos+o.m_gl+o.m_nc)
print(o.groupby("season")[["m_ot","imp_ot"]].mean().round(2))
print(o.groupby(["season",pd.cut(o.grid,[0,5,10,15,22])])[["m_ot","imp_ot"]].mean().round(2).unstack(0))
print(o.groupby("raceId")[["m_ot","imp_ot"]].mean().round(2).T.to_string())
