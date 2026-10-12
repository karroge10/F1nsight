import { describe, expect, it } from "vitest";

import { randomFantasyFile } from "./__fixtures__/randomMarket";
import { adviseChips, finalFixValue } from "./chips";
import { noNegativeSet, prepareMarket, type Market } from "./market";
import { evaluateTeam, optimiseTeam } from "./optimiser";
import { preparePlan, solvePlan } from "./planner";
import { nextFreeTransfers, RULES_2026, transferPenalty } from "./rules";
import type { FantasyFile, UserState } from "./types";

const file = randomFantasyFile({ seed: 21, teams: 11, scenarios: 800 });
const market = prepareMarket(file);
const team = { drivers: ["d0_0", "d3_1", "d6_0", "d8_0", "d10_1"], constructors: ["team1", "team9"] };
const state: UserState = { team, bank: 1.5, freeTransfers: 2 };
const NO_LIMIT = Number.POSITIVE_INFINITY;

describe("chips: exact effects", () => {
  it("x3 Boost: x3 on one driver, the x2 Boost moves to another", () => {
    const plain = evaluateTeam(market, state, team, { chip: null });
    const tripled = evaluateTeam(market, state, team, { chip: "extraBoost" });
    const means = team.drivers.map((id) => market.mean[market.byId.get(id) as number]).sort((a, b) => b - a);
    expect(tripled?.extraBoost).not.toBeNull();
    expect(tripled?.boost).not.toBe(tripled?.extraBoost);
    expect((tripled?.expectedPoints ?? 0) - (plain?.expectedPoints ?? 0)).toBeCloseTo(means[0] + means[1], 6);
  });

  it("x3 Boost without the regular Boost (assumption off) only adds the top driver once more", () => {
    const strict = prepareMarket(file, { rules: { assumptions: { ...RULES_2026.assumptions, extraBoostKeepsRegularBoost: false } } });
    const plain = evaluateTeam(strict, state, team, { chip: null });
    const tripled = evaluateTeam(strict, state, team, { chip: "extraBoost" });
    const means = team.drivers.map((id) => strict.mean[strict.byId.get(id) as number]).sort((a, b) => b - a);
    expect(tripled?.boost).toBeNull();
    expect((tripled?.expectedPoints ?? 0) - (plain?.expectedPoints ?? 0)).toBeCloseTo(means[0], 6);
  });

  it("Autopilot: the Boost goes to the top scorer in every world", () => {
    const auto = evaluateTeam(market, state, team, { chip: "autopilot" });
    const indices = team.drivers.map((id) => market.byId.get(id) as number);
    let expectedMax = 0;
    for (let i = 0; i < market.base.n; i++) {
      let best = Number.NEGATIVE_INFINITY;
      for (const d of indices) best = Math.max(best, market.base.cols[d][i]);
      expectedMax += best / market.base.n;
    }
    let sum = 0;
    for (const id of [...team.drivers, ...team.constructors]) sum += market.mean[market.byId.get(id) as number];
    expect(auto?.boost).toBeNull();
    expect(auto?.expectedPoints).toBeCloseTo(sum + expectedMax, 6);
    const plain = evaluateTeam(market, state, team, { chip: null });
    expect(auto?.expectedPoints ?? 0).toBeGreaterThanOrEqual(plain?.expectedPoints ?? 0);
  });

  it("No Negative: every negative category is removed (exact with scenarios.negative)", () => {
    const nn = noNegativeSet(market);
    expect(nn.exact).toBe(true);
    for (let j = 0; j < market.assets.length; j++) {
      expect(nn.mean[j]).toBeGreaterThanOrEqual(market.mean[j] - 1e-9);
      const negative = market.negativeCols?.[j] as Float32Array;
      expect(nn.set.cols[j][5]).toBeCloseTo(market.base.cols[j][5] - Math.min(0, negative[5]), 4);
    }
    const plain = evaluateTeam(market, state, team, { chip: null });
    const chip = evaluateTeam(market, state, team, { chip: "noNegative" });
    expect(chip?.expectedPoints ?? 0).toBeGreaterThan(plain?.expectedPoints ?? 0);
  });

  it("No Negative without the negative matrix clamps totals at zero (a lower bound)", () => {
    const bare: FantasyFile = { ...file, scenarios: { n: file.scenarios?.n ?? 0, points: file.scenarios?.points ?? [] } };
    const plainMarket = prepareMarket(bare);
    const nn = noNegativeSet(plainMarket);
    expect(nn.exact).toBe(false);
    for (const col of nn.set.cols) for (const value of col) expect(value).toBeGreaterThanOrEqual(0);
  });

  it("Limitless: no cap, no penalty, and the original team is back next race", () => {
    const capped = optimiseTeam(market, state, { chip: null, maxMs: NO_LIMIT });
    const limitless = optimiseTeam(market, state, { chip: "limitless", maxMs: NO_LIMIT });
    expect(limitless.best?.penalty).toBe(0);
    expect(limitless.best?.cost ?? 0).toBeGreaterThan(capped.budget);
    const prepared = preparePlan(market, state, { rounds: 3 });
    const plan = solvePlan(prepared, { [market.round]: "limitless" });
    const after = plan.stages[1];
    const restored = new Set([...team.drivers, ...team.constructors]);
    const changes = [...after.drivers, ...after.constructors].filter((id) => !restored.has(id)).length;
    expect(after.transferCount).toBe(changes);
    expect(after.freeTransfers).toBe(RULES_2026.freeTransfersPerRace + RULES_2026.assumptions.limitlessCarryOver);
  });

  it("Wildcard: unlimited transfers within the cap, the new team stays", () => {
    const wildcard = optimiseTeam(market, state, { chip: "wildcard", maxMs: NO_LIMIT });
    expect(wildcard.best?.penalty).toBe(0);
    expect(wildcard.best?.cost ?? 0).toBeLessThanOrEqual(wildcard.budget + 1e-9);
    const free = optimiseTeam(market, { team: null, budget: wildcard.budget }, { maxMs: NO_LIMIT });
    expect(wildcard.best?.score).toBeCloseTo(free.best?.score ?? 0, 6);
    expect(transferPenalty(RULES_2026, 7, 2, "wildcard")).toBe(0);
    expect(nextFreeTransfers(RULES_2026, 2, 7, "wildcard")).toBe(2);
  });

  it("Final Fix: worth something when qualifying is informative, the best mean swap when it is not", () => {
    const best = optimiseTeam(market, state, { maxMs: NO_LIMIT }).best;
    expect(best).not.toBeNull();
    if (!best) return;
    const informative = finalFixValue(market, best, best.bankAfter);
    expect(informative).toBeGreaterThan(0);
    const blindRules = { assumptions: { ...RULES_2026.assumptions, finalFixInfoShare: 0 } };
    const blind = { ...prepareMarket(file, { rules: blindRules }), raceCols: null };
    expect(finalFixValue(blind, best, best.bankAfter)).toBeCloseTo(bestMeanSwap(blind, best), 4);
  });
});

describe("transfers and free transfer carry-over", () => {
  it("one unused free transfer carries over, never more than one", () => {
    expect(nextFreeTransfers(RULES_2026, 2, 0, null)).toBe(3);
    expect(nextFreeTransfers(RULES_2026, 2, 1, null)).toBe(3);
    expect(nextFreeTransfers(RULES_2026, 2, 2, null)).toBe(2);
    expect(nextFreeTransfers(RULES_2026, 3, 0, null)).toBe(3);
    expect(nextFreeTransfers(RULES_2026, 3, 5, null)).toBe(2);
    expect(transferPenalty(RULES_2026, 4, 2, null)).toBe(20);
    expect(transferPenalty(RULES_2026, 2, 3, null)).toBe(0);
  });
});

describe("chip advice and schedule", () => {
  it("values every chip, plays at most one now, and never schedules a chip twice", () => {
    const advice = adviseChips(market, { ...state, chipsAvailable: ["limitless", "wildcard", "finalFix", "autopilot", "noNegative", "extraBoost"] });
    expect(advice.advice).toHaveLength(6);
    const playing = advice.advice.filter((a) => a.recommendation === "play");
    expect(playing.length).toBeLessThanOrEqual(1);
    const rounds = advice.schedule.map((s) => s.round);
    expect(new Set(rounds).size).toBe(rounds.length);
    const chips = advice.schedule.map((s) => s.chip);
    expect(new Set(chips).size).toBe(chips.length);
    for (const item of advice.advice) {
      expect(item.reason.length).toBeGreaterThan(10);
      expect(item.reason).not.toMatch(/\u2014/);
    }
  });

  it("chips that unlock after the first race are not played on a brand new team", () => {
    const advice = adviseChips(market, { team: null, teamRacesCompleted: 0 });
    for (const chip of ["limitless", "wildcard", "finalFix"] as const) {
      const item = advice.advice.find((a) => a.chip === chip);
      expect(item?.recommendation).not.toBe("play");
      expect(item?.valueNow).toBe(0);
    }
  });

  it("used chips are reported unavailable", () => {
    const advice = adviseChips(market, { ...state, chipsAvailable: ["autopilot"] });
    expect(advice.advice.filter((a) => a.available).map((a) => a.chip)).toEqual(["autopilot"]);
  });

  it("with as many chips as races left, a chip is played now", () => {
    const late = prepareMarket({ ...file, round: 21 });
    const advice = adviseChips(late, { ...state, chipsAvailable: ["autopilot", "noNegative", "extraBoost"] });
    expect(advice.playNow).not.toBeNull();
  });
});

/** No information: the user makes the single swap with the best mean race gain, if any. */
function bestMeanSwap(source: Market, best: NonNullable<ReturnType<typeof optimiseTeam>["best"]>): number {
  const n = source.base.n;
  const raceMean = (j: number) => {
    const asset = source.assets[j];
    const before = (1 - asset.raceShare) * asset.expectedPoints;
    let total = 0;
    for (const value of source.base.cols[j]) total += value - before;
    return total / n;
  };
  const members = new Set([...best.drivers, ...best.constructors]);
  let top = 0;
  for (const id of members) {
    const out = source.byId.get(id) as number;
    const outAsset = source.assets[out];
    const factor = id === best.boost ? source.rules.boostMultiplier : 1;
    for (const candidate of source.assets) {
      if (candidate.kind !== outAsset.kind || members.has(candidate.id)) continue;
      if (candidate.price > outAsset.price + best.bankAfter + 1e-9) continue;
      const gain = factor * (raceMean(candidate.index) - raceMean(out));
      top = Math.max(top, gain);
    }
  }
  return top;
}

describe("chips: the played chip drives the recommendation", () => {
  const tight: UserState = { team, budget: 100, freeTransfers: 1, chipsAvailable: ["limitless", "wildcard", "extraBoost"], teamRacesCompleted: 5 };

  it("Limitless: no cost cap and no transfer penalty this race", async () => {
    const { recommend } = await import("./index");
    const plain = recommend(market, tight, { topN: 1, planRounds: 1, skipChips: true });
    const limitless = recommend(market, { ...tight, chipsToPlay: ["limitless"] }, { topN: 1, planRounds: 1, skipChips: true });
    expect(limitless.chip).toBe("limitless");
    expect(limitless.recommended?.chip).toBe("limitless");
    expect(limitless.recommended?.penalty).toBe(0);
    expect(limitless.recommended?.expectedPoints ?? 0).toBeGreaterThanOrEqual((plain.recommended?.expectedPoints ?? 0) - 1e-6);
    const free = optimiseTeam(market, { ...tight, team: null }, { budget: NO_LIMIT, chip: null, topN: 1 });
    expect(limitless.recommended?.cost).toBeCloseTo(free.best?.cost ?? 0, 6);
  });

  it("Wildcard: free transfers within the cap; x3 Boost: a tripled driver", async () => {
    const { recommend } = await import("./index");
    const wildcard = recommend(market, { ...tight, chipsToPlay: ["wildcard"] }, { topN: 1, planRounds: 1, skipChips: true });
    expect(wildcard.recommended?.penalty).toBe(0);
    expect(wildcard.recommended?.cost ?? 0).toBeLessThanOrEqual(100 + 1e-9);
    const tripled = recommend(market, { ...tight, chipsToPlay: ["extraBoost"] }, { topN: 1, planRounds: 1, skipChips: true });
    expect(tripled.recommended?.extraBoost).not.toBeNull();
  });

  it("ignores a chip the user no longer has", async () => {
    const { recommend } = await import("./index");
    const rec = recommend(market, { ...tight, chipsAvailable: [], chipsToPlay: ["limitless"] }, { topN: 1, planRounds: 1, skipChips: true });
    expect(rec.chip).toBeNull();
  });
});

describe("chips: later values follow how many points a round is worth", () => {
  it("scales the estimated later value of No Negative with the round's total points (a sprint later is worth more)", () => {
    const sprintLater = randomFantasyFile({ seed: 21, teams: 11, scenarios: 800 });
    const doubled = (sprintLater.horizon ?? []).map((h, k) => (k === 0 ? { ...h, hasSprint: true, expectedPoints: Object.fromEntries(Object.entries(h.expectedPoints).map(([id, v]) => [id, v * 2])) } : h));
    const boosted = prepareMarket({ ...sprintLater, horizon: doubled });
    const s: UserState = { team, bank: 1.5, freeTransfers: 2, chipsAvailable: ["noNegative"], teamRacesCompleted: 5 };
    const base = adviseChips(market, s).advice.find((a) => a.chip === "noNegative")!;
    const more = adviseChips(boosted, s).advice.find((a) => a.chip === "noNegative")!;
    expect(more.valueByRound[0].value).toBeGreaterThan(base.valueByRound[0].value * 1.5);
    expect(base.valueByRound[0].value).not.toBe(base.valueNow);
  });
});

describe("chips: Limitless is not replaced by the multi-race plan", () => {
  it("keeps the uncapped Limitless team for a new team and a full plan window", async () => {
    const { recommend } = await import("./index");
    const base: UserState = { team: null, budget: 100, freeTransfers: 3, chipsAvailable: ["limitless"], teamRacesCompleted: 5 };
    const plain = recommend(market, base, { topN: 1, planRounds: 3, skipChips: true });
    const limitless = recommend(market, { ...base, chipsToPlay: ["limitless"] }, { topN: 1, planRounds: 3, skipChips: true });
    expect(limitless.followsPlan).toBe(false);
    expect(limitless.recommended?.expectedPoints ?? 0).toBeGreaterThan(plain.recommended?.expectedPoints ?? 0);
    expect(limitless.recommended?.cost ?? 0).toBeGreaterThan(100);
  });
});
