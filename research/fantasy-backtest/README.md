# Fantasy optimiser season backtest (scratch)

Replays 2024, 2025 and 2026 (rounds 1 to 17) from round 1: real price going into each round,
real points and price changes after it, 100M start. Transfer rule for every season (owner's
statement): 2 free transfers every race, no carry-over, -10 per extra transfer.

## Rerun

    cd pipeline && uv run python ../research/fantasy-backtest/export_history.py
    cd pipeline && uv run python ../research/fantasy-backtest/export_breakdown.py
    cd .. && npx tsx research/fantasy-backtest/run.ts

Writes `results.json` (every variant), `diagnosis.json` (forecast error tables, see
`diagnosis.md`) and the site file `site/src/lib/data/fixtures/fantasy/backtest.json`
(read by `getFantasyBacktest()`). About 2 to 3 minutes.

## Leak-freeness

- Forecast = `fantasyAtLock` (post-practice, before qualifying), model trained on earlier races.
  Every file is checked for stage, inputs and training cut-off.
- Blend weight (model vs form, per kind): least squares on earlier seasons only. 2024 uses a fixed
  prior of 0.5. Fitted: 2025 drivers 0.67, constructors 0.79; 2026 drivers 0.75, constructors 0.79.
- Calibration (actual ~ a + b x model, per kind): fitted on all earlier rounds.
- Objective (expected vs value) and transfer threshold (0 to 16 points per transfer): best total
  on earlier seasons; 2024 uses the prior (expected, 0). Fitted: expected, 0 for every season.
- Chips: Wildcard, Limitless, x3 Boost (Extra DRS in 2024), Autopilot, played when the engine's
  `adviseChips` says play now. The 2024 and 2025 games had the same six chips; Final Fix and
  No Negative are never played because they cannot be scored from this data.

## Totals (every variant tried)

| variant | 2024 | 2025 | 2026 (R1-17) |
|---|---|---|---|
| model, 1 race | 4696 | 4812 | 3573 |
| form, 1 race | 4480 | 5034 | 4136 |
| blend, 1 race | 4717 | 5063 | 3891 |
| calibrated model, 1 race | 4696 | 4812 | 3573 |
| calibrated blend, 1 race | 4691 | 5119 | 3873 |
| model, 3-race plan | 4696 | 4763 | 3620 |
| calibrated blend, value objective | 4691 | 5028 | 4179 |
| calibrated blend + fitted objective and threshold | 4691 | 5119 | 3873 |
| model + chips | 4601 | 4989 | 3794 |
| form + chips | 4616 | 5388 | 4336 |
| **calibrated blend + fitted objective and threshold + chips (shown on the site)** | **4802** | **5306** | **4191** |
| keep the round-1 team | 4244 | 4606 | 2806 |
| hindsight (impossible) | 6877 | 7384 | 5554 |

The site method was declared before its totals were seen. Like for like with chips it beats form
in 2024 and trails in 2025 (-82) and 2026 (-145). The value objective was tried after seeing the
diagnosis; it would have helped 2026 but walk-forward selection (from 2025) rejected it.

## Caveats

- Prediction files were written on 2026-10-12 by a walk-forward backfill; leak-freeness rests on
  the stage and training notes, not on timestamps.
- Missing forecasts: 2024-3 Sargeant, 2025-9 Stroll (form used).
- 2026 has two Lawson assets with one id; prices use the active one (`priceMap` in backtest.ts).
- Chip timing uses the real season length (2026: engine default 23), so 2026 may still hold chips.
- No world rank: see `world-rank.md`.

## Round 2: value of money and all six chips (2026-10-14)

Declared before its 2026 total was seen: calibrated blend + value objective (expected points +
lambda x expected team value change, lambda = scale x c x races left after this one) + all six
chips. Expected price change = the 2025/2026 price rule (3-race points per $M, tiers at 18.5M)
with this race's points ~ Normal(forecast, residual SD), optional second race of lookahead; 2024
(different, transfer driven rule) uses that expectation shrunk by a slope fitted on earlier 2024
rounds. c = points one $1M buys per race, measured on earlier seasons; scale, lookahead and the
Final Fix threshold fitted on earlier seasons. Site rule fixed in advance: switch only if the new
method wins 2025 + 2026 together.

| variant | 2024 | 2025 | 2026 | team value 24/25/26 |
|---|---|---|---|---|
| old site method (4 chips) | 4802 | 5306 | 4191 | 121.3 / 135.7 / 121.5 |
| old site method + all six chips | 4749 | 5285 | 4190 | 122.0 / 134.7 / 122.5 |
| form + all six chips | 4668 | 5411 | 4361 | 124.2 / 142.3 / 130.7 |
| value, lambda from season replay (c = 0), no chips | 4638 | 5119 | 3873 | 122.1 / 132.5 / 123.8 |
| value, lambda from per-race budget slope, no chips | 4638 | 4820 | 4008 | 122.1 / 143.7 / 138.1 |
| same + 2-race price lookahead | 4655 | 4334 | 4175 | 121.3 / 146.0 / 139.8 |
| value (fitted), no chips | 4638 | 4420 | 3873 | 122.1 / 149.1 / 123.8 |
| value (fitted) + 4 chips | 4627 | 4637 | 4222 | 120.2 / 145.2 / 127.9 |
| value (fitted), 3-race plan | 4733 | 4420 | 3777 | 121.5 / 149.1 / 129.8 |
| post hoc: lambda = forecast budget slope x races left | 4702 | 4906 | 3988 | 120.7 / 140.1 / 138.9 |
| post hoc: same + 4 chips | 4627 | 4860 | 4132 | 120.2 / 140.5 / 143.0 |
| **declared: value (fitted) + all six chips** | 4788 | 4593 | 4242 | 119.6 / 145.2 / 127.9 |

Fitted: c (points per $M per race) = 0.6 prior for 2024, 3.865 for 2025 (from 2024), 0.782 for
2026 (2024 slope 3.87, 2025 slope -2.30); scale/lookahead 1/0.5 for 2025, 0 for 2026 (so the 2026
run has no value term); Final Fix threshold 10 / 15 / 10 points. The full season replay with +2M
at a round is pure path noise (gains -86 to +40 per $M), so it fits c = 0.

Result: the value objective does buy team value (up to +17M) but loses points out of sample; the
declared method is -713 in 2025 and +51 in 2026, so the site keeps the old method. Real money
bought only +3.9 points per $M per race in 2024 and -2.3 in 2025: with this forecast, extra budget
does not reliably turn into points, which is why the budget form builds does not help us. No
engine change.

Chips: all six existed in 2024, 2025 and 2026 (x3 Boost was Extra DRS in 2024). No Negative is
scored per item in 2026 (official breakdown) and per session (qualifying, sprint, race) in 2024
and 2025, a lower bound. Final Fix is scored from session points; the decision uses the
post-qualifying forecast file (inputs up to Q and the sprint, no race) minus the qualifying and
sprint points already scored. Engine advice only plays No Negative in the last round.

World reference: 2026 current global leader (round 17) = 4994 (owner, 2026-10-14); our 4191 is
83.9%. 2024 and 2025 stay "not published".

## Round 3: hybrid, price rise, momentum, ensembles, chip timing (2026-10-14)

Every variant, its declared prior and rule, and every total: `experiments.md`. Run one family
without touching any output file: `R3=H npx tsx research/fantasy-backtest/run.ts`
(families H, L, M, U, S, C, or `all`; `R3=sse` prints forecast errors of the stacks,
`R3=multi:H,L,M` the multi-start criterion, `R3=cmp` site vs form per round).

Result: nothing beats the site method out of sample. Best declared variants net +46 (momentum)
and +15 (hybrid) over 2025 + 2026, inside the path noise (one setting step moves a season by 200
to 400 points); the rest lose up to 382. Engine chip advice beats every fixed schedule. A
stacked forecast never lowers the error of the current per-kind blend. The site method, the site
data file and the engine are unchanged.

## Robust season evaluation (2026-10-14)

One season replay is path dependent: two forecasts that differ by a hair can end 200 to 800
points apart. `evaluate.ts` replays each season N times (default 200) with the site method
(calibrated blend, expected objective, threshold 0, 4 chips, engine chip advice; the walk-forward
fit picks exactly this for every season) and every asset's forecast multiplied by (1 + e),
e ~ N(0, sigma), sigma = 3% by default. e is a hash of (seed, season, round, asset), so two
forecast sources get the same draws (common random numbers) and their per-seed difference is
paired. Seed 0 is the plain run.

    npx tsx research/fantasy-backtest/evaluate.ts --a <history dir> [--b <history dir>] \
      [--n 200] [--sigma 0.03] [--jobs 10] [--out file.json]

Per season: mean, SD, 10th and 90th percentile of the total, and for a pair the mean difference
B - A, its SD, standard error, z and `significant` (|z| > 1.96), plus `runsFor100` = runs needed
to detect a 100-point paired difference (5% two-sided, 80% power). Workers are `run.ts` with
`ROBUST_WORKER=season:first:last:sigma` and `PRED_DIR=<history dir>`.

Calibration (old history `data/_backup_fastf1_20261014-1704/predictions/history` vs current,
N = 200, sigma 3%, 10 processes, 203 s):

| season | old mean (SD) | current mean (SD) | paired diff (SD, SE) | z | runs for 100 pts |
|---|---|---|---|---|---|
| 2024 | 4813 (138) | 4812 (129) | -0.4 (163, 11.5) | -0.03 | 21 |
| 2025 | 5102 (154) | 5088 (138) | -14.1 (192, 13.6) | -1.04 | 30 |
| 2026 | 4175 (201) | 4144 (266) | -31.2 (292, 20.6) | -1.51 | 67 |

Not significant in any season, as expected. A 3% nudge alone spreads one season by 130 to 270
points (SD), and the single plain run is not typical: the published 2025 figure 5306 sits near
the 90th percentile of its own cloud (mean 5102). Pairing barely helps (diff SD about 1.2 x the
season SD) because the paths diverge after the first different transfer, so judge changes by the
mean over N >= 70 runs, never by one total.

### Combined test: perturbation plus rebuild drift (2026-10-15)

Two builds of the same forecast that differ only in simulation seeds can differ by 100+ points
per season in the paired test, which the 3% perturbation alone calls significant. Build each
variant B times (`ml/scripts/exp_dispersion/build.py --name X --k K --build b`, seed offset b,
about 65 s per build, 4 in parallel) and pass the builds as comma separated lists:

    npx tsx research/fantasy-backtest/evaluate.ts --a base_b0,base_b1,... --b D_b0,D_b1,... --n 100

Build i of A is paired with build i of B. Combined SE = SD of the B per-build paired means /
sqrt(B), judged with Student t (B - 1 df); the output also splits within-build SE and
between-build SD and gives the builds needed for a 100-point difference. With B = 8, N = 100:
between-build SD 0 / 15 / 56 points (2024 / 2025 / 2026), within SE 6 / 20 / 22; 1 / 1 / 4 builds
detect 100 points, 8 builds detect about 50 in 2026. Runtime: 8 build pairs about 9 min, the
test about 24 min (B x 3 min).
