import { describe, expect, it } from "vitest";

import { randomFantasyFile } from "./__fixtures__/randomMarket";
import { plannerBoard } from "./board";
import { prepareMarket } from "./market";
import type { UserState } from "./types";

describe("planner board", () => {
  const market = prepareMarket(randomFantasyFile({ seed: 8, teams: 11, scenarios: 500 }));
  const team = { drivers: ["d0_1", "d2_0", "d5_1", "d7_0", "d9_0"], constructors: ["team2", "team6"] };
  const state: UserState = { team, bank: 0.8, freeTransfers: 2 };
  const draft = { drivers: ["d0_1", "d2_0", "d5_1", "d7_0", "d9_1"], constructors: ["team2", "team6"] };
  const board = plannerBoard(market, state, { topN: 12, draft, maxMs: Number.POSITIVE_INFINITY });

  it("ranks the best lineups from the saved team", () => {
    expect(board.best).toHaveLength(12);
    for (let i = 1; i < board.best.length; i++) expect(board.best[i].score).toBeLessThanOrEqual(board.best[i - 1].score + 1e-9);
  });

  it("gives the best lineup for each transfer count, keep first", () => {
    expect(board.byTransfers).toHaveLength(4);
    board.byTransfers.forEach((result, count) => expect(result?.transferCount).toBe(count));
    const kept = board.byTransfers[0];
    expect([...(kept?.drivers ?? [])].sort()).toEqual([...team.drivers].sort());
    const bestScore = Math.max(...board.byTransfers.map((r) => r?.score ?? Number.NEGATIVE_INFINITY));
    expect(board.best[0].score).toBeGreaterThanOrEqual(bestScore - 1e-9);
  });

  it("plans the next races starting from the draft", () => {
    const first = board.plan?.stages[0];
    expect([...(first?.drivers ?? [])].sort()).toEqual([...draft.drivers].sort());
    expect(first?.transferCount).toBe(0);
  });

  it("has no transfer options for a new team", () => {
    const fresh = plannerBoard(market, { team: null }, { topN: 3 });
    expect(fresh.byTransfers).toEqual([]);
    expect(fresh.plan).toBeNull();
  });
});
