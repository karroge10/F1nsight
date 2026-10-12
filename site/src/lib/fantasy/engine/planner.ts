// Multi-race transfer planner: this race plus the next one or two from the `horizon` block.
//
// 1. Candidate pool: the best teams for every planned race on its own (expected points of that
//    race, prices moved by the expected price changes, no transfer limit), the exact top teams
//    for this race under the user's objective and transfer state, the best next-race teams
//    reachable from the current team, and the current team itself.
// 2. Dynamic programming over (team, free transfers) with exact rule accounting along every
//    path: net transfers between consecutive lineups, the free allowance with one carried-over
//    transfer, -10 per extra transfer, the cost cap growing or shrinking with the expected price
//    changes of the assets held, Wildcard (no penalty) and Limitless (no cap, team restored).
//    Each later race is weighted by futureWeight^k for forecast uncertainty.

import { horizonMeans, horizonPriceChanges, type Market } from "./market";
import { budgetOf, defaultPointsPerMillion, optimiseTeam, resolveObjective, scoreTeams } from "./optimiser";
import { nextFreeTransfers, transferPenalty } from "./rules";
import type { ChipId, Objective, PlanStage, TeamSelection, TransferPlan, UserState } from "./types";

export interface PlanOptions {
  /** Races to plan, this one included (default 3, capped by the horizon length + 1). */
  rounds?: number;
  /** Weight of each later race relative to the one before (forecast uncertainty). Default 0.85. */
  futureWeight?: number;
  /** Chip to play per round number. Wildcard and Limitless change the transfer rules of that race. */
  chips?: Partial<Record<number, ChipId>>;
  /** Candidate teams taken from each race. Default 40. */
  poolPerStage?: number;
  objective?: Objective;
  /** Time limit for each optimiser call that builds the pool (ms). */
  maxMs?: number;
}

/** Best sequence of teams over the next races. Typical runtime 60 to 250 ms. */
export function planTransfers(market: Market, state: UserState, options: PlanOptions = {}): TransferPlan {
  const prepared = preparePlan(market, state, options);
  return solvePlan(prepared, options.chips ?? {});
}

/** Opaque prepared plan: the candidate pool and its scores, reusable for chip variants. */
export interface PreparedPlan {
  context: PlanContext;
  prepareMs: number;
}

/** Build the candidate pool and per-race scores once (chips in options.chips shape the scores). */
export function preparePlan(market: Market, state: UserState, options: PlanOptions = {}): PreparedPlan {
  const started = performance.now();
  const stages = stageInputs(market, options);
  const objective = options.objective ?? resolveObjective(state);
  const pool = buildPool(market, state, stages, objective, options);
  const scores = stageScores(market, state, stages, pool, objective, options);
  const weights = stages.map((_, s) => (options.futureWeight ?? 0.85) ** s);
  const context: PlanContext = { market, state, stages, pool, scores, weights, chips: options.chips ?? {} };
  return { context, prepareMs: performance.now() - started };
}

/** Solve a prepared plan for a chip schedule (Wildcard and Limitless change the transfer rules). */
export function solvePlan(prepared: PreparedPlan, chips: Partial<Record<number, ChipId>>): TransferPlan {
  const started = performance.now();
  const context: PlanContext = { ...prepared.context, chips };
  const best = solve(context, "plan");
  const myopic = solve(context, "myopic");
  const holdScore = holdValue(context);
  const plan = best ? toStages(context, best) : [];
  return {
    stages: plan,
    score: best?.score ?? 0,
    holdScore,
    myopicScore: myopic?.score ?? 0,
    poolSize: context.pool.length,
    ms: prepared.prepareMs + performance.now() - started,
  };
}

/** Rounds covered by a prepared plan, with their weights. */
export function planRounds(prepared: PreparedPlan): { round: number; raceName: string; weight: number; means: Float64Array; prices: Float64Array }[] {
  const { stages, weights } = prepared.context;
  return stages.map((stage, s) => ({ round: stage.round, raceName: stage.raceName, weight: weights[s], means: stage.means, prices: stage.prices }));
}

// ------------------------------------------------------------------------------ inputs

interface StageInput {
  round: number;
  raceName: string;
  means: Float64Array;
  priceChange: Float64Array;
  prices: Float64Array;
}

interface PoolTeam {
  key: string;
  team: TeamSelection;
  indices: number[];
  lo: number;
  hi: number;
}

export interface PlanContext {
  market: Market;
  state: UserState;
  stages: StageInput[];
  pool: PoolTeam[];
  scores: { objective: Float64Array; expected: Float64Array; boost: (string | null)[]; cost: Float64Array; value: Float64Array }[];
  weights: number[];
  chips: Partial<Record<number, ChipId>>;
}

interface Label {
  team: number;
  freeTransfers: number;
  bank: number;
  score: number;
  stage: number;
  transfers: number;
  penalty: number;
  available: number;
  played: number;
  prev: Label | null;
}

function stageInputs(market: Market, options: PlanOptions): StageInput[] {
  const wanted = Math.max(1, options.rounds ?? 3);
  const count = Math.min(wanted, market.horizon.length + 1);
  const current = Float64Array.from(market.assets, (a) => a.price);
  const firstChange = Float64Array.from(market.assets, (a) => a.expectedPriceChange);
  const stages: StageInput[] = [
    { round: market.round, raceName: market.raceName, means: market.mean, priceChange: firstChange, prices: current },
  ];
  let prices: Float64Array = current;
  let change: Float64Array = firstChange;
  for (let s = 1; s < count; s++) {
    const horizon = market.horizon[s - 1];
    const next = new Float64Array(prices.length);
    for (let j = 0; j < next.length; j++) {
      const moved = prices[j] + change[j];
      const floored = Math.max(market.rules.priceFloor, moved);
      next[j] = Math.min(market.rules.priceCeiling, floored);
    }
    prices = next;
    change = horizonPriceChanges(market, horizon);
    const means = horizonMeans(market, horizon);
    stages.push({ round: horizon.round, raceName: horizon.raceName, means, priceChange: change, prices });
  }
  return stages;
}

function buildPool(
  market: Market,
  state: UserState,
  stages: StageInput[],
  objective: Objective,
  options: PlanOptions,
): PoolTeam[] {
  const perStage = options.poolPerStage ?? 40;
  const maxMs = options.maxMs ?? 120;
  const seen = new Map<string, PoolTeam>();
  const add = (team: TeamSelection) => {
    const pooled = poolTeam(market, team);
    if (pooled && !seen.has(pooled.key)) seen.set(pooled.key, pooled);
  };
  if (state.team) add(state.team);
  const linear: Objective = objective.kind === "value" ? objective : { kind: "expected" };
  const nowChip = options.chips?.[market.round] ?? null;
  const now = optimiseTeam(market, state, { objective, topN: perStage, maxMs, chip: nowChip });
  for (const team of now.alternatives) add(team);
  stages.forEach((stage, s) => {
    const budget = budgetOf(market, state, { prices: stage.prices }) + 0.5 * s;
    const free = optimiseTeam(market, { ...state, team: null }, {
      objective: linear,
      expectedPoints: stage.means,
      priceChanges: stage.priceChange,
      prices: stage.prices,
      budget,
      topN: perStage,
      chip: null,
      maxMs,
    });
    for (const team of free.alternatives) add(team);
    if (s === 1 && state.team) {
      const half = Math.max(5, Math.floor(perStage / 2));
      const reachable = optimiseTeam(market, state, {
        objective: linear,
        expectedPoints: stage.means,
        priceChanges: stage.priceChange,
        prices: stage.prices,
        topN: half,
        chip: null,
        maxMs,
      });
      for (const team of reachable.alternatives) add(team);
    }
  });
  return [...seen.values()];
}

function stageScores(
  market: Market,
  state: UserState,
  stages: StageInput[],
  pool: PoolTeam[],
  objective: Objective,
  options: PlanOptions,
): PlanContext["scores"] {
  const teams = pool.map((p) => p.team);
  const ppm = objective.kind === "value" ? (objective.pointsPerMillion ?? defaultPointsPerMillion(market)) : 0;
  return stages.map((stage, s) => {
    const chip = options.chips?.[stage.round] ?? null;
    const boostChip = chip === "extraBoost" ? chip : null;
    const linear: Objective = { kind: "expected" };
    const expected = scoreTeams(market, state, teams, { objective: linear, expectedPoints: stage.means, chip: boostChip });
    let objectiveScores = expected.map((e) => e.score);
    if (s === 0) {
      const exact = scoreTeams(market, state, teams, { objective, chip });
      objectiveScores = exact.map((e) => e.score);
    }
    const cost = new Float64Array(pool.length);
    const value = new Float64Array(pool.length);
    const objectiveArray = new Float64Array(pool.length);
    pool.forEach((p, t) => {
      let total = 0;
      let change = 0;
      for (const j of p.indices) {
        total += stage.prices[j];
        change += stage.priceChange[j];
      }
      cost[t] = total;
      value[t] = change;
      const valueTerm = s > 0 ? ppm * change : 0;
      objectiveArray[t] = objectiveScores[t] + valueTerm;
    });
    return {
      objective: objectiveArray,
      expected: Float64Array.from(expected, (e) => e.score),
      boost: expected.map((e) => e.boost),
      cost,
      value,
    };
  });
}

// ------------------------------------------------------------------------------ solver

function solve(context: PlanContext, mode: "plan" | "myopic"): Label | null {
  const { market, state, stages, pool, scores, weights } = context;
  const rules = market.rules;
  const startTeam = state.team ? poolIndex(context, state.team) : -1;
  const start: Label = {
    team: startTeam,
    freeTransfers: state.freeTransfers ?? rules.freeTransfersPerRace,
    bank: state.team ? (state.bank ?? 0) : budgetOf(market, state),
    score: 0,
    stage: -1,
    transfers: 0,
    penalty: 0,
    available: state.freeTransfers ?? rules.freeTransfersPerRace,
    played: -1,
    prev: null,
  };
  if (state.team && state.budget !== undefined && startTeam >= 0) {
    start.bank = state.budget - scores[0].cost[startTeam];
  }
  let labels: Label[] = [start];
  for (let s = 0; s < stages.length; s++) {
    const chip = context.chips[stages[s].round] ?? null;
    const next = new Map<string, Label[]>();
    for (const label of labels) {
      const held = label.team;
      const budget = label.bank + (held >= 0 ? scores[s].cost[held] : 0);
      let best: Label | null = null;
      for (let t = 0; t < pool.length; t++) {
        const cost = scores[s].cost[t];
        if (chip !== "limitless" && cost > budget + 1e-6) continue;
        const transfers = held >= 0 ? transferCount(pool[held], pool[t]) : 0;
        const penalty = held >= 0 ? transferPenalty(rules, transfers, label.freeTransfers, chip) : 0;
        const gain = weights[s] * scores[s].objective[t] - penalty;
        if (!Number.isFinite(gain)) continue;
        const restored = chip === "limitless" && held >= 0;
        const after: Label = {
          team: restored ? held : t,
          freeTransfers: held >= 0 ? nextFreeTransfers(rules, label.freeTransfers, transfers, chip) : rules.freeTransfersPerRace,
          bank: restored ? label.bank : budget - cost,
          score: label.score + gain,
          stage: s,
          transfers,
          penalty,
          available: label.freeTransfers,
          played: t,
          prev: label,
        };
        if (mode === "myopic") {
          if (!best || after.score > best.score) best = after;
          continue;
        }
        keepLabel(next, after);
      }
      if (mode === "myopic" && best) keepLabel(next, best);
    }
    labels = [...next.values()].flat();
    if (mode === "myopic" && labels.length > 1) {
      labels.sort((x, y) => y.score - x.score);
      labels = labels.slice(0, 1);
    }
    if (labels.length === 0) return null;
  }
  let winner: Label | null = null;
  for (const label of labels) if (!winner || label.score > winner.score) winner = label;
  return winner;
}

/** Keep up to 4 labels per (team, free transfers) that are not dominated on score and bank. */
function keepLabel(next: Map<string, Label[]>, label: Label): void {
  const key = `${label.team}:${label.freeTransfers}`;
  const list = next.get(key) ?? [];
  for (const other of list) {
    if (other.score >= label.score - 1e-9 && other.bank >= label.bank - 1e-9) return;
  }
  const kept = list.filter((other) => !(label.score >= other.score - 1e-9 && label.bank >= other.bank - 1e-9));
  kept.push(label);
  kept.sort((x, y) => y.score - x.score);
  const trimmed = kept.slice(0, 4);
  next.set(key, trimmed);
}

function holdValue(context: PlanContext): number {
  const { state, stages, scores, weights } = context;
  let team = state.team ? poolIndex(context, state.team) : -1;
  if (team < 0) {
    let best = Number.NEGATIVE_INFINITY;
    scores[0].objective.forEach((value, t) => {
      if (value > best && scores[0].cost[t] <= budgetOf(context.market, state) + 1e-6) {
        best = value;
        team = t;
      }
    });
  }
  if (team < 0) return 0;
  let total = 0;
  for (let s = 0; s < stages.length; s++) total += weights[s] * scores[s].objective[team];
  return total;
}

function toStages(context: PlanContext, last: Label): PlanStage[] {
  const { pool, stages, scores } = context;
  const chain: Label[] = [];
  for (let label: Label | null = last; label && label.stage >= 0; label = label.prev) chain.unshift(label);
  return chain.map((label) => {
    const s = label.stage;
    const played = pool[label.played];
    const before = label.prev && label.prev.team >= 0 ? pool[label.prev.team] : null;
    const playedIds = [...played.team.drivers, ...played.team.constructors];
    const beforeIds = before ? [...before.team.drivers, ...before.team.constructors] : [];
    const beforeSet = new Set(beforeIds);
    const playedSet = new Set(playedIds);
    const budget = label.prev ? label.prev.bank + (label.prev.team >= 0 ? scores[s].cost[label.prev.team] : 0) : 0;
    const cost = scores[s].cost[label.played];
    return {
      round: stages[s].round,
      raceName: stages[s].raceName,
      drivers: played.team.drivers,
      constructors: played.team.constructors,
      boost: scores[s].boost[label.played],
      chip: context.chips[stages[s].round] ?? null,
      transfersIn: before ? playedIds.filter((id) => !beforeSet.has(id)) : [],
      transfersOut: before ? beforeIds.filter((id) => !playedSet.has(id)) : [],
      transferCount: label.transfers,
      freeTransfers: label.available,
      penalty: label.penalty,
      expectedPoints: scores[s].expected[label.played],
      cost: round2(cost),
      teamValue: round2(budget),
      bank: round2(budget - cost),
    };
  });
}

// ------------------------------------------------------------------------------ helpers

function poolTeam(market: Market, team: TeamSelection): PoolTeam | null {
  const indices: number[] = [];
  for (const id of [...team.drivers, ...team.constructors]) {
    const index = market.byId.get(id);
    if (index === undefined) return null;
    indices.push(index);
  }
  let lo = 0;
  let hi = 0;
  for (const j of indices) {
    if (j < 32) lo |= 1 << j;
    else hi |= 1 << (j - 32);
  }
  const sorted = [...indices].sort((a, b) => a - b);
  const key = sorted.join(",");
  const drivers = [...team.drivers];
  const constructors = [...team.constructors];
  return { key, team: { drivers, constructors }, indices, lo, hi };
}

function poolIndex(context: PlanContext, team: TeamSelection): number {
  const pooled = poolTeam(context.market, team);
  if (!pooled) return -1;
  return context.pool.findIndex((p) => p.key === pooled.key);
}

/** Net changes between two lineups: assets in `to` that were not in `from`. */
function transferCount(from: PoolTeam, to: PoolTeam): number {
  const sharedLo = popcount(from.lo & to.lo);
  const sharedHi = popcount(from.hi & to.hi);
  return to.indices.length - sharedLo - sharedHi;
}

function popcount(value: number): number {
  let v = value - ((value >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
