import { describe, expect, it } from "vitest";

import { randomFantasyFile } from "./__fixtures__/randomMarket";
import { noNegativeSet, prepareMarket, type Market, type ScenarioSet } from "./market";
import { optimiseTeam } from "./optimiser";
import type { ChipId, Objective, UserState } from "./types";

// Brute force reference: every 5-driver set, every constructor pair, every Boost option, scored
// directly on the scenario vectors (an independent code path from the optimiser's bounds).

interface BruteTeam {
  key: string;
  score: number;
}

describe("optimiser: optimal vs brute force on small markets", () => {
  const objectives: Objective[] = [
    { kind: "expected" },
    { kind: "meanStd", lambda: 0.7 },
    { kind: "quantile", q: 0.2 },
    { kind: "quantile", q: 0.8 },
    { kind: "value", pointsPerMillion: 4 },
  ];
  const chips: (ChipId | null)[] = [null, "extraBoost", "autopilot", "noNegative", "limitless", "wildcard"];
  for (const seed of [3, 11]) {
    const file = randomFantasyFile({ seed, teams: 5, scenarios: 300 });
    const market = prepareMarket(file);
    const team = { drivers: ["d0_0", "d2_1", "d3_0", "d4_0", "d4_1"], constructors: ["team3", "team4"] };
    for (const objective of objectives) {
      for (const chip of chips) {
        it(`seed ${seed} ${objective.kind} ${"q" in objective ? objective.q : ""} chip ${chip}`, () => {
          const state: UserState = { team, bank: 2, freeTransfers: 2, objective };
          const result = optimiseTeam(market, state, { chip, topN: 5, maxMs: Number.POSITIVE_INFINITY });
          expect(result.exact).toBe(true);
          const brute = bruteForce(market, state, objective, chip);
          expect(result.best).not.toBeNull();
          expect(result.best?.score).toBeCloseTo(brute[0].score, 6);
          const scores = result.alternatives.map((t) => t.score);
          const expected = brute.slice(0, 5).map((t) => t.score);
          for (let i = 0; i < expected.length; i++) expect(scores[i]).toBeCloseTo(expected[i], 6);
          const keys = new Set(result.alternatives.map((t) => [...t.drivers, ...t.constructors].sort().join(",")));
          expect(keys.size).toBe(result.alternatives.length);
        }, 30000);
      }
    }
  }
});

describe("optimiser: exact transfer count", () => {
  const market = prepareMarket(randomFantasyFile({ seed: 3, teams: 5, scenarios: 300 }));
  const team = { drivers: ["d0_0", "d2_1", "d3_0", "d4_0", "d4_1"], constructors: ["team3", "team4"] };
  const state: UserState = { team, bank: 2, freeTransfers: 2, objective: { kind: "expected" } };
  const every = optimiseTeam(market, state, { topN: 5000, maxMs: Number.POSITIVE_INFINITY });

  for (const count of [0, 1, 2, 3, 4]) {
    it(`returns the top teams with exactly ${count} transfers`, () => {
      const result = optimiseTeam(market, state, { topN: 4, exactTransfers: count, maxMs: Number.POSITIVE_INFINITY });
      const reference = every.alternatives.filter((t) => t.transferCount === count).slice(0, 4);
      expect(result.alternatives.length).toBe(reference.length);
      for (const t of result.alternatives) expect(t.transferCount).toBe(count);
      result.alternatives.forEach((t, i) => expect(t.score).toBeCloseTo(reference[i].score, 6));
    });
  }

  it("ignores the transfer count for a new team", () => {
    const fresh = optimiseTeam(market, { team: null }, { topN: 3, exactTransfers: 1 });
    expect(fresh.alternatives.length).toBe(3);
  });
});

describe("optimiser: constraints", () => {
  const file = randomFantasyFile({ seed: 5, teams: 11, scenarios: 500 });
  const market = prepareMarket(file);
  const team = { drivers: ["d0_0", "d1_0", "d5_0", "d8_0", "d9_1"], constructors: ["team2", "team7"] };

  it("respects composition, budget, locks and bans", () => {
    const state: UserState = { team, bank: 0.5, freeTransfers: 2, locked: ["d9_1", "team7"], banned: ["d0_1", "team0"] };
    const result = optimiseTeam(market, state, { topN: 20 });
    expect(result.alternatives.length).toBe(20);
    for (const t of result.alternatives) {
      expect(t.drivers.length).toBe(5);
      expect(t.constructors.length).toBe(2);
      expect(new Set(t.drivers).size).toBe(5);
      expect(t.cost).toBeLessThanOrEqual(result.budget + 1e-9);
      expect(t.drivers).toContain("d9_1");
      expect(t.constructors).toContain("team7");
      expect(t.drivers).not.toContain("d0_1");
      expect(t.constructors).not.toContain("team0");
    }
  });

  it("forces in a locked asset the user does not own and keeps out the best excluded one", () => {
    const open = optimiseTeam(market, { team: null }, { topN: 1 });
    const bestDriver = open.best?.drivers[0] ?? "";
    const outsider = market.assets.find((a) => a.kind === "driver" && a.pickable && !open.best?.drivers.includes(a.id))?.id ?? "";
    const state: UserState = { team: null, locked: [outsider], banned: [bestDriver] };
    const result = optimiseTeam(market, state, { topN: 5 });
    expect(result.best).not.toBeNull();
    for (const t of result.alternatives) {
      expect(t.drivers).toContain(outsider);
      expect(t.drivers).not.toContain(bestDriver);
    }
  });

  it("charges 10 points per transfer beyond the free ones", () => {
    const state: UserState = { team, bank: 0.5, freeTransfers: 1 };
    const result = optimiseTeam(market, state, { topN: 30 });
    for (const t of result.alternatives) {
      expect(t.penalty).toBe(Math.max(0, t.transferCount - 1) * 10);
      expect(t.score).toBeCloseTo(t.expectedPoints - t.penalty, 6);
    }
    const free = optimiseTeam(market, state, { topN: 30, chip: "wildcard" });
    expect(free.best?.penalty).toBe(0);
    expect(free.best?.score ?? 0).toBeGreaterThanOrEqual(result.best?.score ?? 0);
  });

  it("limitless ignores the cost cap, wildcard keeps it", () => {
    const state: UserState = { team, bank: 0, freeTransfers: 2, chipsAvailable: ["limitless", "wildcard"] };
    const limitless = optimiseTeam(market, state, { chip: "limitless" });
    const wildcard = optimiseTeam(market, state, { chip: "wildcard" });
    expect(wildcard.best?.cost ?? 0).toBeLessThanOrEqual(wildcard.budget + 1e-9);
    expect(limitless.best?.cost ?? 0).toBeGreaterThan(wildcard.budget);
    expect(limitless.best?.score ?? 0).toBeGreaterThan(wildcard.best?.score ?? 0);
  });

  it("new team: no penalty and the default 100M cap", () => {
    const result = optimiseTeam(market, { team: null });
    expect(result.budget).toBe(100);
    expect(result.best?.penalty).toBe(0);
    expect(result.best?.transferCount).toBe(0);
  });

  it("x3 Boost: x3 on the top driver and x2 on the second", () => {
    const result = optimiseTeam(market, { team: null }, { chip: "extraBoost" });
    const best = result.best;
    expect(best?.extraBoost).toBe(best?.drivers[0]);
    expect(best?.boost).toBe(best?.drivers[1]);
    const plain = optimiseTeam(market, { team: null });
    expect(best?.expectedPoints ?? 0).toBeGreaterThan(plain.best?.expectedPoints ?? 0);
  });
});

function bruteForce(market: Market, state: UserState, objective: Objective, chip: ChipId | null): BruteTeam[] {
  const rules = market.rules;
  const owned = new Set([...(state.team?.drivers ?? []), ...(state.team?.constructors ?? [])]);
  let budget = state.bank ?? 0;
  for (const id of owned) budget += market.assets[market.byId.get(id) as number].price;
  const unlimited = chip === "limitless";
  const penaltyFree = chip === "limitless" || chip === "wildcard";
  const nn = chip === "noNegative" ? noNegativeSet(market) : null;
  const set: ScenarioSet = nn?.set ?? market.base;
  const mean = nn?.mean ?? market.mean;
  const out: BruteTeam[] = [];
  const drivers = market.drivers;
  const constructors = market.constructors;
  const ppm = objective.kind === "value" ? (objective.pointsPerMillion ?? 0) : 0;
  for (const set5 of combinations(drivers, 5)) {
    for (const pair of combinations(constructors, 2)) {
      const members = [...set5, ...pair];
      const costTenths = members.reduce((acc, j) => acc + Math.round(market.assets[j].price * 10), 0);
      if (!unlimited && costTenths > Math.round(budget * 10 + 1e-6)) continue;
      const transfers = members.filter((j) => !owned.has(market.assets[j].id)).length;
      const penalty = penaltyFree ? 0 : Math.max(0, transfers - (state.freeTransfers ?? 2)) * rules.extraTransferPenalty;
      let best = Number.NEGATIVE_INFINITY;
      for (const option of boostOptions(set5, chip)) {
        const value = scoreTeam(market, set, mean, members, option, chip, objective, ppm);
        best = Math.max(best, value);
      }
      out.push({ key: members.join(","), score: best - penalty });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

function boostOptions(drivers: number[], chip: ChipId | null): Map<number, number>[] {
  const options: Map<number, number>[] = [];
  if (chip === "autopilot") return [new Map()];
  for (const a of drivers) {
    if (chip !== "extraBoost") {
      options.push(new Map([[a, 2]]));
      continue;
    }
    for (const b of drivers) {
      if (b !== a) {
        options.push(
          new Map([
            [a, 3],
            [b, 2],
          ]),
        );
      }
    }
  }
  return options;
}

function scoreTeam(
  market: Market,
  set: ScenarioSet,
  mean: Float64Array,
  members: number[],
  multipliers: Map<number, number>,
  chip: ChipId | null,
  objective: Objective,
  ppm: number,
): number {
  const n = set.n;
  const vector = new Float64Array(n);
  let expected = 0;
  let scenarioMean = 0;
  for (const j of members) {
    const w = multipliers.get(j) ?? 1;
    expected += w * mean[j];
    scenarioMean += w * set.scenarioMean[j];
    for (let i = 0; i < n; i++) vector[i] += w * set.cols[j][i];
  }
  if (chip === "autopilot") {
    let maxMean = 0;
    for (let i = 0; i < n; i++) {
      let best = Number.NEGATIVE_INFINITY;
      for (const j of members.slice(0, 5)) best = Math.max(best, set.cols[j][i]);
      vector[i] += best;
      maxMean += best / n;
    }
    expected += maxMean;
    scenarioMean += maxMean;
  }
  if (objective.kind === "expected") return expected;
  if (objective.kind === "value") {
    const change = members.reduce((acc, j) => acc + market.assets[j].expectedPriceChange, 0);
    return expected + ppm * change;
  }
  let squares = 0;
  for (let i = 0; i < n; i++) squares += (vector[i] - scenarioMean) * (vector[i] - scenarioMean);
  const sd = Math.sqrt(squares / n);
  if (objective.kind === "meanStd") return expected - objective.lambda * sd;
  const sorted = Array.from(vector).sort((a, b) => a - b);
  const h = (n - 1) * objective.q;
  const lo = Math.floor(h);
  return sorted[lo] + (h - lo) * (sorted[lo + 1] - sorted[lo]);
}

function* combinations(items: number[], k: number, start = 0, prefix: number[] = []): Generator<number[]> {
  if (prefix.length === k) {
    yield [...prefix];
    return;
  }
  for (let i = start; i < items.length; i++) {
    prefix.push(items[i]);
    yield* combinations(items, k, i + 1, prefix);
    prefix.pop();
  }
}
