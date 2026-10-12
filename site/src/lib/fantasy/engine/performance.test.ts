import { describe, expect, it } from "vitest";

import { randomFantasyFile } from "./__fixtures__/randomMarket";
import { recommend } from "./index";
import { prepareMarket } from "./market";
import { optimiseTeam } from "./optimiser";
import type { ChipId, Objective, UserState } from "./types";

// Full-size market: 22 drivers, 11 constructors, 2000 joint worlds, 3 horizon rounds.
// Times are medians of 5 warm runs. The limits leave room for other test files running in
// parallel; run this file alone with FANTASY_BENCH_LOG=1 for clean numbers.

const file = randomFantasyFile({ seed: 17, teams: 11, scenarios: 2000 });
const team = { drivers: ["d0_1", "d3_0", "d5_1", "d8_0", "d10_0"], constructors: ["team1", "team6"] };
const owned: UserState = { team, bank: 1.2, freeTransfers: 2 };

describe("performance (browser budget: well under 200 ms per single-race search)", () => {
  const market = prepareMarket(file);

  it("prepares the market quickly", () => {
    const ms = median(() => prepareMarket(file));
    log(`prepareMarket ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(200);
  });

  const cases: { name: string; objective: Objective; chip: ChipId | null; limit: number }[] = [
    { name: "expected points", objective: { kind: "expected" }, chip: null, limit: 200 },
    { name: "expected points, x3 Boost", objective: { kind: "expected" }, chip: "extraBoost", limit: 200 },
    { name: "expected points, Autopilot", objective: { kind: "expected" }, chip: "autopilot", limit: 200 },
    { name: "expected points, Limitless", objective: { kind: "expected" }, chip: "limitless", limit: 200 },
    { name: "value objective", objective: { kind: "value" }, chip: null, limit: 200 },
    { name: "mean - 0.5 sd", objective: { kind: "meanStd", lambda: 0.5 }, chip: null, limit: 200 },
  ];
  for (const item of cases) {
    it(`${item.name}: exact top 10 within ${item.limit} ms`, () => {
      let exact = true;
      const ms = median(() => {
        const result = optimiseTeam(market, { ...owned, objective: item.objective }, { chip: item.chip, topN: 10, maxMs: 2000 });
        exact = exact && result.exact;
      });
      log(`${item.name.padEnd(28)} ${ms.toFixed(1)} ms`);
      expect(exact).toBe(true);
      expect(ms).toBeLessThan(item.limit);
    });
  }

  it("quantile objective returns within the time limit (best found, flagged when not proven)", () => {
    const ms = median(() => optimiseTeam(market, { ...owned, objective: { kind: "quantile", q: 0.2 } }, { topN: 10 }));
    log(`quantile 0.2 (150 ms limit)  ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(600);
  });

  it("full recommendation (team, plan, chips, explanations)", () => {
    let timings: Record<string, number> = {};
    const ms = median(() => {
      timings = recommend(market, { ...owned, chipsAvailable: ["limitless", "wildcard", "finalFix", "autopilot", "noNegative", "extraBoost"] }).timings;
    });
    log(`recommend total ${ms.toFixed(1)} ms ${JSON.stringify(roundAll(timings))}`);
    expect(ms).toBeLessThan(2000);
  }, 60000);
});

function median(run: () => void): number {
  run();
  const times: number[] = [];
  for (let k = 0; k < 5; k++) {
    const started = performance.now();
    run();
    times.push(performance.now() - started);
  }
  times.sort((a, b) => a - b);
  return times[2];
}

function roundAll(values: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(values)) out[key] = Math.round(value);
  return out;
}

function log(line: string): void {
  if (process.env.FANTASY_BENCH_LOG) console.log(line);
}
