import { describe, expect, it } from "vitest";

import data from "@/lib/data/fixtures/fantasy/backtest.json";
import { chipLabel, hindsightShare, signed, type FantasyBacktest } from "./backtest-data";

const backtest = data as unknown as FantasyBacktest;

describe("published fantasy backtest", () => {
  it("covers 2024, 2025 and 2026 with one fixed method", () => {
    const seasons = backtest.seasons.map((s) => s.season);
    expect(seasons).toEqual([2024, 2025, 2026]);
    expect(backtest.method).toBeTruthy();
  });

  for (const season of backtest.seasons) {
    it(`${season.season}: rounds add up, picks are complete, the total stays below hindsight`, () => {
      const last = season.rounds[season.rounds.length - 1];
      const sum = season.rounds.reduce((total, r) => total + r.points, 0);
      expect(Math.abs(last.cumulative - season.total)).toBeLessThanOrEqual(1);
      expect(Math.abs(sum - season.total)).toBeLessThanOrEqual(2);
      expect(season.total).toBeLessThan(season.hindsight);
      for (const r of season.rounds) {
        expect(r.drivers).toHaveLength(5);
        expect(r.constructors).toHaveLength(2);
        expect(r.raceCode).toMatch(/^[A-Z]{2,3}$/);
      }
    });
  }
});

describe("backtest helpers", () => {
  it("formats shares, signed deltas and chip names", () => {
    const season = { ...backtest.seasons[0], total: 500, hindsight: 1000 };
    expect(hindsightShare(season)).toBe(50);
    expect(signed(12.4)).toBe("+12");
    expect(signed(-3)).toBe("-3");
    expect(signed(0)).toBe("0");
    expect(chipLabel("extraBoost")).toBe("x3 Boost");
    expect(chipLabel(null)).toBeNull();
  });
});
