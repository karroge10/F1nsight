# Fantasy strategy experiments (round 3, 2026-10-14)

Every variant run in round 3 is logged here, failures included. Totals are 2024 / 2025 / 2026
(rounds 1 to 17); team value is the final team value plus bank in $M.

Baseline (round 2, unchanged): site method = calibrated blend + fitted objective and threshold +
4 chips (engine advice): 4802 / 5306 / 4191, team value 121.3 / 135.7 / 121.5.

## Protocol, declared before any round 3 run

- Every tunable below has a grid. The value used for season S is the grid point with the best
  total summed over seasons before S (2025 from 2024, 2026 from 2024 + 2025). 2024 uses the prior
  written here, which is always "no change from the site method" unless stated.
- Choosing between families counts as fitting too: the final site method for season S is the
  configuration (family plus parameters) with the best total over seasons before S, among every
  configuration in the final candidate set. 2024 uses the old site method (prior).
- The honest out-of-sample numbers are 2025 and 2026 under that rule. 2024 is in-sample only in
  the sense that it always runs the declared prior.
- Chips: the 4 scorable chips with engine advice, as in the site method, unless a family changes
  chip timing.

## Families and priors (declared before running)

| id | family | grid | 2024 prior |
|---|---|---|---|
| H | Hybrid: transfer forecast = w x calibrated blend + (1 - w) x form; Boost and chip advice from the calibrated blend | w in 0, 0.25, 0.5, 0.75, 1 | w = 1 |
| L | Price rise targeting: value objective with points per $M = L x races left, price change from the 2025/2026 rule with Normal(forecast, residual SD) points (2024: shrunk rule) | L in 0, 0.05, 0.1, 0.2, 0.3, 0.5 | L = 0 |
| M | Momentum: forecast + m x last price change of the asset ($M) | m in 0, 2, 4, 8 | m = 0 |
| U | Boost by upside: Boost = argmax of forecast + k x SD of that driver's earlier points this season | k in 0, 0.25, 0.5, 1 | k = 0 |
| T | Transfer threshold on top of the best family (points per transfer) | 0, 2, 4, 8 | 0 |
| C | Chip timing: engine advice vs fixed schedules declared below | see below | engine advice |

Hypotheses:
- H: form's edge is in which assets to hold (price risers), the model's edge is in ranking this
  weekend (Boost, chips). Splitting the roles should keep most of both.
- L: round 2 used lambda up to 77 points per $M early in the season, far too high. A small lambda
  should buy some of form's team value without giving up points.
- M: an asset whose price just rose is likely to keep scoring (form persistence the model misses).
- U: Boost points are the max of 5; a higher variance driver has a better upside.
- T: no-carry-over makes small holds cheap; fitted 0 before, retest on the new forecast.

## Runs

### Batch 1: families H, L, M, U (hypotheses above)

| family | setting | 2024 (TV) | 2025 (TV) | 2026 (TV) |
|---|---|---|---|---|
| H | w=0 (form transfers, model Boost and chips) | 4653 (123.4) | 5394 (139.7) | 4356 (130.9) |
| H | w=0.25 | 4795 (120.1) | 5150 (136.0) | 4340 (138.6) |
| H | w=0.5 | 4780 (121.8) | 5208 (137.8) | 4206 (126.8) |
| H | w=0.75 | 4822 (121.8) | 5153 (132.7) | 4233 (123.0) |
| H | w=1 (= site) | 4802 (121.3) | 5306 (135.7) | 4191 (121.5) |
| L | L=0 | 4802 (121.3) | 5227 (135.7) | 4222 (127.9) |
| L | L=0.05 | 4763 (122.1) | 5229 (135.3) | 4487 (138.5) |
| L | L=0.1 | 4627 (120.2) | 5229 (135.3) | 4090 (125.8) |
| L | L=0.2 | 4627 (120.2) | 5201 (133.7) | 4011 (134.1) |
| L | L=0.3 | 4627 (120.2) | 5242 (135.5) | 4009 (134.7) |
| L | L=0.5 | 4627 (120.2) | 4784 (136.3) | 4145 (140.5) |
| M | m=0 (= site) | 4802 (121.3) | 5306 (135.7) | 4191 (121.5) |
| M | m=2 | 4776 (120.5) | 5445 (139.2) | 4267 (130.9) |
| M | m=4 | 4876 (120.5) | 4996 (134.7) | 4056 (131.0) |
| M | m=8 | 4654 (121.9) | 5177 (137.5) | 4098 (127.2) |
| U | k=0, 0.25, 0.5, 1 | 4802 (121.3) | 5306 (135.7) | 4191 (121.5) |

Walk-forward picks: H 2025 w=0.75 (5153), 2026 w=1 (4191); L 2025 L=0 (5227), 2026 L=0 (4222);
M 2025 m=4 (4996), 2026 m=2 (4267). None beats the site method out of sample in both seasons.

Findings:
- U changes nothing: every team is one dominant driver plus cheap ones, so the Boost choice is
  never close. Dropped.
- Path noise is large. L=0 is the same objective as the site method but routes through the value
  code path (tiny tie-break and chip advice differences) and moves 2025 by -79 and 2026 by +31.
  Neighbouring grid points swing 200 to 400 points (M: m=2 +139 in 2025, m=4 -310). A single
  earlier season cannot fit a parameter against noise of this size.

### Batch 2 declaration: S, stacked forecast fitted on rows, not season totals

Hypothesis: season totals are too noisy to fit on (batch 1), but forecast error over thousands of
asset rows is not. A per-kind least squares stack of signals, refitted before every round on all
earlier rounds (earlier seasons plus earlier rounds of this season, ridge 1e-3 on the
standardised features), can add form's persistence and price momentum to the model in a way that
is fitted honestly and with little noise. Before 150 rows per kind exist the site forecast is
used, so 2024 starts on the prior and moves to the fit as rows arrive.

Features (per kind): S1 = 1, model; S2 = S1 + form; S3 = S2 + last race, mean of last 3, season
mean; S4 = S3 + last price change; S5 = S4 + sprint x model; S6 = S5 with this season's rows
weighted 3x. Choice among S1 to S6 for season S: lowest squared error of each stack's walk-forward
forecast on the seasons before S (2024: S2, the closest to the site blend). Then the season total
decides only one thing: site method vs the chosen stack, again on seasons before S.

### Batch 2 results: S

RMSE per active asset row (walk-forward):

| season | site | S1 | S2 | S3 | S4 | S5 | S6 |
|---|---|---|---|---|---|---|---|
| 2024 | 15.129 | 15.307 | 15.230 | 15.312 | 15.312 | 15.312 | 15.312 |
| 2025 | 16.961 | 17.025 | 16.970 | 17.027 | 17.085 | 17.086 | 17.144 |
| 2026 | 18.055 | 18.370 | 18.135 | 18.217 | 18.244 | 18.310 | 18.475 |

| stack | 2024 (TV) | 2025 (TV) | 2026 (TV) |
|---|---|---|---|
| S1 | 4735 (119.5) | 4580 (117.9) | 3794 (128.9) |
| S2 | 4925 (124.9) | 4924 (131.3) | 4019 (121.4) |
| S3 | 4923 (122.5) | 5261 (128.5) | 4271 (134.2) |
| S4 | 4762 (122.1) | 4748 (129.9) | 4343 (136.1) |
| S5 | 4908 (122.6) | 4688 (122.6) | 4149 (135.3) |
| S6 | 4908 (122.6) | 4828 (122.0) | 3982 (123.4) |

Declared rule: S2 chosen by error for 2025 and 2026; site vs S2 on earlier totals picks S2 for
2025 (4925 > 4802 in 2024) and the site for 2026. Out of sample: 2025 4924 (-382), 2026 4191 (0).
Rejected. No extra signal (recent points, momentum, sprint term) lowers the error of the
per-kind blend already used, and pooled refits are worse than the per-season blend weights.
Again season totals move 300 to 700 points between forecasts whose error differs by 0.1 points.

### Batch 3 declaration: multi-start fitting criterion

Hypothesis: one season total is one noisy path. Starting the variant from the site method's team
(no chips) at every round k of an earlier season and summing its points from k to the end,
minus the site method's points over the same span, averages over about 22 starts and should rank
grid points with less noise. Criterion R(variant, season) = mean over k of that gain. Fitted for
season S on seasons before S, grids H, L, M as in batch 1; 2024 keeps the priors. The chosen
setting is then run with chips like the site method. Also R itself is printed so the noise can be
judged: if R is within a few points for every grid point, the family is declared "no signal".

### Batch 3 results: multi-start criterion (mean gain per start vs the site method, no chips)

| family | setting | R 2024 | R 2025 |
|---|---|---|---|
| H | w=0 | -43.0 | 60.8 |
| H | w=0.25 | -8.9 | 20.9 |
| H | w=0.5 | -0.2 | 44.9 |
| H | w=0.75 | -25.4 | 41.9 |
| H | w=1 | 0.0 | 0.0 |
| L | L=0 | 0.0 | 0.0 |
| L | L=0.05 | 0.0 | 13.8 |
| L | L=0.1 | 0.0 | 7.9 |
| L | L=0.2 | 0.0 | -43.2 |
| L | L=0.3 | 0.0 | -54.4 |
| L | L=0.5 | 7.1 | -150.7 |
| M | m=0 | 0.0 | 0.0 |
| M | m=2 | 15.1 | -26.2 |
| M | m=4 | -87.2 | -32.8 |
| M | m=8 | -46.2 | 91.3 |

Declared picks (with chips, totals from batch 1): H 2025 w=1 (5306), 2026 w=0.5 (4206);
L 2025 L=0.5 (4784), 2026 L=0.05 (4487); M 2025 m=2 (5445), 2026 m=8 (4098).
Net vs the site method over 2025 + 2026: H +15, L -226, M +46. Rejected: the sign of R flips
between 2024 and 2025 for most settings, so the criterion carries no transferable signal either.
In 2024 the price rule term is shrunk to about 0 (the 2024 rule was transfer driven), so L cannot
be fitted from 2024 at all.

Per-round site vs form (both with 4 chips, `R3=cmp`): 2025 form is +6.4M of team value after
round 3 and stays 8 to 9M ahead, which pays late (+170 points over the last 8 rounds). In 2026
the whole season gap comes from two rounds: R2 (form plays Limitless, 474 vs 313) and R13
(381 vs 192). Everything else is noise around zero.

### Batch 4 declaration: chip timing (C)

Hypothesis: Limitless and x3 Boost are worth more on sprint weekends (more points to multiply or
to buy), and the engine plays them at the first allowed round because the horizon is this race
repeated. Schedules, all declared now (other chips keep engine advice; a chip whose round has
passed falls back to engine advice from the next round):
- C0: engine advice (prior, the site method).
- C1: Limitless on the first sprint weekend from round 2.
- C2: x3 Boost on the first sprint weekend from round 2.
- C3: C1 and C2 together (x3 on the second sprint weekend if both land on the same one).
- C4: Wildcard on round 2 (fix the blind round-1 team as early as possible), rest engine.
Choice for season S: best total over seasons before S; 2024 uses C0.

### Batch 4 results: C

| schedule | 2024 (TV) | 2025 (TV) | 2026 (TV) |
|---|---|---|---|
| C0 engine advice (= site) | 4802 (121.3) | 5306 (135.7) | 4191 (121.5) |
| C1 Limitless first sprint | 4802 (121.3) | 5192 (135.0) | 4073 (122.3) |
| C2 x3 first sprint | 4726 (120.8) | 5306 (135.7) | 4175 (121.5) |
| C3 both on sprints | 4755 (123.1) | 5210 (135.0) | 4073 (122.3) |
| C4 Wildcard round 2 | 4644 (122.0) | 5159 (134.2) | 4019 (121.4) |

Walk-forward: C0 for 2025 (tie with C1 in 2024, the prior wins ties) and C0 for 2026. Engine
chip advice is never beaten by a fixed schedule in any season. Kept.

Not run: a price-based round-1 team. The form forecast is price based at round 1 and scored
less than the model's round-1 team in 2024 (165 vs 209) and 2025 (147 vs 172), more in 2026
(205 vs 168); no reason to expect a declared heuristic to do better.

## Conclusion (round 3)

Out of sample (each family's setting chosen by its declared rule from earlier seasons only),
net change vs the site method over 2025 + 2026:

| variant (declared rule) | 2025 | 2026 | net |
|---|---|---|---|
| M momentum, multi-start fit | 5445 | 4098 | +46 |
| H hybrid, multi-start fit | 5306 | 4206 | +15 |
| C chip schedules | 5306 | 4191 | 0 |
| L price rise, season-total fit | 5227 | 4222 | -48 |
| H hybrid, season-total fit | 5153 | 4191 | -153 |
| L price rise, multi-start fit | 4784 | 4487 | -226 |
| M momentum, season-total fit | 4996 | 4267 | -234 |
| S stacked forecast | 4924 | 4191 | -382 |

The two positive ones are far inside the path noise (neighbouring settings move a season by 200
to 400 points) and their fitting criterion flips sign between 2024 and 2025, so they are not an
improvement anyone should trust. Nothing beats the site method out of sample. The site method,
backtest.json and the engine are unchanged.

Best in-sample numbers, for reference only (picked by their own season, not honest): L=0.05
gives 4487 in 2026 (89.8% of the 4994 leader), form + all six chips 4361. The honest 2026 figure
stays 4191 (83.9%).

## Robust evaluation (2026-10-14)

Method and calibration: README, "Robust season evaluation". Old vs current history, N = 200,
sigma 3%: paired differences -0.4 / -14.1 / -31.2 (SE 11.5 / 13.6 / 20.6), none significant.
Runs needed for a 100-point paired difference: 21 / 30 / 67.

## Round 4: dispersion and overtakes (2026-10-14)

Declared before any result: variants on the team-lock forecast, re-simulated from cached
walk-forward inputs (`ml/scripts/exp_dispersion`: `cache.py` retrains every 3 rounds like
`f1ml.backtest` and pickles the lock inputs, `variants.py` re-simulates with the same seeds and
scores). All against `base` = the same pipeline with the current method (rebuilt, so pairs share
every simulated world).

- O1: overtake rates x season factor (A + 40 m) / (P + 40 m), A / P actual / predicted overtakes
  of this season's earlier rows, m the mean rate (40 rows = two races of shrinkage).
- O2: overtake Poisson refitted with weight 3 on current-season rows (same 12-race window).
- D: race, sprint and qualifying strengths x k in the fantasy simulation, k from 1 / 1.15 / 1.3 /
  1.5 by lowest squared fantasy error (drivers + constructors) on earlier seasons; 2024 k = 1.
  Fitted: k = 1.5 for 2025 and 2026 (grid edge).
- O1+D: both (k refitted, also 1.5).

Keep rule (declared): driver lock MAE or slope (actual ~ predicted, closer to 1) better in at least
2 of 3 seasons, the rest not worse beyond noise, and the robust season evaluation (N = 200,
sigma 3%, paired vs base) not significantly worse in any season.

Driver lock metrics (MAE / per-round Spearman / bias / slope; 2026 overtake MAE / bias from the
official breakdown):

| variant | 2024 | 2025 | 2026 | 2026 overtakes |
|---|---|---|---|---|
| base | 8.540 / .628 / +1.32 / 1.10 | 10.161 / .524 / +1.34 / 1.02 | 11.561 / .566 / +0.38 / 1.22 | 3.80 / +0.07 |
| O1 | 8.549 / .629 / +1.05 / 1.11 | 10.160 / .526 / +1.10 / 1.02 | 11.598 / .566 / +0.94 / 1.19 | 4.01 / +0.64 |
| O2 | 8.543 / .626 / +1.17 / 1.11 | 10.165 / .525 / +1.22 / 1.02 | 11.554 / .567 / +0.57 / 1.19 | 3.84 / +0.27 |
| D | = base | 10.099 / .516 / +1.13 / 0.90 | 11.454 / .564 / +0.12 / 1.10 | 3.77 / -0.12 |
| O1+D | = O1 | 10.108 / .518 / +0.90 / 0.90 | 11.483 / .564 / +0.66 / 1.08 | 3.96 / +0.42 |

Constructors MAE (2025 / 2026): base 17.32 / 18.54, O1 17.29 / 18.82, O2 17.31 / 18.55,
D 16.83 / 18.07, O1+D 16.82 / 18.32. Full table: `ml/reports/exp_dispersion/metrics.json`.

Robust season evaluation, paired B - base, mean (SE), N = 200, sigma 3%:

| variant | 2024 | 2025 | 2026 |
|---|---|---|---|
| D | 0 (0) | -23.7 (15.3), z -1.55 | +52.2 (18.1), z +2.89 |
| O1+D | -0.2 (4.6) | -67.0 (14.9), z -4.49 | -0.8 (17.2) |
| O1 | -0.2 (4.6) | -50.1 (11.6), z -4.31 | -20.7 (10.6), z -1.95 |
| O2 | -1.5 (4.2) | -30.2 (10.1), z -2.98 | -28.3 (10.9), z -2.61 |

(base means 4839 / 4933 / 4011.) Overtakes: over the whole of 2026 the current window is already
unbiased (+0.07 per driver); early-season catch-up (O1, O2) over-corrects later and costs
points, so the overtake regime is not where the 2026 error is. The flat forecast is the strength
model at fantasy scale. Sharpening hurts race positions in 2024 and 2025 (position log loss
2.621 -> 2.662, 2.648 -> 2.654; 2026 2.722 -> 2.697), so D is applied to the fantasy simulation
only, never to the published race odds.

Decision: D passes (MAE better in 2025 and 2026, 2024 identical; robust: 2025 not significant,
2026 significantly better). O1, O2 and O1+D fail (significantly worse 2025). D kept as
`fantasy.strength_sharpness` (1 for 2024, 1.5 from 2025).

Published (official `f1ml.backtest` rerun with D, 5575 s; history, backtest.json, predict,
run.ts regenerated). Robust paired vs the previous published history (N = 200): 2024 0 (identical),
2025 -6.0 (SE 10.6, z -0.56), 2026 +94.3 (SE 18.0, z +5.23). Single run site method: 4737 / 5140 /
4437. Backup of every overwritten file: data/_backup_dispersion_20261014-2139/.

## Round 5: site policy fix and sharpness round 2 (2026-10-15)

Discrepancy (site 2026 total 4437 vs evaluate.ts plain run 4634): run.ts re-fitted the objective
and threshold from one replay per earlier season. With the new history 2024 + 2025 value:0 beat
expected:0 by noise, so 2026 used the value objective; evaluate.ts used expected, 0. A second
single-run rule (switch to value of money + all six chips when it wins 2025 + 2026) also flipped,
so the site file had shown that method since round 4. Fix: `SITE_POLICY` (expected, threshold 0)
shared by the site row and the robust worker, and the site method pinned to the round 2 decision
(the switch rule only adds a note). Site now 4737 / 5140 / 4634 = evaluate.ts seed 0. Blend
weights were not involved (same in both).

Sharpness round 2 (`ml/scripts/exp_dispersion/round2.py`), k grid 1 to 2.5 in 0.25 steps, 2024
prior k = 1, walk-forward squared lock error. pub = published (1.5 from 2025). J = one k (2025:
2.25, 2026: 1.75). K = per kind (2025: drivers 2.0, constructors 2.5; 2026: 1.5, 1.75). Per stage
not run (only lock inputs cached).

| variant | driver MAE 25 / 26 | driver slope 25 / 26 | constr MAE 25 / 26 | robust vs pub 2025 | robust vs pub 2026 |
|---|---|---|---|---|---|
| pub | 10.100 / 11.455 | 0.90 / 1.10 | 16.83 / 18.07 | | |
| J | 10.122 / 11.459 | 0.84 / 1.06 | 16.62 / 17.99 | -41.8 (14.7), z -2.84 | +59.9 (17.8), z +3.36 |
| K | 10.112 / 11.455 | 0.85 / 1.10 | 16.59 / 17.99 | -19.0 (22.2), z -0.86 | +93.9 (18.8), z +5.01 |

(2024 identical, N = 100, sigma 3%.) Decision: neither kept. Driver MAE is not better in any
season, slope better only for J in 2026, and J is significantly worse in 2025. Published stays.

Noise warning: the rebuilt pub history (same method, re-simulated from the cache, price
change from 4000 samples) differs from the published files by tiny amounts per asset yet scores
+22 / -152 / -170 in the paired robust check (z up to -8). The 3% iid perturbation does not
cover this kind of systematic drift, so the robust z is only valid between histories built
the same way (as here: J and K vs rebuilt pub).

## Round 6: combined noise test and sharpness per stage (2026-10-15)

D (published sharpness 1.5) vs base, combined test, B = 8 builds, N = 100:

| season | per-build paired means | mean | within SE | between SD | combined SE | t (crit 2.36) |
|---|---|---|---|---|---|---|
| 2024 | 2, -3, -7, -2, 0, -1, 2, 6 | -0.3 | 5.8 | 0 | 1.3 | -0.24 |
| 2025 | -38, 39, 4, -9, -27, -33, -21, -12 | -12.1 | 19.5 | 14.9 | 8.7 | -1.39 |
| 2026 | 81, 3, 16, 96, -69, 32, 14, 118 | +36.3 | 21.5 | 56.4 | 21.3 | +1.70 |

The round 4 claim (2026 +52, z +2.89) does not survive: with rebuild drift the 2026 gain is
+36 +- 21, not significant (B = 4 gave +49, t 2.13 vs 3.18). D stays published on its lock MAE
and slope gains (which met the keep rule), but its season-total gain is unproven. Note: 2024 is
k = 1 in both yet differs by up to 7 points, because `fantasy._draw_overtakes` draws with the
global torch generator (not the seeded one), so even same-seed builds are not bit-identical.

Sharpness per stage (`stages.py`, all four stages cached once, k grid 1 to 2.5, 2024 prior 1,
walk-forward squared error; stage = one k for both kinds, stageKind = k per kind). Driver MAE /
slope, 2025 and 2026 (2024 identical everywhere):

| stage | pub (k 1.5) | stage fit (k 25 / 26) | stageKind fit (driver k 25 / 26) |
|---|---|---|---|
| pre-weekend | 10.338 / 11.647, 1.01 / 1.13 | 2.5 / 2.5: 10.185 / 11.656, 0.89 / 1.01 | same as stage |
| post-practice | 9.384 / 10.932, 0.97 / 1.10 | 2.5 / 2.0: 9.409 / 10.968, 0.90 / 1.05 | 2.25 / 1.5: 9.401 / 10.932, 0.91 / 1.10 |
| post-qualifying | 8.665 / 11.033, 0.96 / 1.02 | 2.5 / 1.75: 8.699 / 11.041, 0.91 / 1.00 | same as stage |
| lock | 10.099 / 11.454, 0.90 / 1.10 | 2.25 / 1.75: 10.122 / 11.461, 0.84 / 1.06 | 2.0 / 1.5: 10.110 / 11.454, 0.85 / 1.10 |

Constructors improve slightly with larger k at every stage (e.g. lock 16.83 -> 16.59 in 2025),
but the rule is on drivers. Decision: nothing kept; no stage gets both seasons better on MAE or
on slope (the fit overshoots in 2025: slope 0.84 to 0.91), so the combined test was not needed
and the published version stays. Full table: `ml/reports/exp_dispersion/stages_metrics.json`.

## Round 7: reproducible builds and D recheck (2026-10-15)

Fix: `fantasy._draw_overtakes` drew with torch's global generator; it now uses the seeded
scoring generator (`rng.poisson`). No other unseeded draw in fantasy, simulate or forecast.
Test `ml/tests/test_fantasy_seed.py`: same seed, global RNGs disturbed in between, identical
points. Two builds of base with the same seed are byte-identical.

D vs base, combined test, B = 8, N = 100 (rebuilt after the fix):

| season | per-build paired means | mean | within SE | between SD | combined SE | t (crit 2.36) |
|---|---|---|---|---|---|---|
| 2024 | all 0 | 0 | 0 | 0 | 0 | 0 |
| 2025 | -34, 13, -20, 9, -30, -39, -28, -23 | -18.8 | 20.0 | 0 (was 14.9) | 6.8 | -2.74 |
| 2026 | 95, 26, 38, 88, -54, 13, 23, 104 | +41.4 | 22.1 | 47.7 (was 56.4) | 18.6 | +2.23 |

The 2026 gain is still not significant. 2025 is now significantly worse, which breaks the
"robust not significantly worse in any season" clause of the round 4 keep rule. D stays
published for now (the coordinator asked for the decision to stand); reverting is flagged.

Republished for the seeding fix (official backtest 6015 s, predict, run.ts): lock driver MAE
8.56 / 10.10 / 11.41, constructors 14.23 / 16.85 / 17.94; site 4827 / 5140 / 4634.
Backup: data/_backup_seedfix_20261015-0117/.

D reverted (2026-10-15, declared rule): FANTASY_SHARPNESS = 1, seeding fix kept. Republished
(official backtest 5295 s, predict, run.ts): lock driver MAE 8.56 / 10.16 / 11.56, constructors
14.23 / 17.30 / 18.48; site 4827 / 5140 / 4281. Backup of the D outputs:
data/_backup_revertD_20261015-0305/.
