# Fantasy strategy and model work: what was tried, what it showed

Written 2026-10-15 after a two-day push (2026-10-14 and 15) to close the gap to the 2026 global
leader. Read this before starting any new fantasy strategy or forecast experiment, so the same
steps are not repeated. Detailed per-run logs: `research/fantasy-backtest/experiments.md`
and its `README.md` (scratch is gitignored; the harness moves to a tracked place when the page
ships, see "Where things live").

## Bottom line

- Current site method (fixed, pinned as `SITE_POLICY` in `run.ts`): calibrated blend of the model's
  `fantasyAtLock` forecast and form (0.5 x last 3 + 0.5 x season mean), blend weights fitted on
  earlier seasons only, expected-points objective, transfer threshold 0, chips by engine advice
  (Wildcard, Limitless, x3 Boost, Autopilot). Rules: 2 free transfers every race, no carry-over
  (owner's statement), -10 per extra transfer.
- Single-run totals on the site: 4737 (2024), 5140 (2025), 4634 (2026, R1-17).
- Robust means (200 perturbed runs, 3% forecast noise): about 4813 / 5102 / 4175, spread p10 to p90
  roughly +-180 to +-230. Single runs can sit near the 90th percentile; quote means, not single runs.
- 2026 global leader: 4994 points after R17 (owner, 2026-10-14). We are about 84% on the robust
  mean, 93% on the lucky single run.
- Strategy tuning has hit the noise floor with 2 to 3 seasons of data. Real gains now need a
  better forecast or more seasons to fit on.

## Evaluation protocol (keep using it)

1. No leakage: decisions use only `fantasyAtLock` (post-practice, pre-qualifying, model trained on
   earlier races only), prices before the round, past results. Final Fix may use post-qualifying
   information only.
2. Walk-forward fitting: 2025 settings from 2024 only, 2026 from 2024 and 2025; 2024 uses priors
   declared in writing first. Choosing between methods is fitting too.
3. Declare the hypothesis and the keep rule before running. Log every variant, failures included.
4. Never judge by a single season total. One different early transfer changes the whole season
   (near-identical forecasts gave totals 850 points apart).
5. Use the robust test in `evaluate.ts`: N perturbed runs per season with common random numbers
   (paired), plus B rebuilds of the history with different simulation seeds, so the significance
   covers rebuild drift. Combined SE = SD of per-build paired means / sqrt(B), Student t with B-1
   degrees of freedom. At B = 8, N = 100 it detects about 50 points in 2026. About 35 minutes.
6. Keep rule used for forecast changes: driver lock MAE or calibration slope better in at least 2
   of 3 seasons, and no season significantly worse in the robust test.

Noise reference (2026-10-15): within-build SE 6 / 20 / 22 points, between-build SD 0 / 15 / 56
(2024 / 2025 / 2026). Builds with the same seed were not bit-identical because
`fantasy._draw_overtakes` used torch's global RNG (fixed 2026-10-15: between-build SD now 0 / 0 / 48).

## Tried and rejected (do not repeat without a new reason)

| idea | result | why rejected |
|---|---|---|
| Value-of-money objective (points + lambda x expected team value change, lambda per race remaining) | 2025 -713, 2026 +51 vs site method | budget-to-points rate flips sign between seasons (+3.9 pts per $M per race in 2024, -2.3 in 2025) |
| Same with 2-race price lookahead, season-replay lambda, per-race budget slope | all lost 2025 heavily | same instability |
| Value objective as a plain switch | 2026 +306, 2025 -91 | walk-forward choice rejects it |
| Hybrid: form picks transfers, model picks Boost and chips | +15 over 2025+2026 | inside noise |
| Momentum term | +46 over 2025+2026 | inside noise, fitting score flips sign between seasons |
| Small value lambda (season-total fit) | -48 | noise |
| Stacked forecast (model, form, recent 3, momentum, sprint terms) | -382 | never lower error than the current blend |
| Upside (p90) Boost choice | no change | teams are one star plus cheap drivers, the Boost choice is never close |
| Fixed chip schedules declared in advance (Limitless or x3 on sprints, Wildcard R2) | 0 or worse | engine chip advice matched or beat them every season |
| All six chips instead of four (Final Fix, No Negative added) | 4749 / 5285 / 4190 vs 4802 / 5306 / 4191 | no gain; No Negative is advised only when forced late |
| 3-race plan instead of 1-race | equal in 2024, small loss after | 2024 lock files carry no price change, so the horizon has nothing to act on |
| Multi-start fitting (restart from the site team at every round of a past season) | criterion flips sign between seasons | no signal |
| FastF1 long-run pace "completion" | data was already complete (61 to 89% of rows per season had long runs); report text saying 24% was stale | only fixed a leak (see below), no accuracy gain |
| Faster overtake adaptation for 2026 (season factor, current season x3) | 2025 -50 / -30, 2026 -21 / -28 (significant losses) | the 2026 overtake window was already unbiased (+0.07 pts per driver) |
| Sharpness k beyond 1.5, one k or per kind (k up to 2.5) | 2026 up, 2025 significantly down, driver MAE not better | fails the keep rule |
| Sharpness k per forecast stage (pre-weekend, post-practice, post-qualifying, lock) | no stage better in both 2025 and 2026 | overshoots in 2025 (slope 0.84 to 0.91) |
| Fantasy strength sharpening D (fantasy simulation strengths x 1.5 from 2025, walk-forward; published 2026-10-14, reverted 2026-10-15) | driver lock MAE 10.15 / 11.56 to 10.10 / 11.41; combined test, 8 reproducible builds, N = 100: 2024 0, 2025 -18.8 (SE 6.8, t -2.74), 2026 +41.4 (SE 18.6, t 2.23, crit 2.36) | significantly worse in 2025, breaks the declared keep rule |

## Kept

| change | evidence |
|---|---|
| Seeded overtake draws: `fantasy._draw_overtakes` uses the scoring generator, not torch's global RNG | same-seed builds byte-identical, `ml/tests/test_fantasy_seed.py`; between-build SD 2025 15 to 0, 2026 56 to 48 |
| `backtest.ts`: duplicate-id assets (two 2026 Lawson rows) priced from the active copy | bug fix, test |
| Rules: 2 free transfers always, carry-over 0 (`RULES_2026`, `data/raw/fantasy/rules_2026.json`) | owner's rule |
| Long-run features: drop practice held after qualifying (2021 and 2022 sprint weekends leaked FP2), fall back to another pre-qualifying session, scaled | leak fix, `ml/tests/test_long_runs.py`; neutral on accuracy |
| Pinned `SITE_POLICY` in `run.ts` | before, `run.ts` re-fitted objective and threshold from one noisy replay, which flipped the published method (4437 vs 4634 for 2026) |

## Diagnosis facts worth remembering

- The model forecast beats form on per-asset error and rank correlation every season. Form wins
  season totals mainly through team value: it chases assets whose price rises (end of 2025:
  form 137.5M vs model 118.8M before the blend).
- In 2026 almost all of form's lead came from two rounds: R2 (its Limitless scored 474 vs our 313)
  and R13 (381 vs 192).
- Forecasts are under-dispersed (driver SD 8 to 9 vs actual 16 to 19; 2026 slope 1.3). Cause: the
  strength model is too flat, not missing overtake points.
- Rows with negative actual points (DNF, bad races) carry MAE about 25 and near-zero correlation:
  mostly unpredictable per car.
- Sprint weekends: model bias +2 to +3 points.
- Price step accuracy at the lock: 50% drivers, 73% constructors.

## Data facts

- World rank: F1 does not publish winner totals or rank cutoffs for 2024 or 2025. Known: field
  over 2 million teams (2023, 2024), over 2.7 million (2025); 2022 winner 4,766 (different game
  version, context only). Add real cutoffs to `WORLD_RANK_ANCHORS` in `run.ts` if found.
- "Average player" reference = ownership-weighted points (selectedPct from
  `data/processed/fantasy_prices.parquet`, 2024 and 2025 from the community dataset
  mzafram2001/f1-fantasy, 2026 official), drivers scaled to 5 picks, constructors to 2, plus the
  most-owned driver once for the Boost. Our margin: +1734 / +2288 / +1680.
- All six chips existed in 2024, 2025 and 2026 (x3 Boost was called Extra DRS in 2024). No Negative
  is scored per item only in 2026 (official breakdown); 2024 and 2025 are a lower bound.
- 2024 game used a transfer-driven price rule; expected price changes for 2024 are a shrunk rule.

## Where things live

- Season backtest and robust evaluation: `research/fantasy-backtest/` (`run.ts`,
  `evaluate.ts`, `export_*.py`, `experiments.md`). Gitignored scratch: move into a tracked place
  when the fantasy page ships.
- Dispersion experiments: `ml/scripts/exp_dispersion/` (`cache.py`, `variants.py`, `round2.py`,
  `build.py`, `stages.py`); stage caches in `ml/reports/exp_dispersion/inputs_stages/`.
- Site data: `site/src/lib/data/fixtures/fantasy/backtest.json` (regenerated by `run.ts`; the dev
  server caches fixture JSON, restart it after regenerating).
- Backups of published data before each change: `data/_backup_fastf1_20261014-1704/`,
  `data/_backup_dispersion_20261014-2139/`, `data/_backup_sitepolicy_20261014-2350/`.

## Open ideas (not yet tried)

See the end of this file once the next round is written up; candidates so far: Limitless team
picked for upside and timed by weekend type, team value as an explicit target only once three
full seasons exist, better price-step prediction for drivers, weather, retirement risk by team
and circuit.

## Round 7 (2026-10-15): reproducible builds, D reverted

- Seeding fix kept: overtake draws use the seeded scoring generator; same-seed builds are
  byte-identical (test `ml/tests/test_fantasy_seed.py`).
- D rechecked with the combined test (8 builds, N = 100): 2024 0, 2025 -18.8 (t -2.74,
  significant), 2026 +41.4 (t 2.23, not significant). The declared rule requires no season
  significantly worse, so D was reverted (FANTASY_SHARPNESS = 1) and everything republished
  (official backtest, predict, run.ts). Backup of the D outputs: data/_backup_revertD_20261015-0305/.
