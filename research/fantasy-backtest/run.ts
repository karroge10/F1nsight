// Leak-free season backtest of the fantasy optimiser (2024, 2025, 2026 so far).
// Run from the repo root: npx tsx research/fantasy-backtest/run.ts
// Needs history.json in this folder (export_history.py). Writes results.json and diagnosis.json
// here and the site data file site/src/lib/data/fixtures/fantasy/backtest.json.
//
// Rules for every season: 100M start, 2 free transfers every race, no carry-over, -10 per extra
// transfer. Forecast = fantasyAtLock (post-practice, before qualifying) from
// data/predictions/history, model trained on earlier races only. Anything fitted (blend weight,
// calibration, transfer threshold) uses only seasons or rounds before the one it is applied to.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  adviseChips,
  evaluateTeam,
  formForecast,
  optimiseTeam,
  planTransfers,
  prepareMarket,
  transferPenalty,
  type ChipId,
  type FantasyAsset,
  type FantasyFile,
  type GameRules,
  type HistoryFile,
  type HistoryRow,
  type HorizonRound,
  type Market,
  type TeamResult,
  type TeamSelection,
} from "../../site/src/lib/fantasy/engine";
import { priceMap, seasonRules } from "../../site/src/lib/fantasy/engine/backtest";
import { PRICE_STEPS, pointsNeededForRating, tierOf } from "../../site/src/lib/fantasy/engine/priceChange";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const SITE_DATA = join(ROOT, "site", "src", "lib", "data", "fixtures", "fantasy", "backtest.json");
const SEASONS = [2024, 2025, 2026];
// Forecast source (prediction history folder); evaluate.ts points this at a backup to compare.
const PRED_DIR = process.env.PRED_DIR ?? join(ROOT, "data", "predictions", "history");
const PRIOR_BLEND = 0.5;
const PRIOR_THRESHOLD = 0;
// Site method policy, fixed (2026-10-15). The single-run grid fit of objective and threshold is
// path noise: with the 2026-10-14 history it flipped 2026 to "value" (2024 + 2025 sums differ by
// less than one season SD). Shared by the site row and the robust worker (evaluate.ts).
const SITE_POLICY = { threshold: 0, objective: "expected" as const };
const THRESHOLD_GRID = [0, 2, 4, 6, 8, 12, 16];
const SCORED_CHIPS: ChipId[] = ["autopilot", "extraBoost", "wildcard", "limitless"];
// All six chips existed in 2024, 2025 and 2026 (x3 Boost was called Extra DRS in 2024).
const ALL_CHIPS: ChipId[] = ["autopilot", "extraBoost", "wildcard", "limitless", "noNegative", "finalFix"];
// Value of money: lambda(R) = scale x c x R, R = races left after this one. Prior c for 2024 is the
// engine default (0.6 points per $M per race left); later seasons use c simulated on earlier ones.
const PRIOR_MONEY_SLOPE = 0.6;
const MONEY_BONUS = 2;
const MONEY_CHECKPOINT_STEP = 3;
const SCALE_GRID = [0, 0.5, 1, 1.5, 2];
const LOOKAHEAD_GRID = [0, 0.5];
const FINAL_FIX_GRID = [5, 10, 15, 20, 30];
const PRIOR_FINAL_FIX = 10;
const PRIOR_SD: Record<string, number> = { driver: 14, constructor: 20 };
// Current 2026 global leader, as told by the owner on 2026-10-14 (after round 17).
const WORLD_LEADER: Record<number, { round: number; points: number; label: string } | null> = {
  2024: null,
  2025: null,
  2026: { round: 17, points: 4994, label: "current global leader (round 17)" },
};
const MIN_CALIBRATION_ROWS = 60;
// Global league (points at rank) anchors and team counts per season, from world-rank.md. None are
// public yet, so no rank is estimated; add at least two anchors per season to get one.
const WORLD_RANK_ANCHORS: Record<number, { rank: number; points: number }[]> = { 2024: [], 2025: [], 2026: [] };
const WORLD_PLAYERS: Record<number, number | null> = { 2024: 2_000_000, 2025: 2_700_000, 2026: null };

interface LockAsset { price: number; expectedPoints: number; expectedPriceChange?: number | null }
interface LockFile { stage: string; inputsUsed: string[]; drivers: Record<string, LockAsset>; constructors: Record<string, LockAsset> }
interface PredDriver { driverId: string; code: string; constructorId: string; teamColor: string; fantasy?: { expectedPoints: number } }
interface PredTeam { constructorId: string; name: string; teamColor: string }
interface PredFile {
  generatedAt: string;
  model: { version: string; notes: string };
  race: { season: number; round: number; hasSprint?: boolean; raceName?: string; country?: string; stage?: string; inputsUsed?: string[] };
  drivers: PredDriver[];
  constructors: PredTeam[];
  fantasyAtLock?: LockFile;
}

/** One asset in one round: what was known at the lock and what happened. */
interface AssetRound {
  id: string;
  kind: "driver" | "constructor";
  price: number;
  active: boolean;
  actual: number;
  model: number | null;
  form: number;
  priceChange: number;
  /** Official points of the asset's last 2 active rounds before this one (price rule window). */
  recent: number[];
  /** Session points: qualifying, sprint, race. */
  sessions: { q: number; s: number; r: number } | null;
  /** Official item breakdown (2026 only), for No Negative. */
  items: number[] | null;
  /** Post-qualifying forecast of the weekend total (drivers), for Final Fix. */
  postQuali: number | null;
  /** Real price change after the round (null when unknown). */
  actualChange: number | null;
  /** Every earlier official score this season (oldest first). */
  past: number[];
  /** Price change going into this round (this price minus the previous round's), 0 when unknown. */
  lastChange: number;
}

interface RoundData {
  season: number;
  round: number;
  sprint: boolean;
  raceName: string;
  country: string;
  rows: HistoryRow[];
  assets: AssetRound[];
  labels: Map<string, { code: string; team: string; color: string }>;
}

type Forecast = (r: RoundData) => Map<string, number>;
type ObjectiveKind = "expected" | "value";
interface ValuePolicy {
  slope: number;
  lookahead: number;
  /** Post hoc: slope = this round's forecast budget slope (expected points per $M), times `slope`. */
  live?: boolean;
}
interface Policy {
  threshold: number;
  chips: boolean;
  plan: number;
  objective?: ObjectiveKind;
  /** Value of money objective with our own price change expectation. */
  value?: ValuePolicy;
  /** Chip set (default the four always scorable ones). */
  chipSet?: ChipId[];
  /** Final Fix: play when the post-qualifying swap gains at least this many points. */
  finalFix?: number;
  /** Extra money added to the bank at a round (value of money simulation). */
  bonus?: { round: number; amount: number };
  /** Round 3: forecast that picks the Boost (and x3) inside the chosen team. */
  boostForecast?: Forecast;
  /** Round 3: forecast whose market drives the chip advice. */
  chipForecast?: Forecast;
  /** Round 3: fixed chip schedule, chip -> "sprint" (first sprint weekend from round 2) or a round. */
  schedule?: Partial<Record<ChipId, "sprint" | number>>;
  /** Round 3: start at this round index from a given team and bank (multi-start fitting). */
  start?: { index: number; team: TeamSelection; bank: number; lastPrices: Map<string, number> };
  /** Round 3: Boost = argmax of boost forecast + upside x SD of the driver's earlier points this season. */
  upside?: number;
  /** Round 11: called before each decision with the round, market and state (diagnosis only). */
  /** Round 11: Wildcard out of engine advice, played when the no-chip team would pay at least this penalty. */
  wcTrigger?: number;
  trace?: (r: RoundData, market: Market, state: State) => void;
}
interface State { team: TeamSelection | null; bank: number; lastPrices: Map<string, number>; chipsLeft: ChipId[]; races: number }

interface RoundLog {
  round: number;
  drivers: string[];
  constructors: string[];
  transfersIn: string[];
  transfersOut: string[];
  boost: string | null;
  extraBoost: string | null;
  chip: ChipId | null;
  penalty: number;
  points: number;
  cumulative: number;
  teamValue: number;
  bank: number;
}

interface SeasonRun { name: string; total: number; perRound: number[]; transfers: number; penalties: number; finalTeamValue: number; chips: string[]; budgets: number[]; log: RoundLog[] }

const STACK_MIN_ROWS = 150;
const STACK_RIDGE = 1e-3;
const stackCache = new Map<string, Map<string, number>>();
const shrinkCache = new Map<string, number>();
const sdCache = new Map<string, Record<string, number>>();
const calibrationCache = new Map<string, Record<string, { a: number; b: number } | null>>();
const ownershipPath = join(HERE, "ownership.json");
const ownership = (existsSync(ownershipPath) ? JSON.parse(readFileSync(ownershipPath, "utf8")) : {}) as Record<string, Record<string, Record<string, number>>>;
const history = JSON.parse(readFileSync(join(HERE, "history.json"), "utf8")) as HistoryFile;
const breakdown = JSON.parse(readFileSync(join(HERE, "breakdown.json"), "utf8")) as Record<string, Record<string, Record<string, { q: number; s: number; r: number; items: number[] | null }>>>;
const notes: string[] = [];
const data = new Map<number, RoundData[]>();
for (const season of SEASONS) {
  const rounds = buildSeason(season);
  data.set(season, rounds);
}

if (process.env.R3) {
  roundThree();
  process.exit(0);
}

if (process.env.CHIPS_DIAG) {
  chipsDiag(Number(process.env.CHIPS_DIAG));
  process.exit(0);
}

if (process.env.ROBUST_WORKER) {
  robustWorker(process.env.ROBUST_WORKER);
  process.exit(0);
}

const diagnosis = diagnose();
writeFileSync(join(HERE, "diagnosis.json"), JSON.stringify(diagnosis, null, 1));

const results = runVariants();
writeFileSync(join(HERE, "results.json"), JSON.stringify({ generatedAt: new Date().toISOString(), notes, ...results.summary }, null, 1));
const site = siteData(results);
writeFileSync(SITE_DATA, JSON.stringify(site));
console.log("notes:\n " + (notes.join("\n ") || "none"));

// ------------------------------------------------------------------------------ variants

function runVariants() {
  const forecasts: Record<string, (season: number) => Forecast> = {
    model: () => modelForecast,
    form: () => (r) => formOf(r),
    blend: (season) => blendForecast(season, false),
    calibrated: () => calibratedForecast(false),
    "calibrated blend": (season) => blendForecast(season, true),
  };
  const table: Record<string, Record<number, SeasonRun>> = {};
  const fitted: Record<string, unknown> = {};
  const declared = "calibrated blend";

  for (const [name, make] of Object.entries(forecasts)) {
    table[`${name}, 1 race`] = {};
    for (const season of SEASONS) {
      const forecast = make(season);
      table[`${name}, 1 race`][season] = playSeason(`${name}, 1 race`, season, forecast, { threshold: 0, chips: false, plan: 1 });
    }
  }
  table["form + chips"] = {};
  table["model + chips"] = {};
  for (const season of SEASONS) {
    table["form + chips"][season] = playSeason("form + chips", season, forecasts.form(season), { threshold: 0, chips: true, plan: 1 });
    table["model + chips"][season] = playSeason("model + chips", season, modelForecast, { threshold: 0, chips: true, plan: 1 });
  }
  table["model, 3-race plan"] = {};
  for (const season of SEASONS) table["model, 3-race plan"][season] = playSeason("model, 3-race plan", season, modelForecast, { threshold: 0, chips: false, plan: 3 });

  // Objective (expected points, or points plus team value growth) and transfer threshold, fitted
  // walk-forward on earlier seasons with the declared forecast and chips off.
  const gridRuns = new Map<string, SeasonRun>();
  const objectives: ObjectiveKind[] = ["expected", "value"];
  for (const season of SEASONS) {
    const forecast = forecasts[declared](season);
    for (const objective of objectives) {
      for (const x of THRESHOLD_GRID) gridRuns.set(`${season}:${objective}:${x}`, playSeason(`${objective} ${x}`, season, forecast, { threshold: x, chips: false, plan: 1, objective }));
    }
  }
  const choice: Record<number, { objective: ObjectiveKind; threshold: number }> = {};
  for (const season of SEASONS) choice[season] = fitPolicy(season, gridRuns, objectives);
  fitted.policy = choice;
  fitted.grid = Object.fromEntries([...gridRuns].map(([k, v]) => [k, Math.round(v.total)]));

  table[`${declared}, value objective`] = {};
  table[`${declared} + fitted objective and threshold`] = {};
  table[`${declared} + chips`] = {};
  table[`${declared} + fitted objective and threshold + chips`] = {};
  for (const season of SEASONS) {
    const forecast = forecasts[declared](season);
    const c = choice[season];
    table[`${declared}, value objective`][season] = gridRuns.get(`${season}:value:0`) as SeasonRun;
    table[`${declared} + fitted objective and threshold`][season] = gridRuns.get(`${season}:${c.objective}:${c.threshold}`) as SeasonRun;
    table[`${declared} + chips`][season] = playSeason(`${declared} + chips`, season, forecast, { threshold: 0, chips: true, plan: 1 });
    table[`${declared} + fitted objective and threshold + chips`][season] = playSeason("final", season, forecast, { ...SITE_POLICY, chips: true, plan: 1 });
  }

  // ---------------------------------------------------------------- value of money (round 2)
  // Declared before any 2026 total of it was seen: calibrated blend + value of money objective
  // (lambda = scale x c x races left, c simulated on earlier seasons, scale and price lookahead
  // fitted on earlier seasons) + all six chips (Final Fix threshold fitted on earlier seasons).
  const money = moneySlopes(forecasts[declared]);
  const perRace = moneyPerRace(forecasts[declared]);
  fitted.money = { replay: money, perRace };
  const valueRuns = new Map<string, SeasonRun>();
  const valueChoice: Record<number, { slope: number; scale: number; lookahead: number; finalFix: number }> = {};
  for (const target of SEASONS) {
    const c = perRace.slope[target];
    const earlier = SEASONS.filter((s) => s < target);
    let best = { scale: 1, lookahead: 0 };
    let bestTotal = -Infinity;
    for (const scale of SCALE_GRID) {
      for (const lookahead of LOOKAHEAD_GRID) {
        let total = 0;
        for (const s of earlier) {
          const run = playSeason("value grid", s, forecasts[declared](s), { threshold: 0, chips: false, plan: 1, value: { slope: scale * c, lookahead } });
          valueRuns.set(`${target}:${s}:${scale}:${lookahead}`, run);
          total += run.total;
        }
        if (earlier.length > 0 && total > bestTotal) {
          bestTotal = total;
          best = { scale, lookahead };
        }
      }
    }
    let bestFix = PRIOR_FINAL_FIX;
    let bestFixTotal = -Infinity;
    for (const t of earlier.length ? FINAL_FIX_GRID : []) {
      let total = 0;
      for (const s of earlier) {
        const run = playSeason("final fix grid", s, forecasts[declared](s), { threshold: 0, chips: true, plan: 1, chipSet: ALL_CHIPS, finalFix: t, value: { slope: best.scale * c, lookahead: best.lookahead } });
        total += run.total;
      }
      if (total > bestFixTotal) {
        bestFixTotal = total;
        bestFix = t;
      }
    }
    valueChoice[target] = { slope: round3(best.scale * c), scale: best.scale, lookahead: best.lookahead, finalFix: bestFix };
  }
  fitted.value = valueChoice;
  fitted.valueGrid = Object.fromEntries([...valueRuns].map(([k, v]) => [k, Math.round(v.total)]));

  const sixName = `${declared} + fitted objective and threshold + all six chips`;
  const newName = "value of money (fitted) + all six chips";
  const variantsV2: Record<string, (season: number) => Policy> = {
    [sixName]: (s) => ({ threshold: choice[s].threshold, chips: true, plan: 1, objective: choice[s].objective, chipSet: ALL_CHIPS, finalFix: valueChoice[s].finalFix }),
    "form + all six chips": (s) => ({ threshold: 0, chips: true, plan: 1, chipSet: ALL_CHIPS, finalFix: valueChoice[s].finalFix }),
    "value of money, lambda from season replay, no chips": (s) => ({ threshold: 0, chips: false, plan: 1, value: { slope: money.slope[s], lookahead: 0 } }),
    "value of money, lambda from per-race budget slope, no chips": (s) => ({ threshold: 0, chips: false, plan: 1, value: { slope: perRace.slope[s], lookahead: 0 } }),
    "value of money, per-race lambda + 2-race price lookahead, no chips": (s) => ({ threshold: 0, chips: false, plan: 1, value: { slope: perRace.slope[s], lookahead: 1 } }),
    "value of money (fitted), no chips": (s) => ({ threshold: 0, chips: false, plan: 1, value: { slope: valueChoice[s].slope, lookahead: valueChoice[s].lookahead } }),
    "value of money (fitted) + 4 chips": (s) => ({ threshold: 0, chips: true, plan: 1, value: { slope: valueChoice[s].slope, lookahead: valueChoice[s].lookahead } }),
    "value of money (fitted), 3-race plan": (s) => ({ threshold: 0, chips: false, plan: 3, value: { slope: valueChoice[s].slope, lookahead: valueChoice[s].lookahead } }),
    "post hoc: lambda = forecast budget slope x races left, no chips": () => ({ threshold: 0, chips: false, plan: 1, value: { slope: 1, lookahead: 0, live: true } }),
    "post hoc: lambda = forecast budget slope x races left + 4 chips": () => ({ threshold: 0, chips: true, plan: 1, value: { slope: 1, lookahead: 0, live: true } }),
    [newName]: (s) => ({ threshold: 0, chips: true, plan: 1, chipSet: ALL_CHIPS, finalFix: valueChoice[s].finalFix, value: { slope: valueChoice[s].slope, lookahead: valueChoice[s].lookahead } }),
  };
  for (const [name, policyOf] of Object.entries(variantsV2)) {
    table[name] = {};
    for (const season of SEASONS) {
      const forecast = name.startsWith("form") ? forecasts.form(season) : forecasts[declared](season);
      const policy = policyOf(season);
      table[name][season] = playSeason(name, season, forecast, policy);
    }
  }

  // Site method rule (fixed before the run): the new method replaces the old one only when it
  // scores more over the two out-of-sample seasons (2025 + 2026) together.
  const oldName = `${declared} + fitted objective and threshold + chips`;
  const outOfSample = (name: string) => table[name][2025].total + table[name][2026].total;
  // Pinned (2026-10-15): the round 2 decision kept the old method. Re-deciding on every rerun
  // from one replay per season let path noise flip the site method when the history changed.
  const switchWins = outOfSample(newName) > outOfSample(oldName);
  if (switchWins) notes.push("single-run switch rule favours the value of money method; site stays pinned");
  const finalName = oldName;
  const formName = finalName === newName ? "form + all six chips" : "form + chips";
  const keep: Record<number, SeasonRun> = {};
  const hind: Record<number, { total: number; perRound: number[] }> = {};
  for (const season of SEASONS) {
    const first = table[finalName][season].log[0];
    keep[season] = playSeason("keep the round-1 team", season, forecasts[declared](season), { threshold: 0, chips: false, plan: 1 }, { drivers: first.drivers, constructors: first.constructors });
    hind[season] = hindsight(season, table[finalName][season].budgets);
  }
  table["keep the round-1 team"] = keep;
  fitted.blend = Object.fromEntries(SEASONS.map((s) => [s, { raw: blendWeights(s, false), calibrated: blendWeights(s, true) }]));

  console.log("strategy".padEnd(72) + SEASONS.map((s) => String(s).padStart(8)).join(""));
  for (const [name, bySeason] of Object.entries(table)) console.log(name.padEnd(72) + SEASONS.map((s) => (bySeason[s].total.toFixed(0) + "/" + bySeason[s].finalTeamValue.toFixed(1)).padStart(13)).join(""));
  console.log("hindsight (impossible)".padEnd(72) + SEASONS.map((s) => hind[s].total.toFixed(0).padStart(8)).join(""));
  console.log("fitted", JSON.stringify(fitted));

  const summary = {
    fitted,
    totals: Object.fromEntries(Object.entries(table).map(([n, b]) => [n, Object.fromEntries(SEASONS.map((s) => [s, { total: Math.round(b[s].total), transfers: b[s].transfers, penalties: b[s].penalties, finalTeamValue: round1(b[s].finalTeamValue), chips: b[s].chips }]))])),
    hindsight: Object.fromEntries(SEASONS.map((s) => [s, Math.round(hind[s].total)])),
    finalLog: Object.fromEntries(SEASONS.map((s) => [s, table[finalName][s].log])),
  };
  return { summary, table, hind, finalName, formName, keep };
}

/**
 * Points one extra $1M is worth in one race: for every round of each completed season, the best
 * forecast team (fresh team, no chip) at the budget the base run had, minus and plus MONEY_BONUS,
 * scored on the real points; slope = (points(B + d) - points(B - d)) / 2d averaged over rounds.
 * Free of the path noise of a full replay. Per target season the mean over earlier seasons only.
 */
function moneyPerRace(make: (season: number) => Forecast) {
  const perSeason: Record<number, number> = {};
  for (const season of SEASONS.filter((s) => s < SEASONS[SEASONS.length - 1])) {
    const forecast = make(season);
    const base = playSeason("money base", season, forecast, { threshold: 0, chips: false, plan: 1 });
    const rounds = data.get(season) ?? [];
    const slopes = rounds.map((r, k) => {
      const market = marketFor(r, forecast(r));
      const low = bestTeamPoints(r, market, base.budgets[k] - MONEY_BONUS);
      const high = bestTeamPoints(r, market, base.budgets[k] + MONEY_BONUS);
      return (high - low) / (2 * MONEY_BONUS);
    });
    perSeason[season] = round3(mean(slopes));
  }
  const slope: Record<number, number> = {};
  for (const target of SEASONS) {
    const pool = Object.entries(perSeason).filter(([s]) => Number(s) < target).map(([, v]) => v);
    slope[target] = pool.length ? round3(Math.max(0, mean(pool))) : PRIOR_MONEY_SLOPE;
  }
  return { perSeason, slope };
}

/** Real points of the best forecast team for a budget (Boost included, no chip). */
function bestTeamPoints(r: RoundData, market: Market, budget: number): number {
  const result = optimiseTeam(market, { team: null }, { budget, topN: 1, chip: null, maxMs: Number.POSITIVE_INFINITY });
  const best = result.best;
  if (!best) return 0;
  const pick: Pick = { team: { drivers: best.drivers, constructors: best.constructors }, boost: best.boost, extraBoost: null, chip: null };
  return actualPoints(r, pick);
}

/**
 * Points one extra $1M is worth: replay each completed earlier season with MONEY_BONUS added to
 * the bank at every MONEY_CHECKPOINT_STEP-th round and measure the gain over the base run
 * (calibrated blend, expected points, no chips). Per target season, c = least squares slope
 * through the origin of gain per $M on races affected (season length - k + 1), from seasons before
 * the target only. 2024 has no earlier season and uses the prior.
 */
function moneySlopes(make: (season: number) => Forecast) {
  const samples: Record<number, { round: number; races: number; gainPerMillion: number }[]> = {};
  for (const season of SEASONS.filter((s) => s < SEASONS[SEASONS.length - 1])) {
    const forecast = make(season);
    const base = playSeason("money base", season, forecast, { threshold: 0, chips: false, plan: 1 });
    const rounds = data.get(season) ?? [];
    samples[season] = [];
    for (let k = 0; k < rounds.length; k += MONEY_CHECKPOINT_STEP) {
      const round = rounds[k].round;
      const run = playSeason("money bonus", season, forecast, { threshold: 0, chips: false, plan: 1, bonus: { round, amount: MONEY_BONUS } });
      const gainPerMillion = (run.total - base.total) / MONEY_BONUS;
      samples[season].push({ round, races: rounds.length - k, gainPerMillion: round1(gainPerMillion) });
    }
  }
  const slope: Record<number, number> = {};
  for (const target of SEASONS) {
    const pool = Object.entries(samples).filter(([s]) => Number(s) < target).flatMap(([, v]) => v);
    const den = pool.reduce((sum, x) => sum + x.races * x.races, 0);
    const num = pool.reduce((sum, x) => sum + x.races * x.gainPerMillion, 0);
    slope[target] = den > 0 ? round3(Math.max(0, num / den)) : PRIOR_MONEY_SLOPE;
  }
  return { samples, slope };
}

/** Objective and threshold with the best total over earlier seasons; 2024 uses the prior (expected, 0). */
function fitPolicy(season: number, runs: Map<string, SeasonRun>, objectives: ObjectiveKind[]): { objective: ObjectiveKind; threshold: number } {
  const earlier = SEASONS.filter((s) => s < season);
  let best = { objective: "expected" as ObjectiveKind, threshold: PRIOR_THRESHOLD };
  if (earlier.length === 0) return best;
  let bestTotal = -Infinity;
  for (const objective of objectives) {
    for (const x of THRESHOLD_GRID) {
      let total = 0;
      for (const s of earlier) total += (runs.get(`${s}:${objective}:${x}`) as SeasonRun).total;
      if (total > bestTotal) {
        bestTotal = total;
        best = { objective, threshold: x };
      }
    }
  }
  return best;
}

// ------------------------------------------------------------------------------ robust evaluation

/**
 * Worker for evaluate.ts. Spec "season:first:last:sigma": plays the site method (calibrated blend,
 * expected objective, threshold 0, 4 chips; the walk-forward fit picks exactly this for every
 * season) once per seed, each asset's forecast multiplied by (1 + e), e ~ N(0, sigma), e drawn from
 * a hash of (seed, season, round, kind, id) so two forecast sources see the same draws. Seed 0 is
 * the unperturbed run. Prints one JSON line: totals by seed.
 */
function robustWorker(spec: string) {
  const [seasonText, firstText, lastText, sigmaText] = spec.split(":");
  const season = Number(seasonText);
  const sigma = Number(sigmaText);
  const base = blendForecast(season, true);
  const rule = process.env.CHIP_RULE ?? "";
  const policy: Policy = { ...SITE_POLICY, chips: true, plan: 1, ...(rule === "W" ? { wcTrigger: 20 } : {}) };
  const totals: Record<number, number> = {};
  for (let seed = Number(firstText); seed <= Number(lastText); seed++) {
    const forecast = perturbedForecast(base, seed, sigma);
    const run = playSeason(`robust ${seed}`, season, forecast, policy);
    totals[seed] = run.total;
  }
  console.log(JSON.stringify({ season, totals }));
}

function perturbedForecast(base: Forecast, seed: number, sigma: number): Forecast {
  if (seed === 0) return base;
  return (r) => {
    const out = new Map<string, number>();
    for (const [id, value] of base(r)) {
      const kind = r.assets.find((a) => a.id === id)?.kind ?? "driver";
      const e = sigma * hashNormal(`${seed}|${r.season}|${r.round}|${kind}|${id}`);
      out.set(id, value * (1 + e));
    }
    return out;
  };
}

/** Standard normal from a string key (FNV-1a hash, two uniforms, Box-Muller). */
function hashNormal(key: string): number {
  const u1 = (hash32(key + "#1") + 0.5) / 4294967296;
  const u2 = (hash32(key + "#2") + 0.5) / 4294967296;
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function hash32(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return h >>> 0;
}

// ------------------------------------------------------------------------------ round 3

function roundThree() {
  const family = process.env.R3 as string;
  if (family === "sse") return stackErrors();
  if (family === "cmp") return compareRounds();
  if (family.startsWith("multi:")) return multiReport(family.slice(6).split(","));
  const grids = r3Grids();
  const names = family === "all" ? Object.keys(grids) : family.split(",");
  for (const name of names) {
    for (const [label, policyOf] of Object.entries(grids[name])) {
      const runs = SEASONS.map((season) => {
        const { forecast, policy } = policyOf(season);
        return playSeason(label, season, forecast, policy);
      });
      const cells = runs.map((x) => `${Math.round(x.total)} (${x.finalTeamValue.toFixed(1)})`);
      console.log(`| ${name} | ${label} | ${cells.join(" | ")} |`);
    }
  }
}

/** Per round: site points, form points, cumulative gap and team values (both with 4 chips). */
function compareRounds() {
  for (const season of SEASONS) {
    const site = playSeason("site", season, blendForecast(season, true), { threshold: 0, chips: true, plan: 1 });
    const form = playSeason("form", season, (r) => formOf(r), { threshold: 0, chips: true, plan: 1 });
    let gap = 0;
    const lines = site.log.map((x, k) => {
      const y = form.log[k];
      gap += y.points - x.points;
      return `${x.round}:${Math.round(x.points)}/${Math.round(y.points)} gap ${Math.round(gap)} tv ${x.teamValue}/${y.teamValue}`;
    });
    console.log(season, "\n " + lines.join("\n "));
  }
}

/** Multi-start criterion of every grid point of the given families on 2024 and 2025. */
function multiReport(families: string[]) {
  const grids = r3Grids();
  for (const name of families) {
    for (const [label, variant] of Object.entries(grids[name])) {
      const cells = [2024, 2025].map((s) => multiStart(s, variant).toFixed(1));
      console.log(`| ${name} | ${label} | ${cells.join(" | ")} |`);
    }
  }
}

/** Forecast error (RMSE over active rows) of the site forecast and every stack level, per season. */
function stackErrors() {
  const site = (season: number) => blendForecast(season, true);
  for (const season of SEASONS) {
    const n = (data.get(season) ?? []).reduce((k, r) => k + r.assets.filter((a) => a.active).length, 0);
    const cells = [`site ${Math.sqrt(seasonSse(season, site(season)) / n).toFixed(3)}`];
    for (const level of [1, 2, 3, 4, 5, 6]) cells.push(`S${level} ${Math.sqrt(seasonSse(season, stackForecast(level, site)) / n).toFixed(3)}`);
    console.log(season, cells.join("  "));
  }
}

/**
 * Multi-start criterion: mean over start rounds k >= 1 of (variant points from k to the end minus
 * the site method's), both starting from the site method's no-chip team after round k - 1.
 */
function multiStart(season: number, variant: R3Variant): number {
  const site = blendForecast(season, true);
  const base = playSeason("multi base", season, site, { threshold: 0, chips: false, plan: 1 });
  const rounds = data.get(season) ?? [];
  const { forecast, policy } = variant(season);
  const gains: number[] = [];
  for (let k = 1; k < rounds.length; k++) {
    const prev = base.log[k - 1];
    const team = { drivers: prev.drivers, constructors: prev.constructors };
    const lastPrices = priceMap(rounds[k - 1].rows, (x) => x.priceAfter ?? x.price);
    const startAt = { index: k, team, bank: prev.bank, lastPrices };
    const run = playSeason("multi", season, forecast, { ...policy, chips: false, start: startAt });
    const baseSpan = base.perRound.slice(k).reduce((x, y) => x + y, 0);
    gains.push(run.total - baseSpan);
  }
  return mean(gains);
}

type R3Variant = (season: number) => { forecast: Forecast; policy: Policy };

/** Round 3 families: label -> (season -> forecast and policy). */
function r3Grids(): Record<string, Record<string, R3Variant>> {
  const site = (season: number) => blendForecast(season, true);
  const base: Policy = { threshold: 0, chips: true, plan: 1 };
  const out: Record<string, Record<string, R3Variant>> = { H: {}, L: {}, M: {}, U: {}, S: {}, C: {} };
  const schedules: Record<string, Partial<Record<ChipId, "sprint" | number>> | undefined> = {
    C0: undefined,
    C1: { limitless: "sprint" },
    C2: { extraBoost: "sprint" },
    C3: { limitless: "sprint", extraBoost: "sprint" },
    C4: { wildcard: 2 },
  };
  for (const [label, schedule] of Object.entries(schedules)) {
    out.C[label] = (season) => ({ forecast: site(season), policy: { ...base, schedule } });
  }
  for (const level of [1, 2, 3, 4, 5, 6]) {
    out.S[`S${level}`] = () => ({ forecast: stackForecast(level, site), policy: base });
  }
  for (const w of [0, 0.25, 0.5, 0.75, 1]) {
    out.H[`w=${w}`] = (season) => {
      const model = site(season);
      return { forecast: mixForecast(model, (r) => formOf(r), w), policy: { ...base, boostForecast: model, chipForecast: model } };
    };
  }
  for (const L of [0, 0.05, 0.1, 0.2, 0.3, 0.5]) {
    out.L[`L=${L}`] = (season) => ({ forecast: site(season), policy: { ...base, value: { slope: L, lookahead: 0 } } });
  }
  for (const m of [0, 2, 4, 8]) {
    out.M[`m=${m}`] = (season) => ({ forecast: momentumForecast(site(season), m), policy: base });
  }
  for (const k of [0, 0.25, 0.5, 1]) {
    out.U[`k=${k}`] = (season) => {
      const model = site(season);
      return { forecast: model, policy: { ...base, boostForecast: model, upside: k } };
    };
  }
  return out;
}


/**
 * Stacked forecast: per kind, weighted ridge least squares of actual points on the level's
 * features over every earlier round (all seasons), refitted before each round. Falls back to
 * `fallback` until STACK_MIN_ROWS rows per kind exist.
 */
function stackForecast(level: number, fallback: (season: number) => Forecast): Forecast {
  return (r) => {
    const key = `${level}:${r.season}:${r.round}`;
    const cached = stackCache.get(key);
    if (cached) return cached;
    const out = new Map<string, number>();
    const backup = fallback(r.season)(r);
    for (const kind of ["driver", "constructor"] as const) {
      const beta = stackFit(level, kind, r);
      for (const a of r.assets) {
        if (a.kind !== kind) continue;
        if (!beta || !a.active) {
          out.set(a.id, backup.get(a.id) ?? 0);
          continue;
        }
        const f = stackFeatures(a, r, level);
        out.set(a.id, f.reduce((sum, v, i) => sum + v * beta[i], 0));
      }
    }
    stackCache.set(key, out);
    return out;
  };
}

/** Stack coefficients for one kind from every round before r (null before enough rows). */
function stackFit(level: number, kind: string, r: RoundData): number[] | null {
  const xs: number[][] = [];
  const ys: number[] = [];
  const ws: number[] = [];
  for (const s of SEASONS) {
    for (const x of data.get(s) ?? []) {
      if (s > r.season || (s === r.season && x.round >= r.round)) continue;
      for (const a of x.assets) {
        if (!a.active || a.kind !== kind || a.model === null) continue;
        xs.push(stackFeatures(a, x, level));
        ys.push(a.actual);
        ws.push(level >= 6 && s === r.season ? 3 : 1);
      }
    }
  }
  return xs.length >= STACK_MIN_ROWS ? ridge(xs, ys, ws, STACK_RIDGE) : null;
}

/** Features of one asset row for stack level 1 to 6 (6 = 5 with a different row weight). */
function stackFeatures(a: AssetRound, r: RoundData, level: number): number[] {
  const model = a.model ?? a.form;
  const x = [1, model];
  if (level >= 2) x.push(a.form);
  if (level >= 3) {
    const last = a.past.length ? a.past[a.past.length - 1] : a.form;
    const last3 = a.past.length ? mean(a.past.slice(-3)) : a.form;
    const seasonMean = a.past.length ? mean(a.past) : a.form;
    x.push(last, last3, seasonMean);
  }
  if (level >= 4) x.push(a.lastChange);
  if (level >= 5) x.push(r.sprint ? model : 0);
  return x;
}

/** Weighted ridge regression on standardised features (intercept unpenalised), coefficients on the raw scale. */
function ridge(xs: number[][], ys: number[], ws: number[], lambda: number): number[] {
  const p = xs[0].length;
  const wsum = ws.reduce((a, b) => a + b, 0);
  const mu = new Array<number>(p).fill(0);
  const sc = new Array<number>(p).fill(1);
  for (let j = 1; j < p; j++) {
    let m = 0;
    for (let i = 0; i < xs.length; i++) m += ws[i] * xs[i][j];
    m /= wsum;
    let v = 0;
    for (let i = 0; i < xs.length; i++) v += ws[i] * (xs[i][j] - m) ** 2;
    mu[j] = m;
    sc[j] = Math.sqrt(v / wsum) || 1;
  }
  const A = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const b = new Array<number>(p).fill(0);
  for (let i = 0; i < xs.length; i++) {
    const z = xs[i].map((v, j) => (j === 0 ? 1 : (v - mu[j]) / sc[j]));
    for (let j = 0; j < p; j++) {
      b[j] += ws[i] * z[j] * ys[i];
      for (let k = 0; k < p; k++) A[j][k] += ws[i] * z[j] * z[k];
    }
  }
  for (let j = 1; j < p; j++) A[j][j] += lambda * wsum;
  const g = solve(A, b);
  const beta = new Array<number>(p).fill(0);
  beta[0] = g[0];
  for (let j = 1; j < p; j++) {
    beta[j] = g[j] / sc[j];
    beta[0] -= (g[j] * mu[j]) / sc[j];
  }
  return beta;
}

/** Gaussian elimination with partial pivoting. */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-12));
}

/** Squared error of a forecast over every active asset row of a season. */
function seasonSse(season: number, forecast: Forecast): number {
  let total = 0;
  for (const r of data.get(season) ?? []) {
    const f = forecast(r);
    for (const a of r.assets) if (a.active) total += ((f.get(a.id) ?? 0) - a.actual) ** 2;
  }
  return total;
}

/** w x first + (1 - w) x second. */
function mixForecast(first: Forecast, second: Forecast, w: number): Forecast {
  return (r) => {
    const a = first(r);
    const b = second(r);
    const out = new Map<string, number>();
    for (const asset of r.assets) out.set(asset.id, w * (a.get(asset.id) ?? 0) + (1 - w) * (b.get(asset.id) ?? 0));
    return out;
  };
}

/** Forecast plus m x the asset's last price change ($M, known before the lock). */
function momentumForecast(inner: Forecast, m: number): Forecast {
  return (r) => {
    const out = new Map(inner(r));
    if (m === 0) return out;
    const previous = (data.get(r.season) ?? []).find((x) => x.round < r.round && !(data.get(r.season) ?? []).some((y) => y.round > x.round && y.round < r.round));
    if (!previous) return out;
    const before = priceMap(previous.rows, (x) => x.price);
    for (const a of r.assets) {
      const old = before.get(a.id);
      if (old === undefined || !a.active) continue;
      out.set(a.id, (out.get(a.id) ?? 0) + m * (a.price - old));
    }
    return out;
  };
}

// ------------------------------------------------------------------------------ forecasts

function modelForecast(r: RoundData): Map<string, number> {
  const out = new Map<string, number>();
  for (const a of r.assets) out.set(a.id, a.model ?? a.form);
  return out;
}

function formOf(r: RoundData): Map<string, number> {
  return new Map(r.assets.map((a) => [a.id, a.form]));
}

/** w x model + (1 - w) x form, w per kind fitted by least squares on earlier seasons (prior 0.5 for 2024). */
function blendForecast(season: number, calibrate: boolean): Forecast {
  const weights = blendWeights(season, calibrate);
  const calibrated = calibratedForecast(true);
  return (r) => {
    const model = calibrate ? calibrated(r) : modelForecast(r);
    const out = new Map<string, number>();
    for (const a of r.assets) {
      const w = weights[a.kind];
      const m = model.get(a.id) ?? a.form;
      out.set(a.id, w * m + (1 - w) * a.form);
    }
    return out;
  };
}

function blendWeights(season: number, calibrate: boolean): Record<string, number> {
  const earlier = SEASONS.filter((s) => s < season);
  if (earlier.length === 0) return { driver: PRIOR_BLEND, constructor: PRIOR_BLEND };
  const calibrated = calibratedForecast(true);
  const out: Record<string, number> = {};
  for (const kind of ["driver", "constructor"]) {
    let num = 0;
    let den = 0;
    for (const s of earlier) {
      for (const r of data.get(s) ?? []) {
        const model = calibrate ? calibrated(r) : modelForecast(r);
        for (const a of r.assets) {
          if (!a.active || a.kind !== kind) continue;
          const d = (model.get(a.id) ?? a.form) - a.form;
          num += d * (a.actual - a.form);
          den += d * d;
        }
      }
    }
    out[kind] = den > 0 ? Math.min(1, Math.max(0, num / den)) : PRIOR_BLEND;
  }
  return out;
}

/** Model rescaled per kind: actual ~ a + b x model, fitted on every earlier round (all seasons). */
function calibratedForecast(_cache: boolean): Forecast {
  return (r) => {
    const fits = calibrationFor(r.season, r.round);
    const out = new Map<string, number>();
    for (const a of r.assets) {
      const m = a.model ?? a.form;
      const fit = fits[a.kind];
      out.set(a.id, fit ? fit.a + fit.b * m : m);
    }
    return out;
  };
}

function calibrationFor(season: number, round: number): Record<string, { a: number; b: number } | null> {
  const key = `${season}:${round}`;
  const cached = calibrationCache.get(key);
  if (cached) return cached;
  const fits: Record<string, { a: number; b: number } | null> = {};
  for (const kind of ["driver", "constructor"]) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const s of SEASONS) {
      for (const r of data.get(s) ?? []) {
        if (s > season || (s === season && r.round >= round)) continue;
        for (const a of r.assets) {
          if (!a.active || a.kind !== kind || a.model === null) continue;
          xs.push(a.model);
          ys.push(a.actual);
        }
      }
    }
    fits[kind] = xs.length >= MIN_CALIBRATION_ROWS ? linearFit(xs, ys) : null;
  }
  calibrationCache.set(key, fits);
  return fits;
}

// ------------------------------------------------------------------------------ season loop

function playSeason(name: string, season: number, forecast: Forecast, policy: Policy, fixedTeam?: TeamSelection): SeasonRun {
  const rounds = data.get(season) ?? [];
  const chipSet = policy.chipSet ?? SCORED_CHIPS;
  const start = policy.start;
  const state: State = start
    ? { team: start.team, bank: start.bank, lastPrices: start.lastPrices, chipsLeft: [], races: start.index }
    : { team: null, bank: 100, lastPrices: new Map(), chipsLeft: policy.chips ? [...chipSet] : [], races: 0 };
  const perRound: number[] = [];
  const budgets: number[] = [];
  const log: RoundLog[] = [];
  const chipsPlayed: string[] = [];
  let transfers = 0;
  let penalties = 0;
  let cumulative = 0;
  for (const r of rounds.slice(start ? start.index : 0)) {
    const expected = forecast(r);
    const market = marketFor(r, expected, policy.value);
    const priceNow = priceMap(r.rows, (x) => x.price);
    keepKnown(state, priceNow);
    const bonus = policy.bonus && policy.bonus.round === r.round ? policy.bonus.amount : 0;
    state.bank += bonus;
    const budget = state.team ? teamValue(state.team, priceNow) + state.bank : 100 + bonus;
    budgets.push(budget);
    const roundPolicy = policy.value?.live ? livePolicy(policy, market, budget) : policy;
    const chipMarket = policy.chipForecast ? marketFor(r, policy.chipForecast(r), policy.value) : market;
    if (policy.trace) policy.trace(r, market, state);
    const pick = decide(market, state, roundPolicy, fixedTeam, chipMarket);
    if (policy.boostForecast || policy.upside) reBoost(r, pick, policy);
    const owned = state.team ? new Set([...state.team.drivers, ...state.team.constructors]) : null;
    const members = [...pick.team.drivers, ...pick.team.constructors];
    const ins = owned ? members.filter((id) => !owned.has(id)) : [];
    const outs = owned ? [...owned].filter((id) => !members.includes(id)) : [];
    const penalty = owned ? transferPenalty(market.rules, ins.length, 2, pick.chip) : 0;
    const cost = teamValue(pick.team, priceNow);
    if (pick.chip !== "limitless" && cost > budget + 1e-6) notes.push(`${name} ${season}-${r.round}: OVER BUDGET cost ${cost} budget ${budget}`);
    const canFix = pick.chip === null && state.team !== null && state.chipsLeft.includes("finalFix") && policy.finalFix !== undefined;
    const lastRound = r.round >= market.rules.seasonRounds;
    const fix = canFix ? finalFixSwap(r, pick, budget - cost, priceNow, policy.finalFix as number, lastRound) : null;
    if (fix) {
      pick.chip = "finalFix";
      pick.fix = fix;
    }
    const scored = actualPoints(r, pick);
    const points = scored - penalty;
    cumulative += points;
    perRound.push(points);
    transfers += ins.length;
    penalties += penalty;
    if (pick.chip) {
      chipsPlayed.push(`${pick.chip}@R${r.round}`);
      state.chipsLeft = state.chipsLeft.filter((c) => c !== pick.chip);
    }
    const after = priceMap(r.rows, (x) => x.priceAfter ?? x.price);
    if (pick.chip !== "limitless") {
      const fixCost = fix ? (priceNow.get(fix.in) ?? 0) - (priceNow.get(fix.out) ?? 0) : 0;
      state.team = fix ? swapped(pick.team, fix) : pick.team;
      state.bank = budget - cost - fixCost;
    }
    state.lastPrices = after;
    state.races += 1;
    const heldValue = teamValue(state.team as TeamSelection, after) + state.bank;
    log.push({
      round: r.round,
      drivers: pick.team.drivers,
      constructors: pick.team.constructors,
      transfersIn: ins,
      transfersOut: outs,
      boost: pick.boost,
      extraBoost: pick.extraBoost,
      chip: pick.chip,
      penalty,
      points: round1(points),
      cumulative: round1(cumulative),
      teamValue: round1(heldValue),
      bank: round1(state.bank),
    });
  }
  const finalTeamValue = log.length ? log[log.length - 1].teamValue : 100;
  const total = perRound.reduce((x, y) => x + y, 0);
  return { name, total, perRound, transfers, penalties, finalTeamValue, chips: chipsPlayed, budgets, log };
}

interface Swap { out: string; in: string; gain: number }
interface Pick { team: TeamSelection; boost: string | null; extraBoost: string | null; chip: ChipId | null; fix?: Swap }

function decide(market: Market, state: State, policy: Policy, fixedTeam?: TeamSelection, chipMarket: Market = market): Pick {
  const objective = objectiveOf(policy, market);
  // Final Fix is decided after qualifying (finalFixSwap), never before the lock.
  const preLock = state.chipsLeft.filter((c) => c !== "finalFix");
  const user = {
    team: state.team,
    bank: state.bank,
    freeTransfers: 2,
    objective,
    chipsAvailable: preLock,
    teamRacesCompleted: state.races,
  };
  if (fixedTeam) {
    const held = evaluateTeam(market, { ...user, team: fixedTeam }, fixedTeam, { chip: null });
    return { team: fixedTeam, boost: held?.boost ?? null, extraBoost: null, chip: null };
  }
  let chip: ChipId | null = null;
  const forced = policy.chips && state.team ? scheduledChip(market, preLock, policy.schedule) : null;
  const reserved = new Set(Object.keys(policy.schedule ?? {}));
  if (policy.wcTrigger !== undefined) reserved.add("wildcard");
  const free = preLock.filter((c) => !reserved.has(c));
  const triggered = !forced && policy.chips && state.team && policy.wcTrigger !== undefined && preLock.includes("wildcard") && market.round >= 2
    ? (optimiseTeam(market, user, { objective, topN: 1, chip: null, maxMs: Number.POSITIVE_INFINITY }).best?.penalty ?? 0) >= policy.wcTrigger
    : false;
  if (forced) chip = forced;
  else if (triggered) chip = "wildcard";
  else if (policy.chips && state.team && free.length > 0) {
    const advice = adviseChips(chipMarket, { ...user, chipsAvailable: free }, { maxMs: 200 });
    chip = advice.playNow === "finalFix" ? null : advice.playNow;
  }
  if (policy.plan > 1 && !chip) {
    const plan = planTransfers(market, user, { rounds: policy.plan, objective, maxMs: Number.POSITIVE_INFINITY });
    const first = plan.stages[0];
    if (first) return { team: { drivers: first.drivers, constructors: first.constructors }, boost: first.boost, extraBoost: null, chip: null };
  }
  const result = optimiseTeam(market, user, { objective, topN: 40, chip, maxMs: Number.POSITIVE_INFINITY });
  const best = withThreshold(market, user, result.alternatives, policy.threshold, chip);
  if (!best) return { team: state.team as TeamSelection, boost: null, extraBoost: null, chip: null };
  return { team: { drivers: best.drivers, constructors: best.constructors }, boost: best.boost, extraBoost: best.extraBoost, chip };
}

/** The scheduled chip due this round (one per round, in schedule order), or null. */
function scheduledChip(market: Market, available: ChipId[], schedule?: Partial<Record<ChipId, "sprint" | number>>): ChipId | null {
  if (!schedule || market.round < 2) return null;
  for (const [chip, when] of Object.entries(schedule) as [ChipId, "sprint" | number][]) {
    if (!available.includes(chip)) continue;
    const due = when === "sprint" ? market.hasSprint : market.round >= when;
    if (due) return chip;
  }
  return null;
}

/** Round 3: Boost and x3 inside the picked team re-chosen by the boost forecast plus upside. */
function reBoost(r: RoundData, pick: Pick, policy: Policy) {
  if (pick.chip === "autopilot" || pick.team.drivers.length === 0) return;
  const forecast = policy.boostForecast ? policy.boostForecast(r) : null;
  const k = policy.upside ?? 0;
  const score = (id: string) => {
    const base = forecast ? (forecast.get(id) ?? 0) : 0;
    const spread = k > 0 ? spreadOf(r, id) : 0;
    return base + k * spread;
  };
  const ranked = [...pick.team.drivers].sort((x, y) => score(y) - score(x));
  if (pick.extraBoost) {
    pick.extraBoost = ranked[0];
    if (pick.boost) pick.boost = ranked[1];
    return;
  }
  if (pick.boost) pick.boost = ranked[0];
}

/** SD of a driver's earlier points this season (prior 14 before three races). */
function spreadOf(r: RoundData, id: string): number {
  const points: number[] = [];
  for (const x of data.get(r.season) ?? []) {
    if (x.round >= r.round) break;
    const a = x.assets.find((y) => y.id === id && y.active);
    if (a) points.push(a.actual);
  }
  return points.length >= 3 ? sd(points) : PRIOR_SD.driver;
}

/** Best of the candidates after charging `threshold` points per transfer (keeping the team is a candidate). */
function withThreshold(market: Market, user: Parameters<typeof optimiseTeam>[1], alternatives: TeamResult[], threshold: number, chip: ChipId | null): TeamResult | null {
  if (threshold <= 0 || !user.team || chip === "wildcard" || chip === "limitless") return alternatives[0] ?? null;
  const candidates = [...alternatives];
  const complete = user.team.drivers.length === market.rules.drivers && user.team.constructors.length === market.rules.constructors;
  const held = complete ? evaluateTeam(market, user, user.team, { chip }) : null;
  if (held) candidates.push({ ...held, transferCount: 0, penalty: 0 });
  let best: TeamResult | null = null;
  let bestScore = -Infinity;
  for (const c of candidates) {
    const score = c.score - threshold * c.transferCount;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/** Policy with the value slope set to the forecast's own marginal points per $M this round. */
function livePolicy(policy: Policy, market: Market, budget: number): Policy {
  const value = policy.value as ValuePolicy;
  const low = optimiseTeam(market, { team: null }, { budget: budget - MONEY_BONUS, topN: 1, chip: null, objective: { kind: "expected" } });
  const high = optimiseTeam(market, { team: null }, { budget: budget + MONEY_BONUS, topN: 1, chip: null, objective: { kind: "expected" } });
  const gain = (high.best?.expectedPoints ?? 0) - (low.best?.expectedPoints ?? 0);
  const slope = Math.max(0, gain / (2 * MONEY_BONUS));
  return { ...policy, value: { ...value, slope: value.slope * slope } };
}

/** Objective for a policy; the value of money version charges lambda = slope x races left after this one. */
function objectiveOf(policy: Policy, market: Market) {
  if (policy.value) {
    const left = Math.max(0, market.rules.seasonRounds - market.round);
    return { kind: "value" as const, pointsPerMillion: policy.value.slope * left };
  }
  if (policy.objective === "value") return { kind: "value" as const };
  return { kind: "expected" as const };
}

/**
 * Final Fix after qualifying: the one driver swap with the largest expected gain in race points,
 * using only what is known then (post-qualifying forecast minus the qualifying and sprint points
 * already scored). The removed driver keeps those points, the new one scores the race. Played
 * when the gain reaches `minGain` (any positive gain in the last round of the season).
 */
function finalFixSwap(r: RoundData, pick: Pick, bank: number, prices: Map<string, number>, minGain: number, lastRound: boolean): Swap | null {
  const byId = new Map(r.assets.map((a) => [a.id, a]));
  const owned = new Set(pick.team.drivers);
  let best: Swap | null = null;
  for (const out of pick.team.drivers) {
    const outGuess = raceGuess(byId.get(out));
    if (outGuess === null) continue;
    const mult = multiplierOf(pick, out);
    const room = bank + (prices.get(out) ?? 0);
    for (const a of r.assets) {
      const price = prices.get(a.id) ?? Number.POSITIVE_INFINITY;
      if (a.kind !== "driver" || owned.has(a.id) || price > room + 1e-9) continue;
      const inGuess = raceGuess(a);
      if (inGuess === null) continue;
      const gain = mult * (inGuess - outGuess);
      if (!best || gain > best.gain) best = { out, in: a.id, gain };
    }
  }
  if (!best) return null;
  if (best.gain >= minGain || (lastRound && best.gain > 0)) return best;
  return null;
}

/** Expected race points after qualifying; an inactive driver (withdrawn) scores 0. */
function raceGuess(a: AssetRound | undefined): number | null {
  if (!a) return null;
  if (!a.active) return 0;
  if (a.postQuali === null || !a.sessions) return null;
  return a.postQuali - a.sessions.q - a.sessions.s;
}

function multiplierOf(pick: Pick, id: string): number {
  if (pick.extraBoost === id) return 3;
  if (pick.boost === id) return 2;
  return 1;
}

function swapped(team: TeamSelection, fix: Swap): TeamSelection {
  return { drivers: team.drivers.map((id) => (id === fix.out ? fix.in : id)), constructors: team.constructors };
}

function hindsight(season: number, budgets: number[]) {
  const rounds = data.get(season) ?? [];
  const perRound = rounds.map((r, k) => {
    const actual = new Map(r.assets.map((a) => [a.id, a.active ? a.actual : 0]));
    const market = marketFor(r, actual);
    const values = Float64Array.from(market.assets, (x) => actual.get(x.id) ?? 0);
    const result = optimiseTeam(market, { team: null }, { expectedPoints: values, budget: budgets[k], topN: 1, chip: null, maxMs: Number.POSITIVE_INFINITY });
    return result.best?.expectedPoints ?? 0;
  });
  return { total: perRound.reduce((x, y) => x + y, 0), perRound };
}

// ------------------------------------------------------------------------------ data

function buildSeason(season: number): RoundData[] {
  const rows = history.seasons[String(season)] ?? [];
  const rounds = [...new Set(rows.filter((r) => r.points !== null).map((r) => r.round))].sort((x, y) => x - y);
  const past = new Map<string, number[]>();
  const out: RoundData[] = [];
  let previousPrices = new Map<string, number>();
  for (const round of rounds) {
    const roundRows = rows.filter((r) => r.round === round);
    const active = roundRows.filter((r) => r.active);
    const pred = loadPrediction(season, round);
    const lock = pred?.fantasyAtLock;
    if (!lock) notes.push(`${season}-${round}: no fantasyAtLock, form used`);
    else checkLock(season, round, pred as PredFile);
    const form = formForecast(season, round, active, past);
    const assets: AssetRound[] = [];
    const seen = new Set<string>();
    const ordered = [...roundRows].sort((x, y) => Number(y.active) - Number(x.active));
    for (const row of ordered) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      const table = row.kind === "driver" ? lock?.drivers : lock?.constructors;
      const split = breakdown[String(season)]?.[String(round)]?.[`${row.kind}:${row.id}`] ?? null;
      const pastPoints = past.get(`${row.kind}:${row.id}:${row.fantasyId}`) ?? [];
      const hit = table?.[row.id];
      if (lock && row.active && !hit) notes.push(`${season}-${round}: ${row.kind} ${row.id} not in fantasyAtLock, form used`);
      assets.push({
        id: row.id,
        kind: row.kind,
        price: row.price,
        active: row.active,
        actual: row.points ?? 0,
        model: row.active && hit ? hit.expectedPoints : null,
        form: row.active ? (form.get(row.id) ?? 0) : 0,
        priceChange: hit?.expectedPriceChange ?? 0,
        recent: pastPoints.slice(-2),
        past: [...pastPoints],
        lastChange: previousPrices.has(row.id) ? round1(row.price - (previousPrices.get(row.id) as number)) : 0,
        sessions: split ? { q: split.q, s: split.s, r: split.r } : null,
        items: split?.items ?? null,
        actualChange: row.priceAfter === null ? null : round1(row.priceAfter - row.price),
        postQuali: row.active && row.kind === "driver" ? postQualiOf(pred, row.id) : null,
      });
    }
    out.push({
      season,
      round,
      sprint: Boolean(pred?.race.hasSprint),
      raceName: pred?.race.raceName ?? `Round ${round}`,
      country: pred?.race.country ?? "",
      rows: roundRows,
      assets,
      labels: labelsOf(pred, roundRows),
    });
    previousPrices = priceMap(roundRows, (x) => x.price);
    for (const row of active) {
      const key = `${row.kind}:${row.id}:${row.fantasyId}`;
      const h = past.get(key) ?? [];
      h.push(row.points ?? 0);
      past.set(key, h);
    }
  }
  return out;
}

function labelsOf(pred: PredFile | null, rows: HistoryRow[]) {
  const labels = new Map<string, { code: string; team: string; color: string }>();
  const colors = new Map<string, string>();
  for (const c of pred?.constructors ?? []) colors.set(c.constructorId, c.teamColor);
  for (const d of pred?.drivers ?? []) if (!colors.has(d.constructorId)) colors.set(d.constructorId, d.teamColor);
  for (const c of pred?.constructors ?? []) labels.set(c.constructorId, { code: constructorCode(c.name), team: c.constructorId, color: c.teamColor });
  for (const d of pred?.drivers ?? []) labels.set(d.driverId, { code: d.code, team: d.constructorId, color: d.teamColor });
  for (const row of rows) {
    if (!row.active) continue;
    const known = labels.get(row.id);
    const color = colors.get(row.constructorId) ?? known?.color ?? "#888888";
    const code = known?.code ?? (row.kind === "driver" ? driverCode(row.name) : constructorCode(row.name));
    labels.set(row.id, { code, team: row.constructorId, color });
  }
  return labels;
}

function marketFor(r: RoundData, expected: Map<string, number>, value?: ValuePolicy): Market {
  const changes = value ? priceExpectations(r, expected, value) : null;
  const assets: FantasyAsset[] = r.assets.map((a) => ({
    id: a.id,
    kind: a.kind,
    name: a.id,
    constructorId: r.rows.find((x) => x.id === a.id && x.active === a.active)?.constructorId ?? "",
    price: a.price,
    expectedPoints: a.active ? (expected.get(a.id) ?? 0) : 0,
    expectedPriceChange: changes ? (changes.get(a.id) ?? 0) : a.priceChange,
    active: a.active,
  }));
  const rounds = (data.get(r.season) ?? []).map((x) => x.round);
  const next = rounds.filter((x) => x > r.round).slice(0, 2);
  // Horizon: only what is known at this lock, i.e. this round's forecast repeated.
  const horizon: HorizonRound[] = next.map((x) => ({
    round: x,
    raceName: `Round ${x}`,
    hasSprint: false,
    expectedPoints: Object.fromEntries(assets.map((a) => [a.id, a.expectedPoints])),
    expectedPriceChange: Object.fromEntries(assets.map((a) => [a.id, a.expectedPriceChange ?? 0])),
  }));
  const file: FantasyFile = { generatedAt: "", season: r.season, round: r.round, raceName: r.raceName, hasSprint: r.sprint, assets, horizon };
  const rules: Partial<GameRules> = seasonRules(r.season);
  return prepareMarket(file, { rules, fallbackScenarios: 40 });
}

/**
 * Expected price change per asset over the price rule (3-race points per $M, tiers at 18.5M) with
 * this round's points ~ Normal(forecast, residual SD), so near-threshold assets get the full
 * probability spread, not a step at the mean. With lookahead w the next round's expected change
 * (window shifted by one, same forecast) is added with weight w x (races left - 1) / races left,
 * so that one race's lambda covers both. 2024 had a different (transfer driven) rule: there the
 * rule expectation is shrunk by a slope fitted on earlier 2024 rounds (0 before enough rows).
 */
function priceExpectations(r: RoundData, expected: Map<string, number>, value: ValuePolicy): Map<string, number> {
  const out = new Map<string, number>();
  const sds = residualSd(r.season, r.round);
  const left = Math.max(0, (seasonRules(r.season).seasonRounds ?? 23) - r.round);
  const shrink = r.season < 2025 ? ruleShrink2024(r.round) : 1;
  for (const a of r.assets) {
    if (!a.active) {
      out.set(a.id, 0);
      continue;
    }
    const mu = expected.get(a.id) ?? a.form;
    const sd = sds[a.kind];
    const first = ruleExpectation(a.price, a.recent, mu, sd);
    let change = first;
    if (value.lookahead > 0 && left > 1) {
      const window = [...a.recent.slice(-1), mu];
      const second = ruleExpectation(a.price + first, window, mu, sd);
      change += (value.lookahead * second * (left - 1)) / left;
    }
    out.set(a.id, shrink * change);
  }
  return out;
}

/** Expected step of the price rule when the next points are Normal(mu, sd). */
function ruleExpectation(price: number, previous: number[], mu: number, sd: number): number {
  const need = pointsNeededForRating(price, previous);
  const steps = PRICE_STEPS[tierOf(price)];
  const pGreat = 1 - normalCdf((need.great - mu) / sd);
  const pGoodUp = 1 - normalCdf((need.good - mu) / sd);
  const pPoorUp = 1 - normalCdf((need.poor - mu) / sd);
  const great = pGreat;
  const good = pGoodUp - pGreat;
  const poor = pPoorUp - pGoodUp;
  const terrible = 1 - pPoorUp;
  return great * steps.great + good * steps.good + poor * steps.poor + terrible * steps.terrible;
}

/** 2024: slope of the actual price change on the rule expectation (form as the forecast), earlier 2024 rounds. */
function ruleShrink2024(round: number): number {
  const key = `shrink:${round}`;
  const cached = shrinkCache.get(key);
  if (cached !== undefined) return cached;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const r of data.get(2024) ?? []) {
    if (r.round >= round) continue;
    const sds = residualSd(2024, r.round);
    for (const a of r.assets) {
      if (!a.active || a.actualChange === null) continue;
      xs.push(ruleExpectation(a.price, a.recent, a.form, sds[a.kind]));
      ys.push(a.actualChange);
    }
  }
  const fit = xs.length >= MIN_CALIBRATION_ROWS ? linearFit(xs, ys) : null;
  const slope = fit ? Math.max(0, fit.b) : 0;
  shrinkCache.set(key, slope);
  return slope;
}

/** Residual SD of actual on the calibrated model per kind, earlier rounds; prior before enough rows. */
function residualSd(season: number, round: number): Record<string, number> {
  const key = `sd:${season}:${round}`;
  const cached = sdCache.get(key);
  if (cached) return cached;
  const fits = calibrationFor(season, round);
  const out: Record<string, number> = { ...PRIOR_SD };
  for (const kind of ["driver", "constructor"]) {
    const fit = fits[kind];
    if (!fit) continue;
    const residuals: number[] = [];
    for (const s of SEASONS) {
      for (const r of data.get(s) ?? []) {
        if (s > season || (s === season && r.round >= round)) continue;
        for (const a of r.assets) {
          if (!a.active || a.kind !== kind || a.model === null) continue;
          residuals.push(a.actual - fit.a - fit.b * a.model);
        }
      }
    }
    out[kind] = Math.max(1, sd(residuals));
  }
  sdCache.set(key, out);
  return out;
}

function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

/** Post-qualifying forecast of a driver's weekend total, only from a post-qualifying file without race inputs. */
function postQualiOf(pred: PredFile | null, driverId: string): number | null {
  if (!pred || pred.race.stage !== "post-qualifying") return null;
  const inputs = pred.race.inputsUsed ?? [];
  if (inputs.some((x) => /^(R|Race)$/i.test(x))) return null;
  const hit = pred.drivers.find((d) => d.driverId === driverId);
  return hit?.fantasy?.expectedPoints ?? null;
}

function loadPrediction(season: number, round: number): PredFile | null {
  const path = join(PRED_DIR, `${season}-${String(round).padStart(2, "0")}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as PredFile;
}

function checkLock(season: number, round: number, pred: PredFile) {
  const lock = pred.fantasyAtLock as LockFile;
  const bad = lock.inputsUsed.some((s) => /^(Q|SQ|S|R|Sprint)$/i.test(s)) || !/post-practice/.test(lock.stage);
  const m = /before (\d{4})(\d{2})/.exec(pred.model.notes ?? "");
  const trainedBefore = m ? Number(m[1]) * 100 + Number(m[2]) : null;
  const trainOk = trainedBefore !== null && trainedBefore <= season * 100 + round;
  if (bad || !trainOk) notes.push(`${season}-${round}: LEAK SUSPECT stage="${lock.stage}" inputs=${lock.inputsUsed} model="${pred.model.notes}"`);
}

// ------------------------------------------------------------------------------ diagnosis

function diagnose() {
  const out: Record<string, unknown> = {};
  for (const season of SEASONS) {
    const rounds = data.get(season) ?? [];
    const groups: Record<string, { m: number[]; f: number[]; y: number[]; rhoM: number[]; rhoF: number[] }> = Object.create(null);
    const add = (g: string, a: AssetRound) => {
      if (!groups[g]) groups[g] = { m: [], f: [], y: [], rhoM: [], rhoF: [] };
      groups[g].m.push(a.model as number);
      groups[g].f.push(a.form);
      groups[g].y.push(a.actual);
    };
    for (const r of rounds) {
      const live = r.assets.filter((a) => a.active && a.model !== null);
      for (const a of live) {
        add(`all`, a);
        add(a.kind, a);
        add(r.sprint ? "sprint weekends" : "normal weekends", a);
        add(a.actual < 0 ? "actual < 0 (DNF, DSQ, bad race)" : "actual >= 0", a);
        if (r.round <= 3) add("rounds 1-3", a);
      }
      for (const kind of ["driver", "constructor"]) {
        const k = live.filter((a) => a.kind === kind);
        const y = k.map((a) => a.actual);
        groups[kind].rhoM.push(spearman(k.map((a) => a.model as number), y));
        groups[kind].rhoF.push(spearman(k.map((a) => a.form), y));
      }
    }
    const seasonOut: Record<string, unknown> = {};
    for (const [g, v] of Object.entries(groups)) {
      const fitM = linearFit(v.m, v.y);
      seasonOut[g] = {
        n: v.y.length,
        maeModel: r2(mae(v.m, v.y)),
        maeForm: r2(mae(v.f, v.y)),
        biasModel: r2(mean(v.m) - mean(v.y)),
        biasForm: r2(mean(v.f) - mean(v.y)),
        meanActual: r2(mean(v.y)),
        corrModel: r2(pearson(v.m, v.y)),
        corrForm: r2(pearson(v.f, v.y)),
        slopeActualOnModel: r2(fitM.b),
        sdModel: r2(sd(v.m)),
        sdForm: r2(sd(v.f)),
        sdActual: r2(sd(v.y)),
        ...(v.rhoM.length ? { spearmanPerRoundModel: r2(mean(v.rhoM)), spearmanPerRoundForm: r2(mean(v.rhoF)) } : {}),
      };
    }
    out[season] = seasonOut;
  }
  console.log(JSON.stringify(out, null, 0));
  return out;
}

// ------------------------------------------------------------------------------ site data

function siteData(results: ReturnType<typeof runVariants>) {
  const { table, hind, finalName, formName, keep } = results;
  const seasons = SEASONS.map((season) => {
    const rounds = data.get(season) ?? [];
    const ours = table[finalName][season];
    const form = table[formName][season];
    // An asset sold in a round it does not race (injury, replacement) is missing from that round's
    // labels, so fall back to the label from any other round of the season.
    const seasonLabels = new Map<string, { code: string; team: string; color: string }>();
    for (const r of rounds) for (const [id, l] of r.labels) if (!seasonLabels.has(id)) seasonLabels.set(id, l);
    const labelOf = (r: RoundData, id: string) => r.labels.get(id) ?? seasonLabels.get(id);
    const label = (r: RoundData, id: string | null) => (id ? (labelOf(r, id)?.code ?? id) : null);
    const asset = (r: RoundData, id: string) => {
      const l = labelOf(r, id);
      return { code: l?.code ?? id, color: l?.color ?? "#888888" };
    };
    let averageCumulative = 0;
    const averages = rounds.map((r) => averagePlayer(r));
    const averageCovered = averages.every((x) => x !== null);
    let hindCumulative = 0;
    let formCumulative = 0;
    return {
      season,
      total: Math.round(ours.total),
      hindsight: Math.round(hind[season].total),
      form: Math.round(form.total),
      keep: Math.round(keep[season].total),
      average: averageCovered ? Math.round(averages.reduce((a: number, b) => a + (b ?? 0), 0)) : null,
      finalTeamValue: ours.finalTeamValue,
      players: WORLD_PLAYERS[season],
      worldRank: worldRank(season, ours.total),
      leader: leaderOf(season, ours.total),
      transfers: ours.transfers,
      penalties: ours.penalties,
      chips: ours.chips,
      rounds: ours.log.map((x, k) => {
        const r = rounds[k];
        hindCumulative += hind[season].perRound[k];
        formCumulative += form.perRound[k];
        averageCumulative += averages[k] ?? 0;
        const changed = new Set(x.transfersIn);
        return {
          round: x.round,
          raceName: r.raceName,
          raceCode: raceCode(r.raceName),
          country: r.country,
          sprint: r.sprint,
          drivers: x.drivers.map((id) => ({ ...asset(r, id), changed: changed.has(id) })),
          constructors: x.constructors.map((id) => ({ ...asset(r, id), changed: changed.has(id) })),
          transfersIn: x.transfersIn.map((id) => label(r, id) as string),
          transfersOut: x.transfersOut.map((id) => label(r, id) as string),
          boost: label(r, x.boost),
          extraBoost: label(r, x.extraBoost),
          chip: x.chip,
          penalty: x.penalty,
          points: x.points,
          cumulative: x.cumulative,
          formCumulative: round1(formCumulative),
          averageCumulative: averageCovered ? round1(averageCumulative) : null,
          hindsightCumulative: round1(hindCumulative),
          teamValue: x.teamValue,
          bank: x.bank,
        };
      }),
    };
  });
  return { generatedAt: new Date().toISOString().slice(0, 10), method: finalName, seasons };
}

/**
 * Ownership-weighted "average player" points for a round: sum of selectedPct / 100 x points per
 * asset, drivers scaled to exactly 5 picks and constructors to 2, plus the most-owned driver's
 * points once as the Boost (boost ownership is not published). No penalties, no chips.
 * Null when the round has no ownership data.
 */
function averagePlayer(r: RoundData): number | null {
  const table = ownership[String(r.season)]?.[String(r.round)];
  if (!table) return null;
  let total = 0;
  for (const kind of ["driver", "constructor"] as const) {
    const live = r.assets.filter((a) => a.active && a.kind === kind);
    const shares = live.map((a) => table[`${kind}:${a.id}`] ?? 0);
    const sum = shares.reduce((x, y) => x + y, 0);
    if (sum <= 0) return null;
    const picks = kind === "driver" ? 5 : 2;
    live.forEach((a, k) => (total += (picks * shares[k] * a.actual) / sum));
    if (kind === "driver") {
      const top = live[shares.indexOf(Math.max(...shares))];
      total += top.actual;
    }
  }
  return total;
}

/** The reference leader score for a season (null when not known) and our share of it in %. */
function leaderOf(season: number, points: number): { points: number; round: number; label: string; share: number } | null {
  const leader = WORLD_LEADER[season];
  if (!leader) return null;
  const share = Math.round((1000 * points) / leader.points) / 10;
  return { ...leader, share };
}

/** Rank by linear interpolation of points on log(rank) between anchors; range = nearest anchors. */
function worldRank(season: number, points: number): { rank: number; low: number; high: number; percentile: number | null } | null {
  const anchors = [...WORLD_RANK_ANCHORS[season]].sort((x, y) => y.points - x.points);
  if (anchors.length < 2) return null;
  let upper = anchors[0];
  let lower = anchors[anchors.length - 1];
  for (let k = 0; k + 1 < anchors.length; k++) {
    if (points <= anchors[k].points && points >= anchors[k + 1].points) {
      upper = anchors[k];
      lower = anchors[k + 1];
    }
  }
  const t = (upper.points - points) / (upper.points - lower.points);
  const logRank = Math.log(upper.rank) + t * (Math.log(lower.rank) - Math.log(upper.rank));
  const rank = Math.round(Math.exp(logRank));
  const players = WORLD_PLAYERS[season];
  const percentile = players ? Math.round((1000 * rank) / players) / 10 : null;
  return { rank, low: Math.min(upper.rank, lower.rank), high: Math.max(upper.rank, lower.rank), percentile };
}

// ------------------------------------------------------------------------------ helpers

function actualPoints(r: RoundData, pick: Pick): number {
  const byId = new Map(r.assets.map((a) => [a.id, a]));
  const clamp = pick.chip === "noNegative";
  const of = (id: string) => scoreOf(byId.get(id), clamp);
  let total = 0;
  for (const id of [...pick.team.drivers, ...pick.team.constructors]) total += of(id);
  if (pick.chip === "autopilot") {
    const driverPoints = pick.team.drivers.map(of);
    const top = Math.max(...driverPoints);
    return total + top;
  }
  if (pick.boost) total += of(pick.boost);
  if (pick.extraBoost) total += 2 * of(pick.extraBoost);
  if (pick.fix) total += finalFixDelta(byId, pick);
  return total;
}

/**
 * Official points; with No Negative every negative scoring item is set to 0. 2026 has the item
 * breakdown; 2024 and 2025 only have session totals (qualifying, sprint, race), so there each
 * negative session is clamped, a lower bound on the chip (negative items inside a positive
 * session are missed).
 */
function scoreOf(a: AssetRound | undefined, clamp: boolean): number {
  if (!a) return 0;
  if (!clamp) return a.actual;
  if (a.items) return a.items.reduce((sum, x) => sum + Math.max(0, x), 0);
  if (a.sessions) return Math.max(0, a.sessions.q) + Math.max(0, a.sessions.s) + Math.max(0, a.sessions.r);
  return Math.max(0, a.actual);
}

/** Final Fix: the removed driver's race points leave, the new driver's race points come in (with any Boost). */
function finalFixDelta(byId: Map<string, AssetRound>, pick: Pick): number {
  const fix = pick.fix as Swap;
  const raceOf = (id: string) => byId.get(id)?.sessions?.r ?? 0;
  const mult = multiplierOf(pick, fix.out);
  return mult * (raceOf(fix.in) - raceOf(fix.out));
}

function keepKnown(state: State, priceNow: Map<string, number>) {
  if (!state.team) return;
  const known = (id: string) => {
    if (priceNow.has(id)) return true;
    state.bank += state.lastPrices.get(id) ?? 0;
    return false;
  };
  state.team = { drivers: state.team.drivers.filter(known), constructors: state.team.constructors.filter(known) };
}

function teamValue(team: TeamSelection, prices: Map<string, number>): number {
  let total = 0;
  for (const id of [...team.drivers, ...team.constructors]) total += prices.get(id) ?? 0;
  return total;
}

/** Short race code from the race name ("Las Vegas Grand Prix" -> "LVG"). */
function raceCode(raceName: string): string {
  const fixed: Record<string, string> = {
    "Bahrain Grand Prix": "BHR", "Saudi Arabian Grand Prix": "SAU", "Australian Grand Prix": "AUS", "Japanese Grand Prix": "JPN",
    "Chinese Grand Prix": "CHN", "Miami Grand Prix": "MIA", "Emilia Romagna Grand Prix": "EMI", "Monaco Grand Prix": "MON",
    "Canadian Grand Prix": "CAN", "Spanish Grand Prix": "ESP", "Austrian Grand Prix": "AUT", "British Grand Prix": "GBR",
    "Hungarian Grand Prix": "HUN", "Belgian Grand Prix": "BEL", "Dutch Grand Prix": "NED", "Italian Grand Prix": "ITA",
    "Azerbaijan Grand Prix": "AZE", "Singapore Grand Prix": "SIN", "United States Grand Prix": "USA", "Mexico City Grand Prix": "MEX",
    "São Paulo Grand Prix": "SAP", "Las Vegas Grand Prix": "LVG", "Qatar Grand Prix": "QAT", "Abu Dhabi Grand Prix": "ABU",
    "Barcelona Grand Prix": "BAR", "Bahrain Grand Prix in Malaysia": "MAL",
  };
  return fixed[raceName] ?? raceName.slice(0, 3).toUpperCase();
}

function driverCode(name: string): string {
  const last = name.split(/[ .]+/).filter(Boolean).pop() ?? name;
  return last.slice(0, 3).toUpperCase();
}

function constructorCode(name: string): string {
  const fixed: Record<string, string> = { "Red Bull Racing": "RBR", "Red Bull": "RBR", "Racing Bulls": "RB", "Aston Martin": "AMR", "Kick Sauber": "SAU", "Haas F1 Team": "HAA", "RB": "RB" };
  return fixed[name] ?? name.slice(0, 3).toUpperCase();
}

function linearFit(xs: number[], ys: number[]): { a: number; b: number } {
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const b = den > 0 ? num / den : 1;
  return { a: my - b * mx, b };
}

function spearman(xs: number[], ys: number[]): number {
  return pearson(ranks(xs), ranks(ys));
}

function ranks(xs: number[]): number[] {
  const order = xs.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
  const out = new Array<number>(xs.length);
  order.forEach(([, i], k) => (out[i] = k));
  return out;
}

function pearson(xs: number[], ys: number[]): number {
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

function mae(p: number[], y: number[]): number {
  return mean(p.map((v, i) => Math.abs(v - y[i])));
}

function sd(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((v) => (v - m) ** 2)));
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function r2(x: number): number {
  return Math.round(x * 100) / 100;
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

// ------------------------------------------------------------------------------ round 11: chips

/**
 * Chip diagnosis for one season on the site method (unperturbed). Per round on the as-played
 * path: the engine's forecast gain per chip (adviseChips valueNow with all four chips offered)
 * and, for Limitless, x3 Boost and Autopilot, the actual one-round gain of playing it there
 * (chip team minus the no-chip team, actual points). Wildcard and every chip are also replayed
 * path-aware: the chip forced at round k, the other chips at their as-played rounds.
 */
function chipsDiag(season: number) {
  const forecast = blendForecast(season, true);
  const policy: Policy = { ...SITE_POLICY, chips: true, plan: 1 };
  const rows: Record<string, unknown>[] = [];
  const trace = (r: RoundData, market: Market, state: State) => {
    if (!state.team) return;
    const user = { team: state.team, bank: state.bank, freeTransfers: 2, objective: { kind: "expected" as const }, chipsAvailable: [...SCORED_CHIPS], teamRacesCompleted: state.races };
    const advice = adviseChips(market, user, { maxMs: 200 });
    const row: Record<string, unknown> = { round: r.round, sprint: r.sprint, left: [...state.chipsLeft] };
    const none = optimiseTeam(market, user, { objective: { kind: "expected" }, topN: 1, chip: null, maxMs: Number.POSITIVE_INFINITY }).best as TeamResult;
    const nonePick: Pick = { team: { drivers: none.drivers, constructors: none.constructors }, boost: none.boost, extraBoost: none.extraBoost, chip: null };
    const noneActual = actualPoints(r, nonePick);
    const penaltyOf = (t: TeamResult, chip: ChipId | null) => transferPenalty(market.rules, [...t.drivers, ...t.constructors].filter((id) => !(state.team as TeamSelection).drivers.includes(id) && !(state.team as TeamSelection).constructors.includes(id)).length, 2, chip);
    const noneNet = noneActual - penaltyOf(none, null);
    for (const a of advice.advice) {
      if (!SCORED_CHIPS.includes(a.chip)) continue;
      const entry: Record<string, number> = { forecast: round1(a.valueNow), later: round1(a.holdValue) };
      if (a.chip !== "wildcard") {
        const best = optimiseTeam(market, user, { objective: { kind: "expected" }, topN: 1, chip: a.chip, maxMs: Number.POSITIVE_INFINITY }).best as TeamResult;
        const pick: Pick = { team: { drivers: best.drivers, constructors: best.constructors }, boost: best.boost, extraBoost: best.extraBoost, chip: a.chip };
        entry.actual = round1(actualPoints(r, pick) - penaltyOf(best, a.chip) - noneNet);
      }
      if (a.chip === "limitless") {
        // Limitless team picked for upside: forecast + k x SD of the asset's earlier points this season.
        for (const k of [0.5, 1]) {
          const values = Float64Array.from(market.assets.map((x) => market.mean[x.index] + k * spreadAny(r, x.id, x.kind)));
          const up = optimiseTeam(market, { ...user, team: null }, { expectedPoints: values, budget: Number.POSITIVE_INFINITY, topN: 1, chip: null, maxMs: Number.POSITIVE_INFINITY }).best as TeamResult;
          const upPick: Pick = { team: { drivers: up.drivers, constructors: up.constructors }, boost: up.boost, extraBoost: null, chip: "limitless" };
          entry[`upside${k}`] = round1(actualPoints(r, upPick) - noneNet);
        }
        // Hindsight-best unconstrained team (upper bound).
        const actualVals = Float64Array.from(market.assets.map((x) => r.assets.find((y) => y.id === x.id)?.actual ?? 0));
        const oracle = optimiseTeam(market, { ...user, team: null }, { expectedPoints: actualVals, budget: Number.POSITIVE_INFINITY, topN: 1, chip: null, maxMs: Number.POSITIVE_INFINITY }).best as TeamResult;
        entry.oracleTeam = round1(actualPoints(r, { team: { drivers: oracle.drivers, constructors: oracle.constructors }, boost: oracle.boost, extraBoost: null, chip: "limitless" }) - noneNet);
      }
      row[a.chip] = entry;
    }
    row.played = advice.playNow;
    rows.push(row);
  };
  const site = playSeason("site", season, forecast, { ...policy, trace });
  const playedAt: Partial<Record<ChipId, number>> = {};
  for (const c of site.chips) {
    const [chip, round] = c.split("@R");
    playedAt[chip as ChipId] = Number(round);
  }
  // Path-aware replays: chip c forced at round k, other chips at their as-played rounds.
  const replay: Record<string, Record<number, number>> = {};
  const rounds = (data.get(season) ?? []).map((x) => x.round).filter((x) => x >= 2);
  for (const chip of SCORED_CHIPS) {
    replay[chip] = {};
    for (const k of rounds) {
      if (Object.entries(playedAt).some(([c, at]) => c !== chip && at === k)) continue;
      const schedule: Partial<Record<ChipId, number>> = { ...playedAt, [chip]: k };
      const run = playSeason("forced", season, forecast, { ...policy, schedule: exactSchedule(schedule) });
      replay[chip][k] = Math.round(run.total);
    }
  }
  console.log(JSON.stringify({ season, total: Math.round(site.total), chips: site.chips, perRound: site.perRound.map(round1), rows, replay }));
}

/** Schedule entries as exact rounds: scheduledChip plays a chip at the first round >= its entry, sorted so earlier chips come first. */
function exactSchedule(s: Partial<Record<ChipId, number>>): Partial<Record<ChipId, number>> {
  return Object.fromEntries(Object.entries(s).sort((x, y) => (x[1] as number) - (y[1] as number))) as Partial<Record<ChipId, number>>;
}

/** SD of an asset's earlier points this season (prior per kind before three races). */
function spreadAny(r: RoundData, id: string, kind: string): number {
  const points: number[] = [];
  for (const x of data.get(r.season) ?? []) {
    if (x.round >= r.round) break;
    const a = x.assets.find((y) => y.id === id && y.active);
    if (a) points.push(a.actual);
  }
  return points.length >= 3 ? sd(points) : (PRIOR_SD as Record<string, number>)[kind] ?? 14;
}
