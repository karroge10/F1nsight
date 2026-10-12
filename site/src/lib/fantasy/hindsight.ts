// Hindsight best teams: for every scored gameday, the best legal team on the points actually
// scored, once ignoring price and once within the user's budget at that round's prices.
//
// Rules applied: 5 drivers and 2 constructors and the x2 Boost on the team's top scoring driver.
// Every round is a fresh team: no transfers, no chips, no team value growth.

import { combinations } from "@/lib/fantasy";
import { DEFAULT_COST_CAP } from "./planner-state";
import type { FantasyRoundsFile } from "./thresholds";

export interface HindsightAsset {
  id: string;
  kind: "driver" | "constructor";
  price: number;
  /** What the team is chosen on: the real points of the round. */
  score: number;
}

export interface HindsightTeam {
  drivers: string[];
  constructors: string[];
  boost: string;
  cost: number;
  /** Sum of `score` with the Boost driver counted twice. */
  score: number;
}

export interface HindsightRules {
  drivers: number;
  constructors: number;
  /** Total price limit in millions; Infinity ignores price. */
  budget: number;
  boostMultiplier: number;
}

/** One scored round, ready for the solver (prices and real points of that round). */
export interface HindsightRoundInput {
  round: number;
  raceName: string;
  assets: HindsightAsset[];
}

export interface HindsightRound {
  round: number;
  raceName: string;
  /** Best team ignoring price. */
  free: HindsightTeam;
  /** Best team within the budget, null when no legal team fits it. */
  capped: HindsightTeam | null;
}

export const DEFAULT_HINDSIGHT_RULES: HindsightRules = { drivers: 5, constructors: 2, budget: DEFAULT_COST_CAP, boostMultiplier: 2 };

/** Best team under the budget, Boost on the team's top scoring driver. Null when no legal team exists. */
export function bestTeam(assets: HindsightAsset[], rules: HindsightRules = DEFAULT_HINDSIGHT_RULES): HindsightTeam | null {
  const drivers = assets.filter((a) => a.kind === "driver").sort((a, b) => a.price - b.price);
  const pairs = constructorOptions(assets, rules);
  if (pairs.length === 0) return null;
  const extra = rules.boostMultiplier - 1;
  let best: HindsightTeam | null = null;
  for (const combo of combinations(drivers, rules.drivers)) {
    const cost = sumBy(combo, (d) => d.price);
    const remaining = rules.budget - cost;
    const index = lastIndexWithin(pairs, remaining);
    if (index < 0) continue;
    const top = topScorer(combo);
    const driverScore = sumBy(combo, (d) => d.score) + extra * top.score;
    const pair = pairs[index].bestUpToHere;
    const total = driverScore + pair.score;
    if (best && total <= best.score) continue;
    const teamCost = round1(cost + pair.cost);
    best = { drivers: combo.map((d) => d.id), constructors: pair.ids, boost: top.id, cost: teamCost, score: total };
  }
  return best;
}

/** Scored rounds of the file, oldest first, with the race names by round. */
export function hindsightInputs(file: FantasyRoundsFile, raceNames: Record<number, string>): HindsightRoundInput[] {
  const out: HindsightRoundInput[] = [];
  for (const entry of file.rounds) {
    const scored = entry.assets.filter((a) => a.active && a.price !== null && a.points !== null);
    if (scored.length === 0) continue;
    const assets = scored.map((a) => ({ id: a.id, kind: a.kind, price: a.price as number, score: a.points as number }));
    const raceName = raceNames[entry.round] ?? `Round ${entry.round}`;
    out.push({ round: entry.round, raceName, assets });
  }
  return out;
}

/** Best team without a price limit and within `budget` for every round, oldest first. */
export function hindsightSeason(inputs: HindsightRoundInput[], budget: number, rules: HindsightRules = DEFAULT_HINDSIGHT_RULES): HindsightRound[] {
  const freeRules = { ...rules, budget: Number.POSITIVE_INFINITY };
  const cappedRules = { ...rules, budget };
  const out: HindsightRound[] = [];
  for (const input of inputs) {
    const free = bestTeam(input.assets, freeRules);
    if (!free) continue;
    const capped = bestTeam(input.assets, cappedRules);
    out.push({ round: input.round, raceName: input.raceName, free, capped });
  }
  return out;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

interface PairOption {
  ids: string[];
  cost: number;
  score: number;
  /** Highest scoring option among this one and every cheaper one. */
  bestUpToHere: PairOption;
}

function constructorOptions(assets: HindsightAsset[], rules: HindsightRules): PairOption[] {
  const constructors = assets.filter((a) => a.kind === "constructor");
  const options = combinations(constructors, rules.constructors).map((combo) => {
    const option = { ids: combo.map((c) => c.id), cost: sumBy(combo, (c) => c.price), score: sumBy(combo, (c) => c.score) } as PairOption;
    option.bestUpToHere = option;
    return option;
  });
  options.sort((a, b) => a.cost - b.cost);
  let leader: PairOption | null = null;
  for (const option of options) {
    if (!leader || option.score > leader.score) leader = option;
    option.bestUpToHere = leader;
  }
  return options;
}

function lastIndexWithin(sortedByCost: PairOption[], budget: number): number {
  let lo = 0;
  let hi = sortedByCost.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sortedByCost[mid].cost <= budget + 1e-9) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

function topScorer(drivers: HindsightAsset[]): HindsightAsset {
  let top = drivers[0];
  for (const d of drivers) if (d.score > top.score) top = d;
  return top;
}

function sumBy<T>(items: T[], pick: (item: T) => number): number {
  let total = 0;
  for (const item of items) total += pick(item);
  return total;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
