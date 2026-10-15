import { describe, expect, it } from "vitest";
import { priceChange } from "./engine/priceChange";
import { previousActivePoints, priceMoveOdds, priceThreshold, recentRoundPoints, thresholdsForRound, type FantasyRoundsFile } from "./thresholds";

describe("price change thresholds", () => {
  it("matches the hand-computed boundaries for a tier B asset", () => {
    const threshold = priceThreshold(10, [10, 20]);
    expect(threshold.tier).toBe("B");
    expect(threshold.rise).toBe(-3);
    expect(threshold.bigRise).toBe(6);
    expect(threshold.avoidBigFall).toBe(-11);
    expect(threshold.steps).toEqual({ bigRise: 0.6, rise: 0.2, fall: -0.2, bigFall: -0.6 });
  });

  it("uses only the last two earlier gamedays and the tier A steps", () => {
    const threshold = priceThreshold(30, [100, 40, 20]);
    expect(threshold.window).toEqual([40, 20]);
    expect(threshold.tier).toBe("A");
    expect(threshold.steps.rise).toBe(0.1);
  });

  it("agrees with the price rule at and just below every boundary", () => {
    const cases: [number, number[]][] = [
      [10, [10, 20]],
      [27.9, [31, 12]],
      [18.5, []],
      [6.4, [-4]],
      [33.8, [88, 39]],
    ];
    for (const [price, window] of cases) {
      const t = priceThreshold(price, window);
      const atRise = priceChange(price, [...window, t.rise]).change;
      const belowRise = priceChange(price, [...window, t.rise - 1]).change;
      expect(atRise).toBeGreaterThanOrEqual(0);
      expect(belowRise).toBeLessThan(0);
      expect(priceChange(price, [...window, t.bigRise]).rating).toBe("great");
      expect(priceChange(price, [...window, t.bigRise - 1]).rating).not.toBe("great");
      expect(priceChange(price, [...window, t.avoidBigFall]).rating).not.toBe("terrible");
      expect(priceChange(price, [...window, t.avoidBigFall - 1]).rating).toBe("terrible");
    }
  });

  it("skips inactive and unscored gamedays when building the window", () => {
    const file: FantasyRoundsFile = {
      season: 2026,
      rounds: [
        { round: 1, assets: [{ id: "a", fantasyId: "1", kind: "driver", constructorId: "x", price: 10, points: 5, active: true }] },
        { round: 2, assets: [{ id: "a", fantasyId: "1", kind: "driver", constructorId: "x", price: 10, points: 0, active: false }] },
        { round: 3, assets: [{ id: "a", fantasyId: "1", kind: "driver", constructorId: "x", price: 10, points: 12, active: true }] },
        { round: 4, assets: [{ id: "a", fantasyId: "1", kind: "driver", constructorId: "x", price: 10.2, points: null, active: true }] },
      ],
    };
    expect(previousActivePoints(file, "1", 4)).toEqual([5, 12]);
    const map = thresholdsForRound(file, 4);
    expect(map.get("a")?.window).toEqual([5, 12]);
    expect(thresholdsForRound(file, 9).size).toBe(0);
  });
});

describe("price move odds", () => {
  it("splits the probabilities into the four moves of the asset's tier", () => {
    const top = priceMoveOdds(27.5, { "+0.1": 0.08, "+0.3": 0.9, "-0.1": 0.02 });
    expect(top).toEqual({ bigFall: 0, smallFall: 0.02, smallRise: 0.08, bigRise: 0.9, small: 0.1, big: 0.3 });
    const cheap = priceMoveOdds(6.2, { "-0.6": 0.5, "-0.2": 0.3, "+0.2": 0.2 });
    expect(cheap.bigFall).toBe(0.5);
    expect(cheap.smallFall).toBe(0.3);
    expect(cheap.smallRise).toBe(0.2);
    expect(cheap.small).toBe(0.2);
    expect(priceMoveOdds(10, undefined).bigRise).toBe(0);
  });
});

describe("recent round points", () => {
  it("returns the last two scored rounds before the given one", () => {
    const asset = (id: string, points: number | null) => ({ id, fantasyId: id, kind: "driver" as const, constructorId: null, price: 10, points, active: true });
    const file: FantasyRoundsFile = {
      season: 2026,
      rounds: [
        { round: 15, assets: [asset("a", 5)] },
        { round: 16, assets: [asset("a", 7), asset("b", 1)] },
        { round: 17, assets: [asset("a", 9)] },
        { round: 18, assets: [asset("a", null)] },
      ],
    };
    const recent = recentRoundPoints(file, 18);
    expect(recent.rounds).toEqual([16, 17]);
    expect(recent.points.get("a")).toEqual([7, 9]);
    expect(recent.points.get("b")).toEqual([1, null]);
  });
});
