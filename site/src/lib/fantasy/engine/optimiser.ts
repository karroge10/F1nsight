// Exact single-race team optimiser: 5 drivers + 2 constructors + Boost under the cost cap,
// maximising the objective minus the extra transfer penalty.
//
// Method: depth-first branch and bound over driver sets, then over constructor pairs. Every
// objective has separable upper bounds, and a branch is cut only when it provably cannot reach
// the current N-th best team:
// - expected points and the value objective: the means themselves (exact);
// - mean - lambda * sd: sd(team) >= <team, e> for any unit direction e of the joint scenarios,
//   so mean - lambda * sum(w_j a_j) is a valid bound for each e; several directions (from
//   strong warm start teams) are used at once and the smallest bound wins;
// - quantiles: Cantelli, q-quantile <= mean + k * sd <= sum(w_j (mean_j + k sd_j));
// - Autopilot: max over the drivers <= t + sum((X_d - t)+) in every world.
// Surviving teams are scored exactly: closed form for expected points, the scenario covariance
// for mean - lambda * sd, the scenario vectors for quantiles and Autopilot. With no time limit
// the result equals full enumeration (optimiser.test.ts checks this against brute force).

import { noNegativeSet, type Market, type ScenarioSet } from "./market";
import { objectiveFromRisk, transferPenalty } from "./rules";
import type { ChipId, Objective, OptimiseResult, TeamResult, TeamSelection, TeamStats, UserState } from "./types";

export interface OptimiseOptions {
  objective?: Objective;
  /** Chip to apply. Default: the first chip in state.chipsToPlay that is playable. */
  chip?: ChipId | null;
  /** Number of distinct teams to return. Default 10. */
  topN?: number;
  /** Replace the expected points (e.g. a horizon round). Forces a linear objective. */
  expectedPoints?: Float64Array;
  /** Replace the expected price changes (value objective). */
  priceChanges?: Float64Array;
  /** Replace the prices in $M (future rounds in the planner). */
  prices?: Float64Array;
  budget?: number;
  freeTransfers?: number;
  /** Replace state.team (planner, backtest). */
  team?: TeamSelection | null;
  /** Value objective: points per $M of expected team value change. */
  pointsPerMillion?: number;
  /** Search time limit in ms (default 150). When hit, the best teams found so far are returned with exact = false. */
  maxMs?: number;
}

export const DEFAULT_MAX_MS = 150;

/** Best team and the top N alternatives for one race. */
export function optimiseTeam(market: Market, state: UserState, options: OptimiseOptions = {}): OptimiseResult {
  const started = performance.now();
  const search = buildSearch(market, state, options, started);
  if (search) warmStart(search, state, options);
  const leaves = search ? runSearch(search) : [];
  const alternatives = search ? leaves.map((leaf) => toTeamResult(search, leaf)) : [];
  const objective = search?.objective ?? resolveObjective(state, options);
  return {
    best: alternatives[0] ?? null,
    alternatives,
    objective,
    chip: search?.chip ?? null,
    budget: search ? search.nominalBudget : budgetOf(market, state, options),
    freeTransfers: search?.freeTransfers ?? 0,
    evaluated: search?.evaluated ?? 0,
    exact: search ? !search.timedOut : true,
    ms: performance.now() - started,
  };
}

/** Score one given team (best Boost for it) under the same rules and objective. */
export function evaluateTeam(
  market: Market,
  state: UserState,
  team: TeamSelection,
  options: OptimiseOptions = {},
): TeamResult | null {
  const ids = [...team.drivers, ...team.constructors];
  const restricted: UserState = { ...state, locked: ids, banned: [] };
  const fixed = { ...options, topN: 1, budget: Number.POSITIVE_INFINITY, maxMs: Number.POSITIVE_INFINITY };
  const result = optimiseTeam(market, restricted, fixed);
  const best = result.best;
  if (!best) return null;
  const budget = budgetOf(market, state, options);
  return { ...best, budget, bankAfter: round2(budget - best.cost) };
}

/**
 * Objective score (best Boost, no transfer penalty) of many fixed teams, without a search.
 * Teams that break the composition rules score -Infinity.
 */
export function scoreTeams(
  market: Market,
  state: UserState,
  teams: TeamSelection[],
  options: OptimiseOptions = {},
): { score: number; boost: string | null }[] {
  const open: UserState = { ...state, locked: [], banned: [] };
  const started = performance.now();
  const search = buildSearch(market, open, { ...options, budget: Number.POSITIVE_INFINITY }, started);
  if (!search) return teams.map(() => ({ score: Number.NEGATIVE_INFINITY, boost: null }));
  const leaf = new LeafEvaluator(search);
  return teams.map((team) => {
    const drivers = team.drivers.map((id) => market.byId.get(id) ?? -1);
    const a = market.byId.get(team.constructors[0]) ?? -1;
    const b = market.byId.get(team.constructors[1]) ?? -1;
    const pair = search.pairs.find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));
    if (!pair || drivers.includes(-1) || drivers.length !== market.rules.drivers) {
      return { score: Number.NEGATIVE_INFINITY, boost: null };
    }
    leaf.reset(drivers);
    const score = leaf.evaluate(pair, Number.NEGATIVE_INFINITY);
    const boostIndex = search.mode === "x3" ? leaf.boost2 : leaf.boost;
    return { score, boost: boostIndex >= 0 ? market.assets[boostIndex].id : null };
  });
}

export function resolveObjective(state: UserState, options: OptimiseOptions = {}): Objective {
  if (options.objective) return options.objective;
  if (state.objective) return state.objective;
  return objectiveFromRisk(state.risk);
}

/** Cost cap: state.budget, else the current team's value at today's prices plus the bank. */
export function budgetOf(market: Market, state: UserState, options: OptimiseOptions = {}): number {
  if (options.budget !== undefined && Number.isFinite(options.budget)) return options.budget;
  if (state.budget !== undefined) return state.budget;
  const team = options.team !== undefined ? options.team : state.team;
  if (!team) return market.rules.budget;
  let value = state.bank ?? 0;
  for (const id of [...team.drivers, ...team.constructors]) {
    const index = market.byId.get(id);
    if (index === undefined) continue;
    value += options.prices ? options.prices[index] : market.assets[index].price;
  }
  return round2(value);
}

/** Chip that will be applied: explicit option, else the first playable chip in chipsToPlay. */
export function resolveChip(market: Market, state: UserState, options: OptimiseOptions = {}): ChipId | null {
  if (options.chip !== undefined) return options.chip;
  for (const chip of state.chipsToPlay ?? []) {
    if (chipPlayable(market, state, chip)) return chip;
  }
  return null;
}

export function chipPlayable(market: Market, state: UserState, chip: ChipId): boolean {
  if (state.chipsAvailable && !state.chipsAvailable.includes(chip)) return false;
  const teamRace = (state.teamRacesCompleted ?? 1) + 1;
  return teamRace >= market.rules.chips[chip].availableFromTeamRace;
}

/** Default value of $1M of team value in points: 0.6 points per remaining race after this one. */
export function defaultPointsPerMillion(market: Market): number {
  const remaining = Math.max(0, market.rules.seasonRounds - market.round);
  return 0.6 * remaining;
}

/** Scenario statistics of a team: weights per asset plus an optional Autopilot max term. */
export function teamStats(set: ScenarioSet, weights: Map<number, number>, autopilotDrivers: number[] | null): TeamStats {
  const n = set.n;
  const total = new Float64Array(n);
  for (const [index, weight] of weights) {
    const col = set.cols[index];
    for (let i = 0; i < n; i++) total[i] += weight * col[i];
  }
  if (autopilotDrivers) {
    for (let i = 0; i < n; i++) {
      let best = Number.NEGATIVE_INFINITY;
      for (const d of autopilotDrivers) best = Math.max(best, set.cols[d][i]);
      total[i] += best;
    }
  }
  return summarise(total);
}

// ------------------------------------------------------------------------------ search state

type Mode = "x2" | "x3" | "auto";

interface Pair {
  a: number;
  b: number;
  cost: number;
  lin: number;
  mean: number;
  smean: number;
  variance: number;
  transfers: number;
  vec: Float64Array | null;
}

interface Leaf {
  key: number;
  drivers: number[];
  pair: Pair;
  boost: number;
  boost2: number;
  score: number;
  penalty: number;
}

/** One separable upper bound: score(team) <= sum u_j + boost terms + constant. */
interface BoundSet {
  u: Float64Array;
  uBoost: Float64Array;
  uBoost2: Float64Array;
  constant: number;
}

interface Search {
  market: Market;
  objective: Objective;
  chip: ChipId | null;
  mode: Mode;
  /** Scenario set for exact risk and Autopilot scoring (null: linear means only). */
  set: ScenarioSet | null;
  /** Mean per asset used by the objective (scenario mean for quantiles). */
  mean: Float64Array;
  /** Expected points per asset (contract means, chip adjusted), for reporting. */
  pointsMean: Float64Array;
  lin: Float64Array;
  priceChange: Float64Array;
  prices: Float64Array;
  bounds: BoundSet[];
  lambda: number;
  q: number;
  cantelli: number;
  costT: Int32Array;
  budgetT: number;
  nominalBudget: number;
  owned: Uint8Array;
  freeTransfers: number;
  penaltyFree: boolean;
  lockedDrivers: number[];
  candidates: number[];
  pairs: Pair[];
  topN: number;
  boostExtra: number;
  extraBoostExtra: number;
  secondBoost: boolean;
  top: Leaf[];
  /** Keys (bit sets of asset indices) of the teams in top, to keep them distinct. */
  keys: Set<number>;
  evaluated: number;
  deadline: number;
  timedOut: boolean;
  scratch: Float64Array;
  /** Autopilot: per-world threshold tau for max_d X_d <= tau + sum((X_d - tau)+). */
  autoTau: Float64Array | null;
}

const WARM_SEEDS = 30;
const MAX_DIRECTIONS = 6;

function buildSearch(market: Market, state: UserState, options: OptimiseOptions, started: number): Search | null {
  const rules = market.rules;
  const chip = resolveChip(market, state, options);
  let objective = resolveObjective(state, options);
  const linearOnly = options.expectedPoints !== undefined;
  if (linearOnly && objective.kind !== "value") objective = { kind: "expected" };
  const mode: Mode = chip === "extraBoost" ? "x3" : chip === "autopilot" && !linearOnly ? "auto" : "x2";

  const chipSet = chip === "noNegative" ? noNegativeSet(market) : null;
  const set = linearOnly ? null : (chipSet?.set ?? market.base);
  const pointsMean = options.expectedPoints ?? chipSet?.mean ?? market.mean;
  const m = market.assets.length;
  const priceChange = options.priceChanges ?? Float64Array.from(market.assets, (a) => a.expectedPriceChange);
  const prices = options.prices ?? Float64Array.from(market.assets, (a) => a.price);

  const lambda = objective.kind === "meanStd" ? Math.max(0, objective.lambda) : 0;
  const rawQ = objective.kind === "quantile" ? objective.q : 0.5;
  const q = rawQ < 0.01 ? 0.01 : rawQ > 0.99 ? 0.99 : rawQ;
  const n = set?.n ?? 0;
  const lowRank = Math.floor((n - 1) * q);
  const qBound = Math.min(0.999, (lowRank + 2) / Math.max(1, n));
  const cantelli = Math.sqrt(qBound / (1 - qBound));
  const quantileMode = objective.kind === "quantile" && set !== null;
  const mean = quantileMode && set ? set.scenarioMean : pointsMean;

  const ppm = objective.kind === "value"
    ? (options.pointsPerMillion ?? objective.pointsPerMillion ?? defaultPointsPerMillion(market))
    : 0;
  const lin = new Float64Array(m);
  for (let j = 0; j < m; j++) lin[j] = mean[j] + ppm * priceChange[j];

  const team = options.team !== undefined ? options.team : state.team;
  const owned = new Uint8Array(m);
  for (const id of team ? [...team.drivers, ...team.constructors] : []) {
    const index = market.byId.get(id);
    if (index !== undefined) owned[index] = 1;
  }
  const banned = new Set(state.banned ?? []);
  const locked = new Set<number>();
  for (const id of state.locked ?? []) {
    const index = market.byId.get(id);
    if (index !== undefined && !banned.has(id)) locked.add(index);
  }
  const usable = (j: number) => {
    const asset = market.assets[j];
    if (banned.has(asset.id)) return false;
    return asset.pickable || owned[j] === 1 || locked.has(j);
  };

  const nominalBudget = budgetOf(market, state, options);
  const unlimited = chip === "limitless" || options.budget === Number.POSITIVE_INFINITY;
  const budgetT = unlimited ? Number.POSITIVE_INFINITY : Math.round(nominalBudget * 10 + 1e-6);
  const costT = new Int32Array(m);
  for (let j = 0; j < m; j++) costT[j] = Math.round(prices[j] * 10);

  const lockedDrivers = market.drivers.filter((d) => locked.has(d));
  const lockedConstructors = market.constructors.filter((c) => locked.has(c));
  if (lockedDrivers.length > rules.drivers || lockedConstructors.length > rules.constructors) return null;
  const candidates = market.drivers.filter((d) => usable(d) && !locked.has(d));
  const constructorPool = market.constructors.filter((c) => usable(c));
  const pairs = buildPairs(constructorPool, lockedConstructors, set, mean, lin, costT, owned, pointsMean);
  if (pairs.length === 0) return null;

  const penaltyFree = !team || chip === "limitless" || chip === "wildcard";
  const freeTransfers = options.freeTransfers ?? state.freeTransfers ?? rules.freeTransfersPerRace;
  const maxMs = options.maxMs ?? DEFAULT_MAX_MS;
  const search: Search = {
    market,
    objective,
    chip,
    mode,
    set,
    mean,
    pointsMean,
    lin,
    priceChange,
    prices,
    bounds: [],
    lambda,
    q,
    cantelli,
    costT,
    budgetT,
    nominalBudget,
    owned,
    freeTransfers,
    penaltyFree,
    lockedDrivers,
    candidates,
    pairs,
    topN: Math.max(1, options.topN ?? 10),
    boostExtra: rules.boostMultiplier - 1,
    extraBoostExtra: rules.extraBoostMultiplier - 1,
    secondBoost: rules.assumptions.extraBoostKeepsRegularBoost,
    top: [],
    keys: new Set<number>(),
    evaluated: 0,
    deadline: started + maxMs,
    timedOut: false,
    scratch: new Float64Array(n),
    autoTau: null,
  };
  const plain = boundSet(search, null);
  setBounds(search, [plain], null);
  return search;
}

/**
 * Seed the top N with strong teams from a cheaper surrogate objective, so the exact search
 * starts with a high threshold. For mean - lambda * sd the seeds also give the projection
 * directions. For quantiles the search order follows the normal approximation and the worlds
 * are reordered from worst to best for the best seed, so hopeless teams are rejected after
 * fewer worlds.
 */
function warmStart(s: Search, state: UserState, options: OptimiseOptions): void {
  const kind = s.objective.kind;
  if (!s.set || (kind !== "meanStd" && kind !== "quantile" && s.mode !== "auto")) return;
  let surrogate: Objective = { kind: "expected" };
  if (kind === "value") surrogate = s.objective;
  const z = normalQuantile(s.q);
  if (kind === "quantile" && s.q < 0.5 && s.mode !== "auto") surrogate = { kind: "meanStd", lambda: -z };
  if (kind === "meanStd" && s.mode !== "auto" && s.lambda / 3 >= 0.2) surrogate = { kind: "meanStd", lambda: s.lambda / 3 };
  if (kind === "meanStd" && s.mode === "auto") surrogate = s.objective;
  const chip = s.mode === "auto" ? null : s.chip;
  const now = performance.now();
  const remaining = Math.max(10, s.deadline - now);
  const seedOptions: OptimiseOptions = { ...options, chip, objective: surrogate, topN: WARM_SEEDS, maxMs: remaining / 3 };
  const seeds = optimiseTeam(s.market, state, seedOptions);
  const leaf = new LeafEvaluator(s);
  for (const team of seeds.alternatives) seedTeam(s, leaf, team);
  if (s.top.length === 0) return;
  const set = s.set;
  if (s.mode === "auto") {
    s.autoTau = worldMax(set, s.top[0].drivers);
    const plain = boundSet(s, null);
    setBounds(s, [plain], null);
  }
  const directions: Float64Array[] = [];
  for (const seed of s.top.slice(0, MAX_DIRECTIONS)) {
    const vector = leafVector(s, seed);
    const direction = unitDirection(vector);
    if (direction) directions.push(direction);
  }
  if (kind === "meanStd" && s.lambda > 0) {
    const sets = directions.map((direction) => boundSet(s, direction));
    const plain = boundSet(s, null);
    sets.push(plain);
    setBounds(s, sets, null);
  }
  if (kind === "quantile" && directions.length > 0) {
    const order = surrogateOrder(s, set, directions[0], -z);
    const worst = leafVector(s, s.top[0]);
    s.set = permutedSet(set, worst);
    for (const pair of s.pairs) pair.vec = null;
    if (s.autoTau) s.autoTau = worldMax(s.set, s.top[0].drivers);
    setBounds(s, s.bounds, order);
  }
}

/**
 * Separable upper bound of the objective. With a centred unit direction e (mean - lambda * sd
 * only), sd(team) >= <team, e> / sqrt(n), linear in the team, so the bound tightens to
 * mean - lambda * sum(w_j <X_j, e>) / sqrt(n). Under Autopilot the max term is bounded in every
 * world from below by any team driver and from above by t + sum((X_d - t)+).
 */
function boundSet(s: Search, direction: Float64Array | null): BoundSet {
  const market = s.market;
  const m = market.assets.length;
  const set = s.set;
  const quantileMode = s.objective.kind === "quantile" && set !== null;
  const out: BoundSet = { u: new Float64Array(m), uBoost: new Float64Array(m), uBoost2: new Float64Array(m), constant: 0 };
  const tau = s.mode === "auto" && set ? (s.autoTau ?? constantTau(market, set)) : null;
  const project = direction && set && s.lambda > 0 ? directionTerms(set, direction, market.drivers, tau) : null;
  let autoGain: Float64Array | null = null;
  let autoGainSd: Float64Array | null = null;
  if (tau && set) {
    const gains = autopilotGains(set, tau, market.drivers);
    autoGain = gains.mean;
    autoGainSd = gains.sd;
    const spread = quantileMode ? s.cantelli * gains.tauSd : 0;
    out.constant = gains.tauMean + spread;
    if (project) out.constant -= s.lambda * project.negativeMass;
  }
  for (let j = 0; j < m; j++) {
    const spread = quantileMode && set ? s.cantelli * set.sd[j] : 0;
    const risk = project ? s.lambda * project.along[j] : 0;
    out.u[j] = s.lin[j] + spread - risk;
    if (market.assets[j].kind !== "driver") continue;
    if (autoGain && autoGainSd) {
      const gainSpread = quantileMode ? s.cantelli * autoGainSd[j] : 0;
      const gainRisk = project ? s.lambda * project.gainNegative[j] : 0;
      out.u[j] += autoGain[j] + gainSpread - gainRisk;
      out.uBoost[j] = project ? -s.lambda * project.positivePart[j] : 0;
      continue;
    }
    const perUnit = s.mean[j] + spread - risk;
    if (s.mode === "x3") {
      out.uBoost[j] = s.extraBoostExtra * perUnit;
      out.uBoost2[j] = s.secondBoost ? s.boostExtra * perUnit : 0;
    } else {
      out.uBoost[j] = s.boostExtra * perUnit;
    }
  }
  return out;
}

interface DirectionTerms {
  /** <X_j, e> / sqrt(n). */
  along: Float64Array;
  /** Autopilot: sum over worlds with e > 0 of e_i X_j,i / sqrt(n). */
  positivePart: Float64Array;
  /** Autopilot: sum over worlds with e < 0 of e_i (X_j,i - tau_i)+ / sqrt(n). */
  gainNegative: Float64Array;
  /** Autopilot: sum over worlds with e < 0 of e_i tau_i / sqrt(n). */
  negativeMass: number;
}

function directionTerms(set: ScenarioSet, e: Float64Array, drivers: number[], tau: Float64Array | null): DirectionTerms {
  const n = set.n;
  const m = set.cols.length;
  const root = Math.sqrt(n);
  const along = new Float64Array(m);
  const positivePart = new Float64Array(m);
  const gainNegative = new Float64Array(m);
  for (let j = 0; j < m; j++) {
    const col = set.cols[j];
    let total = 0;
    for (let i = 0; i < n; i++) total += col[i] * e[i];
    along[j] = total / root;
  }
  let negativeMass = 0;
  if (tau) {
    for (let i = 0; i < n; i++) if (e[i] < 0) negativeMass += e[i] * tau[i];
    negativeMass /= root;
    for (const d of drivers) {
      const col = set.cols[d];
      let positive = 0;
      let negative = 0;
      for (let i = 0; i < n; i++) {
        if (e[i] > 0) positive += e[i] * col[i];
        else if (col[i] > tau[i]) negative += e[i] * (col[i] - tau[i]);
      }
      positivePart[d] = positive / root;
      gainNegative[d] = negative / root;
    }
  }
  return { along, positivePart, gainNegative, negativeMass };
}

/** Search order for quantiles: the normal approximation mean - lambda * <X_j, e>. */
function surrogateOrder(s: Search, set: ScenarioSet, direction: Float64Array, lambda: number): Float64Array {
  const terms = directionTerms(set, direction, s.market.drivers, null);
  const order = new Float64Array(s.market.assets.length);
  for (let j = 0; j < order.length; j++) order[j] = set.scenarioMean[j] - lambda * terms.along[j];
  return order;
}

/** Install bound sets. Drivers are searched in `order` (default: the first bound); pairs by the first bound. */
function setBounds(s: Search, sets: BoundSet[], order: Float64Array | null): void {
  s.bounds = sets;
  const u = sets[0].u;
  const key = order ?? u;
  s.candidates.sort((x, y) => key[y] - key[x]);
  s.pairs.sort((x, y) => u[y.a] + u[y.b] - (u[x.a] + u[x.b]));
}

/** Per-world best score among the given drivers. */
function worldMax(set: ScenarioSet, drivers: number[]): Float64Array {
  const out = new Float64Array(set.n).fill(Number.NEGATIVE_INFINITY);
  for (const d of drivers) {
    const col = set.cols[d];
    for (let i = 0; i < set.n; i++) if (col[i] > out[i]) out[i] = col[i];
  }
  return out;
}

/** Centred, unit-length copy of a world vector (null when constant). */
function unitDirection(vector: Float64Array): Float64Array | null {
  const n = vector.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += vector[i];
  mean /= n;
  const out = new Float64Array(n);
  let norm = 0;
  for (let i = 0; i < n; i++) {
    out[i] = vector[i] - mean;
    norm += out[i] * out[i];
  }
  if (norm === 0) return null;
  const scale = 1 / Math.sqrt(norm);
  for (let i = 0; i < n; i++) out[i] *= scale;
  return out;
}

// ------------------------------------------------------------------------------ branch and bound

function runSearch(s: Search): Leaf[] {
  const rules = s.market.rules;
  const need = rules.drivers - s.lockedDrivers.length;
  const cand = s.candidates;
  const count = cand.length;
  if (count < need) return s.top;
  const K = s.bounds.length;
  const second = s.mode === "x3" && s.secondBoost;

  // Per bound set: best sum of r remaining u's from position j, suffix max of boost terms,
  // u of every pair (in search order) and the best pair.
  const topSum = s.bounds.map((b) => topSumTable(cand, b.u, need));
  const boostSuffix = s.bounds.map((b) => suffixMax(cand, b.uBoost));
  const boost2Suffix = s.bounds.map((b) => suffixMax(cand, b.uBoost2));
  const pairU = s.bounds.map((b) => Float64Array.from(s.pairs, (p) => b.u[p.a] + b.u[p.b]));
  const bestPairU = pairU.map((values) => maxOf(values));
  const minCost = minCostTable(cand, s.costT, need);
  let minPairCost = Number.POSITIVE_INFINITY;
  for (const pair of s.pairs) minPairCost = Math.min(minPairCost, pair.cost);

  // Running sums per depth and bound set: index depth * K + k.
  const depths = need + 1;
  const uSum = new Float64Array(depths * K);
  const mb = new Float64Array(depths * K).fill(Number.NEGATIVE_INFINITY);
  const mb2 = new Float64Array(depths * K).fill(Number.NEGATIVE_INFINITY);
  let lockedCost = 0;
  let lockedTransfers = 0;
  for (const d of s.lockedDrivers) {
    lockedCost += s.costT[d];
    lockedTransfers += s.owned[d] ? 0 : 1;
    for (let k = 0; k < K; k++) {
      const b = s.bounds[k];
      uSum[k] += b.u[d];
      mb[k] = Math.max(mb[k], b.uBoost[d]);
      mb2[k] = Math.max(mb2[k], b.uBoost2[d]);
    }
  }

  const leaf = new LeafEvaluator(s);
  const chosen: number[] = [...s.lockedDrivers];
  const leafBound = new Float64Array(K);
  let nodes = 0;

  const visit = (start: number, left: number, depth: number, cost: number, transfers: number): void => {
    if (s.timedOut) return;
    nodes += 1;
    if ((nodes & 255) === 0 && performance.now() > s.deadline) {
      s.timedOut = true;
      return;
    }
    const base = depth * K;
    if (left === 0) {
      for (let k = 0; k < K; k++) {
        const boost = mb[base + k] + (second ? mb2[base + k] : 0);
        leafBound[k] = uSum[base + k] + boost + s.bounds[k].constant;
      }
      evaluatePairs(s, leaf, chosen, cost, transfers, leafBound, pairU);
      return;
    }
    const minPenalty = penaltyOf(s, transfers);
    for (let j = start; j <= count - left; j++) {
      let bound = Number.POSITIVE_INFINITY;
      for (let k = 0; k < K; k++) {
        const boost = Math.max(mb[base + k], boostSuffix[k][j]) + (second ? Math.max(mb2[base + k], boost2Suffix[k][j]) : 0);
        const value = uSum[base + k] + topSum[k][j][left] + boost + s.bounds[k].constant + bestPairU[k];
        if (value < bound) bound = value;
      }
      if (bound - minPenalty <= threshold(s)) return;
      if (cost + minCost[j][left] + minPairCost > s.budgetT) return;
      const d = cand[j];
      const nextCost = cost + s.costT[d];
      if (nextCost + minCost[j + 1][left - 1] + minPairCost > s.budgetT) continue;
      const next = base + K;
      for (let k = 0; k < K; k++) {
        const b = s.bounds[k];
        uSum[next + k] = uSum[base + k] + b.u[d];
        mb[next + k] = Math.max(mb[base + k], b.uBoost[d]);
        mb2[next + k] = Math.max(mb2[base + k], b.uBoost2[d]);
      }
      chosen.push(d);
      visit(j + 1, left - 1, depth + 1, nextCost, transfers + (s.owned[d] ? 0 : 1));
      chosen.pop();
      if (s.timedOut) return;
    }
  };
  visit(0, need, 0, lockedCost, lockedTransfers);
  return s.top;
}

function evaluatePairs(
  s: Search,
  leaf: LeafEvaluator,
  drivers: number[],
  cost: number,
  transfers: number,
  leafBound: Float64Array,
  pairU: Float64Array[],
): void {
  const remaining = s.budgetT - cost;
  const minPenalty = penaltyOf(s, transfers);
  const K = leafBound.length;
  leaf.reset(drivers);
  for (let p = 0; p < s.pairs.length; p++) {
    const pair = s.pairs[p];
    const primary = leafBound[0] + pairU[0][p];
    if (primary - minPenalty <= threshold(s)) break;
    if (pair.cost > remaining) continue;
    const penalty = penaltyOf(s, transfers + pair.transfers);
    let optimistic = primary;
    for (let k = 1; k < K; k++) optimistic = Math.min(optimistic, leafBound[k] + pairU[k][p]);
    if (optimistic - penalty <= threshold(s)) continue;
    const need = threshold(s) + penalty;
    const value = leaf.evaluate(pair, need);
    s.evaluated += 1;
    if (value <= need) continue;
    const key = teamKey(drivers, pair);
    insertLeaf(s, { key, drivers: [...drivers], pair, boost: leaf.boost, boost2: leaf.boost2, score: value - penalty, penalty });
  }
}

// ------------------------------------------------------------------------------ exact scoring

/** Exact objective value of a driver set plus a constructor pair, with the best Boost. */
class LeafEvaluator {
  boost = -1;
  boost2 = -1;
  private drivers: number[] = [];
  private readonly m: number;
  private linearReady = false;
  private linearValue = 0;
  private linearBoost = -1;
  private linearBoost2 = -1;
  private optionsReady = false;
  private optionCount = 0;
  private readonly optB1 = new Int32Array(20);
  private readonly optB2 = new Int32Array(20);
  private readonly optE1 = new Float64Array(20);
  private readonly optE2 = new Float64Array(20);
  private readonly optMean = new Float64Array(20);
  private readonly optSmean = new Float64Array(20);
  private readonly optVar = new Float64Array(20);
  private readonly optVecReady = new Uint8Array(20);
  private readonly optVec: Float64Array[] = [];
  private readonly covDc: Float64Array;
  private readonly driverSum: Float64Array;
  private driverSumReady = false;
  private autoReady = false;
  private readonly autoVec: Float64Array;
  private readonly autoCov: Float64Array;
  private autoLinear = 0;
  private autoMean = 0;
  private autoSmean = 0;
  private autoVar = 0;

  constructor(private readonly s: Search) {
    this.m = s.market.assets.length;
    const n = s.set?.n ?? 0;
    this.covDc = new Float64Array(this.m);
    this.driverSum = new Float64Array(n);
    this.autoVec = new Float64Array(n);
    this.autoCov = new Float64Array(this.m);
  }

  reset(drivers: number[]): void {
    this.drivers = drivers;
    this.linearReady = false;
    this.optionsReady = false;
    this.optVecReady.fill(0);
    this.driverSumReady = false;
    this.autoReady = false;
  }

  evaluate(pair: Pair, need: number): number {
    const s = this.s;
    const kind = s.objective.kind;
    if (s.mode === "auto" && s.set) return this.evaluateAuto(pair, need);
    if (kind === "expected" || kind === "value" || !s.set) return this.evaluateLinear(pair);
    if (kind === "meanStd") return this.evaluateMeanStd(pair);
    return this.evaluateQuantile(pair, need);
  }

  private evaluateLinear(pair: Pair): number {
    if (!this.linearReady) this.prepareLinear();
    this.boost = this.linearBoost;
    this.boost2 = this.linearBoost2;
    return this.linearValue + pair.lin;
  }

  private prepareLinear(): void {
    const s = this.s;
    let total = 0;
    let first = -1;
    let second = -1;
    for (const d of this.drivers) {
      total += s.lin[d];
      if (first < 0 || s.mean[d] > s.mean[first]) {
        second = first;
        first = d;
      } else if (second < 0 || s.mean[d] > s.mean[second]) {
        second = d;
      }
    }
    this.linearBoost2 = -1;
    if (s.mode === "x3") {
      total += s.extraBoostExtra * s.mean[first];
      if (s.secondBoost) {
        total += s.boostExtra * s.mean[second];
        this.linearBoost2 = second;
      }
    } else {
      total += s.boostExtra * s.mean[first];
    }
    this.linearBoost = first;
    this.linearValue = total;
    this.linearReady = true;
  }

  private evaluateMeanStd(pair: Pair): number {
    if (!this.optionsReady) this.prepareOptions();
    const s = this.s;
    let best = Number.NEGATIVE_INFINITY;
    for (let o = 0; o < this.optionCount; o++) {
      const variance = this.optionVariance(o, pair);
      const sd = Math.sqrt(variance > 0 ? variance : 0);
      const value = this.optMean[o] + pair.mean - s.lambda * sd;
      if (value > best) {
        best = value;
        this.boost = this.optB1[o];
        this.boost2 = this.optB2[o];
      }
    }
    return best;
  }

  private evaluateQuantile(pair: Pair, need: number): number {
    if (!this.optionsReady) this.prepareOptions();
    const s = this.s;
    const set = s.set as ScenarioSet;
    let best = Number.NEGATIVE_INFINITY;
    let pairVector: Float64Array | null = null;
    for (let o = 0; o < this.optionCount; o++) {
      const variance = this.optionVariance(o, pair);
      const sd = Math.sqrt(variance > 0 ? variance : 0);
      const bound = this.optSmean[o] + pair.smean + s.cantelli * sd;
      const floor = need > best ? need : best;
      if (bound <= floor) continue;
      if (!pairVector) pairVector = pairVec(pair, set);
      const driverVector = this.optionVector(o);
      const value = quantileOfSum(driverVector, pairVector, s.q, floor, s.scratch);
      if (value > best) {
        best = value;
        this.boost = this.optB1[o];
        this.boost2 = this.optB2[o];
      }
    }
    return best;
  }

  private evaluateAuto(pair: Pair, need: number): number {
    if (!this.autoReady) this.prepareAuto();
    const s = this.s;
    this.boost = -1;
    this.boost2 = -1;
    const kind = s.objective.kind;
    if (kind === "expected" || kind === "value") return this.autoLinear + pair.lin;
    const variance = this.autoVar + pair.variance + 2 * (this.autoCov[pair.a] + this.autoCov[pair.b]);
    const sd = Math.sqrt(variance > 0 ? variance : 0);
    if (kind === "meanStd") return this.autoMean + pair.mean - s.lambda * sd;
    const bound = this.autoSmean + pair.smean + s.cantelli * sd;
    if (bound <= need) return Number.NEGATIVE_INFINITY;
    const set = s.set as ScenarioSet;
    const pairVector = pairVec(pair, set);
    return quantileOfSum(this.autoVec, pairVector, s.q, need, s.scratch);
  }

  /** Variance of driver option o plus a constructor pair, from the covariance matrix. */
  private optionVariance(o: number, pair: Pair): number {
    const cov = (this.s.set as ScenarioSet).cov;
    const m = this.m;
    const b1 = this.optB1[o];
    const b2 = this.optB2[o];
    const e1 = this.optE1[o];
    const e2 = this.optE2[o];
    let covA = this.covDc[pair.a] + e1 * cov[b1 * m + pair.a];
    let covB = this.covDc[pair.b] + e1 * cov[b1 * m + pair.b];
    if (b2 >= 0) {
      covA += e2 * cov[b2 * m + pair.a];
      covB += e2 * cov[b2 * m + pair.b];
    }
    return this.optVar[o] + pair.variance + 2 * (covA + covB);
  }

  private prepareOptions(): void {
    const s = this.s;
    const set = s.set as ScenarioSet;
    const cov = set.cov;
    const m = this.m;
    const drivers = this.drivers;
    let meanD = 0;
    let smeanD = 0;
    let varD = 0;
    for (const d of drivers) {
      meanD += s.mean[d];
      smeanD += set.scenarioMean[d];
      for (const e of drivers) varD += cov[d * m + e];
    }
    for (const c of s.market.constructors) {
      let total = 0;
      for (const d of drivers) total += cov[d * m + c];
      this.covDc[c] = total;
    }
    const covWithD = (b: number) => {
      let total = 0;
      for (const d of drivers) total += cov[b * m + d];
      return total;
    };
    let count = 0;
    const add = (b1: number, e1: number, b2: number, e2: number) => {
      const c1 = covWithD(b1);
      let variance = varD + 2 * e1 * c1 + e1 * e1 * cov[b1 * m + b1];
      let mean = meanD + e1 * s.mean[b1];
      let smean = smeanD + e1 * set.scenarioMean[b1];
      if (b2 >= 0) {
        const c2 = covWithD(b2);
        variance += 2 * e2 * c2 + e2 * e2 * cov[b2 * m + b2] + 2 * e1 * e2 * cov[b1 * m + b2];
        mean += e2 * s.mean[b2];
        smean += e2 * set.scenarioMean[b2];
      }
      this.optB1[count] = b1;
      this.optB2[count] = b2;
      this.optE1[count] = e1;
      this.optE2[count] = e2;
      this.optMean[count] = mean;
      this.optSmean[count] = smean;
      this.optVar[count] = variance;
      count += 1;
    };
    for (const a of drivers) {
      if (s.mode !== "x3") {
        add(a, s.boostExtra, -1, 0);
        continue;
      }
      if (!s.secondBoost) {
        add(a, s.extraBoostExtra, -1, 0);
        continue;
      }
      for (const b of drivers) {
        if (b !== a) add(a, s.extraBoostExtra, b, s.boostExtra);
      }
    }
    this.optionCount = count;
    this.optionsReady = true;
  }

  private optionVector(o: number): Float64Array {
    const set = this.s.set as ScenarioSet;
    const n = set.n;
    if (!this.optVec[o]) this.optVec[o] = new Float64Array(n);
    const vector = this.optVec[o];
    if (this.optVecReady[o]) return vector;
    if (!this.driverSumReady) {
      this.driverSum.fill(0);
      for (const d of this.drivers) {
        const col = set.cols[d];
        for (let i = 0; i < n; i++) this.driverSum[i] += col[i];
      }
      this.driverSumReady = true;
    }
    const first = set.cols[this.optB1[o]];
    const e1 = this.optE1[o];
    for (let i = 0; i < n; i++) vector[i] = this.driverSum[i] + e1 * first[i];
    const b2 = this.optB2[o];
    if (b2 >= 0) {
      const secondCol = set.cols[b2];
      const e2 = this.optE2[o];
      for (let i = 0; i < n; i++) vector[i] += e2 * secondCol[i];
    }
    this.optVecReady[o] = 1;
    return vector;
  }

  private prepareAuto(): void {
    const s = this.s;
    const set = s.set as ScenarioSet;
    const n = set.n;
    const vector = this.autoVec;
    let maxTotal = 0;
    for (let i = 0; i < n; i++) {
      let total = 0;
      let best = Number.NEGATIVE_INFINITY;
      for (const d of this.drivers) {
        const value = set.cols[d][i];
        total += value;
        if (value > best) best = value;
      }
      vector[i] = total + best;
      maxTotal += best;
    }
    const expectedMax = maxTotal / n;
    let linear = expectedMax;
    let mean = expectedMax;
    let smean = expectedMax;
    for (const d of this.drivers) {
      linear += s.lin[d];
      mean += s.mean[d];
      smean += set.scenarioMean[d];
    }
    let vectorMean = 0;
    for (let i = 0; i < n; i++) vectorMean += vector[i];
    vectorMean /= n;
    let variance = 0;
    for (let i = 0; i < n; i++) {
      const delta = vector[i] - vectorMean;
      variance += delta * delta;
    }
    this.autoVar = variance / n;
    for (const c of s.market.constructors) {
      const col = set.cols[c];
      const mu = set.scenarioMean[c];
      let total = 0;
      for (let i = 0; i < n; i++) total += (vector[i] - vectorMean) * (col[i] - mu);
      this.autoCov[c] = total / n;
    }
    this.autoLinear = linear;
    this.autoMean = mean;
    this.autoSmean = smean;
    this.autoReady = true;
  }
}

// ------------------------------------------------------------------------------ helpers

function buildPairs(
  pool: number[],
  locked: number[],
  set: ScenarioSet | null,
  mean: Float64Array,
  lin: Float64Array,
  costT: Int32Array,
  owned: Uint8Array,
  pointsMean: Float64Array,
): Pair[] {
  const pairs: Pair[] = [];
  const m = owned.length;
  for (let x = 0; x < pool.length; x++) {
    for (let y = x + 1; y < pool.length; y++) {
      const a = pool[x];
      const b = pool[y];
      if (locked.some((c) => c !== a && c !== b)) continue;
      const variance = set ? set.cov[a * m + a] + set.cov[b * m + b] + 2 * set.cov[a * m + b] : 0;
      const smean = set ? set.scenarioMean[a] + set.scenarioMean[b] : pointsMean[a] + pointsMean[b];
      pairs.push({
        a,
        b,
        cost: costT[a] + costT[b],
        lin: lin[a] + lin[b],
        mean: mean[a] + mean[b],
        smean,
        variance,
        transfers: (owned[a] ? 0 : 1) + (owned[b] ? 0 : 1),
        vec: null,
      });
    }
  }
  return pairs;
}

function pairVec(pair: Pair, set: ScenarioSet): Float64Array {
  if (pair.vec) return pair.vec;
  const vector = new Float64Array(set.n);
  const first = set.cols[pair.a];
  const second = set.cols[pair.b];
  for (let i = 0; i < set.n; i++) vector[i] = first[i] + second[i];
  pair.vec = vector;
  return vector;
}

/** table[j][r]: the largest possible sum of r values of u among candidates j.. */
function topSumTable(cand: number[], u: Float64Array, need: number): Float64Array[] {
  const count = cand.length;
  const table: Float64Array[] = [];
  for (let j = 0; j <= count; j++) table.push(new Float64Array(need + 1));
  const sorted: number[] = [];
  for (let j = count - 1; j >= 0; j--) {
    const value = u[cand[j]];
    let at = 0;
    while (at < sorted.length && sorted[at] >= value) at++;
    sorted.splice(at, 0, value);
    let total = 0;
    for (let r = 1; r <= need; r++) {
      if (r <= sorted.length) total += sorted[r - 1];
      table[j][r] = r <= sorted.length ? total : Number.NEGATIVE_INFINITY;
    }
  }
  return table;
}

function suffixMax(cand: number[], values: Float64Array): Float64Array {
  const out = new Float64Array(cand.length + 1).fill(Number.NEGATIVE_INFINITY);
  for (let i = cand.length - 1; i >= 0; i--) out[i] = Math.max(out[i + 1], values[cand[i]]);
  return out;
}

function maxOf(values: Float64Array): number {
  let best = Number.NEGATIVE_INFINITY;
  for (const value of values) if (value > best) best = value;
  return best;
}

/** minCost[i][r]: cheapest total of r drivers chosen from candidates i.. (tenths). */
function minCostTable(cand: number[], costT: Int32Array, need: number): number[][] {
  const count = cand.length;
  const table: number[][] = [];
  for (let i = 0; i <= count; i++) {
    const row = new Array<number>(need + 1).fill(Number.POSITIVE_INFINITY);
    row[0] = 0;
    table.push(row);
  }
  for (let i = count - 1; i >= 0; i--) {
    for (let r = 1; r <= need; r++) {
      const skip = table[i + 1][r];
      const take = costT[cand[i]] + table[i + 1][r - 1];
      table[i][r] = Math.min(skip, take);
    }
  }
  return table;
}

/** Constant threshold: the best driver's mean, in every world. */
function constantTau(market: Market, set: ScenarioSet): Float64Array {
  let best = 0;
  for (const d of market.drivers) best = Math.max(best, set.scenarioMean[d]);
  return new Float64Array(set.n).fill(best);
}

/** Mean and sd of (X_d - tau)+ per driver, and of tau itself. */
function autopilotGains(set: ScenarioSet, tau: Float64Array, drivers: number[]) {
  const m = set.cols.length;
  const n = set.n;
  const mean = new Float64Array(m);
  const sd = new Float64Array(m);
  for (const d of drivers) {
    const col = set.cols[d];
    let total = 0;
    let squares = 0;
    for (let i = 0; i < n; i++) {
      const gain = col[i] > tau[i] ? col[i] - tau[i] : 0;
      total += gain;
      squares += gain * gain;
    }
    const mu = total / n;
    mean[d] = mu;
    const variance = Math.max(0, squares / n - mu * mu);
    sd[d] = Math.sqrt(variance);
  }
  let tauTotal = 0;
  let tauSquares = 0;
  for (let i = 0; i < n; i++) {
    tauTotal += tau[i];
    tauSquares += tau[i] * tau[i];
  }
  const tauMean = tauTotal / n;
  const tauVariance = Math.max(0, tauSquares / n - tauMean * tauMean);
  return { mean, sd, tauMean, tauSd: Math.sqrt(tauVariance) };
}

function penaltyOf(s: Search, transfers: number): number {
  if (s.penaltyFree) return 0;
  return transferPenalty(s.market.rules, transfers, s.freeTransfers, s.chip);
}

function threshold(s: Search): number {
  if (s.top.length < s.topN) return Number.NEGATIVE_INFINITY;
  return s.top[s.top.length - 1].score;
}

function insertLeaf(s: Search, leaf: Leaf): void {
  if (s.keys.has(leaf.key)) return;
  const top = s.top;
  let lo = 0;
  let hi = top.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (top[mid].score >= leaf.score) lo = mid + 1;
    else hi = mid;
  }
  top.splice(lo, 0, leaf);
  s.keys.add(leaf.key);
  if (top.length > s.topN) {
    const removed = top.pop() as Leaf;
    s.keys.delete(removed.key);
  }
}

function teamKey(drivers: number[], pair: Pair): number {
  let key = 2 ** pair.a + 2 ** pair.b;
  for (const d of drivers) key += 2 ** d;
  return key;
}

/** Score a known team exactly and add it to the top N (used by the warm start). */
function seedTeam(s: Search, leaf: LeafEvaluator, team: TeamResult): void {
  const market = s.market;
  const drivers = team.drivers.map((id) => market.byId.get(id) as number);
  const a = market.byId.get(team.constructors[0]) as number;
  const b = market.byId.get(team.constructors[1]) as number;
  const pair = s.pairs.find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));
  if (!pair) return;
  if (s.lockedDrivers.some((d) => !drivers.includes(d))) return;
  let cost = pair.cost;
  let transfers = pair.transfers;
  for (const d of drivers) {
    cost += s.costT[d];
    transfers += s.owned[d] ? 0 : 1;
  }
  if (cost > s.budgetT) return;
  leaf.reset(drivers);
  const value = leaf.evaluate(pair, Number.NEGATIVE_INFINITY);
  const penalty = penaltyOf(s, transfers);
  const key = teamKey(drivers, pair);
  insertLeaf(s, { key, drivers, pair, boost: leaf.boost, boost2: leaf.boost2, score: value - penalty, penalty });
}

/** Total points vector of a scored team over the current scenario set (boosts and Autopilot included). */
function leafVector(s: Search, leaf: Leaf): Float64Array {
  const set = s.set as ScenarioSet;
  const weights = leafWeights(s, leaf);
  const vector = new Float64Array(set.n);
  for (const [index, weight] of weights) {
    const col = set.cols[index];
    for (let i = 0; i < set.n; i++) vector[i] += weight * col[i];
  }
  if (s.mode === "auto") {
    for (let i = 0; i < set.n; i++) {
      let best = Number.NEGATIVE_INFINITY;
      for (const d of leaf.drivers) best = Math.max(best, set.cols[d][i]);
      vector[i] += best;
    }
  }
  return vector;
}

function leafWeights(s: Search, leaf: Leaf): Map<number, number> {
  const weights = new Map<number, number>();
  for (const j of leaf.drivers) weights.set(j, 1);
  weights.set(leaf.pair.a, 1);
  weights.set(leaf.pair.b, 1);
  if (s.mode === "x3") {
    if (leaf.boost >= 0) weights.set(leaf.boost, 1 + s.extraBoostExtra);
    if (leaf.boost2 >= 0) weights.set(leaf.boost2, 1 + s.boostExtra);
  } else if (leaf.boost >= 0) {
    weights.set(leaf.boost, 1 + s.boostExtra);
  }
  return weights;
}

/** Same worlds, reordered from the worst to the best for `vector` (quantiles do not depend on order). */
function permutedSet(set: ScenarioSet, vector: Float64Array): ScenarioSet {
  const indices = vector.keys();
  const order = Array.from(indices);
  order.sort((x, y) => vector[x] - vector[y]);
  const cols = set.cols.map((col) => {
    const out = new Float32Array(col.length);
    for (let i = 0; i < order.length; i++) out[i] = col[order[i]];
    return out;
  });
  return { ...set, cols };
}

/**
 * q-quantile (numpy "linear") of a + b over the worlds, or -Infinity as soon as it is provably
 * not above `floor` (enough worlds at or below it).
 */
function quantileOfSum(a: Float64Array, b: Float64Array, q: number, floor: number, scratch: Float64Array): number {
  const n = a.length;
  const h = (n - 1) * q;
  const lo = Math.floor(h);
  const limit = lo + 2;
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (a[i] + b[i] <= floor) {
      count += 1;
      if (count >= limit) return Number.NEGATIVE_INFINITY;
    }
  }
  for (let i = 0; i < n; i++) scratch[i] = a[i] + b[i];
  return interpolatedQuantile(scratch, h);
}

function interpolatedQuantile(values: Float64Array, h: number): number {
  const lo = Math.floor(h);
  const x = select(values, lo);
  if (lo + 1 >= values.length) return x;
  let y = Number.POSITIVE_INFINITY;
  for (let i = lo + 1; i < values.length; i++) if (values[i] < y) y = values[i];
  return x + (h - lo) * (y - x);
}

/** k-th smallest (0-based); partially reorders `values` (Hoare quickselect). */
function select(values: Float64Array, k: number): number {
  let left = 0;
  let right = values.length - 1;
  while (left < right) {
    const mid = (left + right) >> 1;
    const pivot = median3(values[left], values[mid], values[right]);
    let i = left;
    let j = right;
    while (i <= j) {
      while (values[i] < pivot) i++;
      while (values[j] > pivot) j--;
      if (i <= j) {
        const tmp = values[i];
        values[i] = values[j];
        values[j] = tmp;
        i++;
        j--;
      }
    }
    if (k <= j) right = j;
    else if (k >= i) left = i;
    else return values[k];
  }
  return values[k];
}

function median3(a: number, b: number, c: number): number {
  if (a < b) {
    if (b < c) return b;
    return a < c ? c : a;
  }
  if (a < c) return a;
  return b < c ? c : b;
}

/** Inverse standard normal CDF (Acklam's rational approximation). */
function normalQuantile(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  if (p < low || p > 1 - low) {
    const tail = p < low ? p : 1 - p;
    const logTail = Math.log(tail);
    const r = Math.sqrt(-2 * logTail);
    const value = (((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) / ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1);
    return p < low ? value : -value;
  }
  const t = p - 0.5;
  const r = t * t;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * t) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

function summarise(total: Float64Array): TeamStats {
  const n = total.length;
  if (n === 0) return { mean: 0, sd: 0, p10: 0, p50: 0, p90: 0, worst10: 0 };
  let sum = 0;
  for (let i = 0; i < n; i++) sum += total[i];
  const mean = sum / n;
  let squares = 0;
  for (let i = 0; i < n; i++) squares += (total[i] - mean) * (total[i] - mean);
  const sd = Math.sqrt(squares / n);
  const sorted = Float64Array.from(total).sort();
  const at = (q: number) => {
    const h = (n - 1) * q;
    const lo = Math.floor(h);
    const hi = Math.min(n - 1, lo + 1);
    return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
  };
  const tenth = Math.floor(n * 0.1);
  const tail = Math.max(1, tenth);
  let tailSum = 0;
  for (let i = 0; i < tail; i++) tailSum += sorted[i];
  return { mean, sd, p10: at(0.1), p50: at(0.5), p90: at(0.9), worst10: tailSum / tail };
}

function toTeamResult(s: Search, leaf: Leaf): TeamResult {
  const market = s.market;
  const drivers = [...leaf.drivers].sort((x, y) => s.pointsMean[y] - s.pointsMean[x]);
  const constructors = [leaf.pair.a, leaf.pair.b].sort((x, y) => s.pointsMean[y] - s.pointsMean[x]);
  const members = [...drivers, ...constructors];
  let regular = leaf.boost;
  let extra = -1;
  if (s.mode === "x3") {
    extra = leaf.boost;
    regular = leaf.boost2;
  }
  const weights = leafWeights(s, leaf);
  const autopilot = s.mode === "auto" ? drivers : null;
  let expectedPoints = 0;
  for (const [j, w] of weights) expectedPoints += w * s.pointsMean[j];
  let stats: TeamStats = { mean: expectedPoints, sd: 0, p10: expectedPoints, p50: expectedPoints, p90: expectedPoints, worst10: expectedPoints };
  if (s.set) {
    stats = teamStats(s.set, weights, autopilot);
    if (autopilot) expectedPoints += stats.mean - scenarioLinearMean(s.set, weights);
  }

  let cost = 0;
  let valueChange = 0;
  for (const j of members) {
    cost += s.prices[j];
    valueChange += s.priceChange[j];
  }
  const memberSet = new Set(members);
  const transfersIn = members.filter((j) => !s.owned[j]).map((j) => market.assets[j].id);
  const transfersOut: string[] = [];
  s.owned.forEach((flag, j) => {
    if (flag && !memberSet.has(j)) transfersOut.push(market.assets[j].id);
  });
  const newTeam = s.owned.every((flag) => flag === 0);
  return {
    drivers: drivers.map((j) => market.assets[j].id),
    constructors: constructors.map((j) => market.assets[j].id),
    boost: regular >= 0 ? market.assets[regular].id : null,
    extraBoost: extra >= 0 ? market.assets[extra].id : null,
    chip: s.chip,
    cost: round2(cost),
    budget: s.nominalBudget,
    bankAfter: round2(s.nominalBudget - cost),
    score: leaf.score,
    expectedPoints,
    penalty: leaf.penalty,
    transfersIn: newTeam ? [] : transfersIn,
    transfersOut,
    transferCount: newTeam ? 0 : transfersIn.length,
    expectedValueChange: valueChange,
    stats,
  };
}

function scenarioLinearMean(set: ScenarioSet, weights: Map<number, number>): number {
  let total = 0;
  for (const [j, w] of weights) total += w * set.scenarioMean[j];
  return total;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
