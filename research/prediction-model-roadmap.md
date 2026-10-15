# Prediction model roadmap

Research note, 2026-10-08. Scope: race finishing order, win/podium/points odds, title odds and
fantasy points in `ml`, and how the site uses them (`site/src/components/forecast`,
`site/src/lib/fantasy`).

What was done: read `ml/README.md`, `ml/REPORT.md`, `ml/f1ml/` (features, bundle, gbm, plackett,
simulate, forecast, nn, fantasy, stack2, evaluate, compare), `ml/reports/` (v2 evaluation and
comparison outputs), `ml/models/params.json`, `data/predictions/history/`, `SPEC.md`,
`INTEGRATION_TODO.md`, the FastF1 `PROGRESS.md`, and web sources (listed at the end). No training,
backtest or simulation was run. No file under `data` or `ml/models` was touched. Code
findings are from reading, not from tests, except where a number is quoted from an existing report.

---

## 0. Summary

The model is sound in its basics: point-in-time features, a per-stage ranker, a set transformer,
a Plackett-Luce layer with a position dependent temperature, and a GPU Monte Carlo that keeps every
published number in the same simulated worlds. Post-qualifying it beats the grid-order baseline on
Spearman (0.700 vs 0.679) and on win log loss (1.237 vs 1.547). Its weak points are not the core
model. They are these:

1. **The evaluation is weaker than the numbers suggest.** The 2024-26 holdout was looked at while
   designing two of the published choices (the pole bonus and the schedule window), so it is not a
   clean test. It has 64 races, so the win-accuracy 95% interval is about plus or minus 0.12.
   The "winner" metric (argmax per race) is noisy and improper.
2. **Title odds are not validated at all.** No backtest of championship probabilities exists. The
   two drift sizes that drive them (team 0.25, driver 0.10 on the strength scale) are assumptions.
   Team-level retirements are not modelled, so teammates retire independently.
3. **The v2 stack (`stack2.py`) is not better than v1 on current evidence.** Post-qualifying win log
   loss gets worse (1.237 to 1.343, 95% interval about -0.003 to +0.230 on the 64 races). Spearman is
   unchanged. Weather adds nothing so far.
4. **The 2026 reset is handled only by flags.** Team form is an exponentially weighted average over
   the last 40 team rows across eras. Nothing discounts 2025 car results when the regulations
   change. Round 1 to 4 of reset years are about 0.09 Spearman worse (REPORT).
5. **Pre-weekend calibration of the top and the midfield is off.** The leader gets about 16 expected
   points per round against 20 realised, and drivers expected to score 6 to 15 are over-predicted
   by 1 to 2.5 points.
6. **Practice pace is only partly used.** Practice best laps come from F1DB for every season, but
   long-run pace from FastF1 covers about a quarter of 2026 rows. The FastF1 download for 2018-22 is
   still running (PROGRESS: 389 sessions left at last update, 2018 not started then).

Top actions, in order:

- Lock an evaluation protocol and a scorecard built on proper scores (RPS, log likelihood of the
  realised order, PIT and calibration), computed from the existing `history/*.json` files.
- Backtest title odds and fit the drift sizes on past seasons only. Add team-level retirement
  shocks to the simulator.
- Discount pre-reset team form in reset years and check it on 2014, 2017, 2022 and 2026.
- Recalibrate pre-weekend expected points with a walk-forward monotone map.
- After the FastF1 download finishes: rebuild the tables, add long-run and degradation features for
  2018-26, and rerun the ablation.
- Medium term: a dynamic Plackett-Luce state-space model with team and driver strengths that evolve
  race to race and a reset-aware innovation variance. It gives both better base strengths and
  honest uncertainty for title odds.

---

## 1. The model as built

| Part | What it does | Where |
|---|---|---|
| Target | Classified finishing order (retirements are a separate binary target); qualifying order | `gbm.train_ranker`, `features.py` label columns |
| Features | Driver form (EW finish, quali, points), team form (EW best quali gap, finish, mechanical DNF), team-mate deltas, circuit history, track type (3 clusters), reliability, standings, era, practice gaps, long-run pace, sprint, grid and penalties | `features.py:30-54`, `History._target_features` 227-258 |
| Stages | `pre-weekend`, `post-practice`, `post-qualifying`; inputs blanked per stage | `features.stage_frame` 95-108, `forecast.STAGE_INPUTS` |
| Base models | XGBoost rankers per stage (pairwise, or NDCG for post-quali), tuned on 2021-23 with Optuna; a set transformer (3 layers, Plackett-Luce loss, 3 seeds); an L2 logistic DNF model plus the network DNF head | `gbm.py`, `nn.py`, `params.json` |
| Stacking | Blend weights of GBM and network scores fitted by Plackett-Luce NLL on the last 30 races; position dependent temperature (a, b, tau) fitted on 96 out-of-sample races; first pick refitted on 48 races; pole bonus for grid slots 1 to 3 | `bundle.fit_bundle`, `bundle.long_window_schedules`, `plackett.py` |
| Simulation | Quali, sprint, race drawn pick by pick (Gumbel trick), retirements first; 20,000 worlds on GPU | `simulate.py` |
| Fantasy | Points from the same worlds with official rules; overtakes, fastest lap, DOTD and pit points from small refitted models | `fantasy.py` |
| Title odds | This weekend's simulated points plus each remaining round (pre-weekend features) and a per-season team and driver offset | `simulate.simulate_championship`, `forecast.championship` |
| Validation | Walk-forward, retrain every 3 rounds, 2024 to 2026 R16 (64 races) | `backtest.py`, REPORT |

Published metrics (REPORT, 64 races, post-qualifying): winner 0.547 (grid baseline 0.594), podium
0.656 (baseline 0.688), Spearman 0.700 (0.679), MAE 3.27 (3.22), win Brier 0.0305 (0.0290), win log
loss 1.237 (1.547). Pre-weekend Spearman 0.624 against 0.599 for championship order.

Calibration (REPORT): expected calibration error post-quali win 0.011, podium 0.019, points 0.059.
Pre-weekend points 0.048. Fantasy driver MAE at the lock 9.97 and post-quali 9.24, against 13.30 for
the last-3-rounds baseline.

---

## 2. Weaknesses, ranked by expected impact

Each item has the evidence, then the consequence. Impact is my estimate.

### 2.1 Evaluation protocol (high)

- REPORT lines 165-168 and 176-179 say the schedule window and the pole bonus were chosen after
  looking at the 2024-26 results. The text says the choices "were checked on 2019-2023" too, but
  the investigation started from the 2024-26 backtest (REPORT 332-334). Those two choices are
  therefore tuned against the holdout. Treat the 2024-26 numbers as optimistic by a small amount.
- 64 races give wide intervals. Post-quali winner accuracy 0.547 has a 95% bootstrap interval of
  [0.422, 0.672] (`reports/v2/compare_v2.md`). A winner-accuracy difference of 0.05 is invisible at
  this size.
- `winner` (argmax per race) is improper and throws away the distribution. Use proper scores
  (section 3).
- Calibration bins with 5 to 14 races (REPORT 58-60) are noise. Several calibration claims rest on
  them.
- Reporting bug: `ml/reports/v2/compare_v2.md` has a "2019-26 (64 races)" section. It is the same
  64 races as 2024-26. `compare.py:27` defines the period, but the v1 2019-23 snapshot it reads
  (`v1_races_2019_2023.json`, `compare.py:119`) is not in `reports/v2/`, and the v1 2019-23 log
  (`v1_backtest_2019_2023.log`) stops at race 202017. So v1 versus v2 on 2019-23 has never been
  computed. The v2-only evaluation does cover 168 races (2019-26, `eval_v2.json`), which is the
  data to use. Its own log shows 2019-23 post-quali winner 0.615, log loss 1.108, and 2024-26
  winner 0.547, log loss 1.343.

### 2.2 Title odds (high, and the site shows them prominently)

- No backtest. `backtest.py` and REPORT never score `championship.drivers[].pTitle`. Today's
  Antonelli 99.6% title probability with an 84-point lead and 7 rounds left (REPORT 195-203) is a
  claim that has never been checked against outcomes.
- Two numbers drive the spread and are assumptions: team sigma 0.25 and driver sigma 0.10 on the
  strength scale (`simulate.py:165`, applied at 185-188; REPORT 115-116 and 326-327 say so).
- Teammates retire independently. `simulate.py:90-91` draws retirements per car from the car's own
  pDnf. Real team-level mechanical failures hit both cars and are a large part of title variance.
- Future rounds use features frozen at the current race (`forecast.py:147`,
  `features.py:194-203`). This weekend's simulated form does not feed later rounds except through
  points. Small, but it biases the odds in the direction of the pre-weekend form.
- Remaining-points intervals are not scored. The cheapest proper test is PIT (probability integral
  transform) of realised remaining points against the simulated distribution, per driver and round.
  That gives thousands of samples instead of seven title outcomes.

### 2.3 Pre-weekend calibration of the top and midfield (medium-high)

- REPORT 216-225: expected points at 6 to 10 are 8.07 predicted against 10.73 realised; at 15 to 20,
  16.97 against 16.51. The model moves 1 to 2.5 points per race from the second tier to the back.
  Leader expected points were about 8 per round before the fix and 16 now (INTEGRATION_TODO).
- Likely cause: GBM ranker scores have no meaningful scale, and the single `race_gbm_ratio`
  (`bundle.py:293-306`) maps them onto the strength scale using the spread of the validation window.
  Trees also shrink extremes. The temperature is one global schedule, so the front and the midfield
  share a sharpness. A walk-forward monotone map of predicted to realised points fixes the symptom
  without refitting the base models.

### 2.4 The 2026 regulation reset (medium-high)

- Era flags exist (`ERA_STARTS`, `rounds_since_reset`, `reset_season`, `features.py:25`) and
  current-season averages take over after about round 8 (REPORT 293-296).
- Team form is an exponentially weighted average over the last 40 team rows regardless of era
  (`features.py:375-401`, `_before(..., 40)`). Half-lives are 3 and 8 races, so 2025 cars still
  dominate the first 3 to 5 rounds of 2026. Recency weights in training were tried and did not
  help, but that test changed training weights, not the team-form features. Discounting pre-reset
  rows in the team and driver form features was not tested.
- Also check that quali gap features (`t_qgap_e3`) are normalised per era. Gaps to pole are
  era-neutral, but the team-level and cluster deltas (`t_cluster_qgap`) are not standardised within
  a season.

### 2.5 Practice and tyre data (medium)

- Practice best laps come from F1DB for every season (REPORT 335-336). Long-run pace from FastF1
  (`longrun.py`: fuel and tyre corrected stints of 5+ laps, compound offsets, pooled slope) is
  used for about a quarter of 2026 rows and no earlier rows. Practice is the second most important
  input after qualifying (dNLL +0.403 when removed, REPORT 268 to 272).
- `longrun.py` already has a degradation slope and compound offsets, but they are not used as
  per-driver features in the stacked model. Their value is unknown until the 2018-22 data is in.
- No tyre strategy, pit-stop or safety car simulation exists in the main path. Safety car and rain
  appear only as a dispersion term in the experimental `stack2`.

### 2.6 Weather (low now, medium later)

- `weather.py` (Open-Meteo archive and archived forecasts) feeds `stack2`. The no-weather ablation
  is within noise: post-quali log loss 1.335 without weather against 1.343 with it, and winner
  accuracy 0.531 against 0.547 (`eval_no_weather.log`).
- Rain is the largest miss (REPORT 321-322), but there are only a handful of wet races in the
  backtest, so the test has little power. Treat weather as a dispersion multiplier on race strength
  (more chaos when wet) rather than as a mean shift.

### 2.7 Reliability (medium-low)

- Retirements are modelled per car with AUC 0.55 to 0.62 (REPORT 320). Only the level is modelled.
  The logistic DNF model is a good choice for that.
- Missing: team-level common shocks (see 2.2), and a link between retirement risk and how hard a
  car is pushed (energy management under the 2026 rules may matter here).

### 2.8 Team upgrades and driver or team changes (medium)

- No explicit upgrade signal. Team form lags upgrades by several rounds. Practice gaps and
  quali gaps are the fastest signals, and they are already in the model, but they are pooled
  with the older form.
- Driver and team changes are handled through lineage (`data.lineage_of`) and team-mate deltas.
  New drivers have no history (`d_starts` = 0, features NaN). There is no prior from junior series.

### 2.9 Track type similarity (low-medium)

- Three clusters (street, high-speed, medium) in `features.py` (`_cluster_delta`, `c_street`,
  `c_speed`). Coarse. A similarity based on corner and speed profiles from FastF1 would be a better
  kernel for "this team is strong at circuits like this".

### 2.10 Simulation details (low)

- The sprint is simulated with the race schedule and the race strength (`simulate.py:282`, `286`),
  not sprint-specific parameters. `SPRINT_DNF_FACTOR = 0.35` is hard-coded (`simulate.py:25`).
- Quali and race are independent given strengths before qualifying, so the grid-to-finish spread is
  wider than reality (REPORT notes this, and it inflates fantasy p10 and p90 before qualifying).

### 2.11 Fantasy (medium, presentation)

- Driver forecast MAE 9.24 post-quali against 13.30 for the last-3 baseline, interval coverage
  0.83 for a nominal 0.80 (REPORT 237-245). Good, but slightly wide.
- "Fantasy scoring error about 2.6 points per driver" in `INTEGRATION_TODO.md` is the error of
  reconstructing actual scores from free data, not forecast error. The two must not be mixed on the
  site. Forecast MAE is about 9 points per driver.
- Overtakes are the weakest part in 2026 (about 4.9 per driver per race against 3.3 in 2025; the
  model was weakest early in 2026, REPORT 328-329). A regime-aware overtake rate would help.

### 2.12 Things I checked and found sound

- Point-in-time construction. Every history query takes a `cutoff` and only reads `raceId < cutoff`
  (`_before`, `features.py:495-505`), for drivers (`_driver_features`), teams (`_team_features`),
  circuits (`_circuit_features`), season DNF rate (`_season_dnf_rate`), standings
  (`_previous_round_id`) and the reset count (`_rounds_between`). Labels are attached only for the
  target race (`_attach_labels`, 479-493). I did not run a numerical leakage test.
- Stacking uses out-of-sample scores: blend weights and schedules are fitted on races the base
  models did not train on (`fit_stack`, `long_window_schedules`, `oos` chunks).
- Retired cars are excluded from order likelihoods (`_finishers_only`, `bundle.py:282-290`). This
  was a real bug, now fixed, and the REPORT explains it well.

---

## 3. Evaluation: what to measure and how

Scorecard (compute from `data/predictions/history/*.json`, which holds `positionDist`, `pTitle`,
`expectedPoints`, `pPodium`, `pPoints` and the `actual` block, and from `backtest` outputs):

- RPS (ranked probability score) on the position distribution, per driver and per race, against
  the grid baseline and the last-3 baseline. Constantinou and Fenton argue for RPS on ordered
  outcomes. Wheatcroft argues it is not sensitive enough and prefers the ignorance score, so report
  both.
- Log likelihood of the realised full classified order under the forecast Plackett-Luce strengths.
  This is the model's own training target, so it is the most direct check on the layer that the
  Monte Carlo uses.
- CRPS on the position distribution, or on expected position, for a continuous summary.
- Brier and log loss on `pWin`, `pPodium`, `pPoints`, plus the Murphy decomposition
  (reliability, resolution, uncertainty) so that "calibrated but uninformative" is visible.
- Calibration slope and intercept (logistic recalibration) per stage, and reliability bins with at
  least 15 cases. Show the number of cases on every bin.
- PIT histograms for realised position, realised points and realised remaining season points. A
  flat histogram means the distribution is right in width as well as location.
- Title odds: log loss of the eventual champion's pTitle at each round, and PIT of the realised
  remaining points.
- Fantasy: CRPS or interval score for points, coverage of p10 to p90 by season, price-change
  probability log loss.
- Uncertainty on everything: paired bootstrap over races (not over drivers), per season, with the
  number of races stated.

Protocols (fix them in writing before each experiment):

- Tuning: 2019-23 only.
- Selection: 2024-25. Compare candidate changes here.
- Holdout: 2026 from round 17 onward (Singapore and later), scored once, with the decision rule
  written down beforehand.

Accept rule: a change ships when it improves mean RPS and log likelihood on the 2019-26 walk-forward,
with a paired bootstrap interval that excludes zero, and no season gets worse by more than a set
margin (suggest 0.02 RPS).

---

## 4. Roadmap

Impacts are my judgement of the effect on the published numbers (sharpness, calibration, fantasy
error). Each item lists how to measure it and the files it touches. Nothing here has been run.

### 4.1 Quick wins (days)

**QW1. Lock the protocol.** Write the tuning, selection and holdout split (section 3) into
`research/` before the next experiment. Mark 2026 round 17 onward as the holdout.
- Impact: prevents further optimism in the reported numbers. Low compute.
- Measure: n/a (process). Files: `research/` only.

**QW2. Scorecard from the history files.** Write a read-only script that scores every
`data/predictions/history/*.json` file on RPS, log likelihood of the realised order, Brier and log
loss for pWin, pPodium and pPoints, PIT, and a calibration table with case counts. Output to
`ml/reports/scorecard.json`.
- Impact: the first honest view of calibration, and the baseline for every later change. High.
- Measure: scorecard numbers for 2024 to 2026 against grid and last-3 baselines, paired bootstrap.
- Files: new `ml/scripts/scorecard.py` (reads `data/predictions/history/`, writes `ml/reports/`).

**QW3. Fix the comparison report.** `compare.py:27` and `:119` label a 64-race result "2019-26" and
read a missing v1 2019-23 snapshot. Either regenerate the v1 2019-23 records (the backtest log
stopped at 202017) or drop that section and say so.
- Impact: removes a misleading table. Trivial.
- Measure: race counts in `compare_*.md` match the period names.
- Files: `ml/f1ml/compare.py`, `ml/reports/v2/compare_*.md`.

**QW4. Title-odds backtest and drift fit.** For 2024 to 2026 (history files have `championship`
blocks), score pTitle against the eventual champion and PIT the realised remaining points. Then
refit the team and driver drift sigmas on 2019-23 only (grid 0.0, 0.1, 0.25, 0.4 for each), and
check on 2024-25. This needs the future-round strengths stored per round, which the backtest does
not save today, so extend the backtest to store them. Re-running the simulator is cheap (about
0.1 s per weekend on GPU), but the backtest run is about 35 minutes and should be scheduled, not run
ad hoc.
- Impact: directly addresses the title odds being too sharp. High for the site.
- Measure: title log loss, PIT of remaining points, coverage of the 80% interval for remaining points.
- Files: `ml/f1ml/simulate.py` (drift defaults), `ml/f1ml/forecast.py` (championship block),
  `ml/f1ml/backtest.py` (store future-round inputs).

**QW5. Team-level retirement shocks.** In `simulate_weekend` and `simulate_championship`, add a team
event per race (both cars retire together, e.g. a power unit or hydraulics failure), with the event
probability set so that each car's marginal pDnf is unchanged. Estimate team co-retirement rates from
the history.
- Impact: widens title odds in a realistic way and makes teammate retirements correlated. Medium.
- Measure: teammate co-retirement rate in history against the simulated rate; title PIT.
- Files: `ml/f1ml/simulate.py`, `ml/f1ml/fantasy.py` (joint outcomes for constructors).

**QW6. Era-discounted team and driver form in reset years.** In `_team_features` and
`_driver_features`, multiply the weight of rows from before the reset by a factor lambda (fit on the
2014, 2017 and 2022 transitions only, then tested on 2026). Keep the rest of the feature definitions.
- Impact: targets the rounds 1 to 4 of 2026 gap (about 0.09 Spearman in past resets). Medium, in
  a few races only.
- Measure: Spearman and post-quali NLL over rounds 1 to 8 of 2014, 2017, 2022 and 2026, walk-forward.
- Files: `ml/f1ml/features.py` (`_team_features`, `_driver_features`).

**QW7. Walk-forward recalibration of expected points and pWin.** Fit a monotone map (isotonic, or a
two-parameter logit slope and intercept) from predicted to realised values on the 2019-23 history,
then check on 2024-25. Apply the same map to the published pre-weekend numbers. Do not fit it on the
race being published.
- Impact: fixes the 6 to 15 point tier and the leader's expected points, without touching base models.
  Medium-high for the site.
- Measure: ECE and calibration slope on expected points by bin, plus RPS on positions.
- Files: `ml/f1ml/forecast.py` or `ml/f1ml/export.py` (new calibration step), coefficients stored
  next to `models/` (not inside `models/`, which is off limits for this task).

**QW8. Site text.** Keep "2.6 points" (reconstruction error on actual scores) and "9 points" (forecast
MAE) distinct on the fantasy page and in the methodology text. Owner: site copy.
- Impact: avoids a misleading number. Trivial.

### 4.2 Medium (weeks)

**M1. Dynamic Plackett-Luce state space (main medium-term bet).** Model every team and driver as a
latent strength that follows a random walk race to race, with an innovation variance that is larger
at reset years (estimated from 2014, 2017, 2022 transitions). Observations: the realised finishing
order of classified cars (Plackett-Luce likelihood), with the stage's pace features as covariates.
Fit by MAP or Laplace in torch on GPU first, and in NumPyro later if it is needed. Its output is a
strength per car plus a posterior spread, which the Monte Carlo can draw from instead of the fixed
drift sizes.
- Impact: the most principled fix for both the reset handling and the title odds. Expected to
  help rounds 1 to 8 of reset years and the championship tails. Medium-high.
- Measure: full-order log likelihood walk-forward 2019-26, reset-year rounds 1 to 4 Spearman, title
  PIT. Compare against the current stack.
- Files: new `ml/f1ml/dynpl.py`; `ml/f1ml/bundle.py` (as a base score); `ml/f1ml/simulate.py`
  (draws of strengths per simulated season).
- Related: Henderson and Kirrane (2018) found that discounting older results sharpens Plackett-Luce
  forecasts for F1, and Powell (2023) gives an online Plackett-Luce rating for the same purpose.

**M2. Long-run pace and tyre degradation for every season.** When the FastF1 download finishes
(2018-22 still pending): rebuild `ff1_*` tables with `f1p.fastf1.build_tables`, rebuild features,
and add per-driver long-run pace and a per-circuit, per-compound degradation slope from the
`longrun.py` stints. A state-space degradation model (arXiv 2512.00640) is a reference for the
slope estimator. Then rerun the ablation.
- Impact: practice has the second biggest effect, and long-run pace is currently missing for most
  seasons. Medium, and it lifts the post-practice stage most.
- Measure: post-practice NLL and Spearman walk-forward 2019-26, with and without long-run features.
- Files: `ml/f1ml/longrun.py`, `ml/f1ml/features.py` (practice block), pipeline
  `f1p.fastf1.build_tables`. Blocked on the download, which should not be stopped for this.

**M3. Split conformal intervals for expected points and positions.** Calibrate on a rolling window of
recent races (not all history: rule changes break exchangeability). Use it to set the p10 and p90
for fantasy points and the position intervals, and to report set-valued podium predictions with a
stated coverage. Current p10 to p90 coverage is 0.83 for a nominal 0.80, so the gain is in
calibrated width and in honest reporting, not in fixing a big miss.
- Impact: honest intervals per season. Medium-low for accuracy, medium for trust.
- Measure: coverage by season, mean interval width, and the interval score.
- Files: `ml/f1ml/fantasy.py` (`summarize_points`), `ml/f1ml/export.py`.

**M4. Upgrade change points.** Detect step changes in each team's practice and quali gap (a simple
Bayesian online change-point detector on the team's gap series), and let team form restart at a
detected change. Manual flags from published upgrade news are free and can override the detector.
- Impact: helps mid-season upgrades in 2026 (Ferrari and McLaren developments are the obvious
  test cases). Medium-low.
- Measure: Spearman and NLL after detected changes versus no change, walk-forward 2026.
- Files: `ml/f1ml/features.py` (team block), new small module.

**M5. Circuit similarity from telemetry.** Replace the three clusters with a similarity from FastF1
corner and speed profiles (per circuit), and use kernel-weighted team form at similar circuits.
- Impact: better track-type effects, especially for new venues. Medium-low.
- Measure: ablation of circuit features, walk-forward NLL 2019-26.
- Files: `ml/f1ml/features.py` (`_cluster_delta`, circuit features), pipeline FastF1 positions data.

**M6. Weather as dispersion.** Use the forecast rain probability (already in `weather.py`) as a
multiplier on the strength scale in the Monte Carlo (more randomness when wet), instead of a mean
term. Keep the wet-skill term only if it survives the ablation.
- Impact: rain races are the largest misses; the current mean-shift approach shows no gain. Low-medium.
- Measure: wet races only (the 2019-26 eval has a few), and overall RPS to confirm nothing gets worse.
- Files: `ml/f1ml/simulate.py`, `ml/f1ml/stack2.py` (or its successor).

**M7. Future rounds see this weekend.** Update the team and driver form used for the title odds
with this weekend's simulated outcomes (a one-step update, or a shift in team strength from the
weekend's expected team points). Keep it simple and test it.
- Impact: small, but it removes a known bias in the title odds. Low-medium.
- Measure: title log loss and PIT of remaining points with and without the update.
- Files: `ml/f1ml/forecast.py` (`championship`), `ml/f1ml/features.py`.

**M8. Keep one stack.** Decide between v1 and `stack2` on the 2019-26 walk-forward with the proper
scores and the accept rule. `stack2` is not better on current evidence and it adds complexity. If it
does not win, delete it or move it out of the production path.
- Impact: simplicity and maintenance. Measure: as in section 3.
- Files: `ml/f1ml/stack2.py`, `ml/f1ml/evaluate.py`, `ml/f1ml/compare.py`.

**M9. Rookies and new entrants.** Add a prior from junior series results (F2 or F3) where a free,
licence-clear source exists. Check the licence before using it, since the project is free-data only.
- Impact: for rookies and debutants only, but those are the rows with the largest errors. Low-medium.

### 4.3 Ambitious (months)

**A1. Full hierarchical Bayesian Plackett-Luce (NumPyro or PyMC).** Extend M1 with the full hierarchy:
team and driver effects, a season-level shift, a reset effect, a circuit-type effect, and team-level
retirement shocks. Run NUTS offline, store posterior draws, and feed them to the Monte Carlo so that
title odds and fantasy intervals include parameter uncertainty. This replaces the fixed drift sizes
and the separate temperature fits with one joint model. Fit time is minutes to hours, so it is a
scheduled job, not a per-race step.
- Impact: the most honest title odds and the cleanest reset behaviour. High if it works, high cost.
- Measure: log likelihood on held-out races, title PIT, coverage of interval bands.

**A2. Lap-level race simulator for strategy-sensitive races.** Replace the pick-by-pick Plackett-Luce
race with a lap-level simulation: fuel-corrected lap time per car, tyre degradation per compound,
traffic penalties, pit windows, safety car and virtual safety car (rates from `chaos.py`), using
common random numbers for comparisons (as in PITWALL, github.com/Ad1th/pitwall; its maturity is
unverified). Use it for the races where strategy and safety cars decide the order, and keep the
Plackett-Luce layer as the default for the rest.
- Impact: physically grounded spreads and better sprint and strategy handling. High cost, uncertain
  gain against a strong statistical baseline. Start with a validation on past races before any use.
- Measure: RPS and log likelihood against the current model on 2019-26.

**A3. Season as a sequence.** Train one network over the rounds of a season (a latent team state
updated after each race), with a Plackett-Luce head per race and an RPS-aligned auxiliary loss. This
would learn the reset and upgrade dynamics from data instead of from features. Risky with about 170
training races; consider only after M1 and M2 are in.

**A4. Learned calibration layer.** After M1, fit a small calibration network or a conformal wrapper
on the rolling window (as in M3) that maps the Monte Carlo output to the published probabilities.
Only if QW7 and M3 leave a measurable gap.

---

## 5. Suggested order of work

1. QW1 and QW2 first: they change what "better" means and make every later step measurable.
2. QW3 (fix the compare report) with QW2, since they touch the same outputs.
3. QW4 and QW5 together: title odds are the most visible claim and the least checked.
4. QW6 and QW7: the reset and calibration fixes, then re-score with QW2.
5. When the FastF1 download is done: M2.
6. M1 in parallel with the above once QW2 exists. It is the main architectural step.
7. M8 once M1 and M2 give a comparison.
8. A1 only after M1 has earned its place.

---

## 6. Caveats

- Everything above is from reading code and existing reports. No backtest, simulation or training
  was run, so impact estimates are judgement, not measurement.
- The v1 2019-23 comparison is missing (see 2.1), so claims about v1 versus v2 before 2024 are not
  supported by the current files.
- Web search was thin for the specific F1 questions. The F1 papers found are small, mostly 2018-2025,
  and mostly not calibration studies. I did not find a published study of calibrated F1 title odds.
- PITWALL's maturity and licence, and the F1 StratLab models, are unverified. The 2026 season
  standings that appeared in search results were inconsistent, so I did not use them.
- The FastF1 download is still running per its PROGRESS file. This note assumes it is still in
  progress on 2026-10-08. Do not stop it for these items.

---

## Sources

Papers and reports (web search, 2026-10-08):

- Henderson, D. and Kirrane, L. (2018). A comparison of truncated and time-weighted Plackett-Luce
  models for predicting Formula One results. Bayesian Analysis 13(2).
  https://projecteuclid.org/journals/bayesian-analysis/volume-13/issue-2/A-Comparison-of-Truncated-and-Time-Weighted-PlackettLuce-Models-for/10.1214/17-BA1048.full
- Bayesian analysis of Formula One race results: disentangling driver skill and constructor advantage
  (arXiv 2203.08489; only the reference list was seen, so the model is unverified).
  https://arxiv.org/pdf/2203.08489
- Powell, B. (2023). Generalizing Elo (online Plackett-Luce ratings, Journal of Quantitative Analysis
  in Sports). Preprint: https://www-users.york.ac.uk/~bp787/Generalizing_Elo_arxiv.pdf
- Rane (2025). Predicting Formula 1 race outcomes: decomposing the roles of drivers and constructors
  through linear modeling (arXiv 2508.00200).
  https://arxiv.org/pdf/2508.00200
- Weissbock, J. and Mills, S. (2025). Evaluating the predictive power of qualifying performance in
  Formula One Grand Prix (arXiv 2507.10966). Qualifying predicts finish better than grid or practice.
  https://arxiv.org/abs/2507.10966v1
- Weissbock and Mills (2025). Re-evaluating the qualifying/finish relationship in Formula One (Wharton
  Sports Analytics Journal submission).
  https://wsb.wharton.upenn.edu/wp-content/uploads/2025/12/WEISSBOCK_WSA_F1-Submission.pdf
- A state-space approach to modelling tire degradation in Formula 1 racing (arXiv 2512.00640).
  https://arxiv.org/pdf/2512.00640
- PITWALL, open-source race reconstruction and Monte Carlo strategy evaluation with FastF1 (maturity
  unverified). https://github.com/Ad1th/pitwall
- F1 StratLab strategy models (TCN tyre degradation with Monte Carlo dropout quantiles; open source,
  licence not checked). https://huggingface.co/VforVitorio/f1-strategy-models
- Gneiting, T. and Raftery, A. E. (2007). Strictly proper scoring rules, prediction, and estimation.
  Journal of the American Statistical Association 102(477), 359-378. DOI 10.1198/016214506000001437.
- Constantinou, A. and Fenton, N. (2012). Solving the problem of inadequate scoring rules for assessing
  probabilistic football forecast models. Journal of Quantitative Analysis in Sports 8(1). DOI
  10.1515/1559-0410.1418.
- Wheatcroft, E. (2021). Evaluating probabilistic forecasts of football matches: the case against the
  Ranked Probability Score (arXiv 1908.08980). https://arxiv.org/pdf/1908.08980
- Angelopoulos, A. N. and Bates, S. (2021, rev. 2022; monograph 2023). A gentle introduction to
  conformal prediction and distribution-free uncertainty quantification (arXiv 2107.07511).
  https://arxiv.org/pdf/2107.07511
- Conformal win probability for NCAA basketball tournaments (arXiv 2208.08598): conformal win
  probabilities were better calibrated at low probabilities, log loss within about 1% of the best
  method. https://arxiv.org/pdf/2208.08598
- Bradley-Terry-Elo models for supervised and online learning of paired competition outcomes
  (arXiv 1701.08055). https://arxiv.org/pdf/1701.08055
- Partitioned preference and fast Plackett-Luce estimation (arXiv 2006.05067), background for neural
  Plackett-Luce training. https://arxiv.org/pdf/2006.05067

Repository files used (read only):

- `ml/README.md`, `ml/REPORT.md`, `ml/f1ml/{features,bundle,gbm,plackett,simulate,forecast,
  fantasy,nn,stack2,evaluate,compare,longrun,weather,chaos}.py`, `ml/models/params.json`
- `ml/reports/v2/{eval_v2.log,eval_no_weather.log,eval_no_chaos_sprint.log,compare_v2.md,
  compare_no_weather.md,v1_backtest_2019_2023.log}`
- `data/predictions/history/*.json`, `data/raw/fastf1/PROGRESS.md`
- `SPEC.md`, `INTEGRATION_TODO.md`
