// Hindsight best teams: for every scored gameday, the best legal team on the points actually
// scored, once ignoring price and once within a budget at that round's prices.
//
// Rules applied: 5 drivers and 2 constructors and the x2 Boost on the team's top scoring driver
// (with the x3 Boost chip: x3 on the top scorer, x2 on the next). Every round is a fresh team,
// as if every round had unlimited free transfers.
//
// `hindsightPath` plays a season that way. With a budget it starts at the $100M every game season
// starts with, and the Cost Cap moves with the price changes of the team held. It plays the x3
// Boost on its best round and, with a budget, Limitless (no cap for one round) on its best other
// round. Wildcard and Autopilot change nothing when every round is a fresh team.

import { combinations } from "@/lib/fantasy";
import { DEFAULT_COST_CAP } from "./planner-state";
import type { FantasyRoundsFile } from "./thresholds";

export interface HindsightAsset {
  id: string;
  kind: "driver" | "constructor";
  price: number;
  /** What the team is chosen on: the real points of the round. */
  score: number;
  /** Price after the round (the next round's price), when known. */
  priceAfter?: number;
}

export interface HindsightTeam {
  drivers: string[];
  constructors: string[];
  boost: string;
  /** Driver on the x3 Boost chip, null without it. */
  extraBoost: string | null;
  cost: number;
  /** Sum of `score` with the Boost multipliers applied. */
  score: number;
}

export interface HindsightRules {
  drivers: number;
  constructors: number;
  /** Total price limit in millions; Infinity ignores price. */
  budget: number;
  boostMultiplier: number;
  /** x3 Boost chip: the top scorer counts three times and the next one twice. */
  extraBoost?: boolean;
}

/** One scored round, ready for the solver (prices and real points of that round). */
export interface HindsightRoundInput {
  round: number;
  raceName: string;
  raceCode: string;
  country: string | null;
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

/** One round of a hindsight season (`hindsightPath`). */
export interface HindsightPathRound {
  round: number;
  raceName: string;
  raceCode: string;
  country: string | null;
  team: HindsightTeam;
  chip: "extraBoost" | "limitless" | null;
  /** Team value plus bank going into the round ($M); null without a budget. */
  costCap: number | null;
  /** Money not spent on the team ($M); null without a budget or under Limitless. */
  left: number | null;
}

export interface RaceLabel {
  name: string;
  code: string;
  country: string | null;
}

export const DEFAULT_HINDSIGHT_RULES: HindsightRules = { drivers: 5, constructors: 2, budget: DEFAULT_COST_CAP, boostMultiplier: 2 };
/** Every F1 Fantasy season starts with a $100M Cost Cap. */
export const STARTING_COST_CAP = 100;

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
    const [top, second] = topTwo(combo);
    const boostExtra = rules.extraBoost ? top.score + second.score : 0;
    const driverScore = sumBy(combo, (d) => d.score) + extra * top.score + boostExtra;
    const pair = pairs[index].bestUpToHere;
    const total = driverScore + pair.score;
    if (best && total <= best.score) continue;
    const teamCost = round1(cost + pair.cost);
    const boost = rules.extraBoost ? second.id : top.id;
    const extraBoost = rules.extraBoost ? top.id : null;
    best = { drivers: combo.map((d) => d.id), constructors: pair.ids, boost, extraBoost, cost: teamCost, score: total };
  }
  return best;
}

/** Scored rounds of the file, oldest first, with each asset's price after the round. */
export function hindsightInputs(file: FantasyRoundsFile, races: Record<number, RaceLabel>): HindsightRoundInput[] {
  const out: HindsightRoundInput[] = [];
  file.rounds.forEach((entry, k) => {
    const scored = entry.assets.filter((a) => a.active && a.price !== null && a.points !== null);
    if (scored.length === 0) return;
    const nextPrices = pricesOf(file.rounds[k + 1]);
    const assets = scored.map((a) => ({ id: a.id, kind: a.kind, price: a.price as number, score: a.points as number, priceAfter: nextPrices.get(a.id) }));
    const race = races[entry.round];
    out.push({ round: entry.round, raceName: race?.name ?? `Round ${entry.round}`, raceCode: race?.code ?? `R${entry.round}`, country: race?.country ?? null, assets });
  });
  return out;
}

/** A season of fresh best teams, with or without a budget, x3 Boost and Limitless on their best rounds. */
export function hindsightPath(inputs: HindsightRoundInput[], budgeted: boolean, rules: HindsightRules = DEFAULT_HINDSIGHT_RULES): HindsightPathRound[] {
  const noChips: ChipPlan = new Map();
  const plain = playPath(inputs, budgeted, noChips, rules);
  const chips = chooseChips(inputs, plain, budgeted, rules);
  return playPath(inputs, budgeted, chips, rules);
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

type ChipPlan = Map<number, "extraBoost" | "limitless">;

/** Plays the season round by round. The Cost Cap after a round is the money left plus the held
 * team at its new prices; it stays put after Limitless, whose team is handed back. */
function playPath(inputs: HindsightRoundInput[], budgeted: boolean, chips: ChipPlan, rules: HindsightRules): HindsightPathRound[] {
  const out: HindsightPathRound[] = [];
  let cap = STARTING_COST_CAP;
  for (const input of inputs) {
    const chip = chips.get(input.round) ?? null;
    const capped = budgeted && chip !== "limitless";
    const budget = capped ? cap : Number.POSITIVE_INFINITY;
    const team = bestTeam(input.assets, { ...rules, budget, extraBoost: chip === "extraBoost" });
    if (!team) continue;
    const left = capped ? round1(cap - team.cost) : null;
    out.push({ round: input.round, raceName: input.raceName, raceCode: input.raceCode, country: input.country, team, chip, costCap: budgeted ? round1(cap) : null, left });
    if (capped) cap = round1(cap - team.cost + valueAfter(team, input.assets));
  }
  return out;
}

/** x3 Boost and (with a budget) Limitless on the two different rounds where they add most. */
function chooseChips(inputs: HindsightRoundInput[], plain: HindsightPathRound[], budgeted: boolean, rules: HindsightRules): ChipPlan {
  const byRound = new Map(inputs.map((input) => [input.round, input] as const));
  const boostGain: number[] = [];
  const limitlessGain: number[] = [];
  for (const played of plain) {
    const assets = byRound.get(played.round)?.assets ?? [];
    const budget = played.costCap ?? Number.POSITIVE_INFINITY;
    const boosted = bestTeam(assets, { ...rules, budget, extraBoost: true });
    boostGain.push(boosted ? boosted.score - played.team.score : 0);
    const free = budgeted ? bestTeam(assets, { ...rules, budget: Number.POSITIVE_INFINITY }) : null;
    limitlessGain.push(free ? free.score - played.team.score : 0);
  }
  const plan: ChipPlan = new Map();
  let bestTotal = Number.NEGATIVE_INFINITY;
  plain.forEach((boostRound, i) => {
    plain.forEach((limitRound, j) => {
      if (budgeted && i === j) return;
      const total = boostGain[i] + (budgeted ? limitlessGain[j] : 0);
      if (total <= bestTotal) return;
      bestTotal = total;
      plan.clear();
      plan.set(boostRound.round, "extraBoost");
      if (budgeted) plan.set(limitRound.round, "limitless");
    });
  });
  return plan;
}

function valueAfter(team: HindsightTeam, assets: HindsightAsset[]): number {
  const byId = new Map(assets.map((a) => [a.id, a] as const));
  let total = 0;
  for (const id of [...team.drivers, ...team.constructors]) {
    const asset = byId.get(id);
    if (asset) total += asset.priceAfter ?? asset.price;
  }
  return total;
}

function pricesOf(entry: FantasyRoundsFile["rounds"][number] | undefined): Map<string, number> {
  const prices = new Map<string, number>();
  if (!entry) return prices;
  for (const a of entry.assets) if (a.price !== null) prices.set(a.id, a.price);
  return prices;
}

/** The two top scoring drivers, best first. */
function topTwo(drivers: HindsightAsset[]): [HindsightAsset, HindsightAsset] {
  const sorted = [...drivers].sort((a, b) => b.score - a.score);
  return [sorted[0], sorted[1] ?? sorted[0]];
}

function sumBy<T>(items: T[], pick: (item: T) => number): number {
  let total = 0;
  for (const item of items) total += pick(item);
  return total;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
