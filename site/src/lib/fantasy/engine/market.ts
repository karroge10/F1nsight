// Turns fantasy.json into the dense arrays the optimiser works on: asset table, scenario
// columns (one Float32Array per asset), means and the joint covariance of the scenarios.

import { rulesFromContract } from "./rules";
import type { AssetKind, FantasyAsset, FantasyFile, GameRules, HorizonRound } from "./types";

export interface MarketAsset {
  index: number;
  id: string;
  kind: AssetKind;
  name: string;
  constructorId: string;
  teamColor: string;
  price: number;
  /** Price in tenths of a million (exact integer arithmetic for the budget). */
  priceTenths: number;
  expectedPoints: number;
  p10: number;
  p90: number;
  pNegative: number;
  expectedPriceChange: number;
  /** Probability that the price goes up / down after this race. */
  pRise: number;
  pFall: number;
  recentPoints: number[];
  /** Expected share of the weekend points scored after qualifying and the sprint (Final Fix fallback). */
  raceShare: number;
  /** False for inactive assets: they can be kept or sold, but not bought. */
  pickable: boolean;
}

export interface ScenarioSet {
  n: number;
  /** cols[j][i]: points of asset j in world i. */
  cols: Float32Array[];
  /** Scenario mean per asset (the optimiser uses expectedPoints for means, see Market.mean). */
  scenarioMean: Float64Array;
  sd: Float64Array;
  /** Population covariance, cov[j * m + k]. */
  cov: Float64Array;
}

export interface Market {
  season: number;
  round: number;
  raceName: string;
  hasSprint: boolean;
  synthetic: boolean;
  generatedAt: string;
  rules: GameRules;
  assets: MarketAsset[];
  byId: Map<string, number>;
  drivers: number[];
  constructors: number[];
  /** Expected points per asset (from the contract, more precise than the scenario mean). */
  mean: Float64Array;
  base: ScenarioSet;
  scenarioSource: "contract" | "gaussian-fallback";
  /** Grand Prix race points per world (Final Fix), when the file provides them. */
  raceCols: Float32Array[] | null;
  /** Negative scoring items per world (No Negative), when the file provides them. */
  negativeCols: Float32Array[] | null;
  noNegative: { set: ScenarioSet; mean: Float64Array; exact: boolean } | null;
  horizon: HorizonRound[];
  warnings: string[];
}

export interface PrepareOptions {
  rules?: Partial<GameRules>;
  /** Worlds to draw when the file has no scenarios (independent normal fallback). */
  fallbackScenarios?: number;
}

/** Parse fantasy.json into a Market. Cost: about 5 to 15 ms for 2000 worlds and 33 assets. */
export function prepareMarket(file: FantasyFile, options: PrepareOptions = {}): Market {
  const rules = rulesFromContract(file.rules, options.rules);
  const warnings: string[] = [];
  const keep: number[] = [];
  file.assets.forEach((asset, j) => {
    if (asset.price === null || asset.price === undefined || !Number.isFinite(asset.price)) {
      warnings.push(`${asset.id} has no price and is left out`);
      return;
    }
    keep.push(j);
  });
  const assets = keep.map((j, index) => toMarketAsset(file.assets[j], index));
  const byId = new Map<string, number>();
  for (const asset of assets) byId.set(asset.id, asset.index);
  const drivers = assets.filter((a) => a.kind === "driver").map((a) => a.index);
  const constructors = assets.filter((a) => a.kind === "constructor").map((a) => a.index);
  const expected = assets.map((a) => a.expectedPoints);
  const mean = Float64Array.from(expected);

  const scenarios = file.scenarios;
  const hasScenarios = !!scenarios && Array.isArray(scenarios.points) && scenarios.points.length > 0;
  let cols: Float32Array[];
  if (hasScenarios) {
    cols = columnsFrom(scenarios.points, keep);
  } else {
    warnings.push("no joint scenarios in the file: risk figures use independent normal worlds");
    cols = gaussianColumns(assets, options.fallbackScenarios ?? 1000);
  }
  const base = scenarioSet(cols);
  const raceCols = hasScenarios && scenarios.race ? columnsFrom(scenarios.race, keep) : null;
  const negativeCols = hasScenarios && scenarios.negative ? columnsFrom(scenarios.negative, keep) : null;
  return {
    season: file.season,
    round: file.round,
    raceName: file.raceName,
    hasSprint: file.hasSprint,
    synthetic: !!file.synthetic,
    generatedAt: file.generatedAt,
    rules,
    assets,
    byId,
    drivers,
    constructors,
    mean,
    base,
    scenarioSource: hasScenarios ? "contract" : "gaussian-fallback",
    raceCols,
    negativeCols,
    noNegative: null,
    horizon: file.horizon ?? [],
    warnings,
  };
}

/**
 * Scenario set with the No Negative chip applied: every negative scoring category removed.
 * Exact with scenarios.negative; otherwise each world's total is clamped at 0 (a lower bound).
 */
export function noNegativeSet(market: Market): { set: ScenarioSet; mean: Float64Array; exact: boolean } {
  if (market.noNegative) return market.noNegative;
  const exact = market.negativeCols !== null;
  const cols = market.base.cols.map((col, j) => {
    const out = new Float32Array(col.length);
    const negative = market.negativeCols?.[j];
    for (let i = 0; i < col.length; i++) {
      out[i] = negative ? col[i] - Math.min(0, negative[i]) : Math.max(0, col[i]);
    }
    return out;
  });
  const set = scenarioSet(cols);
  const mean = new Float64Array(market.assets.length);
  for (let j = 0; j < mean.length; j++) {
    const lift = set.scenarioMean[j] - market.base.scenarioMean[j];
    mean[j] = market.mean[j] + lift;
  }
  market.noNegative = { set, mean, exact };
  return market.noNegative;
}

/** Expected points per asset for a horizon round (missing ids fall back to this race). */
export function horizonMeans(market: Market, round: HorizonRound): Float64Array {
  const out = new Float64Array(market.assets.length);
  for (const asset of market.assets) {
    const value = round.expectedPoints[asset.id];
    out[asset.index] = typeof value === "number" ? value : market.mean[asset.index];
  }
  return out;
}

/** Expected price change per asset for a horizon round (missing ids: 0). */
export function horizonPriceChanges(market: Market, round: HorizonRound): Float64Array {
  const out = new Float64Array(market.assets.length);
  for (const asset of market.assets) {
    const value = round.expectedPriceChange[asset.id];
    out[asset.index] = typeof value === "number" ? value : 0;
  }
  return out;
}

export function scenarioSet(cols: Float32Array[]): ScenarioSet {
  const m = cols.length;
  const n = m > 0 ? cols[0].length : 0;
  const scenarioMean = new Float64Array(m);
  for (let j = 0; j < m; j++) {
    let total = 0;
    const col = cols[j];
    for (let i = 0; i < n; i++) total += col[i];
    scenarioMean[j] = n > 0 ? total / n : 0;
  }
  const cov = new Float64Array(m * m);
  const centred = cols.map((col, j) => {
    const out = new Float64Array(n);
    const mu = scenarioMean[j];
    for (let i = 0; i < n; i++) out[i] = col[i] - mu;
    return out;
  });
  for (let j = 0; j < m; j++) {
    const a = centred[j];
    for (let k = j; k < m; k++) {
      const b = centred[k];
      let total = 0;
      for (let i = 0; i < n; i++) total += a[i] * b[i];
      const value = n > 0 ? total / n : 0;
      cov[j * m + k] = value;
      cov[k * m + j] = value;
    }
  }
  const sd = new Float64Array(m);
  for (let j = 0; j < m; j++) {
    const variance = Math.max(0, cov[j * m + j]);
    sd[j] = Math.sqrt(variance);
  }
  return { n, cols, scenarioMean, sd, cov };
}

function toMarketAsset(asset: FantasyAsset, index: number): MarketAsset {
  const price = asset.price as number;
  const probs = asset.priceChangeProbs ?? {};
  let pRise = 0;
  let pFall = 0;
  for (const [key, value] of Object.entries(probs)) {
    const step = Number.parseFloat(key);
    if (step > 0) pRise += value;
    if (step < 0) pFall += value;
  }
  const spread = asset.p90 !== undefined && asset.p10 !== undefined ? asset.p90 - asset.p10 : null;
  const qualifying = asset.breakdown?.qualifying;
  const sprint = asset.breakdown?.sprint ?? 0;
  const beforeRace = qualifying !== undefined ? qualifying + sprint : null;
  const share = beforeRace !== null && asset.expectedPoints > 1 ? (asset.expectedPoints - beforeRace) / asset.expectedPoints : 0.7;
  return {
    index,
    id: asset.id,
    kind: asset.kind,
    name: asset.name,
    constructorId: asset.constructorId,
    teamColor: asset.teamColor ?? "#888888",
    price,
    priceTenths: Math.round(price * 10),
    expectedPoints: asset.expectedPoints,
    p10: asset.p10 ?? asset.expectedPoints - (spread ?? 20) / 2,
    p90: asset.p90 ?? asset.expectedPoints + (spread ?? 20) / 2,
    pNegative: asset.pNegative ?? 0,
    expectedPriceChange: asset.expectedPriceChange ?? 0,
    pRise,
    pFall,
    recentPoints: asset.recentPoints ?? [],
    raceShare: share < 0 ? 0 : share > 1 ? 1 : share,
    pickable: asset.active !== false,
  };
}

function columnsFrom(rows: number[][], keep: number[]): Float32Array[] {
  const n = rows.length;
  return keep.map((j) => {
    const col = new Float32Array(n);
    for (let i = 0; i < n; i++) col[i] = rows[i][j] ?? 0;
    return col;
  });
}

function gaussianColumns(assets: MarketAsset[], n: number): Float32Array[] {
  const random = mulberry32(20260407);
  return assets.map((asset) => {
    const sd = Math.max(1, (asset.p90 - asset.p10) / 2.5631);
    const col = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const draw = random();
      const u1 = Math.max(1e-12, draw);
      const u2 = random();
      const radius = -2 * Math.log(u1);
      const angle = Math.cos(2 * Math.PI * u2);
      const z = Math.sqrt(radius) * angle;
      col[i] = asset.expectedPoints + sd * z;
    }
    return col;
  });
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
