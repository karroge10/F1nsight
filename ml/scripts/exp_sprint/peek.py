import pandas as pd
p=pd.read_parquet("reports/scorecard/published_fantasy.parquet"); print(p.columns.tolist()); print(p.head(3))
f=pd.read_parquet("../data/processed/fantasy_points.parquet"); print(f.columns.tolist()); print(f.head(2).T)
