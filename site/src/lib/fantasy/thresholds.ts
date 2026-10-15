// Price change thresholds: how many points an asset needs this gameday for its price to rise
// or to avoid the bigger fall. Uses the 2025/2026 rule ported in engine/priceChange.ts
// (rolling three-gameday points per million, fitted on the official prices, about 99% of
// observed changes reproduced; see data/raw/fantasy/rules_2026.md, "Price changes").
//
// Every active asset moves after every gameday, there is no "hold" band:
//   great (PPM >= 1.20): +0.3 (tier A, price >= 18.5M) or +0.6 (tier B)
//   good  (PPM >= 0.90): +0.1 or +0.2
//   poor  (PPM >  0.60): -0.1 or -0.2
//   terrible:            -0.3 or -0.6
// PPM is the mean of the last three active gamedays (this one included) over the current price.

import { PRICE_STEPS, PRICE_WINDOW, rate, tierOf } from "@/lib/fantasy/engine/priceChange";

export interface PriceThreshold {
  /** Fewest points this gameday for any rise (rating good or better). Below it the price falls. */
  rise: number;
  /** Fewest points for the big rise (rating great). */
  bigRise: number;
  /** Fewest points to avoid the big fall (rating poor or better). */
  avoidBigFall: number;
  tier: "A" | "B";
  steps: { bigRise: number; rise: number; fall: number; bigFall: number };
  /** Earlier active gameday totals in the window, oldest first. */
  window: number[];
}

export interface FantasyRoundAsset {
  id: string;
  /** The game's asset id. A driver who changed seats has two assets with the same `id`. */
  fantasyId: string;
  kind: "driver" | "constructor";
  constructorId: string | null;
  price: number | null;
  points: number | null;
  active: boolean;
  /** Share of teams that picked the asset, in percent (files written before it was added lack it). */
  selectedPct?: number | null;
}

export interface FantasyRoundsFile {
  season: number;
  rounds: { round: number; assets: FantasyRoundAsset[] }[];
}

/** Points thresholds for one asset, given its current price and its earlier active gameday totals (oldest first). */
export function priceThreshold(price: number, previousPoints: number[]): PriceThreshold {
  const window = previousPoints.slice(-(PRICE_WINDOW - 1));
  const tier = tierOf(price);
  const step = PRICE_STEPS[tier];
  return {
    rise: minimumPoints(price, window, 0.9),
    bigRise: minimumPoints(price, window, 1.2),
    avoidBigFall: minimumPoints(price, window, 0.6),
    tier,
    steps: { bigRise: step.great, rise: step.good, fall: step.poor, bigFall: step.terrible },
    window,
  };
}

/** Earlier active, scored gameday totals of a game asset (by fantasyId) before `round`, oldest first. */
export function previousActivePoints(file: FantasyRoundsFile, fantasyId: string, round: number): number[] {
  const points: number[] = [];
  for (const entry of file.rounds) {
    if (entry.round >= round) continue;
    const asset = entry.assets.find((a) => a.fantasyId === fantasyId);
    if (asset && asset.active && asset.points !== null) points.push(asset.points);
  }
  return points;
}

/** Thresholds for every active asset going into `round`, keyed by asset id. */
export function thresholdsForRound(file: FantasyRoundsFile, round: number): Map<string, PriceThreshold> {
  const out = new Map<string, PriceThreshold>();
  const current = file.rounds.find((r) => r.round === round);
  if (!current) return out;
  for (const asset of current.assets) {
    if (!asset.active || asset.price === null) continue;
    const history = previousActivePoints(file, asset.fantasyId, round);
    const threshold = priceThreshold(asset.price, history);
    out.set(asset.id, threshold);
  }
  return out;
}

export interface PriceMoveOdds {
  bigFall: number;
  smallFall: number;
  smallRise: number;
  bigRise: number;
  /** Size of the small and the big step for the asset's tier ($M): 0.1 and 0.3 from $18.5M, else 0.2 and 0.6. */
  small: number;
  big: number;
}

/**
 * The chance of each of the four price moves, from the fantasy file's priceChangeProbs (keys
 * like "+0.3", "-0.1"). A move is big when it is closer to the tier's big step than to its
 * small step, so moves clipped at the price floor or ceiling still land on the right side.
 */
export function priceMoveOdds(price: number, probs: Record<string, number> | undefined): PriceMoveOdds {
  const tier = tierOf(price);
  const steps = PRICE_STEPS[tier];
  const small = steps.good;
  const big = steps.great;
  const odds: PriceMoveOdds = { bigFall: 0, smallFall: 0, smallRise: 0, bigRise: 0, small, big };
  const middle = (small + big) / 2;
  for (const [key, chance] of Object.entries(probs ?? {})) {
    const move = Number(key);
    if (!Number.isFinite(move) || move === 0) continue;
    const isBig = Math.abs(move) >= middle;
    if (move > 0 && isBig) odds.bigRise += chance;
    else if (move > 0) odds.smallRise += chance;
    else if (isBig) odds.bigFall += chance;
    else odds.smallFall += chance;
  }
  return odds;
}

export interface RecentRoundPoints {
  /** The rounds shown, oldest first. */
  rounds: number[];
  /** Points per asset id in those rounds (null when the asset did not score). */
  points: Map<string, (number | null)[]>;
}

/** Points of every asset in the last `count` scored rounds before `round`. */
export function recentRoundPoints(file: FantasyRoundsFile, round: number, count = 2): RecentRoundPoints {
  const scored = file.rounds.filter((r) => r.round < round && r.assets.some((a) => a.points !== null));
  const sorted = [...scored].sort((x, y) => x.round - y.round);
  const recent = sorted.slice(-count);
  const points = new Map<string, (number | null)[]>();
  recent.forEach((entry, i) => {
    for (const asset of entry.assets) {
      if (asset.points === null) continue;
      const row = points.get(asset.id) ?? recent.map(() => null);
      row[i] = (row[i] ?? 0) + asset.points;
      points.set(asset.id, row);
    }
  });
  return { rounds: recent.map((r) => r.round), points };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * Smallest whole number of points that reaches `ppmBoundary` once the game's rounding is
 * applied. Starts from the closed form and walks to the exact integer with the real rating.
 */
function minimumPoints(price: number, window: number[], ppmBoundary: number): number {
  const count = window.length + 1;
  const already = window.reduce((a, b) => a + b, 0);
  const estimate = Math.ceil(ppmBoundary * price * count - already);
  let points = estimate - 3;
  while (!reaches(price, window, points, ppmBoundary)) points += 1;
  return points;
}

function reaches(price: number, window: number[], points: number, ppmBoundary: number): boolean {
  const all = [...window, points];
  const mean = all.reduce((a, b) => a + b, 0) / all.length;
  const rating = rate(mean / price);
  if (ppmBoundary >= 1.2) return rating === "great";
  if (ppmBoundary >= 0.9) return rating === "great" || rating === "good";
  return rating !== "terrible";
}
