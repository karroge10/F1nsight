import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import history from "./__fixtures__/history.json";
import {
  predictionForecaster,
  priceMap,
  runBacktest,
  seasonRules,
  type HistoryFile,
  type HistoryRow,
  type PredictionHistory,
  type SeasonBacktest,
} from "./backtest";

// Real 2025 and 2026 prices, points and price changes (fantasy_prices / fantasy_points). The
// forecast is the form baseline in backtest.ts; when data/predictions/history holds the model's
// published forecasts for a whole season, that season is also replayed with them.
// Set FANTASY_BACKTEST_LOG=1 to print the tables.

describe("backtest on recorded seasons", () => {
  const report = runBacktest(history as unknown as HistoryFile);

  it("covers 2025 (24 rounds) and 2026 (16 rounds)", () => {
    const rounds = report.seasons.map((s) => s.rounds.length);
    expect(rounds).toEqual([24, 16]);
  });

  for (const season of report.seasons) {
    it(`${season.season}: the engine beats the naive heuristic and holding, and stays below hindsight`, () => {
      const [engine, planned, naive, hold] = season.strategies;
      expect(engine.total).toBeGreaterThan(naive.total);
      expect(engine.total).toBeGreaterThan(hold.total);
      expect(planned.total).toBeGreaterThan(naive.total);
      for (const strategy of season.strategies) expect(strategy.total).toBeLessThanOrEqual(season.hindsight.total);
      logSeason("form baseline", season);
    }, 60000);
  }
});

describe("duplicate asset ids and transfer rules", () => {
  const lawson = (fantasyId: string, active: boolean, price: number): HistoryRow => ({
    round: 12,
    kind: "driver",
    id: "lawson",
    fantasyId,
    name: "Liam Lawson",
    constructorId: active ? "red_bull" : "rb",
    active,
    price,
    priceAfter: price + 0.2,
    points: active ? 12 : 0,
  });

  it("prices the active asset when an id appears twice, whatever the row order", () => {
    const active = lawson("116", true, 14.5);
    const inactive = lawson("114", false, 10.3);
    const before = priceMap([active, inactive], (r) => r.price);
    const after = priceMap([inactive, active], (r) => r.priceAfter ?? r.price);
    expect(before.get("lawson")).toBe(14.5);
    expect(after.get("lawson")).toBeCloseTo(14.7);
  });

  it("gives 2 free transfers every race with no carry-over in every season", () => {
    for (const season of [2024, 2025, 2026]) {
      const rules = seasonRules(season);
      expect(rules.freeTransfersPerRace).toBe(2);
      expect(rules.maxCarryOver).toBe(0);
    }
  });
});

describe("backtest with the model's published forecasts (when available)", () => {
  const files = readPredictionHistory();
  const { forecast, covered } = predictionForecaster(files);
  const fixture = history as unknown as HistoryFile;
  const seasons = [2025, 2026].filter((season) => {
    const rows = fixture.seasons[String(season)] ?? [];
    const scored = rows.filter((r) => r.points !== null).map((r) => r.round);
    const rounds = [...new Set(scored)];
    return rounds.length > 0 && rounds.every((round) => covered(season, round));
  });

  it.skipIf(seasons.length === 0)("replays fully covered seasons with the model forecast", () => {
    const report = runBacktest(fixture, { seasons, forecast, forecastName: "model (post-qualifying)" });
    for (const season of report.seasons) {
      const [engine] = season.strategies;
      expect(engine.total).toBeLessThanOrEqual(season.hindsight.total);
      logSeason("model forecast, post-qualifying, optimistic", season);
    }
  }, 120000);
});

function readPredictionHistory(): PredictionHistory[] {
  const folder = path.resolve(process.cwd(), "../data/predictions/history");
  if (!existsSync(folder)) return [];
  const names = readdirSync(folder).filter((name) => /^(2025|2026)-\d+\.json$/.test(name));
  return names.map((name) => {
    const file = path.join(folder, name);
    const text = readFileSync(file, "utf8");
    return JSON.parse(text) as PredictionHistory;
  });
}

function logSeason(label: string, season: SeasonBacktest): void {
  if (!process.env.FANTASY_BACKTEST_LOG) return;
  const lines = [`${season.season} (${label}): ${season.rounds.length} rounds, forecast MAE ${season.forecastMae.toFixed(2)}`];
  for (const s of [...season.strategies, season.hindsight]) {
    const share = (100 * s.total) / season.hindsight.total;
    lines.push(`  ${s.name.padEnd(28)} ${s.total.toFixed(0).padStart(6)}  ${share.toFixed(1)}%  transfers ${s.transfers}  penalties ${s.penalties}`);
  }
  console.log(lines.join("\n"));
}
