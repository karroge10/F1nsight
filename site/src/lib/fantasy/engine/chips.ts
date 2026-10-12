// Chip advice: what every available 2026 chip is worth this weekend, what it is worth in the
// planned later rounds, and a season schedule (one chip per race, each chip once) that tells
// the user whether to play a chip now or hold it.
//
// Value of a chip in a round = best objective score with the chip minus without it:
// - x3 Boost, Autopilot, No Negative: exact this weekend on the joint scenarios (the optimiser
//   re-picks the team for the chip); later rounds from the planned lineup and horizon means
//   (x3 Boost) or this weekend's value as the estimate (Autopilot, No Negative);
// - Limitless: best uncapped team minus the planned team, per round;
// - Wildcard: whole-plan gain (the new team stays), from the transfer planner;
// - Final Fix: option value of one penalty-free swap after qualifying, simulated world by world
//   with a decision that only uses what qualifying and the sprint reveal.

import type { Market } from "./market";
import { chipPlayable, optimiseTeam, resolveObjective } from "./optimiser";
import { planRounds, preparePlan, solvePlan, type PlanOptions, type PreparedPlan } from "./planner";
import { CHIP_IDS, type ChipAdvice, type ChipId, type ChipPlan, type TeamResult, type TransferPlan, type UserState } from "./types";

export interface ChipOptions {
  /** Reuse a prepared plan (from preparePlan) instead of building one. */
  prepared?: PreparedPlan;
  planOptions?: PlanOptions;
  /** Time limit per optimiser call (ms). */
  maxMs?: number;
}

/** Advice for every chip plus the recommended schedule. Typical runtime 100 to 400 ms. */
export function adviseChips(market: Market, state: UserState, options: ChipOptions = {}): ChipPlan {
  const objective = resolveObjective(state);
  const maxMs = options.maxMs ?? 100;
  const available = state.chipsAvailable ?? [...CHIP_IDS];
  const prepared = options.prepared ?? preparePlan(market, state, options.planOptions);
  const basePlan = solvePlan(prepared, {});
  const rounds = planRounds(prepared);
  const base = optimiseTeam(market, state, { chip: null, topN: 1, objective, maxMs });
  const baseScore = base.best?.score ?? 0;
  const remainingAfterNow = Math.max(0, market.rules.seasonRounds - market.round);

  const advice: ChipAdvice[] = CHIP_IDS.map((chip) => {
    const rule = market.rules.chips[chip];
    if (!available.includes(chip)) {
      return unavailable(chip, rule.name, "already used this season");
    }
    const playable = chipPlayable(market, state, chip);
    const now = valueNow(market, state, chip, base.best, baseScore, prepared, basePlan, maxMs);
    const later = laterValues(market, state, chip, now.value, rounds, basePlan, prepared, maxMs);
    return {
      chip,
      name: rule.name,
      available: true,
      unavailableReason: playable ? undefined : "unlocks after your team's first race",
      valueNow: playable ? now.value : 0,
      confidence: confidenceOf(market, chip),
      valueByRound: later,
      holdValue: 0,
      recommendation: "hold",
      plannedRound: null,
      reason: "",
      team: now.team,
    };
  });

  const schedule = scheduleChips(market, state, advice, remainingAfterNow);
  for (const item of advice) {
    if (!item.available) continue;
    const slot = schedule.assignment.get(item.chip) ?? null;
    item.plannedRound = slot === null ? null : slot.round;
    item.holdValue = bestLater(item);
    item.recommendation = slot !== null && slot.round === market.round ? "play" : "hold";
    item.reason = reasonFor(market, item, slot, schedule.mustUse);
    if (item.confidence === "estimate") item.reason += " Rough estimate: the forecast file has no race-only points per world.";
    if (item.confidence === "lower bound") item.reason += " Lower bound: the forecast file has no per-category negatives.";
  }
  const playNow = advice.find((a) => a.recommendation === "play")?.chip ?? null;
  const concrete = [...schedule.assignment.entries()]
    .filter(([, slot]) => slot.round > 0)
    .map(([chip, slot]) => ({ round: slot.round, chip }))
    .sort((x, y) => x.round - y.round);
  return { playNow, advice, schedule: concrete };
}

/**
 * Final Fix option value this weekend. After qualifying (and the sprint) the user knows those
 * points in every world; the expected race points given them come from a linear regression over
 * the joint worlds (race points on pre-race points, per asset). The user makes the single swap
 * with the best predicted race gain (or none), within the bank, and the realised race-points
 * gain is averaged over the worlds. Without race points in the file, qualifying is modelled as
 * a noisy signal explaining a share of the race-points variance (assumption finalFixInfoShare).
 */
export function finalFixValue(market: Market, team: TeamResult, bank: number): number {
  const rules = market.rules;
  const set = market.base;
  const n = set.n;
  const members = [...team.drivers, ...team.constructors].map((id) => market.byId.get(id) as number);
  const memberSet = new Set(members);
  const raceCols = market.raceCols ?? fallbackRaceCols(market);
  const predictedCols = market.raceCols ? conditionalRace(set.cols, raceCols) : shareRace(raceCols, rules.assumptions.finalFixInfoShare);
  const boostIndex = team.boost ? (market.byId.get(team.boost) ?? -1) : -1;
  const swaps: { out: number; into: number; factor: number }[] = [];
  for (const out of members) {
    const asset = market.assets[out];
    if (asset.kind === "constructor" && !rules.assumptions.finalFixAllowsConstructor) continue;
    const factor = out === boostIndex ? rules.boostMultiplier : 1;
    for (const candidate of market.assets) {
      if (candidate.kind !== asset.kind || memberSet.has(candidate.index) || !candidate.pickable) continue;
      if (candidate.price > asset.price + bank + 1e-9) continue;
      swaps.push({ out, into: candidate.index, factor });
    }
  }
  let total = 0;
  for (let i = 0; i < n; i++) {
    let bestPredicted = 0;
    let realised = 0;
    for (const swap of swaps) {
      const predicted = swap.factor * (predictedCols[swap.into][i] - predictedCols[swap.out][i]);
      if (predicted > bestPredicted) {
        bestPredicted = predicted;
        realised = swap.factor * (raceCols[swap.into][i] - raceCols[swap.out][i]);
      }
    }
    total += realised;
  }
  return total / n;
}

/** E[race points | pre-race points] per asset and world, by least squares over the worlds. */
function conditionalRace(totalCols: Float32Array[], raceCols: Float32Array[]): Float64Array[] {
  return raceCols.map((race, j) => {
    const total = totalCols[j];
    const n = race.length;
    let meanRace = 0;
    let meanBefore = 0;
    for (let i = 0; i < n; i++) {
      meanRace += race[i];
      meanBefore += total[i] - race[i];
    }
    meanRace /= n;
    meanBefore /= n;
    let cov = 0;
    let variance = 0;
    for (let i = 0; i < n; i++) {
      const before = total[i] - race[i] - meanBefore;
      cov += before * (race[i] - meanRace);
      variance += before * before;
    }
    const slope = variance > 0 ? cov / variance : 0;
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = meanRace + slope * (total[i] - race[i] - meanBefore);
    return out;
  });
}

/**
 * Fallback without race points: what qualifying reveals is a noisy signal that explains a share
 * r2 of the race-points variance. Signal K = r2 * dev + sqrt(r2 (1 - r2)) * sd * z (z seeded
 * standard normal), so E[dev | K] = K and Var(K) = r2 Var(dev).
 */
function shareRace(raceCols: Float32Array[], r2: number): Float64Array[] {
  const random = mulberry32(170);
  const share = r2 < 0 ? 0 : r2 > 1 ? 1 : r2;
  const noiseScale = Math.sqrt(share * (1 - share));
  return raceCols.map((race) => {
    const n = race.length;
    let mean = 0;
    for (let i = 0; i < n; i++) mean += race[i];
    mean /= n;
    let squares = 0;
    for (let i = 0; i < n; i++) squares += (race[i] - mean) * (race[i] - mean);
    const sd = Math.sqrt(squares / n);
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const z = standardNormal(random);
      out[i] = mean + share * (race[i] - mean) + noiseScale * sd * z;
    }
    return out;
  });
}

function standardNormal(random: () => number): number {
  const draw = random();
  const u1 = Math.max(1e-12, draw);
  const u2 = random();
  const radius = -2 * Math.log(u1);
  const angle = Math.cos(2 * Math.PI * u2);
  return Math.sqrt(radius) * angle;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------------------ values

function valueNow(
  market: Market,
  state: UserState,
  chip: ChipId,
  baseTeam: TeamResult | null,
  baseScore: number,
  prepared: PreparedPlan,
  basePlan: TransferPlan,
  maxMs: number,
): { value: number; team?: TeamResult } {
  if (chip === "finalFix") {
    if (!baseTeam) return { value: 0 };
    const value = finalFixValue(market, baseTeam, baseTeam.bankAfter);
    return { value };
  }
  if (chip === "wildcard") {
    const plan = solvePlan(prepared, { [market.round]: "wildcard" });
    const result = optimiseTeam(market, state, { chip, topN: 1, maxMs });
    const value = plan.score - basePlan.score;
    return { value: Math.max(0, value), team: result.best ?? undefined };
  }
  const result = optimiseTeam(market, state, { chip, topN: 1, maxMs });
  const score = result.best?.score ?? baseScore;
  return { value: score - baseScore, team: result.best ?? undefined };
}

function laterValues(
  market: Market,
  state: UserState,
  chip: ChipId,
  now: number,
  rounds: ReturnType<typeof planRounds>,
  basePlan: TransferPlan,
  prepared: PreparedPlan,
  maxMs: number,
): ChipAdvice["valueByRound"] {
  const out: ChipAdvice["valueByRound"] = [];
  const nowTotal = totalPoints(market.mean);
  for (let s = 1; s < rounds.length; s++) {
    const round = rounds[s];
    const stage = basePlan.stages[s];
    if (!stage) break;
    // Chips without an exact later model (No Negative, Autopilot, Final Fix) scale with how many
    // points the round is worth against this one, so a sprint weekend now is not copied onto a
    // normal race later (and a sprint later is worth more).
    const scale = nowTotal > 0 ? totalPoints(round.means) / nowTotal : 1;
    let value = now * scale;
    let estimated = true;
    if (chip === "extraBoost") {
      value = extraBoostGain(market, stage.drivers, round.means);
      estimated = false;
    } else if (chip === "limitless") {
      const free = optimiseTeam(market, { ...state, team: null }, {
        expectedPoints: round.means,
        prices: round.prices,
        budget: Number.POSITIVE_INFINITY,
        topN: 1,
        chip: null,
        maxMs,
      });
      value = (free.best?.expectedPoints ?? 0) - stage.expectedPoints + stage.penalty;
      estimated = false;
    } else if (chip === "wildcard") {
      const plan = solvePlan(prepared, { [round.round]: "wildcard" });
      value = Math.max(0, (plan.score - basePlan.score) / round.weight);
      estimated = false;
    }
    out.push({ round: round.round, value, estimated });
  }
  return out;
}

/** x3 Boost gain for a lineup: (x3 - x2) on the best driver plus the x2 moving to the second. */
function extraBoostGain(market: Market, drivers: string[], means: Float64Array): number {
  const rules = market.rules;
  const values = drivers.map((id) => means[market.byId.get(id) as number]).sort((a, b) => b - a);
  const top = values[0] ?? 0;
  const second = values[1] ?? 0;
  const extra = (rules.extraBoostMultiplier - rules.boostMultiplier) * top;
  const moved = rules.assumptions.extraBoostKeepsRegularBoost ? (rules.boostMultiplier - 1) * second : 0;
  return extra + moved;
}

function fallbackRaceCols(market: Market): Float32Array[] {
  return market.base.cols.map((col, j) => {
    const asset = market.assets[j];
    const before = (1 - asset.raceShare) * asset.expectedPoints;
    const out = new Float32Array(col.length);
    for (let i = 0; i < col.length; i++) out[i] = col[i] - before;
    return out;
  });
}

// ------------------------------------------------------------------------------ schedule

interface Slot {
  round: number;
  index: number;
}

/**
 * Assign chips to races: this race, the planned horizon races, then typical later races (the
 * chip's average known value), one chip per race, each chip at most once, maximising the total.
 */
function scheduleChips(
  market: Market,
  state: UserState,
  advice: ChipAdvice[],
  remainingAfterNow: number,
): { assignment: Map<ChipId, Slot>; mustUse: boolean } {
  const chips = advice.filter((a) => a.available);
  const horizonRounds = chips[0]?.valueByRound.map((v) => v.round) ?? [];
  const slots: Slot[] = [{ round: market.round, index: 0 }];
  horizonRounds.slice(0, remainingAfterNow).forEach((round, k) => slots.push({ round, index: k + 1 }));
  const generic = Math.max(0, remainingAfterNow - horizonRounds.length);
  for (let g = 0; g < Math.min(generic, chips.length); g++) slots.push({ round: -1 - g, index: -1 });

  const value = (chip: ChipAdvice, slot: Slot): number => {
    if (slot.index === 0) return chipPlayable(market, state, chip.chip) ? chip.valueNow : Number.NEGATIVE_INFINITY;
    if (slot.index > 0) return chip.valueByRound[slot.index - 1]?.value ?? 0;
    return typicalValue(chip);
  };
  const count = chips.length;
  const states = 1 << count;
  // best[k][mask]: best total from slot k on with the chips in mask already used.
  const best: Float64Array[] = [];
  for (let k = 0; k <= slots.length; k++) best.push(new Float64Array(states));
  for (let k = slots.length - 1; k >= 0; k--) {
    for (let mask = 0; mask < states; mask++) {
      let top = best[k + 1][mask];
      for (let c = 0; c < count; c++) {
        if (mask & (1 << c)) continue;
        const gain = value(chips[c], slots[k]);
        if (!(gain > 0)) continue;
        const total = gain + best[k + 1][mask | (1 << c)];
        if (total > top) top = total;
      }
      best[k][mask] = top;
    }
  }
  const assignment = new Map<ChipId, Slot>();
  let mask = 0;
  for (let k = 0; k < slots.length; k++) {
    let choice = -1;
    let top = best[k + 1][mask];
    for (let c = 0; c < count; c++) {
      if (mask & (1 << c)) continue;
      const gain = value(chips[c], slots[k]);
      if (!(gain > 0)) continue;
      const total = gain + best[k + 1][mask | (1 << c)];
      if (total > top + 1e-9) {
        top = total;
        choice = c;
      }
    }
    if (choice >= 0) {
      assignment.set(chips[choice].chip, slots[k]);
      mask |= 1 << choice;
    }
  }
  const mustUse = count >= remainingAfterNow + 1;
  return { assignment, mustUse };
}

/**
 * Value in a typical race beyond the horizon: the average over the planned later rounds. This
 * race is left out, so a sprint weekend now does not inflate every later race; it is the
 * fallback only when there is no horizon.
 */
function typicalValue(chip: ChipAdvice): number {
  const later = chip.valueByRound.map((v) => v.value).filter((v) => v > 0);
  const values = later.length ? later : [chip.valueNow].filter((v) => v > 0);
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function bestLater(chip: ChipAdvice): number {
  let best = typicalValue(chip);
  for (const v of chip.valueByRound) best = Math.max(best, v.value);
  return best;
}

function reasonFor(market: Market, chip: ChipAdvice, slot: Slot | null, mustUse: boolean): string {
  const now = formatPoints(chip.valueNow);
  const later = formatPoints(chip.holdValue);
  const bestRound = chip.valueByRound.reduce<{ round: number; value: number } | null>(
    (acc, v) => (!acc || v.value > acc.value ? v : acc),
    null,
  );
  const roundName = (round: number) => {
    const horizon = market.horizon.find((h) => h.round === round);
    return horizon ? `round ${round} (${horizon.raceName})` : `round ${round}`;
  };
  if (chip.unavailableReason && chip.valueNow === 0 && slot?.round !== market.round) {
    const where = slot && slot.round > 0 ? ` Planned for ${roundName(slot.round)}.` : "";
    return `Not playable this weekend: ${chip.unavailableReason}.${where}`;
  }
  if (slot && slot.round === market.round) {
    const pressure = mustUse ? " You have as many chips left as races, so each race should use one." : "";
    return `Play it now. It scores about ${now} points this weekend, against about ${later} in its best later slot.${pressure}`;
  }
  if (chip.valueNow <= 0.5) return `Hold it. It adds almost nothing this weekend (${now} points), so keep it for a race that suits it.`;
  if (slot && slot.round > 0) {
    return `Hold it for ${roundName(slot.round)}. It scores about ${now} points now, but about ${formatPoints(valueAt(chip, slot.round))} there, and another chip uses this weekend better.`;
  }
  if (bestRound && bestRound.value > chip.valueNow) {
    return `Hold: about ${now} points now, about ${formatPoints(bestRound.value)} in ${roundName(bestRound.round)}.`;
  }
  return `Hold it for a later race. It scores about ${now} points now, about ${later} in a typical later race, and the other chips use the next races better.`;
}

function totalPoints(values: ArrayLike<number>): number {
  let total = 0;
  for (let i = 0; i < values.length; i++) total += Math.max(0, values[i]);
  return total;
}

function valueAt(chip: ChipAdvice, round: number): number {
  return chip.valueByRound.find((v) => v.round === round)?.value ?? 0;
}

function confidenceOf(market: Market, chip: ChipId): ChipAdvice["confidence"] {
  if (chip === "finalFix" && !market.raceCols) return "estimate";
  if (chip === "noNegative" && !market.negativeCols) return "lower bound";
  return "exact";
}

function unavailable(chip: ChipId, name: string, reason: string): ChipAdvice {
  return {
    chip,
    name,
    available: false,
    unavailableReason: reason,
    valueNow: 0,
    confidence: "exact",
    valueByRound: [],
    holdValue: 0,
    recommendation: "unavailable",
    plannedRound: null,
    reason: `${name} is not available: ${reason}.`,
  };
}

function formatPoints(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return rounded >= 0 ? `+${rounded.toFixed(1)}` : rounded.toFixed(1);
}
