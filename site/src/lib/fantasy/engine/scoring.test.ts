import { describe, expect, it } from "vitest";

import history from "./__fixtures__/history.json";
import parity from "./__fixtures__/scoring_parity.json";
import { priceChange } from "./priceChange";
import { scoreConstructor, scoreDriver, scoringRulesFor, type DriverWeekend } from "./scoring";

// Fixtures come from real recorded weekends (pipeline/scripts/export_fantasy_engine_fixtures.py):
// 2026 rounds 1 to 16 with the official overtakes, Driver of the Day and pit stop points, and
// 2025 driver weekends with Wayback-derived inputs. "python" is f1p.fantasy.scoring's output.

interface ParityPoints {
  qualifying: number;
  sprint: number;
  race: number;
  total: number;
  breakdown: Record<string, number>;
}

interface ParityCase {
  season: number;
  round: number;
  kind: "driver" | "constructor";
  id: string;
  weekend?: DriverWeekend;
  drivers?: DriverWeekend[];
  fieldSize?: number;
  officialPitPoints?: number;
  python: ParityPoints;
  officialTotal: number;
}

const cases = (parity as unknown as { cases: ParityCase[] }).cases;

describe("scoring: parity with the Python reference on real weekends", () => {
  it("has fixtures for 2025 and 2026, drivers and constructors", () => {
    expect(cases.filter((c) => c.season === 2026 && c.kind === "driver").length).toBeGreaterThan(300);
    expect(cases.filter((c) => c.season === 2026 && c.kind === "constructor").length).toBeGreaterThan(150);
    expect(cases.filter((c) => c.season === 2025).length).toBeGreaterThan(200);
  });

  it("matches f1p.fantasy.scoring exactly (every session and breakdown item)", () => {
    let checked = 0;
    for (const c of cases) {
      const rules = scoringRulesFor(c.season);
      const points = c.kind === "driver"
        ? scoreDriver(c.weekend as DriverWeekend, rules)
        : scoreConstructor(c.drivers as DriverWeekend[], rules, {}, c.fieldSize);
      const label = `${c.season} r${c.round} ${c.id}`;
      expect(points.qualifying, label).toBe(c.python.qualifying);
      expect(points.sprint, label).toBe(c.python.sprint);
      expect(points.race, label).toBe(c.python.race);
      expect(points.total, label).toBe(c.python.total);
      expect(points.breakdown, label).toEqual(c.python.breakdown);
      checked += 1;
    }
    expect(checked).toBe(cases.length);
  });

  it("reproduces the official 2026 totals (drivers 100%, constructors at least 175 of 176)", () => {
    const rows = cases.filter((c) => c.season === 2026);
    const rules = scoringRulesFor(2026);
    let driverExact = 0;
    let driverCount = 0;
    let teamExact = 0;
    let teamCount = 0;
    for (const c of rows) {
      if (c.kind === "driver") {
        const points = scoreDriver(c.weekend as DriverWeekend, rules);
        driverCount += 1;
        if (points.total === c.officialTotal) driverExact += 1;
      } else {
        const points = scoreConstructor(c.drivers as DriverWeekend[], rules, {}, c.fieldSize);
        teamCount += 1;
        if (points.total + (c.officialPitPoints ?? 0) === c.officialTotal) teamExact += 1;
      }
    }
    expect(driverExact).toBe(driverCount);
    expect(teamCount - teamExact).toBeLessThanOrEqual(1);
  });

  it("reproduces most official 2025 driver totals with the 2025 rule variant", () => {
    const rows = cases.filter((c) => c.season === 2025);
    const rules = scoringRulesFor(2025);
    const exact = rows.filter((c) => scoreDriver(c.weekend as DriverWeekend, rules).total === c.officialTotal).length;
    expect(exact / rows.length).toBeGreaterThan(0.95);
  });

  it("applies the season variants (2025 sprint NC -20, 2024 rank based pit stops)", () => {
    const sprintNc: DriverWeekend = { qualiPosition: 5, sprint: { grid: 5, finish: null, classified: false }, race: null };
    expect(scoreDriver(sprintNc, scoringRulesFor(2026)).sprint).toBe(-10);
    expect(scoreDriver(sprintNc, scoringRulesFor(2025)).sprint).toBe(-20);
    const team = [{ qualiPosition: 1 }, { qualiPosition: 2 }];
    expect(scoreConstructor(team, scoringRulesFor(2024), { pitRankPositions: [1, 3] }).breakdown.pit_rank).toBe(13);
    expect(scoreConstructor(team, scoringRulesFor(2026), { teamFastestPitS: 1.79, raceFastestPitS: 1.79 }).race).toBe(40);
  });
});

describe("price change rule: replay of every recorded 2025 and 2026 change", () => {
  for (const season of [2025, 2026]) {
    it(`${season}: at least 98.5% of changes match`, () => {
      const rows = (history as unknown as { seasons: Record<string, HistoryFixtureRow[]> }).seasons[String(season)];
      const byAsset = new Map<string, HistoryFixtureRow[]>();
      for (const row of rows) {
        const key = `${row.kind}:${row.fantasyId}:${row.name}`;
        const list = byAsset.get(key) ?? [];
        list.push(row);
        byAsset.set(key, list);
      }
      let matched = 0;
      let total = 0;
      for (const list of byAsset.values()) {
        list.sort((a, b) => a.round - b.round);
        const recent: number[] = [];
        for (const row of list) {
          if (row.priceAfter === null) continue;
          if (row.active) recent.push(row.points ?? 0);
          const predicted = priceChange(row.price, recent, season, row.active);
          const actual = Math.round((row.priceAfter - row.price) * 10) / 10;
          total += 1;
          if (Math.abs(predicted.change - actual) < 1e-9) matched += 1;
        }
      }
      expect(total).toBeGreaterThan(500);
      expect(matched / total).toBeGreaterThanOrEqual(0.985);
    });
  }
});

interface HistoryFixtureRow {
  round: number;
  kind: string;
  fantasyId: string;
  name: string;
  active: boolean;
  price: number;
  priceAfter: number | null;
  points: number | null;
}
