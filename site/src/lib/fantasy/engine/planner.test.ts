import { describe, expect, it } from "vitest";

import { randomFantasyFile } from "./__fixtures__/randomMarket";
import { explainTransfers } from "./explain";
import { horizonMeans, horizonPriceChanges, prepareMarket, type Market } from "./market";
import { planTransfers } from "./planner";
import { nextFreeTransfers, transferPenalty } from "./rules";
import type { TeamSelection, UserState } from "./types";

describe("planner: rule accounting along the plan", () => {
  const market = prepareMarket(randomFantasyFile({ seed: 8, teams: 11, scenarios: 500 }));
  const team = { drivers: ["d0_1", "d2_0", "d5_1", "d7_0", "d9_0"], constructors: ["team2", "team6"] };
  const state: UserState = { team, bank: 0.8, freeTransfers: 3 };
  const plan = planTransfers(market, state, { rounds: 3 });

  it("plans three races and beats both holding and one race at a time", () => {
    expect(plan.stages).toHaveLength(3);
    expect(plan.score).toBeGreaterThanOrEqual(plan.myopicScore - 1e-9);
    expect(plan.score).toBeGreaterThanOrEqual(plan.holdScore - 1e-9);
  });

  it("counts net transfers, free transfers with carry-over, penalties and the cap", () => {
    let previous: TeamSelection = team;
    let free = 3;
    for (const stage of plan.stages) {
      const before = new Set([...previous.drivers, ...previous.constructors]);
      const lineup = [...stage.drivers, ...stage.constructors];
      const changes = lineup.filter((id) => !before.has(id)).length;
      expect(stage.drivers).toHaveLength(5);
      expect(stage.constructors).toHaveLength(2);
      expect(stage.transferCount).toBe(changes);
      expect(stage.freeTransfers).toBe(free);
      expect(stage.penalty).toBe(transferPenalty(market.rules, changes, free, stage.chip));
      expect(stage.cost).toBeLessThanOrEqual(stage.teamValue + 1e-6);
      expect(stage.bank).toBeGreaterThanOrEqual(-1e-6);
      free = nextFreeTransfers(market.rules, free, changes, stage.chip);
      previous = { drivers: stage.drivers, constructors: stage.constructors };
    }
  });

  it("explains every transfer of the first race with numbers and no em dash", () => {
    const first = plan.stages[0];
    const result = {
      drivers: first.drivers,
      constructors: first.constructors,
      boost: first.boost,
      extraBoost: null,
      chip: null,
      cost: first.cost,
      budget: first.teamValue,
      bankAfter: first.bank,
      score: 0,
      expectedPoints: first.expectedPoints,
      penalty: first.penalty,
      transfersIn: first.transfersIn,
      transfersOut: first.transfersOut,
      transferCount: first.transferCount,
      expectedValueChange: 0,
      stats: { mean: 0, sd: 0, p10: 0, p50: 0, p90: 0, worst10: 0 },
    };
    const explanations = explainTransfers(market, result, { plan });
    expect(explanations.length).toBe(Math.max(first.transfersIn.length, first.transfersOut.length));
    for (const item of explanations) {
      expect(item.text).toMatch(/\d/);
      expect(item.text).not.toMatch(/\u2014/);
    }
  });
});

describe("planner: optimal vs brute force over every team sequence (small market, 2 races)", () => {
  for (const seed of [2, 9]) {
    it(`seed ${seed}`, () => {
      const market = prepareMarket(randomFantasyFile({ seed, teams: 4, scenarios: 200, horizon: 1 }));
      const team = { drivers: ["d0_0", "d1_0", "d2_1", "d3_0", "d3_1"], constructors: ["team0", "team3"] };
      const state: UserState = { team, bank: 1, freeTransfers: 1, objective: { kind: "expected" } };
      const plan = planTransfers(market, state, { rounds: 2, poolPerStage: 1000, futureWeight: 0.8, maxMs: Number.POSITIVE_INFINITY });
      const brute = bruteForcePlan(market, state, team, 0.8);
      expect(plan.score).toBeCloseTo(brute, 6);
    }, 60000);
  }
});

function bruteForcePlan(market: Market, state: UserState, team: TeamSelection, weight: number): number {
  const rules = market.rules;
  const teams = allTeams(market);
  const prices0 = Float64Array.from(market.assets, (a) => a.price);
  const change0 = Float64Array.from(market.assets, (a) => a.expectedPriceChange);
  const prices1 = prices0.map((p, j) => Math.min(rules.priceCeiling, Math.max(rules.priceFloor, p + change0[j])));
  const means1 = horizonMeans(market, market.horizon[0]);
  void horizonPriceChanges;
  const cost = (t: number[], prices: Float64Array) => t.reduce((acc, j) => acc + prices[j], 0);
  const score = (t: number[], means: Float64Array) => {
    let total = 0;
    let top = Number.NEGATIVE_INFINITY;
    for (const j of t) {
      total += means[j];
      if (market.assets[j].kind === "driver") top = Math.max(top, means[j]);
    }
    return total + (rules.boostMultiplier - 1) * top;
  };
  const owned = [...team.drivers, ...team.constructors].map((id) => market.byId.get(id) as number);
  const budget0 = cost(owned, prices0) + (state.bank ?? 0);
  const changes = (from: number[], to: number[]) => to.filter((j) => !from.includes(j)).length;
  let best = Number.NEGATIVE_INFINITY;
  for (const first of teams) {
    const c0 = cost(first, prices0);
    if (c0 > budget0 + 1e-6) continue;
    const t0 = changes(owned, first);
    const p0 = transferPenalty(rules, t0, state.freeTransfers ?? 2, null);
    const free1 = nextFreeTransfers(rules, state.freeTransfers ?? 2, t0, null);
    const bank = budget0 - c0;
    const budget1 = bank + cost(first, prices1);
    const stage0 = score(first, market.mean) - p0;
    for (const second of teams) {
      if (cost(second, prices1) > budget1 + 1e-6) continue;
      const t1 = changes(first, second);
      const p1 = transferPenalty(rules, t1, free1, null);
      const total = stage0 + weight * score(second, means1) - p1;
      if (total > best) best = total;
    }
  }
  return best;
}

function allTeams(market: Market): number[][] {
  const out: number[][] = [];
  const drivers = market.drivers;
  const constructors = market.constructors;
  const pick = (items: number[], k: number, start: number, prefix: number[], sink: number[][]) => {
    if (prefix.length === k) {
      sink.push([...prefix]);
      return;
    }
    for (let i = start; i < items.length; i++) {
      prefix.push(items[i]);
      pick(items, k, i + 1, prefix, sink);
      prefix.pop();
    }
  };
  const driverSets: number[][] = [];
  const pairs: number[][] = [];
  pick(drivers, 5, 0, [], driverSets);
  pick(constructors, 2, 0, [], pairs);
  for (const d of driverSets) for (const p of pairs) out.push([...d, ...p]);
  return out;
}
