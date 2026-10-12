// Backtest of the advice on recorded seasons: real prices going into every round, real points
// and real price changes afterwards. Each strategy starts from an empty team with the 100M cap
// and plays the season with the real transfer rules (2 free transfers, one carried over, -10
// per extra transfer). Chips are not played, so every strategy is on the same footing.
//
// Strategies: the engine (one race at a time), the engine with the 3-race planner, a naive
// "points per million" heuristic, and keeping the first team all season. The hindsight team
// (best possible team every round with the actual points, no transfer limit, same cap as the
// engine) is the upper bound.

import { prepareMarket, type Market } from "./market";
import { optimiseTeam } from "./optimiser";
import { planTransfers } from "./planner";
import { priceChange } from "./priceChange";
import { nextFreeTransfers, transferPenalty } from "./rules";
import type { FantasyAsset, FantasyFile, GameRules, HorizonRound, TeamSelection } from "./types";

export interface HistoryRow {
  round: number;
  kind: "driver" | "constructor";
  id: string;
  fantasyId: string;
  name: string;
  constructorId: string;
  active: boolean;
  price: number;
  priceAfter: number | null;
  points: number | null;
}

export interface HistoryFile {
  seasons: Record<string, HistoryRow[]>;
}

/** Expected points per asset id for a round, from what was known before it. */
export type Forecaster = (season: number, round: number, rows: HistoryRow[], past: Map<string, number[]>) => Map<string, number>;

export interface BacktestOptions {
  seasons?: number[];
  forecast?: Forecaster;
  forecastName?: string;
  /** Planner lookahead for the "engine + plan" strategy (races, this one included). */
  planRounds?: number;
}

export interface StrategyResult {
  name: string;
  total: number;
  perRound: number[];
  transfers: number;
  penalties: number;
  finalTeamValue: number;
}

export interface SeasonBacktest {
  season: number;
  rounds: number[];
  strategies: StrategyResult[];
  hindsight: StrategyResult;
  forecastMae: number;
}

export interface BacktestReport {
  forecast: string;
  seasons: SeasonBacktest[];
}

/** Replay every season in the history file. Runtime: a few seconds per season. */
export function runBacktest(history: HistoryFile, options: BacktestOptions = {}): BacktestReport {
  const seasons = options.seasons ?? Object.keys(history.seasons).map(Number);
  const forecast = options.forecast ?? formForecast;
  const results = seasons.map((season) => {
    const key = String(season);
    const rows = history.seasons[key] ?? [];
    return backtestSeason(season, rows, forecast, options);
  });
  return { forecast: options.forecastName ?? "form baseline (recent and season average points)", seasons: results };
}

/**
 * Form baseline: 0.5 x mean of the last 3 rounds + 0.5 x season mean; before an asset has a
 * scored round, its price x the league's average points per million so far (1.0 in round 1).
 */
export function formForecast(_season: number, _round: number, rows: HistoryRow[], past: Map<string, number[]>): Map<string, number> {
  let pointTotal = 0;
  let priceTotal = 0;
  for (const row of rows) {
    const history = past.get(keyOf(row)) ?? [];
    if (history.length === 0) continue;
    pointTotal += mean(history);
    priceTotal += row.price;
  }
  const leaguePpm = priceTotal > 0 ? pointTotal / priceTotal : 1;
  const out = new Map<string, number>();
  for (const row of rows) {
    const history = past.get(keyOf(row)) ?? [];
    if (history.length === 0) {
      out.set(row.id, row.price * leaguePpm);
      continue;
    }
    const recent = mean(history.slice(-3));
    const season = mean(history);
    out.set(row.id, 0.5 * recent + 0.5 * season);
  }
  return out;
}

/** One data/predictions/history/<season>-<round>.json file (only the fields used here). */
export interface PredictionHistory {
  race: { season: number; round: number; stage?: string };
  drivers: { driverId: string; fantasy?: { expectedPoints?: number | null } | null }[];
  constructors: { constructorId: string; fantasy?: { expectedPoints?: number | null } | null }[];
}

/**
 * Forecaster from the model's published history files: the fantasy expected points of each
 * asset, falling back to the form baseline for rounds or assets the files do not cover.
 * Note: these files hold the post-qualifying forecast, while the real team lock is before
 * qualifying, so this backtest is optimistic for the model.
 */
export function predictionForecaster(files: PredictionHistory[]): { forecast: Forecaster; covered: (season: number, round: number) => boolean } {
  const byRound = new Map<string, Map<string, number>>();
  for (const file of files) {
    const values = new Map<string, number>();
    for (const driver of file.drivers ?? []) {
      const value = driver.fantasy?.expectedPoints;
      if (typeof value === "number") values.set(`driver:${driver.driverId}`, value);
    }
    for (const team of file.constructors ?? []) {
      const value = team.fantasy?.expectedPoints;
      if (typeof value === "number") values.set(`constructor:${team.constructorId}`, value);
    }
    if (values.size > 0) byRound.set(`${file.race.season}:${file.race.round}`, values);
  }
  const forecast: Forecaster = (season, round, rows, past) => {
    const baseline = formForecast(season, round, rows, past);
    const model = byRound.get(`${season}:${round}`);
    if (!model) return baseline;
    const out = new Map<string, number>();
    for (const row of rows) {
      const value = model.get(`${row.kind}:${row.id}`);
      out.set(row.id, value ?? baseline.get(row.id) ?? 0);
    }
    return out;
  };
  const covered = (season: number, round: number) => byRound.has(`${season}:${round}`);
  return { forecast, covered };
}

// ------------------------------------------------------------------------------ season loop

interface TeamState {
  team: TeamSelection | null;
  bank: number;
  freeTransfers: number;
  lastPrices: Map<string, number>;
}

interface Decision {
  team: TeamSelection;
  boost: string | null;
}

type Strategy = (context: RoundContext, state: TeamState) => Decision;

interface RoundContext {
  season: number;
  round: number;
  rows: HistoryRow[];
  market: Market;
  forecast: Map<string, number>;
  rules: GameRules;
  future: HorizonRound[];
}

function backtestSeason(season: number, rows: HistoryRow[], forecast: Forecaster, options: BacktestOptions): SeasonBacktest {
  const rules = seasonRules(season);
  const rounds = [...new Set(rows.filter((r) => r.points !== null).map((r) => r.round))].sort((a, b) => a - b);
  const byRound = new Map<number, HistoryRow[]>();
  for (const round of rounds) byRound.set(round, rows.filter((r) => r.round === round));

  const contexts: RoundContext[] = [];
  const past = new Map<string, number[]>();
  let errorTotal = 0;
  let errorCount = 0;
  for (const round of rounds) {
    const roundRows = byRound.get(round) ?? [];
    const active = roundRows.filter((r) => r.active);
    const expected = forecast(season, round, active, past);
    for (const row of active) {
      const actual = row.points ?? 0;
      errorTotal += Math.abs((expected.get(row.id) ?? 0) - actual);
      errorCount += 1;
    }
    const future = futureRounds(round, rounds, active, expected, past, season);
    const file = fantasyFileFor(season, round, roundRows, expected, future);
    const market = prepareMarket(file, { rules, fallbackScenarios: 40 });
    contexts.push({ season, round, rows: roundRows, market, forecast: expected, rules: market.rules, future });
    for (const row of active) {
      const key = keyOf(row);
      const history = past.get(key) ?? [];
      history.push(row.points ?? 0);
      past.set(key, history);
    }
  }

  const planRounds = options.planRounds ?? 3;
  const engine = playSeason("engine (1 race)", contexts, engineStrategy);
  const planned = playSeason(`engine (${planRounds}-race plan)`, contexts, (c, s) => planStrategy(c, s, planRounds));
  const naive = playSeason("naive points per million", contexts, naiveStrategy);
  const hold = playSeason("keep the first team", contexts, holdStrategy);
  const hindsight = hindsightSeason(contexts, engine.budgets);
  return {
    season,
    rounds,
    strategies: [engine.result, planned.result, naive.result, hold.result],
    hindsight,
    forecastMae: errorCount ? errorTotal / errorCount : 0,
  };
}

function playSeason(name: string, contexts: RoundContext[], strategy: Strategy): { result: StrategyResult; budgets: number[] } {
  const state: TeamState = { team: null, bank: 100, freeTransfers: 2, lastPrices: new Map() };
  const perRound: number[] = [];
  const budgets: number[] = [];
  let transfers = 0;
  let penalties = 0;
  for (const context of contexts) {
    const priceNow = new Map(context.rows.map((r) => [r.id, r.price]));
    const kept = keepKnown(state, priceNow);
    const budget = kept.team ? teamValue(kept.team, priceNow) + kept.bank : 100;
    budgets.push(budget);
    const decision = strategy(context, kept);
    const owned = kept.team ? new Set([...kept.team.drivers, ...kept.team.constructors]) : null;
    const members = [...decision.team.drivers, ...decision.team.constructors];
    const changes = owned ? members.filter((id) => !owned.has(id)).length : 0;
    const penalty = owned ? transferPenalty(context.rules, changes, kept.freeTransfers, null) : 0;
    const points = actualPoints(context, decision) - penalty;
    perRound.push(points);
    transfers += changes;
    penalties += penalty;
    const cost = teamValue(decision.team, priceNow);
    state.team = decision.team;
    state.bank = budget - cost;
    state.freeTransfers = owned ? nextFreeTransfers(context.rules, kept.freeTransfers, changes, null) : context.rules.freeTransfersPerRace;
    state.lastPrices = new Map(context.rows.map((r) => [r.id, r.priceAfter ?? r.price]));
  }
  const last = contexts[contexts.length - 1];
  const finalPrices = last ? new Map(last.rows.map((r) => [r.id, r.priceAfter ?? r.price])) : new Map<string, number>();
  const finalTeamValue = state.team ? teamValue(state.team, finalPrices) + state.bank : 100;
  const total = perRound.reduce((a, b) => a + b, 0);
  return { result: { name, total, perRound, transfers, penalties, finalTeamValue }, budgets };
}

function hindsightSeason(contexts: RoundContext[], budgets: number[]): StrategyResult {
  const perRound = contexts.map((context, k) => {
    const actual = Float64Array.from(context.market.assets, (a) => actualOf(context, a.id));
    const result = optimiseTeam(context.market, { team: null }, {
      expectedPoints: actual,
      budget: budgets[k],
      topN: 1,
      chip: null,
      maxMs: Number.POSITIVE_INFINITY,
    });
    return result.best?.expectedPoints ?? 0;
  });
  const total = perRound.reduce((a, b) => a + b, 0);
  return { name: "best possible in hindsight", total, perRound, transfers: 0, penalties: 0, finalTeamValue: 0 };
}

// ------------------------------------------------------------------------------ strategies

function engineStrategy(context: RoundContext, state: TeamState): Decision {
  const user = userState(state);
  const result = optimiseTeam(context.market, user, { objective: { kind: "expected" }, topN: 1, chip: null, maxMs: Number.POSITIVE_INFINITY });
  return decisionOf(result.best, state);
}

function planStrategy(context: RoundContext, state: TeamState, rounds: number): Decision {
  const user = userState(state);
  const plan = planTransfers(context.market, user, { rounds, objective: { kind: "expected" }, maxMs: Number.POSITIVE_INFINITY });
  const first = plan.stages[0];
  if (!first) return engineStrategy(context, state);
  return { team: { drivers: first.drivers, constructors: first.constructors }, boost: first.boost };
}

/** Naive heuristic: rank assets by expected points per $M, swap the worst held for the best affordable, up to the free transfers. */
function naiveStrategy(context: RoundContext, state: TeamState): Decision {
  const market = context.market;
  const ppm = (id: string) => {
    const asset = market.assets[market.byId.get(id) as number];
    return asset.expectedPoints / asset.price;
  };
  const price = (id: string) => market.assets[market.byId.get(id) as number].price;
  const pickable = market.assets.filter((a) => a.pickable);
  if (!state.team) {
    const team = greedyTeam(market, 100);
    return { team, boost: topDriver(market, team) };
  }
  const drivers = [...state.team.drivers];
  const constructors = [...state.team.constructors];
  let bank = state.bank;
  for (let k = 0; k < state.freeTransfers; k++) {
    let best: { list: string[]; at: number; into: string; gain: number } | null = null;
    for (const list of [drivers, constructors]) {
      const kind = list === drivers ? "driver" : "constructor";
      const worstAt = argMin(list, ppm);
      const worst = list[worstAt];
      for (const asset of pickable) {
        if (asset.kind !== kind || list.includes(asset.id)) continue;
        if (asset.price > price(worst) + bank + 1e-9) continue;
        const gain = asset.expectedPoints / asset.price - ppm(worst);
        if (gain > 0 && (!best || gain > best.gain)) best = { list, at: worstAt, into: asset.id, gain };
      }
    }
    if (!best) break;
    bank += price(best.list[best.at]) - price(best.into);
    best.list[best.at] = best.into;
  }
  const team = { drivers, constructors };
  return { team, boost: topDriver(market, team) };
}

function holdStrategy(context: RoundContext, state: TeamState): Decision {
  if (!state.team) return engineStrategy(context, state);
  return { team: state.team, boost: topDriver(context.market, state.team) };
}

// ------------------------------------------------------------------------------ helpers

function userState(state: TeamState) {
  return { team: state.team, bank: state.bank, freeTransfers: state.freeTransfers, objective: { kind: "expected" as const } };
}

function decisionOf(best: { drivers: string[]; constructors: string[]; boost: string | null } | null, state: TeamState): Decision {
  if (best) return { team: { drivers: best.drivers, constructors: best.constructors }, boost: best.boost };
  return { team: state.team as TeamSelection, boost: null };
}

function greedyTeam(market: Market, budget: number): TeamSelection {
  const byPpm = market.assets.filter((a) => a.pickable).sort((x, y) => y.expectedPoints / y.price - x.expectedPoints / x.price);
  const drivers: string[] = [];
  const constructors: string[] = [];
  let left = budget;
  const cheapest = (kind: string, skip: Set<string>) =>
    market.assets.filter((a) => a.kind === kind && a.pickable && !skip.has(a.id)).map((a) => a.price).sort((a, b) => a - b);
  for (const asset of byPpm) {
    const list = asset.kind === "driver" ? drivers : constructors;
    const limit = asset.kind === "driver" ? market.rules.drivers : market.rules.constructors;
    if (list.length >= limit) continue;
    const taken = new Set([...drivers, ...constructors, asset.id]);
    const needDrivers = market.rules.drivers - drivers.length - (asset.kind === "driver" ? 1 : 0);
    const needConstructors = market.rules.constructors - constructors.length - (asset.kind === "constructor" ? 1 : 0);
    const reserveDrivers = cheapest("driver", taken).slice(0, needDrivers);
    const reserveConstructors = cheapest("constructor", taken).slice(0, needConstructors);
    const reserve = [...reserveDrivers, ...reserveConstructors].reduce((a, b) => a + b, 0);
    if (asset.price + reserve > left + 1e-9) continue;
    list.push(asset.id);
    left -= asset.price;
  }
  return { drivers, constructors };
}

function topDriver(market: Market, team: TeamSelection): string | null {
  let best: string | null = null;
  let value = Number.NEGATIVE_INFINITY;
  for (const id of team.drivers) {
    const index = market.byId.get(id);
    if (index === undefined) continue;
    const points = market.assets[index].expectedPoints;
    if (points > value) {
      value = points;
      best = id;
    }
  }
  return best;
}

function actualPoints(context: RoundContext, decision: Decision): number {
  let total = 0;
  for (const id of [...decision.team.drivers, ...decision.team.constructors]) total += actualOf(context, id);
  if (decision.boost) total += (context.rules.boostMultiplier - 1) * actualOf(context, decision.boost);
  return total;
}

function actualOf(context: RoundContext, id: string): number {
  const row = context.rows.find((r) => r.id === id && r.active) ?? context.rows.find((r) => r.id === id);
  return row?.points ?? 0;
}

/** Drop held assets that no longer exist (sold at their last price). */
function keepKnown(state: TeamState, priceNow: Map<string, number>): TeamState {
  if (!state.team) return state;
  let bank = state.bank;
  const known = (id: string) => {
    if (priceNow.has(id)) return true;
    bank += state.lastPrices.get(id) ?? 0;
    return false;
  };
  const drivers = state.team.drivers.filter(known);
  const constructors = state.team.constructors.filter(known);
  if (drivers.length === state.team.drivers.length && constructors.length === state.team.constructors.length) return state;
  return { ...state, team: { drivers, constructors }, bank };
}

function teamValue(team: TeamSelection, prices: Map<string, number>): number {
  let total = 0;
  for (const id of [...team.drivers, ...team.constructors]) total += prices.get(id) ?? 0;
  return total;
}

function fantasyFileFor(
  season: number,
  round: number,
  rows: HistoryRow[],
  expected: Map<string, number>,
  future: HorizonRound[],
): FantasyFile {
  const seen = new Set<string>();
  const assets: FantasyAsset[] = [];
  const ordered = [...rows].sort((x, y) => Number(y.active) - Number(x.active));
  for (const row of ordered) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    assets.push({
      id: row.id,
      kind: row.kind,
      name: row.name,
      constructorId: row.constructorId,
      price: row.price,
      expectedPoints: row.active ? (expected.get(row.id) ?? 0) : 0,
      expectedPriceChange: 0,
      active: row.active,
    });
  }
  return { generatedAt: "", season, round, raceName: `Round ${round}`, hasSprint: false, assets, horizon: future };
}

/** Horizon for the planner: the same form forecast for the next rounds, prices moved by the price rule. */
function futureRounds(
  round: number,
  rounds: number[],
  rows: HistoryRow[],
  expected: Map<string, number>,
  past: Map<string, number[]>,
  season: number,
): HorizonRound[] {
  const next = rounds.filter((r) => r > round).slice(0, 2);
  return next.map((r) => {
    const expectedPoints: Record<string, number> = {};
    const expectedPriceChange: Record<string, number> = {};
    for (const row of rows) {
      const points = expected.get(row.id) ?? 0;
      expectedPoints[row.id] = points;
      const history = past.get(keyOf(row)) ?? [];
      const window = [...history, points];
      const change = season >= 2025 ? priceChange(row.price, window, season).change : 0;
      expectedPriceChange[row.id] = change;
    }
    return { round: r, raceName: `Round ${r}`, hasSprint: false, expectedPoints, expectedPriceChange };
  });
}

function seasonRules(season: number): Partial<GameRules> {
  if (season === 2025) return { season, priceFloor: 4.5, priceCeiling: Number.POSITIVE_INFINITY, seasonRounds: 24 };
  return { season };
}

/** Asset identity across rounds: 2025 rows have no game id, and 2026 has two Lawson assets (one per team). */
function keyOf(row: HistoryRow): string {
  return `${row.kind}:${row.id}:${row.fantasyId}`;
}

function argMin(list: string[], score: (id: string) => number): number {
  let best = 0;
  for (let k = 1; k < list.length; k++) {
    const value = score(list[k]);
    const current = score(list[best]);
    if (value < current) best = k;
  }
  return best;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
