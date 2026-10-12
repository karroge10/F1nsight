import { describe, expect, it } from "vitest";
import { getFantasyMarket, getNextRacePrediction } from "./data";
import { buildFantasyRows, combinations, fantasyDeadline, solveLineups } from "./fantasy";

describe("fantasy", () => {
  it("combinations count matches n choose k", () => {
    const combos = combinations([1, 2, 3, 4, 5], 2);
    expect(combos.length).toBe(10);
  });

  it("merges market and forecast into rows with value", async () => {
    const market = await getFantasyMarket();
    const prediction = await getNextRacePrediction();
    const rows = buildFantasyRows(market, prediction);
    const drivers = rows.filter((r) => r.kind === "driver");
    expect(drivers.length).toBe(market.drivers.length);
    const antonelli = rows.find((r) => r.id === "antonelli");
    expect(antonelli?.price).toBe(27);
    expect(antonelli?.value).toBeCloseTo((antonelli?.expectedPoints ?? 0) / 27, 1);
  });

  it("solves lineups within budget and team rules", async () => {
    const market = await getFantasyMarket();
    const prediction = await getNextRacePrediction();
    const rows = buildFantasyRows(market, prediction);
    const lineups = solveLineups(rows, market.rules);
    expect(lineups.length).toBe(3);
    for (const lineup of lineups) {
      expect(lineup.drivers.length).toBe(5);
      expect(lineup.constructors.length).toBe(2);
      expect(lineup.cost).toBeLessThanOrEqual(100);
      const ids = new Set([...lineup.drivers, ...lineup.constructors].map((r) => r.id));
      expect(ids.size).toBe(7);
    }
    const points = lineups.find((l) => l.key === "points");
    const safe = lineups.find((l) => l.key === "safe");
    expect(points?.expectedPoints).toBeGreaterThanOrEqual(safe?.expectedPoints ?? 0);
  });

  it("locks teams at sprint qualifying on sprint weekends, at qualifying otherwise", () => {
    expect(fantasyDeadline({ qualifying: "2026-10-24T21:00:00Z" })).toBe("2026-10-24T21:00:00Z");
    expect(fantasyDeadline({ sprintQualifying: "2026-10-09T12:30:00Z", qualifying: "2026-10-10T13:00:00Z" })).toBe("2026-10-09T12:30:00Z");
    expect(fantasyDeadline({})).toBeNull();
  });
});
