import json, numpy as np, pandas as pd
for tag in ['before', 'after']:
    s = json.load(open(f'reports/backtest_summary{"_before" if tag=="before" else ""}.json'))
    rows = pd.read_parquet(f'reports/backtest_driver_rows{"_before" if tag=="before" else ""}.parquet')
    print('=====', tag)
    for st, v in s['stages'].items():
        print(st, {k: round(v[k], 4) for k in ['winnerCorrect','podiumHits','spearman','mae','brierWin','logLossWin','brierPodium','logLossPodium','maxPWin','pWinActualWinner','pDnfMean','dnfRate'] if k in v})
    for st in ['pre-weekend', 'post-qualifying']:
        r = rows[rows.stage == st]
        fav = r.loc[r.groupby('raceId').pWin.idxmax()]
        g = fav.groupby('season').agg(maxp=('pWin','mean'), favwon=('actual', lambda a: (a==1).mean()))
        print(st, 'favourite by season', g.round(3).to_dict('index'))
        print(st, 'ECE win/podium/points/dnf', [s['calibration'][st][k]['ece'] for k in ['win','podium','points','dnf']])
    for k, v in s['pointsBySeason'].items():
        if k.split(':')[0] in ('pre-weekend','post-qualifying'):
            print(k, v['top8ExpectedOverActual'], {d: (x['expected'], x['actual']) for d, x in list(v['drivers'].items())[:3]})
    if tag == 'after':
        print('bySeason post-q', {k: {m: round(x[m],3) for m in ['winnerCorrect','spearman','logLossWin']} for k, x in s['bySeason']['post-qualifying'].items()})
        print('bySeason pre', {k: {m: round(x[m],3) for m in ['winnerCorrect','spearman','logLossWin']} for k, x in s['bySeason']['pre-weekend'].items()})
        b = s['baselines']
        for n in ['grid', 'championship', 'form3']: print('baseline', n, {k: round(v, 4) for k, v in b[n].items()}, {k: round(v['spearman'],3) for k, v in b[n+'BySeason'].items()})
        print('components', s['components'])
        for k, v in s['fantasy'].items(): print('fantasy', k, v)
        print(json.dumps(s['calibration']['post-qualifying']['win']['bins']))
        print(json.dumps(s['calibration']['pre-weekend']['win']['bins']))
        print(json.dumps(s['calibration']['post-qualifying']['podium']['bins']))
