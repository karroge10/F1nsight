// F1 Fantasy price change rule (2025 and 2026 game), reverse engineered. Port of
// v2/pipeline/src/f1p/fantasy/price_change.py: after each gameday an asset is rated on
// points per million over its last 3 active gamedays and moves by a fixed step for its tier.

export type PriceRating = "great" | "good" | "poor" | "terrible" | "inactive";

export const PRICE_WINDOW = 3;
export const TIER_SPLIT = 18.5;
export const PRICE_STEPS: Record<"A" | "B", Record<Exclude<PriceRating, "inactive">, number>> = {
  A: { great: 0.3, good: 0.1, poor: -0.1, terrible: -0.3 },
  B: { great: 0.6, good: 0.2, poor: -0.2, terrible: -0.6 },
};

export interface PriceChange {
  rating: PriceRating;
  ppm: number;
  change: number;
  newPrice: number;
}

/**
 * Price change after a gameday. recentPoints: official totals of the asset's active gamedays,
 * oldest first, ending with the gameday just scored (only the last 3 count).
 */
export function priceChange(price: number, recentPoints: number[], season = 2026, active = true): PriceChange {
  if (season < 2025) throw new Error("price changes before 2025 depended on transfers; not modelled");
  if (!active || recentPoints.length === 0) return { rating: "inactive", ppm: 0, change: 0, newPrice: price };
  const ppm = pointsPerMillion(price, recentPoints);
  const rating = rate(ppm);
  const tier = tierOf(price);
  const step = PRICE_STEPS[tier][rating];
  const floor = priceFloor(season);
  const ceiling = priceCeiling(season);
  const raised = Math.max(price + step, floor);
  const capped = Math.min(raised, ceiling);
  const newPrice = round1(capped);
  const change = round1(newPrice - price);
  return { rating, ppm, change, newPrice };
}

/**
 * Minimum points in the next gameday for each rating, given the earlier window (oldest first).
 * Below the 'poor' value the rating is 'terrible'.
 */
export function pointsNeededForRating(price: number, previousPoints: number[]): Record<"great" | "good" | "poor", number> {
  const window = previousPoints.slice(-(PRICE_WINDOW - 1));
  const count = window.length + 1;
  const already = window.reduce((a, b) => a + b, 0);
  return {
    great: 1.2 * price * count - already,
    good: 0.9 * price * count - already,
    poor: 0.6 * price * count - already,
  };
}

export function pointsPerMillion(price: number, recentPoints: number[]): number {
  const window = recentPoints.slice(-PRICE_WINDOW);
  const mean = window.reduce((a, b) => a + b, 0) / window.length;
  return mean / price;
}

/** Boundaries fitted on 2025/2026: PPM rounded to 2 decimals, 1.20 is great, 0.60 terrible. */
export function rate(ppm: number): Exclude<PriceRating, "inactive"> {
  const rounded = roundHalfEven(ppm + 1e-9, 2);
  if (rounded >= 1.2) return "great";
  if (rounded >= 0.9) return "good";
  if (rounded > 0.6) return "poor";
  return "terrible";
}

export function tierOf(price: number): "A" | "B" {
  return price >= TIER_SPLIT ? "A" : "B";
}

export function priceFloor(season: number): number {
  return season >= 2026 ? 3.0 : 4.5;
}

export function priceCeiling(season: number): number {
  return season >= 2026 ? 34.0 : Number.POSITIVE_INFINITY;
}

function round1(value: number): number {
  return roundHalfEven(value, 1);
}

/** Python's round(): half to even on the binary value. */
function roundHalfEven(value: number, digits: number): number {
  const factor = 10 ** digits;
  const scaled = value * factor;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  let result = floor;
  if (diff > 0.5 + 1e-12) result = floor + 1;
  else if (Math.abs(diff - 0.5) <= 1e-12) result = floor % 2 === 0 ? floor : floor + 1;
  return result / factor;
}
