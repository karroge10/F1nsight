import pandas as pd
from f1ml import scorecard, weather
s = scorecard.race_scores("published")
w = weather.race_weather()
ff = pd.read_parquet("../data/processed/ff1_weather.parquet")
ffr = ff[ff.session.isin(["R","Race"])].groupby(["season","round"]).rainfall.mean().rename("ffRain").reset_index()
races = pd.read_parquet("../data/processed/races.parquet")[["raceId","season","round"]] if "raceId" in pd.read_parquet("../data/processed/races.parquet").columns else None
s = s.merge(w[["raceId","rain_actual","rain_fc1","rain_fc4"]], on="raceId", how="left")
s["round"] = s.raceId % 100
s = s.merge(ffr, on=["season","round"], how="left")
s["wet"] = (s.ffRain > 0.05) | (s.rain_actual >= 0.5)
print(s.drop_duplicates("raceId")[s.drop_duplicates("raceId").wet][["raceId","rain_actual","rain_fc1","ffRain"]])
print(s.groupby(["stage","wet"])[["rps","nll"]].agg(["mean","count"]).round(4))
for st,g in s.groupby("stage"):
    tot=g.rps.sum(); print(st, "wet share of RPS", round(g[g.wet].rps.sum()/tot,3), "nll", round(g[g.wet].nll.sum()/g.nll.sum(),3))
a = w[(w.raceId//100>=2014)&(w.raceId//100<=2023)]
print("wet races 2014-2023 ERA5>=0.5:", (a.rain_actual>=0.5).sum(), ">=1:", (a.rain_actual>=1).sum(), "of", len(a))
s["strong"] = s.ffRain > 0.25
print(s.groupby(["stage","strong"])[["rps","nll"]].mean().round(4), s[s.strong].raceId.nunique())
