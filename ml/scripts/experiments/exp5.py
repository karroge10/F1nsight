import numpy as np, pandas as pd, warnings, json
warnings.filterwarnings('ignore')
from scipy.special import logsumexp
from f1ml import gbm, features as feat, plackett, train
f = pd.read_parquet('cache/features.parquet'); f = f[f.y_finish.notna()]
params = train.load_params()['rank']
ids = np.sort(f[f.season >= 2012].raceId.unique())
blocks = [ids[i:i+4] for i in range(0, len(ids), 4)]
out = {}
for stage in ['pre-weekend', 'post-qualifying']:
    cols = feat.stage_columns(stage); sp = params.get(stage, params['default']); parts = []
    for b in blocks:
        tr = feat.stage_frame(f[f.raceId < b.min()], stage); te = feat.stage_frame(f[f.raceId.isin(b)], stage)
        m = gbm.train_ranker(tr, cols, 'y_finish', sp)
        parts.append(te[['raceId', 'season', 'y_finish']].assign(s=gbm.predict(m, te, cols)))
    out[stage] = pd.concat(parts)
    out[stage].to_parquet(f'cache/oos_{stage}.parquet')
    print(stage, 'done', len(out[stage]))
