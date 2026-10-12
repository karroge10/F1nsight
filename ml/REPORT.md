# f1ml report: how good are the predictions?

Written 2026-10-07, before the Singapore Grand Prix (2026 round 17). All numbers are out of
sample: every forecast was made by a model trained only on races before it (walk-forward), and
hyper-parameters were tuned on 2021 to 2023 only. Everything is free data and trains locally on
an RTX 5070 Ti. Short version: the model is clearly better than simple baselines at ordering
the field, its win probabilities are reasonably calibrated overall, but F1 is noisy. Before a
weekend the favourite wins about a quarter of the time, and once the grid is known "the pole
sitter wins" is still a hard baseline to beat on winner picks.

## Backtest: 2024, 2025 and 2026 R1 to R16 (64 races)

Walk-forward: before race N the bundle is retrained on every race before N (every 3 rounds;
blend weights and temperatures refitted at the same time), fantasy extras refitted before every
race, 20,000 simulations per stage. Metrics are averages over races. `winner` = the highest pWin
won; `podium` = share of the predicted top 3 (by pPodium) that finished on the podium; `MAE` =
mean absolute error of the expected position over all cars; `Spearman` = rank correlation of
expected position with the classification; `Brier win` = mean over cars of (pWin - won)^2;
`log loss win` = -log pWin of the actual winner.

| Forecast | winner | podium | Spearman | MAE | Brier win | log loss win |
|---|---|---|---|---|---|---|
| model, pre-weekend | 0.266 | 0.563 | 0.624 | 3.71 | 0.0410 | 1.917 |
| model, post-practice | 0.313 | 0.557 | 0.632 | 3.55 | 0.0399 | 1.779 |
| model, post-qualifying | **0.547** | 0.656 | **0.700** | 3.27 | 0.0305 | **1.237** |
| baseline: grid order (empirical P(win / podium) by grid slot, 2014-2023) | **0.594** | **0.688** | 0.679 | **3.22** | **0.0290** | 1.547 |
| baseline: championship order (same, by standings position) | 0.313 | 0.578 | 0.599 | 3.89 | 0.0408 | 2.076 |
| baseline: last 3 races form ("betting style") | 0.281 | 0.505 | 0.565 | 4.11 | n/a | n/a |

Honest reading:

- Before the weekend the model beats both pre-weekend baselines on ordering (Spearman 0.624 vs
  0.599 and 0.565) and is level with the championship order on win Brier (0.0410 vs 0.0408).
  Its favourite won 26.6% of races; the championship leader won 31.3%. Picking a winner before
  practice is mostly not possible in this era.
- With the grid known, the model orders the whole field better than the grid (0.700 vs 0.679)
  and has a much better win log loss (1.237 vs 1.547: it rarely gives a winner a tiny
  probability), but "the pole sitter wins" is still the better single pick (0.594 vs 0.547)
  and the grid-slot lookup has a slightly better win Brier (0.0290 vs 0.0305). Pole sitters won
  59% of 2024-2026 races, more than in the training years.
- Ensemble ablation (Spearman of each part alone, post-qualifying): GBM 0.692, network 0.692,
  blend 0.696. Pre-weekend: GBM 0.621, network 0.619, blend 0.618. The network adds a little
  after qualifying and nothing before it on the race order; it carries real weight in the
  qualifying blend and the DNF stack.

By season:

| Season | post-quali winner | post-quali Spearman | post-quali log loss win | pre-weekend winner | pre-weekend Spearman | grid Spearman |
|---|---|---|---|---|---|---|
| 2024 | 0.417 | 0.757 | 1.532 | 0.375 | 0.679 | 0.730 |
| 2025 | 0.625 | 0.668 | 1.032 | 0.167 | 0.577 | 0.653 |
| 2026 R1-16 | 0.625 | 0.664 | 1.101 | 0.250 | 0.614 | 0.641 |

**Calibration** (all 64 races x all cars, expected calibration error): post-qualifying win
0.011, podium 0.019, points 0.059, DNF 0.020; pre-weekend win 0.016, podium 0.047, points 0.048,
DNF 0.014. Post-qualifying win reliability (mean predicted vs observed): 0.10-0.20 bin 0.143 vs
0.145; 0.20-0.30 0.245 vs 0.286; 0.30-0.40 0.338 vs 0.385; 0.40-0.50 0.476 vs 0.667 (n=12);
0.50-0.60 0.559 vs 0.692 (n=13); 0.60-0.70 0.641 vs 0.286 (n=14); 0.80-0.90 0.837 vs 0.800
(n=5). Podium: 0.30-0.40 0.356 vs 0.463; 0.50-0.60 0.545 vs 0.486; 0.70-0.80 0.751 vs 0.800;
0.90-1.00 0.913 vs 0.762. The high bins hold few races, so read them as noisy.

## What the model is

**Three forecast stages**, each with its own inputs:

| Stage | Inputs | When |
|---|---|---|
| `pre-weekend` | history only (form, team pace, circuit, reliability, standings) | before FP1 |
| `post-practice` | + practice best laps and long-run pace; + sprint qualifying and sprint result when they run before qualifying (2024+ format) | after the last session before qualifying |
| `post-qualifying` | + qualifying, official grid, grid penalties, pit lane starts | before the race |

**Base models** (all trained on the GPU):

1. XGBoost rankers (`device=cuda`), one per stage for the race finishing order (classified
   finishers, group = race) and one per pre-qualifying stage for the qualifying order. Objective
   (pairwise or LambdaRank NDCG) and all tree parameters tuned with Optuna, 40 trials per
   study, time based folds (train on seasons before 2021 / 2022 / 2023, validate on that season).
2. A set transformer in PyTorch over the entrants of a race (2 to 3 attention layers, every
   driver attends to the whole field, inputs plus race-centred inputs plus a stage one-hot).
   One network for all three stages: each race is seen three times with the inputs a stage may
   not see blanked. Three heads: race order (Plackett-Luce negative log likelihood, listwise),
   qualifying order (Plackett-Luce) and retirement (binary cross entropy). Seed ensemble of 3.
3. Retirements: a small L2 logistic model (season-to-date field retirement rate, team and
   driver retirement history, circuit retirement rate, running position, grid when known),
   stacked with the network's DNF head. It replaced an XGBoost classifier, which matched the
   base rate (tuned log loss 0.3755 vs base rate 0.3758) and was badly off in 2026, where
   retirements doubled (19.3% of starts vs about 10% in 2024 and 2025).

**Stacking and calibration** (fitted on held out races inside each training window, so it never
sees the race it predicts):

- Blend weights of GBM and network scores, fitted by Plackett-Luce likelihood on the last 30
  races. The network gets a small race weight (it is nearly as good as the GBM on its own,
  Spearman 0.619 vs 0.621 pre-weekend, but highly correlated with it) and a large qualifying
  weight.
- A position dependent temperature: the k-th pick among the remaining finishers is drawn with
  softmax(T_k x strength), T_k = b + (a - b) exp(-(k - 1) / tau). The tail (b, tau) is fitted
  on the full finishing order of classified finishers over the last 96 races (out of sample,
  4 chunks of 24, each scored by rankers trained before it). The first pick (who wins) is
  refitted on the winner likelihood of the last 48 races. Post-qualifying, the first pick also
  gets a penalised bonus for grid slots 1 to 3 (fitted on the same 48 races; currently +0.91
  logits for pole).
- See "Sharpness and calibration" below for why each piece exists and what it changed.

**Monte Carlo** (torch, GPU): 20,000 simulated weekends per forecast. Qualifying and the sprint
are simulated when not yet known; the race is sampled pick by pick with fresh Gumbel noise, with
retirements drawn first and classified behind all finishers. A full weekend (quali, sprint,
race) takes about 0.1 s on the GPU. Every published number (positionDist, pWin, pPodium, pPoints,
pDnf, expectedPosition, expectedPoints) comes from the same simulated worlds, so they are
internally consistent: rows sorted by expected position need not be sorted by pWin (a driver
with a high win chance and a high retirement chance can have a worse expected position).

**Championship**: this weekend's simulated points plus every remaining round, each with its own
pre-weekend features (its circuit, track type, sprint format), and a per simulated season
development drift (team N(0, 0.25), driver N(0, 0.10) on the strength scale) so the remaining
rounds are correlated. The drift sizes are assumptions, not fitted.

## Features (point in time)

Every feature row is built for a target race from events with raceId below a cutoff; weekend
inputs come from the target race and are blanked per stage (`features.stage_frame`). History
starts in 2000, training rows in 2006 (8,763 driver-races, 416 races).

| Group | Features |
|---|---|
| Driver form | exponentially weighted finish (half-lives 3 and 10 races), qualifying position and gap to pole in %, points rate, current and previous season averages, last result, last DNF |
| Team form | best car's quali gap and finish (EW 3 and 8 races), team points rate, season averages, previous season; team lineage maps renames (Sauber to Audi, Toro Rosso to RB, ...) |
| Team-mate | EW qualifying gap and finish delta to the team-mate |
| Circuit | street flag (F1DB), typical lap speed, length, turns, grid-to-finish rank correlation, pole conversion, retirement rate, mean position change, number of visits |
| Track type | team's quali gap at circuits of the same type (street / high-speed / medium) minus its era average |
| Driver at circuit | finish, places gained and team-mate delta over the last 6 visits |
| Reliability | team mechanical and all-cause DNF rate this season and EW, driver accident rate, season-to-date field retirement rate |
| Standings | championship position and points share before the race, team position |
| Era | season, round, season progress, rounds since the last regulation reset (2006, 2009, 2014, 2017, 2022, 2026), reset-season flag |
| Practice | best lap gap (%) per FP session held before qualifying, best, last, mean rank, team best, team-mate delta, gap versus recent quali form; long-run pace (fuel and tyre corrected stints of 5+ laps, FastF1) |
| Sprint | sprint qualifying position and gap, sprint result, sprint DNF, places gained |
| Qualifying | grid, qualifying position and gap, grid penalty, pit lane start, team-mate delta |

Weekend data sources, in priority order: F1DB (all practice sessions since the 1990s, sprint
qualifying, Driver of the Day), FastF1 laps, OpenF1 session results, the F1 static live timing
archive (parsed from `data/raw/livetiming`, used as the last fallback during a weekend).
Features degrade to NaN when a source is missing; trees route missing values, the network gets
a missing indicator.

## Sharpness and calibration: what was wrong and what changed

The first published Singapore forecast (model v20261007-r202616-0654) gave the top driver 9%
to win, 26% podium and an expected finish of P8.2, and the championship leader about 8
expected points per round. That was under-confidence, and it had three causes:

1. **One Plackett-Luce temperature for the whole finishing order.** Fitted on the full order,
   the temperature has to suit the midfield, which is close to a lottery, so the front was far
   too flat. Out of sample (GBM scores, refit every 4 races, no retirements) the favourite's
   average win probability was 0.18 while favourites won 31% (2024-26) and 61% (2019-23) of
   races. Fix: a position dependent temperature (sharp first pick, flatter tail), sampled pick
   by pick on the GPU.
2. **Retirements were over-predicted** (Singapore mean pDnf 23.9% vs a 2026 rate of 19.3%;
   front runners retire about 12.5% of the time; Antonelli has 0 retirements in 16 starts but
   got 20%). Fix: the logistic DNF model above. Antonelli is now at 13.8%.
3. **The order likelihoods included retired cars**, whose classification at the back is noise
   relative to pace. This pinned the tail temperature at zero and moved points from midfield
   front runners to backmarkers. Fix: fit every order likelihood on classified finishers (the
   simulator draws retirements separately).

The opposite failure showed up along the way: a schedule fitted on only the last 30 races (2023,
when Verstappen won 19 of 22) made 2024 pre-weekend favourites 73% likely on average while they
won 37.5%. So the window and the target of the fit were chosen on 2019-2023 only (not on the
backtest seasons):

| Out of sample, GBM only | 2019-23 log loss win | max pWin | favourite won | 2024-26 log loss win | max pWin | favourite won |
|---|---|---|---|---|---|---|
| constant temperature (old) | 2.019 | 0.170 | 0.606 | 2.209 | 0.177 | 0.312 |
| schedule, full order, last 96 races | 1.341 | 0.662 | 0.606 | 2.042 | 0.547 | 0.312 |
| schedule + first pick on winner likelihood, last 48 races (used) | 1.309 | 0.585 | 0.606 | 1.999 | 0.474 | 0.312 |

The post-qualifying grid-slot bonus was added after seeing that pole sitters averaged pWin 0.39
but won 59% in 2024-26. Fitted the same way on 2019-23 it is neutral (win log loss 1.123 with
and without; pole was under-weighted there too, 0.415 vs 0.510), and on 2024-26 it improves win
log loss from 1.335 to 1.265, so it stays, with an L2 penalty and a rolling refit.

Favourite's average max pWin vs how often the favourite won, by season (final model):
pre-weekend 2024 0.688 vs 0.375, 2025 0.276 vs 0.167, 2026 0.211 vs 0.250; post-qualifying 2024
0.648 vs 0.417, 2025 0.502 vs 0.625, 2026 0.530 vs 0.625. 2024 (a dominant season followed by
parity) is still overconfident; 2025-26 are close, or slightly under-confident after
qualifying. No further sharpening was forced beyond what the selection seasons support.

Effect on the Singapore pre-weekend forecast and the title odds:

| | first version (0654) | final (1018) |
|---|---|---|
| favourite's win / podium | Russell 9.1% / 26.2% | Antonelli 17.8% / 44.2% |
| favourite's expected finish | P8.2 | P6.4 |
| Antonelli expected points this weekend (race + sprint) | 10.7 | 16.1 |
| Antonelli pDnf | 14.2% | 13.8% |
| Antonelli title probability, expected final points | 99.5%, 378.7 | 99.65%, 409.7 |
| Russell title probability, expected final points | 0.5%, 297.5 | 0.3%, 319.4 |

Antonelli has 320 points; the final model adds 89.7 over the 7 remaining rounds and the
Singapore sprint (about 12.8 per round), against 20.0 per round so far. It regresses him towards
Russell, his team-mate in the same car (14.75 per round), because his recent form (no win since
round 14) is less dominant than his season total, and because 2026 pre-weekend favourites have
won only a quarter of the races. That regression is what the data supports. The title
probability barely depends on it (84 point lead, 7 rounds left).

## Expected points versus actual

Expected points per driver for Singapore (race + sprint) against the 2026 average per round:
Antonelli 16.1 vs 20.0, Russell 15.1 vs 14.8, Verstappen 13.1 vs 11.8, Hamilton 12.8 vs 13.4,
Norris 12.1 vs 11.8, Leclerc 11.9 vs 11.9. Only the leader is pulled in noticeably.

Season sums over the backtest, for the 8 drivers with the highest *predicted* total (selecting
by actual points would bias the ratio downwards even for a perfect model): expected / actual =
0.943 (2024), 0.979 (2025), 0.949 (2026) post-qualifying; 0.886, 0.878, 0.844 pre-weekend.
Binned by predicted expected points per race (pre-weekend, all cars):

| predicted bin | 0-1 | 1-3 | 3-6 | 6-10 | 10-15 | 15-20 | 20+ |
|---|---|---|---|---|---|---|---|
| races x cars | 118 | 519 | 237 | 207 | 141 | 61 | 27 |
| mean predicted | 0.75 | 1.97 | 3.99 | 8.07 | 12.03 | 16.97 | 22.93 |
| mean actual | 0.13 | 1.26 | 2.92 | 10.73 | 13.77 | 16.51 | 20.89 |

Post-qualifying the same table is close (6-10 bin 7.94 vs 9.04; 15-20 bin 17.08 vs 18.45).
Before the weekend the model still moves 1 to 2.5 points per race from the second tier (drivers
expected to score 6 to 15) to the back of the field; that is the main calibration weakness left.

## Fantasy accuracy (2024, 2025, 2026 R1-16; 1,310 driver and 656 constructor rounds)

Predicted points come from the same simulated worlds with the official rules. The vectorised
scorer matches `f1p.fantasy.scoring` exactly on position points in sampled worlds, and the price
rule matches `f1p.fantasy.price_change` on every tested value. Overtakes, Driver of the Day,
fastest lap and pit stops come from models refitted before each race. Historical overtakes were
derived as fantasy race points minus position-derived points minus 10 x DOTD, which reproduces
the official 2026 overtake counts exactly (315 of 315). Baseline: the asset's average over its
last 3 rounds (the first rounds of a season have no baseline, so the model MAE on the same rows
is shown in brackets).

| Stage | kind | MAE | MAE last-3 baseline | Spearman per race | p10-p90 coverage | bias |
|---|---|---|---|---|---|---|
| team lock (practice known) | driver | 9.97 (11.37) | 13.30 | 0.566 | 0.838 | +1.0 |
| team lock | constructor | 16.50 (18.12) | 19.85 | 0.703 | 0.784 | +2.1 |
| post-qualifying | driver | 9.24 (11.27) | 13.30 | 0.610 | 0.827 | +0.6 |
| post-qualifying | constructor | 14.95 (17.75) | 19.85 | 0.732 | 0.785 | +1.3 |

Driver MAE at the lock by season: 8.68 (2024), 10.20 (2025), 11.41 (2026). The 80% interval
holds the real score 78 to 84% of the time.

Price changes (2025 and 2026; the 2024 game used a transfer based rule that cannot be
reproduced): at the lock the most likely predicted step matches the real change for 73.4% of
constructors and 50.4% of drivers; the probability given to the real step averages 0.63 and
0.42; the mean absolute error of the expected change is 0.23M and 0.32M. Driver steps are
harder because the lower price tier jumps in steps of 0.2 and 0.6 that turn on a few points.

`history/<season>-<round>.json` carries `fantasyAtLock` (practice known, no qualifying: when
teams lock) so the optimiser's own backtest is honest. `fantasy.json` adds `scenarios.race`
(Grand Prix points only) and `scenarios.negative` (sum of negative items; constructor items are
summed over both drivers per category before clamping, as the game does), and a `horizon` with
each future circuit's own pre-weekend forecast and a chained price path.

## Ablations (GBM only, walk-forward 2024-2026, retrain every 4 rounds)

Change in mean Spearman and in Plackett-Luce NLL per race when a feature group is removed
(lower NLL is better):

| Removed | stage | dSpearman | dNLL |
|---|---|---|---|
| qualifying and grid | post-qualifying | -0.058 | +0.566 |
| practice pace | post-practice | -0.016 | +0.403 |
| sprint results | post-practice | +0.010 | +0.191 |
| current-season averages | pre-weekend | -0.010 | +0.025 |
| season / era context | pre-weekend | -0.003 | +0.101 |
| circuit history | pre-weekend | -0.006 | -0.071 |
| driver form | pre-weekend | -0.006 | -0.062 |
| team form | pre-weekend | -0.003 | -0.159 |
| standings | pre-weekend | -0.005 | -0.058 |

Qualifying is by far the most important input, then practice. Before the weekend the form, team,
circuit and standings groups overlap: removing any one of them barely changes Spearman and
slightly improves the likelihood, so the pre-weekend model carries more overlapping features
than it needs. Top GBM gain, post-qualifying: q_pos 0.40, grid 0.36, d_q_e3 0.05; pre-weekend:
d_pts_e5 0.16, t_fin_e3 0.13, d_q_e3 0.13, t_pts_e5 0.10.

## Regulation changes (2014, 2017, 2022, 2026 vs 2016, 2019, 2024)

Pre-weekend Spearman by part of the season, walk-forward GBM:

| Rounds | reset years | normal years | reset years, recency weight 0.5 |
|---|---|---|---|
| 1-4 | 0.536 | 0.628 | 0.520 |
| 5-8 | 0.590 | 0.678 | 0.581 |
| 9-12 | 0.633 | 0.601 | 0.612 |
| 13+ | 0.654 | 0.663 | 0.650 |

After a reset the model is about 0.09 Spearman worse for the first four rounds and catches up
by rounds 9 to 12, as current-season averages and short half-life form take over. Weighting
recent seasons more aggressively did not help in either kind of season, so the tuned decay is
kept.

## Training, GPU and run times

RTX 5070 Ti 16 GB, CUDA 12.8, torch 2.11, XGBoost 3.4 (`device=cuda`), sampled with nvidia-smi
every second:

| Job | wall time | GPU busy share | mean utilisation | peak |
|---|---|---|---|---|
| Optuna tuning (4 ranker studies + DNF x 40 trials, network x 10) | 16.1 min | 66% | 12.5% | 91% |
| final bundle (GBM 2.3 s, set transformer 35 s, inner fold, long window) | 81 s | 81% | 9% | 34% |
| walk-forward backtest (22 retrains, 64 races x 4 forecasts x 20,000 sims) | 34.6 min | 80% | 10% | 42% |
| `f1ml.predict` (features cached) | about 30 s | | | |

The GPU is busy most of the time but lightly loaded: the data is small (8,763 rows), so the
trees and the 64-wide transformer are bound by Python overhead, and the Monte Carlo is tiny for
a modern GPU. Earlier runs showed 63% mean utilisation only because another process (a local
LLM server) shared the card.

## Known limitations

- Pre-weekend favourites were overconfident in 2024 (dominance to parity transition), and the
  pre-weekend expected points of second-tier drivers are 1 to 2.5 per race too low.
- After qualifying, "the pole sitter wins" is still the better single winner pick.
- Retirements are close to unpredictable per car (AUC 0.55 to 0.62); only the level is modelled.
- No weather, rain or safety car modelling and no tyre strategy simulation. Rain races are the
  largest misses.
- Before qualifying, qualifying and race are sampled independently given the strengths, so
  fantasy p10/p90 before qualifying are slightly wide on gained/lost points. Qualifying NC and
  disqualifications are not simulated.
- The championship development drift (team 0.25, driver 0.10 on the strength scale) is an
  assumption, not fitted.
- Fantasy overtakes changed regime in 2026 (about 4.9 per driver per race vs 3.3 in 2025); the
  overtake model uses a short recent window and was weakest early in 2026.
- The backtest retrains every 3 rounds, not before every race; the published model is retrained
  on everything through 2026 R16.
- The pole bonus and fitting the first pick on the winner likelihood were checked on 2019-2023,
  but the investigation started from what the 2024-2026 backtest showed.
- Practice features use F1DB best laps for every season; long-run pace (FastF1) covers only
  about a quarter of 2026 rows so far.

## What improves when FastF1 finishes

- Long-run (race) pace from practice for every season since 2018: the post-practice model can
  then learn how much long runs matter (today it sees them for 24% of 2026 rows and none
  before). This needs the pipeline's `uv run python -m f1p.fastf1.build_tables` (the merged
  `ff1_laps` table was last rebuilt at 10:04 with 6 rounds of 2026, while the raw download has
  all 16), then `uv run python -m f1ml.features`, `f1ml.train` and `f1ml.backtest`.
- Tyre compound, stint and sector data for degradation and track evolution features.
- Weather per session (rain flag, track temperature) for every past race, so the model can learn
  wet-race behaviour.
- During a race weekend, practice and qualifying land within minutes from FastF1 or the live
  timing archive cache, and `f1ml.predict` moves from pre-weekend to post-practice and
  post-qualifying automatically.

Experiment scripts behind the calibration tables are in `scripts/experiments/` (run from
`v2/ml` with `PYTHONPATH=.`); raw numbers are in `reports/` (`backtest_summary.json`,
`studies.json`, `tuning.json`).
