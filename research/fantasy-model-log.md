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

## Round 8 (declared 2026-10-15, before any run): qualifying first, then the race from that grid

Hypothesis: before qualifying, the race is drawn independently of the simulated qualifying. Chain
them instead: draw M = 100 qualifying orders from the stage's quali model, and for each order
take the race strength, DNF chance and grid bonus from the post-qualifying model given that grid
(as `forecast.conditional_strength` does for the sprint grid), then draw 200 races per order.

- Only the Grand Prix changes; quali and sprint draws stay as they are.
- The post-qualifying model sees only what the stage may see (`features.stage_frame`) plus the
  simulated grid. q_gap per world: the driver's stage proxy (sprint quali gap, else best practice
  gap, else d_qgap_e3, else the field median), sorted and handed out in the simulated order, so
  gap and position agree. q_tm_delta and q_vs_form are recomputed from it.
- One variant, fixed settings, no tuning. Same retrain schedule (every 3 rounds) and seeds as
  `f1ml.backtest`; base and chain run on the same bundles (paired).
- NLL of the chain = -log of the mean over the 100 orders of each order's exact likelihood
  (order plus retirements).

Keep rule (race, `evaluation-protocol.md`): on pre-weekend and post-practice, RPS and NLL not
significantly worse, at least one significantly better, no season worse by more than 0.002 RPS.
Keep rule (fantasy, this log): driver lock MAE better in at least 2 of 3 seasons and constructor
lock MAE not worse; then the combined robust test before anything is published.
Pilot: `ml/scripts/exp_chain/pilot.py`, outputs in `ml/reports/exp_chain/`.

Result (pilot, 64 races, 2026 R17 holdout left out; paired, same bundles and seeds):

| stage | RPS | NLL | win log loss | points MAE |
|---|---|---|---|---|
| pre-weekend | -0.0010 [-0.0026, +0.0005] | -0.43 [-0.75, -0.12] | -0.148 [-0.226, -0.076] | -0.18 [-0.26, -0.12] |
| post-practice | +0.0007 [-0.0004, +0.0017] | -0.21 [-0.61, +0.14] | -0.118 [-0.222, -0.023] | -0.04 [-0.09, +0.00] |

RPS by season, pre-weekend -0.0008 / -0.0029 / +0.0017, post-practice +0.0013 / -0.0005 / +0.0015
(2024 / 2025 / 2026): none worse than 0.002. Fantasy lock MAE, drivers 8.54 to 8.57 / 10.16 to 10.01 /
11.41 to 11.38, constructors 14.15 to 14.14 / 17.32 to 17.01 / 18.53 to 18.32. The chain also
removes part of the upward bias (driver lock bias 1.32 / 1.34 / 0.13 to 1.13 / 0.90 / -0.28),
p10 to p90 coverage drops about 1 point.

Verdict: passes the declared race rule (pre-weekend NLL significantly better, nothing significantly
worse) and the fantasy screen (driver lock MAE better in 2 of 3 seasons, constructors not worse).
Post-practice on its own is neutral. Next: build it into `forecast.py` behind a switch, run the
labelled backtest, then the combined robust fantasy test before publishing.

Full check (2026-10-15): built into `forecast.py` behind `F1ML_CHAIN` (off by default), market
pooling and grid penalties handled inside the chain.
- Labelled backtest `chain_bt` vs `published` (64 races, unpaired bundles): pre-weekend NLL -0.22
  [-0.49, +0.03], RPS -0.0001; post-practice NLL -0.16 [-0.48, +0.13], RPS +0.0004; win log loss
  -0.13 / -0.11 and points MAE -0.13 / -0.06 significantly better; post-qualifying identical.
  Lock MAE better in all three seasons (drivers 8.56 / 10.16 / 11.41 to 8.53 / 10.02 / 11.38).
- Combined robust fantasy test (`scripts/exp_chain/build.py`, 8 builds per side from one cache,
  N = 100): 2024 +61.4 (SE 4.6, t 13.4), 2025 +55.2 (SE 19.8, t 2.78), 2026 -125.3 (SE 25.9,
  t -4.84). All three significant; 2026 significantly worse.

Verdict for fantasy: rejected by the declared rule (a season significantly worse), even though
lock MAE is lower in every season. Better per-asset error again does not carry over to season
totals. The race model result is decided separately under the race rule.

Decision (2026-10-15): the chain is on for the race forecast (`F1ML_CHAIN`, default 1) and off
for fantasy: `forecast_race` scores fantasy points on the direct draw, so fantasy projections are
as before. Republished (backup `data/_backup_chain_20261015-1132/`).

## Round 9 (2026-10-15): scoping the other ideas

- Price step bug: `export.AssetBook.lookup` matched recent points on fantasyId, which is empty in
  the 2024 and 2025 community data, so every 2024/2025 asset had no recent points and the
  published expected price change used one race instead of three. Fixed (match on driver or
  constructor when there is no id; `tests/test_asset_book.py`). The "50% driver price step
  accuracy" above was mostly this bug: fed the actual points, the rule hits 99% in 2026 and
  (pipeline validator) 99% in 2025. `run.ts` keeps its own recent points per asset, so the
  value-of-money experiments were not affected by the bug. Price prediction quality is now
  just points forecast quality; a separate price model has nothing left to learn.
- DNF and safety car risk: pDnf beats a constant rate only slightly (log loss 0.374 vs 0.386 per
  car after qualifying); even an oracle that knew each race's real retirement rate gets 0.346.
  Calibration slope flips between seasons (1.7 / 0.25 / 0.8), so a recalibration cannot be fitted
  walk-forward. Not pursued.
- Team development: pre-weekend residual vs team trend (t_qgap_e3 - t_qgap_e8) Spearman -0.002
  pooled (2024 0.05, 2025 -0.05, 2026 0.13); driver trend 0.05 pooled, 0.23 in 2026. Only the
  regulation-change season hints at slow adaptation. Not pursued now; revisit with reset seasons
  (2014, 2017, 2022) in the tuning split.
- Weather: archived forecasts exist only from 2024 (`weather.py`, Previous Runs API); 6 clearly wet
  races in the selection window, half of wet races missed by the 1-day forecast. Upper bound about
  0.001 RPS on the 64-race mean, inside noise. Parked; scratch `ml/scripts/exp_weather/`.
- Betting markets: podium markets have 5 to 8 price points and open on race day, points markets
  are constructor markets, no top 6 or head-to-head. Only pole markets (about 47 races, hourly
  history) are usable, as a qualifying prior for the chain; expected gain small. Parked; scratch
  `ml/scripts/exp_market2/`.
- Sprint bias (lock, expected minus actual): drivers +1.8 / +2.4 / +1.0 on sprint weekends vs
  +1.2 / +0.9 / +0.4 on normal ones, constructors +3.5 / +5.1 / +3.2 vs +2.3 / +1.5 / +0.9. Not
  uniform: model top 6 drivers about 0, ranks 7 to 20 +2 to +3. Main cause: sprint overtakes over
  predicted (+0.8 per driver in 2024 and 2025), because the simulated sprint finish is drawn
  independently of the grid (mean places changed 4.0 simulated vs 2.5 real) and the overtake
  model turns places gained into overtakes. Same root cause as round 8, whose chain lowered the
  bias but lost the 2026 season test. Sprint DNF factor: walk-forward ratio of sprint to race
  retirements 0.44 / 0.37 / 0.46 vs the fixed 0.35, worth about -0.1 points per driver, too small
  to test. Scratch `ml/scripts/exp_sprint/`.

## Round 10 (2026-10-15): post-qualifying

Diagnosis (`ml/scripts/exp_postq/diag.py`, `diag2.py`; pub64 post-qualifying rows, classified
cars, raceId < 202617): regressing the finishing rank (share of field) on the predicted rank plus
one more variable, the grid slot still adds +0.21 (t 3.5, cluster by race), and with the same
sign in every season (0.24 / 0.20 / 0.18). Starting further back means finishing further back
than the model expects: the forecast leans on pace and form and under-uses the grid. Long-run
pace beyond the grid is weak (lr_gap t 2.5, coefficient near 0 in 2024), long-run degradation,
circuit grid correlation x grid, team-mate gaps and past places gained add nothing. Starting tyre
data was not checked (no column in the scorecard rows).

Hypothesis: a full-order grid term on the post-qualifying race strength, strength - g * grid /
field, with g fitted walk-forward by Plackett-Luce likelihood on the long schedule window (before
the temperature schedule and the first-pick grid bonus are refitted), lowers post-qualifying RPS
and NLL. Switch `F1ML_GRIDTERM` (off by default, `bundle.py`). Label `gridterm`, compared with
`pub64`.

Keep rule (protocol): post-qualifying and pre-weekend RPS and NLL not worse (paired 95% interval
not entirely on the worse side), at least one better, no season worse by more than 0.002 RPS.
Pre-weekend is expected to be unchanged (the term only touches the post-qualifying model; the
chain uses it, but pub64 has no chain).

## Round 11: chips (2026-10-15)

### Diagnosis (site method, unperturbed, current history; single runs 4827 / 5140 / 4281)

Scratch: `CHIPS_DIAG=<season>` mode in `run.ts`, outputs `ml/reports/exp_chips/diag_<season>.json`.
Replays are path-aware: one chip forced at round k, the others at their as-played rounds.

- How the engine picks: `adviseChips` compares the chip's forecast gain now with its gain in the
  2 horizon rounds and a "typical" later slot. In the backtest the horizon is this round's
  forecast repeated, so later slots look like now and chips go early: Wildcard R2 or R3,
  Limitless R4 or R5, x3 Boost R2 to R5 every season; Autopilot is left to the end.
- Forecast gain vs actual gain per round (rounds 3+): x3 Boost corr 0.09 / -0.35 / -0.05,
  Limitless -0.12 / 0.37 / 0.29, Autopilot 0.14 / 0.41 / -0.26. The signal barely ranks weekends.
- Hindsight-best weekend vs as played (season total): Wildcard +57 / +144 / +266, x3 Boost
  +171 / +127 / +159, Limitless +21 / +54 / 0, Autopilot +51 / +28 / +31. Not additive; an
  oracle bound. The forecast-best weekend is no better than as played.
- Wildcard: most forced rounds give the same total (4779 / 5207 / 4453), i.e. the Wildcard is a
  no-op there. Playing it at R2 as advised scored -67 (2025) and -172 (2026) vs that no-op value.
  It only helps when a big rebuild is wanted (2024 R3 +48).
- Limitless as played earned +160 / +136 / +187 over the no-chip team, near the best rounds.
  Upside teams (forecast + k x SD of earlier points, k 0.5 or 1) on those weekends: 136 / 132 or
  165 / 176, not better on balance. Not tested further.
- Gap to the 2026 leader (4994 vs robust 4175, 819): the chip oracle bound is about 450, most of
  it Wildcard and x3 timing that the forecast cannot see. The rest is weekly transfers.

### Declaration (before any run)

One rule only (x3 and Autopilot timing have no forecast signal, Limitless timing is already near
the best, upside Limitless is not better in hindsight):

- W (Wildcard trigger): the Wildcard is removed from engine advice. It is played at the first
  round from round 2 where the best no-chip team under the site objective would pay a transfer
  penalty of at least 20 points (4 or more transfers wanted); otherwise held (unused). Other
  chips stay on engine advice. Threshold fixed in advance, not fitted.
- Test: combined robust test, base builds b0..b7 (`ml/reports/exp_chain/builds/base_b*`),
  N = 100, sigma 0.03, site policy vs W on the same build (policy via `CHIP_RULE` env in
  `run.ts`, default unchanged).
- Keep rule: no season significantly worse and the sum over 2025 + 2026 positive; otherwise
  rejected.

### Result (combined test, 8 base builds, N = 100)

W vs site policy: 2024 -31.3 (SE 2.2, t -14.2), 2025 -152.1 (SE 8.3, t -18.4), 2026 -72.4
(SE 10.5, t -6.9). Significantly worse in every season: rejected. The early Wildcard as advised is
worth more on average than holding it for a big-rebuild trigger; the single-run diagnosis (R2
Wildcard below its no-op value) was path noise. Chip timing is not where the points are: the
remaining hindsight room (x3 and Wildcard timing) is invisible to the forecast. Outputs:
`ml/reports/exp_chips/combined_W8.json`, `eval_W.log`. Defaults unchanged (`CHIP_RULE` empty).

Result (label `gridterm`, `F1ML_GRIDTERM=1 F1ML_CHAIN=0`, 64 races, vs `pub64`):
- Post-qualifying RPS 0.1118 to 0.1114, diff -0.0004 [-0.0008, 0.0000]; NLL 35.29 to 35.22, diff
  -0.08 [-0.17, +0.03]. Better in every season (RPS -0.0003 / -0.0008 / -0.0001).
- Pre-weekend and post-practice identical (as expected without the chain).
- Fitted g (sanity check on GBM scores, unit scale): about 0 at the 2024 cutoff, 0.19 at 2026.

Verdict: passes the accept rule (post-qualifying RPS better with its interval reaching zero only
at the upper end, NLL neutral-better, no stage or season worse). Keep, still off by default:
turning it on needs a republish together with the chain (the chain uses the post-qualifying
model with simulated grids, so pre-weekend and post-practice will move and must be rescored).

Round 10 follow-up (2026-10-15): grid term together with the qualifying chain (label `both`) vs
the chain alone (`chain_bt`): RPS pre-weekend -0.0002 [-0.0003, -0.0001], post-practice -0.0002
[-0.0003, -0.0001], post-qualifying -0.0004 [-0.0008, 0.0000]; NLL neutral to better at every
stage; win log loss pre-weekend -0.005. No season worse. Kept: `F1ML_GRIDTERM` default 1,
republished (backup `data/_backup_gridterm_20261015-1624/`).

## Round 12: podium market (2026-10-15)

### Declaration (before any run)

- Hypothesis: pooling Kalshi prices into our forecast beats both ours alone and Kalshi alone on
  podium log loss (and, for the winner market, win log loss), before and after qualifying.
- Data: current model `ml/reports/scorecard/both_cars.parquet` (chain + grid term); Kalshi
  podium (`KXF1RACEPODIUM`) and winner (`KXF1RACE`) midpoints at the same stage cutoffs as
  `ml/scripts/benchmark/score.py` (cached responses only). Kalshi covers 2025 and 2026.
- Method (one, fixed): log pooling from the saved probabilities, no re-simulation.
  Podium: q_i proportional to p_i^w * m_i^(1-w), rescaled to sum 3 (clipped to [0.001, 0.999],
  rescale repeated). Win: same with sum 1. w = model weight.
- Weight walk-forward: for season S, w is the grid value (0 to 1, step 0.05) minimising mean
  log loss on races of earlier seasons at the same stage and target. First season with data
  (2025) uses the fixed prior `market.OURS_WEIGHT` (0.2 pre-weekend, 0.35 otherwise).
- Stages: pre-weekend, post-practice, post-qualifying. Scores: podium log loss (per-driver
  binary, as the benchmark), win log loss. RPS not scored (no re-simulation).
- Keep rule, per stage and target: pooled vs ours and pooled vs Kalshi, paired bootstrap over
  races (4000 draws, 95% interval): no comparison significantly worse, at least one significantly
  better. Kept only if this holds at the post-qualifying stage and at least one earlier stage.

### Result (`ml/scripts/exp_podium/pool.py`, outputs `ml/reports/exp_podium/`)

Pooled minus other, mean per race, 95% bootstrap interval (2025 + 2026, weights 2025 prior / 2026 fitted):
- Podium post-qualifying (22 races, w 0.35 / 0.25): pooled 0.1941 vs ours 0.2059, diff
  [-0.0251, -0.0000]; vs Kalshi 0.1950, [-0.0073, +0.0061].
- Podium post-practice (15, w 0.35 / 0.35): 0.2291 vs ours 0.2409 [-0.0249, +0.0005]; vs Kalshi
  0.2345 [-0.0152, +0.0035].
- Podium pre-weekend (20, w 0.2 / 0.0): 0.2379 vs ours 0.2488 [-0.0261, +0.0022]; vs Kalshi 0.2375
  [-0.0016, +0.0026].
- Win post-qualifying (30, w 0.35 / 0.40): 0.979 vs ours 0.983 [-0.065, +0.063]; vs Kalshi 1.043
  [-0.110, -0.024].
- Win post-practice (25): 1.525 vs ours 1.506 [-0.114, +0.152]; vs Kalshi 1.631 [-0.242, +0.008].
- Win pre-weekend (27): 1.582 vs ours 1.557 [-0.107, +0.163]; vs Kalshi 1.664 [-0.179, +0.004].

No comparison is significantly worse. Significantly better only after qualifying (podium vs ours,
at the edge; win vs Kalshi). Earlier stages: point estimates better for podium, not significant.
Verdict: rejected under the declared rule (no earlier stage passes). Samples are small (15 to 30
races, one fitted season); the podium direction is consistent, so worth re-running at season end.
Production unchanged.
