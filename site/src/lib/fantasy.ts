// Fantasy helpers: merges market data with the forecast and solves the best team.

import type { FantasyMarket, FantasyRules, Prediction, RaceSummary } from "@/lib/data";

export type AssetKind = "driver" | "constructor";

export interface FantasyAssetRow {
  id: string;
  kind: AssetKind;
  code: string;
  name: string;
  team: string;
  constructorId: string;
  teamColor: string;
  price: number;
  previousPrice: number;
  priceDelta: number;
  priceHistory: number[];
  pointsHistory: (number | null)[];
  seasonPoints: number;
  selectedPct: number;
  expectedPoints: number;
  p10: number;
  p90: number;
  expectedPriceChange: number;
  priceChangeProbs: Record<string, number>;
  value: number;
  active: boolean;
}

export interface Lineup {
  key: "points" | "value" | "safe";
  title: string;
  description: string;
  drivers: FantasyAssetRow[];
  constructors: FantasyAssetRow[];
  cost: number;
  expectedPoints: number;
  p10: number;
  p90: number;
}

export function buildFantasyRows(market: FantasyMarket, prediction: Prediction): FantasyAssetRow[] {
  const forecastByDriver = new Map(prediction.drivers.map((d) => [d.driverId, d]));
  const forecastByTeam = new Map(prediction.constructors.map((c) => [c.constructorId, c]));
  const rows: FantasyAssetRow[] = [];
  for (const asset of market.drivers) {
    const forecast = forecastByDriver.get(asset.driverId);
    const expected = forecast?.fantasy.expectedPoints ?? 0;
    rows.push({
      id: asset.driverId,
      kind: "driver",
      code: asset.code,
      name: asset.name,
      team: asset.team,
      constructorId: asset.constructorId,
      teamColor: asset.teamColor,
      price: asset.price,
      previousPrice: asset.previousPrice,
      priceDelta: round1(asset.price - asset.previousPrice),
      priceHistory: asset.priceHistory,
      pointsHistory: asset.pointsHistory,
      seasonPoints: asset.seasonPoints,
      selectedPct: asset.selectedPct,
      expectedPoints: expected,
      p10: forecast?.fantasy.p10 ?? 0,
      p90: forecast?.fantasy.p90 ?? 0,
      expectedPriceChange: forecast?.fantasy.expectedPriceChange ?? 0,
      priceChangeProbs: forecast?.fantasy.priceChangeProbs ?? {},
      value: asset.price > 0 ? round2(expected / asset.price) : 0,
      active: asset.active && Boolean(forecast),
    });
  }
  for (const asset of market.constructors) {
    const forecast = forecastByTeam.get(asset.constructorId);
    const expected = forecast?.fantasy.expectedPoints ?? 0;
    rows.push({
      id: asset.constructorId,
      kind: "constructor",
      code: asset.name.slice(0, 3).toUpperCase(),
      name: asset.name,
      team: asset.name,
      constructorId: asset.constructorId,
      teamColor: asset.teamColor,
      price: asset.price,
      previousPrice: asset.previousPrice,
      priceDelta: round1(asset.price - asset.previousPrice),
      priceHistory: asset.priceHistory,
      pointsHistory: asset.pointsHistory,
      seasonPoints: asset.seasonPoints,
      selectedPct: asset.selectedPct,
      expectedPoints: expected,
      p10: forecast?.fantasy.p10 ?? 0,
      p90: forecast?.fantasy.p90 ?? 0,
      expectedPriceChange: forecast?.fantasy.expectedPriceChange ?? 0,
      priceChangeProbs: forecast?.fantasy.priceChangeProbs ?? {},
      value: asset.price > 0 ? round2(expected / asset.price) : 0,
      active: Boolean(forecast),
    });
  }
  return rows;
}

export function solveLineups(rows: FantasyAssetRow[], rules: FantasyRules): Lineup[] {
  const drivers = rows.filter((r) => r.kind === "driver" && r.active);
  const constructors = rows.filter((r) => r.kind === "constructor" && r.active);
  const byPoints = solve(drivers, constructors, rules, (r) => r.expectedPoints);
  const byValue = solve(drivers, constructors, rules, (r) => r.expectedPoints + 1.5 * r.expectedPriceChange * 10);
  const bySafe = solve(drivers, constructors, rules, (r) => r.p10 * 0.6 + r.expectedPoints * 0.4);
  return [
    toLineup("points", "Highest expected points", "Maximises projected points this gameday, ignoring price moves.", byPoints),
    toLineup("value", "Points plus price growth", "Weights projected price rises, for building team value over the next rounds.", byValue),
    toLineup("safe", "Lowest downside", "Maximises the 10th percentile outcome, for a quiet weekend.", bySafe),
  ];
}

export function bestTeam(drivers: FantasyAssetRow[], constructors: FantasyAssetRow[], rules: FantasyRules, score: (r: FantasyAssetRow) => number) {
  return solve(drivers, constructors, rules, score);
}

/** Team lock of a weekend: the start of sprint qualifying on sprint weekends, of qualifying otherwise. */
export function fantasyDeadline(sessions: RaceSummary["sessions"]): string | null {
  return sessions.sprintQualifying ?? sessions.qualifying ?? null;
}

// ---------------------------------------------------------------------------
// solver: exhaustive over C(n,5) x C(m,2) with budget pruning, fast enough for 23 x 11
// ---------------------------------------------------------------------------

interface Solution {
  drivers: FantasyAssetRow[];
  constructors: FantasyAssetRow[];
  cost: number;
  score: number;
}

function solve(drivers: FantasyAssetRow[], constructors: FantasyAssetRow[], rules: FantasyRules, score: (r: FantasyAssetRow) => number): Solution | null {
  const driverCount = rules.drivers;
  const constructorCount = rules.constructors;
  const budget = rules.budget;
  const constructorCombos = combinations(constructors, constructorCount).map((combo) => ({
    combo,
    cost: sum(combo.map((c) => c.price)),
    score: sum(combo.map(score)),
  }));
  constructorCombos.sort((a, b) => a.cost - b.cost);
  const bestConstructorScoreUnderCost = prefixMax(constructorCombos);
  let best: Solution | null = null;
  const sortedDrivers = [...drivers].sort((a, b) => a.price - b.price);
  const driverCombos = combinations(sortedDrivers, driverCount);
  for (const combo of driverCombos) {
    const cost = sum(combo.map((d) => d.price));
    if (cost > budget) continue;
    const driverScore = sum(combo.map(score));
    const remaining = budget - cost;
    const idx = lastIndexUnderCost(constructorCombos, remaining);
    if (idx < 0) continue;
    const upperBound = driverScore + bestConstructorScoreUnderCost[idx].score;
    if (best && upperBound <= best.score) continue;
    const constructorPick = bestConstructorScoreUnderCost[idx];
    const total = driverScore + constructorPick.score;
    if (!best || total > best.score) {
      best = { drivers: combo, constructors: constructorPick.combo, cost: round1(cost + constructorPick.cost), score: total };
    }
  }
  return best;
}

function toLineup(key: Lineup["key"], title: string, description: string, solution: Solution | null): Lineup {
  if (!solution) {
    return { key, title, description, drivers: [], constructors: [], cost: 0, expectedPoints: 0, p10: 0, p90: 0 };
  }
  const all = [...solution.drivers, ...solution.constructors];
  return {
    key,
    title,
    description,
    drivers: [...solution.drivers].sort((a, b) => b.price - a.price),
    constructors: [...solution.constructors].sort((a, b) => b.price - a.price),
    cost: solution.cost,
    expectedPoints: round1(sum(all.map((r) => r.expectedPoints))),
    p10: round1(sum(all.map((r) => r.p10))),
    p90: round1(sum(all.map((r) => r.p90))),
  };
}

function prefixMax<T extends { score: number; cost: number }>(sortedByCost: T[]): T[] {
  const out: T[] = [];
  let best: T | null = null;
  for (const item of sortedByCost) {
    if (!best || item.score > best.score) best = item;
    out.push(best);
  }
  return out;
}

function lastIndexUnderCost(sortedByCost: { cost: number }[], budget: number): number {
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

export function combinations<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  const pick: T[] = [];
  const walk = (start: number) => {
    if (pick.length === size) {
      out.push([...pick]);
      return;
    }
    for (let i = start; i <= items.length - (size - pick.length); i++) {
      pick.push(items[i]);
      walk(i + 1);
      pick.pop();
    }
  };
  walk(0);
  return out;
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
