import json
from pathlib import Path


def main():
    root = Path(__file__).resolve().parents[2]
    output = root / 'reports/exp/market'
    path = output / 'summary.json'
    text = path.read_text(encoding='utf-8')
    summary = json.loads(text)
    verdicts = {}
    lines = ['# Historical market comparison', '', 'Source: public Polymarket Gamma and CLOB APIs. No trading, login, paid data or prohibited scraping.', '']
    coverage = summary['coverage']
    lines.append(f"Usable coverage: {coverage['usableRaces']} of {coverage['totalRaces']} races, {coverage['usableRaceStages']} of {coverage['totalRaceStages']} race-stage pairs.")
    lines.extend(['', '| Stage | Selection races | Ours win log loss | Market | Blend | Market minus ours 95% CI | Blend minus ours 95% CI |', '|---|---:|---:|---:|---:|---|---|'])
    for row in summary['comparison']:
        if row['metric'] != 'logLossWin':
            continue
        stage = row['stage']
        if row['races'] == 0:
            verdicts[stage] = 'insufficient coverage'
            continue
        market = row['marketMinusOurs']
        blend = row['blendMinusOurs']
        verdict = 'ours better' if market['ci_low'] > 0 else 'market better' if market['ci_high'] < 0 else 'inconclusive within sampling uncertainty'
        blend_verdict = 'blend improves win log loss' if blend['ci_high'] < 0 else 'blend worsens win log loss' if blend['ci_low'] > 0 else 'blend improvement unproven'
        verdicts[stage] = {'market': verdict, 'blend': blend_verdict}
        lines.append(f"| {stage} | {row['races']} | {row['ours']:.4f} | {row['market']:.4f} | {row['blend']:.4f} | [{market['ci_low']:.4f}, {market['ci_high']:.4f}] | [{blend['ci_low']:.4f}, {blend['ci_high']:.4f}] |")
    summary['stageVerdicts'] = verdicts
    summary['verdict'] = 'Stage-specific evidence; no production adoption under full-position accept rule'
    summary['reason'] = 'The paired win-only comparison is restricted to complete recovered market fields and stage windows. Stage verdicts follow paired 95% win-log-loss intervals, and an interval containing zero is inconclusive rather than evidence of equivalence. Logarithmic blend weights are fitted only on earlier selection races, with a ten-race warmup using ours alone. Coverage gaps, uniform allocation of explicit Other mass, and approximate session completion times limit generalisation. Archive prices prospectively; do not adopt a full forecast blend until position RPS and NLL pass the locked accept rule on a genuinely untouched holdout.'
    summary['reason'] += ' Post-practice Brier improves for both the market and blend with paired intervals below zero, so blending is promising for win calibration, although its win-log-loss benefit is unproven.'
    summary['normalization'] = 'Normalize raw named-driver prices plus explicit Other to sum to one. Split explicit Other mass equally among genuinely unlisted entrants, independently of our forecasts and the winner. Exclude a stage when any listed entrant lacks a fresh historical price. Preserve raw price sum and allocation membership in coverage.json. Other can include cancellation outcomes, so this is conditional on the race taking place.'
    summary['coverage']['bySeason'] = {}
    for season in [2024, 2025, 2026]:
        entries = [r for r in coverage['races'] if r['season'] == season]
        counts = {stage: sum(r['stages'][stage]['usable'] for r in entries) for stage in summary['coverage']['byStage']}
        summary['coverage']['bySeason'][str(season)] = counts
    summary['limitations'] = ['Discovery includes two Formula 1 tag catalogs, capped at 2000 closed events each, and candidate race slugs. Coverage is recovered coverage, not proof no other market exists.', 'Post-qualifying window is two to three hours after qualifying start; post-practice assumes a one-hour practice duration. Actual session end timestamps are not in races.parquet.', 'No contemporaneous historical bid/ask or depth is available in prices-history. Final cumulative volume and retrieval liquidity are descriptive only.', 'Brier is mean squared error across all entrants per race, then averaged across races, matching the project binary-win convention. Multiclass sum Brier is field size times this value.', 'Bootstrap uses 4000 race draws, seed 20261008; fixed fitted forecasts are resampled, without refitting the sequential blend in each bootstrap.', 'All-stage 2026 R17 numbers are descriptive holdout exposure, not a clean model-selection observation. Avoid claiming a clean remaining-season holdout for any race already examined.']
    summary['limitations'].append('When multiple main-race winner events match, choose the largest final-volume event. This retrospective venue-selection rule can bias comparison and must be frozen prospectively.')
    summary['timing'] = 'Pre-weekend: latest in six hours before FP1. Post-practice: latest in the first 30 minutes after scheduled final practice start plus one hour, strictly before qualifying. This avoids extra sprint information. Post-qualifying: latest two to three hours after qualifying start. Scheduled duration assumptions are required because actual end timestamps are absent.'
    usable = [stage for race in coverage['races'] for stage in race['stages'].values() if stage['usable']]
    sums = [stage['priceSum'] for stage in usable]
    summary['normalizationDiagnostics'] = {'otherAllocationRaceStages': sum(bool(stage['otherAllocatedDrivers']) for stage in usable), 'rawPriceSumMin': min(sums) if sums else None, 'rawPriceSumMax': max(sums) if sums else None}
    summary['fullDistributionPropagation'] = 'Fit adjusted Plackett-Luce driver strengths to reproduce blended win probabilities under the existing retirement, grid-bonus and temperature simulator. Then re-simulate the full distribution and validate RPS, order plus DNF NLL, podium, points and fantasy on the locked splits. This experiment does not implement that change.'
    rendered = json.dumps(summary, indent=2, allow_nan=False)
    path.write_text(rendered, encoding='utf-8')
    lines.extend(['', summary['reason'], '', '## Stage verdicts', ''])
    for stage, verdict in verdicts.items():
        lines.append(f'{stage}: {verdict}')
    lines.extend(['', '## Brier and top-pick accuracy', '', '| Stage | Metric | Ours | Market | Blend | Market minus ours 95% CI | Blend minus ours 95% CI |', '|---|---|---:|---:|---:|---|---|'])
    for row in summary['comparison']:
        if row['metric'] == 'logLossWin' or not row['races']:
            continue
        market = row['marketMinusOurs']
        blend = row['blendMinusOurs']
        lines.append(f"| {row['stage']} | {row['metric']} | {row['ours']:.5f} | {row['market']:.5f} | {row['blend']:.5f} | [{market['ci_low']:.5f}, {market['ci_high']:.5f}] | [{blend['ci_low']:.5f}, {blend['ci_high']:.5f}] |")
    summary['sourcesInvestigated'] = {'Polymarket': 'Used public metadata catalogs and explicit-window CLOB histories; all raw responses cached.', 'Kalshi': 'Public Sports series discovery was reachable and returned F1 race series. No Kalshi prices were used because Polymarket provided a usable benchmark. No claim is made that missing Polymarket races are unavailable elsewhere.'}
    summary['coverage']['mappingNotes'] = ['Chinese maps to China, Australian maps to Australia, Sao Paulo maps to Brazilian, and typo Brazlian maps to Brazilian.', 'Barcelona was checked against Spanish markets, but excluded when event end date did not match the race window.', 'The local name Bahrain Grand Prix in Malaysia maps to Bahrain on the same race date. This unusual local name should be reviewed before production use.', 'Require event endDate from one day before to fourteen days after local raceUtc, in addition to season and main-race title checks.']
    lines.extend(['', '## Limits and reproducibility', '', *summary['limitations'], '', summary['fullDistributionPropagation'], '', 'Run from ml: uv run python scripts/exp_market/research.py, then uv run python scripts/exp_market/report.py. Network responses are keyed by SHA256 of exact URL and reused from reports/exp/market/raw. No backtest is rerun.'])
    report = '\n'.join(lines) + '\n'
    (output / 'REPORT.md').write_text(report, encoding='utf-8')
    print(report)


if __name__ == '__main__':
    main()
