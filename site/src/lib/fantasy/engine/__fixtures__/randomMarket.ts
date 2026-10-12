// Seeded random fantasy.json files for tests and benchmarks (same shape as the contract).
// Worlds have a shared team factor, so teammates and their constructor are correlated.

import type { FantasyAsset, FantasyFile, HorizonRound } from "../types";

export interface RandomFileOptions {
  seed?: number;
  teams?: number;
  scenarios?: number;
  horizon?: number;
  round?: number;
}

export function randomFantasyFile(options: RandomFileOptions = {}): FantasyFile {
  const random = mulberry32(options.seed ?? 1);
  const teams = options.teams ?? 11;
  const n = options.scenarios ?? 2000;
  const round = options.round ?? 17;
  const assets: FantasyAsset[] = [];
  const strength: number[] = [];
  for (let t = 0; t < teams; t++) {
    const draw = random();
    strength.push(draw * 1.6 - 0.4);
  }
  strength.sort((a, b) => b - a);
  for (let t = 0; t < teams; t++) {
    for (let k = 0; k < 2; k++) {
      const skill = strength[t] + (random() - 0.5) * 0.5;
      const jitter = random() * 4;
      const price = clampPrice(6 + skill * 14 + jitter);
      const driver = asset(`d${t}_${k}`, "driver", `team${t}`, price);
      assets.push(driver);
    }
  }
  for (let t = 0; t < teams; t++) {
    const jitter = random() * 4;
    const price = clampPrice(8 + strength[t] * 18 + jitter);
    const constructorAsset = asset(`team${t}`, "constructor", `team${t}`, price);
    assets.push(constructorAsset);
  }
  const driverCount = teams * 2;
  const points: number[][] = [];
  const negative: number[][] = [];
  const race: number[][] = [];
  for (let i = 0; i < n; i++) {
    const teamShock = strength.map(() => normal(random) * 6);
    const chaos = random() < 0.1;
    const row: number[] = [];
    const neg: number[] = [];
    const raceRow: number[] = [];
    for (let d = 0; d < driverCount; d++) {
      const t = Math.floor(d / 2);
      const base = 8 + strength[t] * 22;
      const dnf = random() < (chaos ? 0.2 : 0.06);
      const noise = normal(random) * 9;
      const lost = Math.min(0, noise * 0.4);
      const value = dnf ? -20 + random() * 6 : base + teamShock[t] + noise;
      const total = round1(value);
      const negativePart = round1(dnf ? -20 : lost);
      const racePart = round1(value * 0.7);
      row.push(total);
      neg.push(negativePart);
      raceRow.push(racePart);
    }
    for (let t = 0; t < teams; t++) {
      const draw = random();
      const pit = Math.floor(draw * 4) * 5;
      const value = row[2 * t] + row[2 * t + 1] + pit + 3;
      const total = round1(value);
      const negativePart = round1(neg[2 * t] + neg[2 * t + 1]);
      const racePart = round1(raceRow[2 * t] + raceRow[2 * t + 1] + pit);
      row.push(total);
      neg.push(negativePart);
      raceRow.push(racePart);
    }
    points.push(row);
    negative.push(neg);
    race.push(raceRow);
  }
  assets.forEach((a, j) => {
    let total = 0;
    for (let i = 0; i < n; i++) total += points[i][j];
    a.expectedPoints = round2(total / n);
    const draw = random();
    a.expectedPriceChange = round2((draw - 0.45) * 0.8);
    a.priceChangeProbs = { "+0.2": 0.5, "-0.2": 0.5 };
  });
  const horizon: HorizonRound[] = [];
  for (let h = 1; h <= (options.horizon ?? 3); h++) {
    const expectedPoints: Record<string, number> = {};
    const expectedPriceChange: Record<string, number> = {};
    for (const a of assets) {
      const form = random();
      const move = random();
      expectedPoints[a.id] = round2(a.expectedPoints * (0.8 + form * 0.4));
      expectedPriceChange[a.id] = round2((move - 0.45) * 0.6);
    }
    horizon.push({ round: round + h, raceName: `Race ${round + h}`, hasSprint: false, expectedPoints, expectedPriceChange });
  }
  return {
    generatedAt: "2026-10-07T00:00:00Z",
    season: 2026,
    round,
    raceName: "Test Grand Prix",
    hasSprint: false,
    synthetic: true,
    assets,
    scenarios: { n, points, negative, race },
    horizon,
  };
}

function asset(id: string, kind: "driver" | "constructor", constructorId: string, price: number): FantasyAsset {
  return { id, kind, name: id, constructorId, price, expectedPoints: 0 };
}

function clampPrice(value: number): number {
  const bounded = value < 3 ? 3 : value > 34 ? 34 : value;
  return Math.round(bounded * 10) / 10;
}

function normal(random: () => number): number {
  const draw = random();
  const u1 = Math.max(1e-12, draw);
  const u2 = random();
  const radius = -2 * Math.log(u1);
  const angle = Math.cos(2 * Math.PI * u2);
  return Math.sqrt(radius) * angle;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
