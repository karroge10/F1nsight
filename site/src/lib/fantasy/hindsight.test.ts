import { describe, expect, it } from "vitest";
import { combinations } from "@/lib/fantasy";
import { bestTeam, DEFAULT_HINDSIGHT_RULES, hindsightInputs, hindsightPath, hindsightSeason, STARTING_COST_CAP, type HindsightAsset } from "./hindsight";
import type { FantasyRoundsFile } from "./thresholds";

const NO_BUDGET = { ...DEFAULT_HINDSIGHT_RULES, budget: Number.POSITIVE_INFINITY };
const CAP_100 = { ...DEFAULT_HINDSIGHT_RULES, budget: 100 };

describe("hindsight solver", () => {
  it("matches a brute force search, Boost and cap included", () => {
    for (const seed of [1, 2, 3, 4]) {
      const assets = randomAssets(seed);
      const best = bestTeam(assets, CAP_100);
      const brute = bruteForce(assets, 100);
      expect(best?.score).toBeCloseTo(brute, 9);
      expect(best?.cost ?? 0).toBeLessThanOrEqual(100 + 1e-9);
    }
  });

  it("ignores price without a budget and matches a brute force search", () => {
    for (const seed of [1, 2, 3, 4]) {
      const assets = randomAssets(seed);
      const best = bestTeam(assets, NO_BUDGET);
      const brute = bruteForce(assets, Number.POSITIVE_INFINITY);
      expect(best?.score).toBeCloseTo(brute, 9);
    }
  });

  it("gives up points when the budget binds", () => {
    for (const seed of [1, 2, 3, 4]) {
      const assets = randomAssets(seed);
      const free = bestTeam(assets, NO_BUDGET);
      const tight = (free?.cost ?? 0) - 10;
      const capped = bestTeam(assets, { ...DEFAULT_HINDSIGHT_RULES, budget: tight });
      const brute = bruteForce(assets, tight);
      expect(capped?.cost ?? 0).toBeLessThanOrEqual(tight + 1e-9);
      expect(capped?.score ?? 0).toBeLessThan(free?.score ?? 0);
      expect(capped?.score).toBeCloseTo(brute, 9);
    }
  });

  it("matches the no-budget team when the budget does not bind", () => {
    for (const seed of [1, 2, 3, 4]) {
      const assets = randomAssets(seed);
      const free = bestTeam(assets, NO_BUDGET);
      const capped = bestTeam(assets, { ...DEFAULT_HINDSIGHT_RULES, budget: (free?.cost ?? 0) + 5 });
      expect(capped?.score).toBe(free?.score);
    }
  });

  it("puts the Boost on the top scoring driver and respects the cap", () => {
    const assets: HindsightAsset[] = [
      { id: "star", kind: "driver", price: 60, score: 50 },
      ...["a", "b", "c", "d", "e"].map((id, i) => ({ id, kind: "driver" as const, price: 5, score: 10 + i })),
      { id: "t1", kind: "constructor", price: 5, score: 20 },
      { id: "t2", kind: "constructor", price: 5, score: 10 },
      { id: "t3", kind: "constructor", price: 40, score: 30 },
    ];
    const best = bestTeam(assets, CAP_100);
    expect(best?.drivers).toContain("star");
    expect(best?.boost).toBe("star");
    expect(best?.constructors.sort()).toEqual(["t1", "t2"]);
    expect(best?.score).toBe(50 * 2 + 14 + 13 + 12 + 11 + 30);
    expect(best?.cost).toBe(90);
  });

  it("returns null when no team fits the budget", () => {
    const assets: HindsightAsset[] = [
      ...["a", "b", "c", "d", "e"].map((id) => ({ id, kind: "driver" as const, price: 30, score: 1 })),
      { id: "t1", kind: "constructor", price: 5, score: 1 },
      { id: "t2", kind: "constructor", price: 5, score: 1 },
    ];
    expect(bestTeam(assets, CAP_100)).toBeNull();
  });

  it("builds one entry per scored round and skips unscored ones", () => {
    const assets = randomAssets(7);
    const rounds: FantasyRoundsFile = {
      season: 2026,
      rounds: [
        { round: 1, assets: assets.map((a) => ({ id: a.id, fantasyId: a.id, kind: a.kind, constructorId: null, price: a.price, points: a.score, active: true })) },
        { round: 2, assets: assets.map((a) => ({ id: a.id, fantasyId: a.id, kind: a.kind, constructorId: null, price: a.price, points: null, active: true })) },
      ],
    };
    const inputs = hindsightInputs(rounds, { 1: { name: "Test GP", code: "TST", country: null } });
    const season = hindsightSeason(inputs, 100);
    expect(season).toHaveLength(1);
    expect(season[0].raceName).toBe("Test GP");
    expect(inputs[0].raceCode).toBe("TST");
    expect(season[0].capped?.cost ?? 0).toBeLessThanOrEqual(100 + 1e-9);
    expect(season[0].capped?.score ?? 0).toBeLessThanOrEqual(season[0].free.score);
  });

  it("scores the x3 Boost as x3 on the top driver and x2 on the next", () => {
    for (const seed of [1, 2, 3]) {
      const assets = randomAssets(seed);
      const best = bestTeam(assets, { ...NO_BUDGET, extraBoost: true });
      const brute = bruteForce(assets, Number.POSITIVE_INFINITY, true);
      expect(best?.score).toBeCloseTo(brute, 9);
      expect(best?.extraBoost).not.toBeNull();
      expect(best?.extraBoost).not.toBe(best?.boost);
    }
  });
});

describe("hindsight season path", () => {
  const inputs = [1, 2, 3, 4].map((round) => {
    const assets = randomAssets(round + 10).map((a, i) => ({ ...a, priceAfter: a.price + (i % 3) * 0.2 }));
    return { round, raceName: `R${round}`, raceCode: `R${round}`, country: null, assets };
  });

  it("starts the budget at $100M and carries the held team's new prices", () => {
    const path = hindsightPath(inputs, true);
    expect(path[0].costCap).toBe(STARTING_COST_CAP);
    for (let k = 1; k < path.length; k++) {
      const previous = path[k - 1];
      if (previous.chip === "limitless") {
        expect(path[k].costCap).toBe(previous.costCap);
        continue;
      }
      const assets = inputs[k - 1].assets;
      const held = [...previous.team.drivers, ...previous.team.constructors];
      const value = held.reduce((sum, id) => sum + (assets.find((a) => a.id === id)?.priceAfter ?? 0), 0);
      expect(path[k].costCap ?? 0).toBeCloseTo((previous.left ?? 0) + value, 1);
    }
  });

  it("plays x3 Boost and Limitless once each on different rounds with a budget", () => {
    const path = hindsightPath(inputs, true);
    const boosts = path.filter((r) => r.chip === "extraBoost");
    const limitless = path.filter((r) => r.chip === "limitless");
    expect(boosts).toHaveLength(1);
    expect(limitless).toHaveLength(1);
    expect(boosts[0].round).not.toBe(limitless[0].round);
    expect(limitless[0].left).toBeNull();
  });

  it("plays only the x3 Boost without a budget", () => {
    const path = hindsightPath(inputs, false);
    expect(path.filter((r) => r.chip === "extraBoost")).toHaveLength(1);
    expect(path.some((r) => r.chip === "limitless")).toBe(false);
    expect(path.every((r) => r.costCap === null)).toBe(true);
  });
});

function randomAssets(seed: number): HindsightAsset[] {
  let state = seed * 9301 + 49297;
  const next = () => {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  };
  const assets: HindsightAsset[] = [];
  for (let i = 0; i < 12; i++) assets.push({ id: `d${i}`, kind: "driver", price: Math.round((4 + next() * 26) * 10) / 10, score: Math.round(next() * 60 - 10) });
  for (let i = 0; i < 6; i++) assets.push({ id: `t${i}`, kind: "constructor", price: Math.round((5 + next() * 25) * 10) / 10, score: Math.round(next() * 80 - 10) });
  return assets;
}

/** Every legal team and every Boost placement; with `extraBoost` one driver x3 and another x2. */
function bruteForce(assets: HindsightAsset[], budget: number, extraBoost = false): number {
  const drivers = assets.filter((a) => a.kind === "driver");
  const constructors = assets.filter((a) => a.kind === "constructor");
  let best = Number.NEGATIVE_INFINITY;
  for (const ds of combinations(drivers, 5)) {
    for (const cs of combinations(constructors, 2)) {
      const all = [...ds, ...cs];
      const cost = all.reduce((s, a) => s + a.price, 0);
      if (cost > budget + 1e-9) continue;
      const base = all.reduce((s, a) => s + a.score, 0);
      for (const boost of ds) {
        if (!extraBoost) {
          best = Math.max(best, base + boost.score);
          continue;
        }
        for (const triple of ds) if (triple !== boost) best = Math.max(best, base + boost.score + 2 * triple.score);
      }
    }
  }
  return best;
}
