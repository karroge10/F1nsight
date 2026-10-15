# Fantasy engine

Pure TypeScript brain of the F1 Fantasy tool: no React, no I/O, no network. Everything runs in
the browser (ideally in a Web Worker) on `data/predictions/fantasy.json`. Inputs and outputs are
plain data, so they cross a worker boundary with structured clone.

Import from `@/lib/fantasy/engine` (the `index.ts` barrel). Rules: 2026 game, see
`data/raw/fantasy/rules_2026.md` and the official FAQ text in
`data/raw/fantasy/official/2026/translations_en.json`.

## Quick start

```ts
import { prepareMarket, recommend } from "@/lib/fantasy/engine";

const market = prepareMarket(fantasyJson);          // parse once, reuse (5 to 25 ms)
const advice = recommend(market, {
  team: { drivers: ["russell", "norris", "lawson", "bearman", "albon"], constructors: ["mclaren", "williams"] },
  bank: 1.0,                                         // or budget: 121.2 (team value + bank)
  freeTransfers: 2,
  chipsAvailable: ["limitless", "wildcard", "finalFix", "autopilot", "noNegative", "extraBoost"],
  risk: "balanced",                                  // or objective: { kind: "meanStd", lambda: 0.5 }
});
advice.recommended;     // the team to field this week (TeamResult)
advice.team.alternatives; // top 10 teams for this race alone, best first
advice.explanations;    // one reason per transfer
advice.chips;           // chip advice and season schedule
advice.plan;            // 3-race transfer plan
advice.notes;           // short human-readable notes (boost, penalty, risk, plan, chip)
```

In a worker (the market is cached between messages, send `file` only once):

```ts
const worker = new Worker(new URL("@/lib/fantasy/engine/worker.ts", import.meta.url), { type: "module" });
worker.postMessage({ id: 1, type: "recommend", file: fantasyJson, state });
worker.postMessage({ id: 2, type: "optimise", state: { ...state, risk: "safe" } }); // reuses the cached file
worker.onmessage = ({ data }) => { /* { id, ok: true, result, ms } or { id, ok: false, error } */ };
```

Message types: `recommend` (options: `RecommendOptions`), `optimise` (`OptimiseOptions`), `plan`
(`PlanOptions`), `chips`, `board` (`BoardOptions`, everything the planner page shows). The same logic is callable without a worker: `handleEngineRequest(request)`.

## Inputs

### `FantasyFile` (fantasy.json, SPEC contract)

Used fields: `season`, `round`, `raceName`, `hasSprint`, `generatedAt`, `synthetic?`, `rules`
(copy of rules_2026.json, parsed by `rulesFromContract`), `assets[]`, `scenarios`, `horizon[]`.

- `assets[]`: `id`, `kind`, `name`, `constructorId`, `teamColor`, `price` (assets with a null price
  are left out), `expectedPoints`, `p10`, `p90`, `pNegative`, `breakdown`, `expectedPriceChange`,
  `priceChangeProbs`. Optional extras: `active` (false = can be kept or sold, not bought),
  `recentPoints`.
- `scenarios.points[i][j]`: joint worlds (teammates, a driver and his constructor, chaos races are
  correlated). Without scenarios the engine draws independent normal worlds from p10/p90 and adds
  a warning.
- Optional extras the engine uses when present (the synthetic file has them, the ML export does
  not yet): `scenarios.negative[i][j]` (sum of the negative scoring items, makes No Negative exact)
  and `scenarios.race[i][j]` (Grand Prix points only, makes Final Fix exact).
- `horizon[]`: next rounds with `expectedPoints` and `expectedPriceChange` per asset id.

### `UserState`

| Field | Meaning |
|---|---|
| `team` | `{ drivers: string[5], constructors: string[2] }`, or `null` for a new team (no penalty, 100M cap) |
| `bank` | Unspent money. Cost cap = current team value at today's prices + bank |
| `budget` | Total cost cap override (takes priority over bank) |
| `freeTransfers` | Free transfers this race (2 in 2026, no carry-over). Default 2 |
| `boost` | The user's current Boost pick (informational) |
| `chipsAvailable` | Chips not used yet. Default: all six |
| `chipsToPlay` | Chip the user wants this weekend; the first playable one is applied to the team search |
| `locked` / `banned` | Asset ids that must stay / must not be picked |
| `risk` | `"safe"` (mean - 0.5 sd), `"balanced"` (expected points), `"aggressive"` (75th percentile) |
| `objective` | Explicit objective, overrides `risk` |
| `teamRacesCompleted` | Races the team has played (chip unlocks). Default 1 |

### Objectives

| `Objective` | Score | Search |
|---|---|---|
| `{ kind: "expected" }` | expected points with Boost and chip, minus penalty | exact |
| `{ kind: "meanStd", lambda }` | mean - lambda x sd of the team total over the joint worlds | exact (bounded by projections of the worlds) |
| `{ kind: "quantile", q }` | q-quantile of the team total over the joint worlds | exact when it finishes, else best found (`exact: false`) |
| `{ kind: "value", pointsPerMillion? }` | expected points + pointsPerMillion x expected team value change | exact |

`pointsPerMillion` defaults to `defaultPointsPerMillion(market)` = 0.6 x races left after this one.

## Public API

All functions are synchronous and pure (the market caches the No Negative world set lazily).

```ts
recommend(input: FantasyFile | Market, state: UserState, options?: RecommendOptions): Recommendation
// RecommendOptions: { topN = 10, planRounds = 3, maxMs = 150, skipChips = false, prepare?: PrepareOptions }

prepareMarket(file: FantasyFile, options?: { rules?: Partial<GameRules>; fallbackScenarios?: number }): Market

optimiseTeam(market, state, options?: OptimiseOptions): OptimiseResult
// OptimiseOptions: { objective?, chip?, topN = 10, maxMs = 150, budget?, freeTransfers?, team?,
//   expectedPoints?: Float64Array, priceChanges?: Float64Array, prices?: Float64Array, pointsPerMillion?,
//   exactTransfers? (only teams with exactly that many net transfers) }
evaluateTeam(market, state, team: TeamSelection, options?): TeamResult | null   // one fixed team, best Boost
scoreTeams(market, state, teams: TeamSelection[], options?): { score; boost }[] // many fixed teams, no search

planTransfers(market, state, options?: PlanOptions): TransferPlan
// PlanOptions: { rounds = 3, futureWeight = 0.85, chips?: { [round]: ChipId }, poolPerStage = 40, objective?, maxMs?,
//   holdFirst? (field the current team unchanged in the first race) }

plannerBoard(market, state, options?: BoardOptions): PlannerBoard
// { best: top N lineups from state.team, byTransfers: best lineup per transfer count (0 = keep),
//   plan: plan from options.draft held in the first race, exact }
preparePlan(market, state, options?): PreparedPlan      // build the candidate pool once
solvePlan(prepared, chips: { [round]: ChipId }): TransferPlan // re-solve for a chip schedule (fast)

adviseChips(market, state, options?: { prepared?, planOptions?, maxMs = 100 }): ChipPlan
finalFixValue(market, team: TeamResult, bank: number): number

explainTransfers(market, team: TeamResult, options?: { plan?, chips?, newTeam? }): TransferExplanation[]
explainTeam(market, team: TeamResult, options?): string[]

runBacktest(history: HistoryFile, options?: { seasons?, forecast?: Forecaster, forecastName?, planRounds = 3 }): BacktestReport
formForecast: Forecaster                                   // form baseline
predictionForecaster(files: PredictionHistory[]): { forecast: Forecaster; covered(season, round) }

// Rules, scoring and prices (ports of the Python reference)
RULES_2026, CHIP_RULES, rulesFromContract(raw, overrides?), objectiveFromRisk(risk),
nextFreeTransfers(rules, available, used, chip), transferPenalty(rules, transfers, free, chip)
scoringRulesFor(season), scoreDriver(weekend, rules), scoreConstructor(drivers, rules, pit?, fieldSize?),
effectiveGrid(grid), qualiSegmentFromPosition(position, fieldSize?), negativeItems(points)
priceChange(price, recentPoints, season?, active?), pointsNeededForRating(price, previousPoints),
priceRating(ppm), priceTier(price)

handleEngineRequest(request: EngineRequest): EngineResponse   // from worker.ts
```

## Outputs

- `Recommendation`: `{ generatedAt, season, round, raceName, synthetic, objective, chip, team:
  OptimiseResult, recommended: TeamResult | null, followsPlan, explanations, notes, chips: ChipPlan,
  plan: TransferPlan, timings }`. `recommended` is the plan's first race when looking ahead pays
  (then `followsPlan` is true and the first note says how much it gives up this race), else
  `team.best`.
- `OptimiseResult`: `{ best, alternatives (top N distinct teams), objective, chip, budget,
  freeTransfers, evaluated, exact, ms }`. `exact: false` means the time limit cut the search.
- `TeamResult`: `{ drivers (best first), constructors, boost (x2 driver, null under Autopilot),
  extraBoost (x3 driver), chip, cost, budget, bankAfter, score (objective, penalty subtracted),
  expectedPoints (with Boost and chip, before penalty), penalty, transfersIn, transfersOut,
  transferCount, expectedValueChange ($M), stats: { mean, sd, p10, p50, p90, worst10 } }`.
  Under Limitless `budget` is the normal cap and `bankAfter` can be negative.
- `TransferExplanation`: `{ out, in, kind, gainNow, gainWindow, priceDelta, text }`. Example text:
  "Kimi Antonelli in for George Russell: +17.0 expected points at Singapore (39.9 vs 22.9);
  +46.2 over Singapore, United States, Mexico City; frees 1.0M; 91% chance Kimi Antonelli rises
  (+0.2M expected), George Russell is 80% likely to drop; safer floor: bad-weekend score 19.0 vs 4.0."
- `ChipPlan`: `{ playNow, advice: ChipAdvice[6], schedule: { round, chip }[] }`.
  `ChipAdvice`: `{ chip, name, available, unavailableReason?, valueNow, confidence ("exact" |
  "estimate" | "lower bound"), valueByRound: { round, value, estimated }[], holdValue,
  recommendation ("play" | "hold" | "unavailable"), plannedRound (a round, a negative number for
  "a typical later race", or null), reason, team? }`.
- `TransferPlan`: `{ stages: PlanStage[], score, holdScore, myopicScore, poolSize, ms }`.
  `PlanStage`: `{ round, raceName, drivers, constructors, boost, chip, transfersIn, transfersOut,
  transferCount, freeTransfers (available at that race), penalty, expectedPoints, cost,
  teamValue (cost cap at that race), bank }`.

## How it works

### Single race optimiser (`optimiser.ts`)

Depth-first branch and bound over driver sets, then constructor pairs, with exact integer budget
arithmetic (tenths of a million). Transfers are the net change from the current lineup; each one
beyond the free allowance costs 10 points (none under Wildcard or Limitless, none for a new team).
Every objective has a separable upper bound, so a branch is cut only when it provably cannot
reach the current N-th best team:

- expected points / value: the means themselves;
- mean - lambda x sd: for any centred unit direction e of the worlds, sd(team) >= <team, e>,
  which is linear in the team; up to six directions (from warm start teams) are used at once;
- quantiles: Cantelli, q-quantile <= mean + k sd <= sum of (mean_j + k sd_j);
- Autopilot: max over the drivers <= tau + sum((X_d - tau)+) in every world, with tau the best
  warm start team's per-world maximum.

Survivors are scored exactly: closed form for expected points, the scenario covariance for
mean - lambda x sd, the world vectors for quantiles and Autopilot. A warm start from a cheaper
surrogate objective raises the threshold early. Brute-force tests confirm the top 5 equals full
enumeration for every objective and chip.

### Chips (`chips.ts`, effects from the official 2026 FAQ)

| Chip | Effect modelled | Value now | Later rounds |
|---|---|---|---|
| x3 Boost | x3 on one driver, the x2 Boost moves to another driver | exact (team re-picked for the chip) | planned lineup: (x3 - x2) x best + second best |
| Autopilot | x2 goes to the top scoring driver in every world | exact on the joint worlds | this weekend's value (estimate) |
| No Negative | every negative scoring category set to 0 for every asset | exact with `scenarios.negative`, else totals clamped at 0 (lower bound) | this weekend's value (estimate) |
| Limitless | no cost cap, no penalty, team restored after the race, no carried transfer | exact | best uncapped team minus the planned team, plus the plan's penalty that race |
| Wildcard | unlimited transfers within the cap, the team stays | whole-plan gain from the planner | planner with the Wildcard in that round |
| Final Fix | one swap after qualifying, no penalty; outgoing keeps its points, incoming scores the race and inherits the Boost; team restored after | option value: in every world the best predicted race-points swap within the bank, predicted from qualifying and sprint points by regression across the worlds (`scenarios.race`), else a noisy-signal estimate | this weekend's value (estimate) |

One chip per race, each chip once, three of them (Limitless, Wildcard, Final Fix) only from the
team's second race. The schedule is a small exact assignment (dynamic programming over chip
subsets) of chips to this race, the horizon races and typical later races (average known value),
maximising the total. A chip is recommended for this weekend only when that assignment puts it
here; otherwise `holdValue` and `reason` say where it is worth more. With as many chips as races
left, one is played every race.

### Multi-race planning (`planner.ts`)

Lookahead of 2 to 3 races (`rounds`, capped by the horizon). The candidate pool is the best teams
for each planned race on its own (prices moved by the expected price changes), the exact top teams
for this race under the user's objective, the best next-race teams reachable from the current
team, and the current team. Dynamic programming over (team, free transfers), keeping the
non-dominated (score, bank) labels, applies the rules exactly along each path: net transfers
between lineups, 2 free transfers per race (no carry-over in 2026), -10 per extra, the
cost cap moving with the expected price changes of the held assets, Wildcard and Limitless.
Later races are weighted by `futureWeight^k` (0.85). The result reports the gain over holding
the team (`holdScore`) and over optimising one race at a time (`myopicScore`). A brute-force test
over every two-race team sequence on a small market matches the plan exactly.

### Explanations (`explain.ts`)

Each sold asset is paired with a bought one of the same kind. The text is built only from the
numbers: expected points gain this race and over the plan window, money freed or spent, price
rise or drop odds (from `priceChangeProbs`), the bad-weekend floor (p10) or the chance of a
negative score, and the upcoming races. Team notes cover the Boost pick, penalties paid, the
points range, team value growth, the plan's gain and the chip to play.

## Rule assumptions (config: `GameRules.assumptions`, pass `prepareMarket(file, { rules: { assumptions } })`)

| Assumption | Default | Why |
|---|---|---|
| `extraBoostKeepsRegularBoost` | true | FAQ: "if your choice already has the regular 2x Boost you'll have to give that to another driver" |
| `wildcardCarryOver` | 0 | Not stated; transfers under the Wildcard are unlimited, so nothing is left to carry |
| `limitlessCarryOver` | 0 | FAQ: no free transfers are carried into the next race week |
| `finalFixAllowsConstructor` | true | FAQ: "a single change to your team" |
| `finalFixInfoShare` | 0.15 | Only without `scenarios.race`: share of race-points variance explained by qualifying (low confidence) |
| `noNegativeFallback` | clampTotal | Only without `scenarios.negative` |
| `priceTierSplit`, `priceWindow` | 18.5, 3 | Reverse engineered price rule (98.9% match in 2026) |

Other rule values come from `rules_2026.json`: 5 drivers + 2 constructors, 100M cap, floor 3.0,
ceiling 34.0, 2 free transfers per race with no carry-over, -10 per extra transfer, x2 Boost, 23 rounds.

## Performance

Full-size market (22 drivers, 11 constructors, 2000 worlds, 3 horizon rounds), Node 24 on the
dev machine, median of 5 warm runs (`FANTASY_BENCH_LOG=1 npx vitest run src/lib/fantasy/engine/performance.test.ts`):

| Call | Time |
|---|---|
| `prepareMarket` | 6 ms |
| `optimiseTeam`, expected points, top 10 (also x3 Boost, value objective) | 9 to 13 ms |
| `optimiseTeam`, Limitless | 4 ms |
| `optimiseTeam`, Autopilot | 30 to 40 ms |
| `optimiseTeam`, mean - 0.5 sd | 30 to 45 ms |
| `optimiseTeam`, quantile 0.2 | stops at the 150 ms limit, `exact: false` (proving it takes seconds) |
| `planTransfers` (3 races) | 50 to 150 ms |
| `adviseChips` | 180 to 370 ms |
| `recommend` (everything) | 250 to 450 ms |

The first call in a fresh page is slower (JIT warm-up). Strong risk aversion (lambda >= 1.5)
with x3 Boost or Autopilot can also hit the limit; the result is then the best found and
flagged. Run `recommend` in the worker so the page stays responsive.

## Validation (`npx vitest run src/lib/fantasy/engine`)

- `scoring.test.ts`: the TypeScript scoring equals `f1p.fantasy.scoring` on all 802 recorded
  weekends in `__fixtures__/scoring_parity.json` (every session total and breakdown item: 352
  2026 drivers, 176 2026 constructors, 274 2025 drivers). Against the official totals: 352/352
  drivers and 175/176 constructors in 2026 (the miss is the known Miami Q3 data issue), 264/274
  drivers in 2025 (Wayback inputs). Season variants are covered. The price rule replays the
  recorded changes: 683/689 (99.1%) in 2025 and 532/538 (98.9%) in 2026, the same as the Python
  validation.
- `optimiser.test.ts`: top 5 equals brute force for 5 objectives x 6 chip settings on two markets;
  composition, budget, locks, bans, penalties, Limitless and Wildcard caps, x3 Boost placement.
- `chips.test.ts`: every chip's effect, carry-over rules, chip availability, one chip per race.
- `planner.test.ts`: accounting along the plan, plan >= myopic and >= hold, and equality with
  brute force over every two-race team sequence.
- `backtest.test.ts`, `contract.test.ts`, `performance.test.ts`: see below and above.

### Backtest (real prices, points and price changes, `__fixtures__/history.json`)

Every strategy starts from an empty team with 100M and plays the real transfer rules, no chips.
Two forecasts: the form baseline (0.5 x mean of the last 3 rounds + 0.5 x season mean), and the
model's published history (`data/predictions/history/<season>-<round>.json`, replayed
automatically for every fully covered season). The history files hold the post-qualifying
forecast while the real team lock is before qualifying, so the model rows are optimistic.

| Season, forecast (MAE per asset) | Engine (1 race) | Engine (3-race plan) | Naive points per $M | Keep first team | Hindsight best |
|---|---|---|---|---|---|
| 2025, form baseline (13.6) | 5289 (71.2%) | 5289 (71.2%) | 3899 (52.5%) | 3656 (49.2%) | 7433 |
| 2026 R1 to R16, form baseline (14.9) | 3778 (71.2%) | 3629 (68.4%) | 2927 (55.1%) | 2185 (41.2%) | 5309 |
| 2025, model post-qualifying (10.8) | 5220 (73.9%) | 5144 (72.8%) | 4228 (59.8%) | 4432 (62.7%) | 7066 |

Hindsight = best possible team every round with the actual points, no transfer limit, same cap
as the engine strategy (an upper bound nobody can reach; it differs between forecasts because
the engine's cap path differs). The horizon in the backtest repeats the current forecast for
the next races, so the planner mostly re-times transfers; it needs a real horizon from the model
to pay off.

## Data scripts

- `ml/scripts/synthetic_fantasy.py`: SYNTHETIC stand-in for fantasy.json with the contract
  shape plus `scenarios.negative` and `scenarios.race`, marked `"synthetic": true`. Writes
  `data/predictions/fantasy.synthetic.json` (`--out` to change). `cd ml && uv run python scripts/synthetic_fantasy.py`.
- `pipeline/scripts/export_fantasy_engine_fixtures.py`: regenerates `__fixtures__/scoring_parity.json`
  and `__fixtures__/history.json` from the processed parquet tables.
  `cd pipeline && uv run python scripts/export_fantasy_engine_fixtures.py`.

## Files

`types.ts` (all public types), `rules.ts`, `market.ts`, `optimiser.ts`, `planner.ts`,
`chips.ts`, `explain.ts`, `backtest.ts`, `scoring.ts`, `priceChange.ts`, `index.ts` (barrel and
`recommend`), `worker.ts`, `__fixtures__/` (test data and the random market generator).
