import { describe, expect, it } from "vitest";
import type { PredictionHistoryEntry } from "@/lib/data";
import { buildBacktestRecord, buildPublishedRaceRows, mergePublishedHistory, type FinishedRace, type PublishedForecastReport } from "./model-record";

function historyEntry(season: number, round: number, predictedWinner: string, actualWinner: string): PredictionHistoryEntry {
  const driver = (driverId: string, code: string, pWin: number) => ({
    driverId,
    code,
    name: driverId,
    number: null,
    constructorId: "team",
    team: "Team",
    teamColor: "#000000",
    grid: null,
    expectedPosition: 1,
    positionDist: [pWin],
    pDnf: 0,
    pWin,
    pPodium: pWin,
    pPoints: pWin,
    expectedPoints: 0,
    fantasy: { price: 0, expectedPoints: 0, p10: 0, p90: 0, expectedPriceChange: 0 },
    reasons: [],
  });
  const drivers = [driver(predictedWinner, "PICK", 0.7), driver(actualWinner, "WIN", 0.3)];
  return {
    generatedAt: "2026-01-01T00:00:00Z",
    model: { version: "backtest", trainedAt: "2026-01-01T00:00:00Z", notes: "", backtest: {} as PredictionHistoryEntry["model"]["backtest"] },
    race: { season, round, raceName: `Race ${round}`, circuitId: "track", circuitName: "Track", country: "Country", date: "2026-01-01T00:00:00Z", hasSprint: false, stage: "pre-weekend", inputsUsed: [] },
    drivers,
    constructors: [],
    championship: { drivers: [], constructors: [] },
    actual: { results: [{ driverId: actualWinner, position: 1, positionText: "1", grid: 1, points: 25, status: "Finished", classified: true }] },
  };
}

describe("model record helpers", () => {
  it("sorts verified publication races newest first", () => {
    const report = {
      schemaVersion: 1,
      generatedAt: "2026-01-01T00:00:00Z",
      races: [
        { raceId: 202601, winner: "a", stages: {}, status: "no-published-pre-race-forecast" },
        { raceId: 202602, winner: "b", stages: {}, status: "no-published-pre-race-forecast" },
      ],
    } as PublishedForecastReport;
    expect(buildPublishedRaceRows(report).map((race) => race.raceId)).toEqual([202602, 202601]);
  });

  it("calculates backtest scores and a current correct-call run from newest races", () => {
    const result = buildBacktestRecord([
      historyEntry(2026, 1, "a", "a"),
      historyEntry(2026, 2, "a", "a"),
      historyEntry(2026, 3, "a", "b"),
    ]);
    expect(result.rows.map((row) => row.round)).toEqual([3, 2, 1]);
    expect(result.analytics).toMatchObject({ races: 3, correct: 2, accuracy: 2 / 3, currentCorrectRun: 0 });
    expect(result.rows[0].logLoss).toBeCloseTo(-Math.log(0.3));
    expect(result.rows[0].brier).toBeCloseTo(0.49);
    expect(result.rows[0].order[0]).toMatchObject({ id: "a", winRank: 1, actualPosition: null });
    expect(result.rows[0].order[1]).toMatchObject({ id: "b", actualPosition: 1 });
    expect(result.rows[0]).toMatchObject({ exactPositionHits: 0, exactPositionDenominator: 1, exactPositionAccuracy: 0 });
  });

  it("excludes unclassified drivers even when the source gives them a numeric ordering", () => {
    const entry = historyEntry(2026, 18, "a", "b");
    entry.actual.results.push({ driverId: "a", position: 2, positionText: "NC", grid: 2, points: 0, status: "DNF", classified: false });
    const record = buildBacktestRecord([entry]).rows[0];
    expect(record.exactPositionDenominator).toBe(1);
    expect(record.order.find(driver => driver.id === "a")?.actualPosition).toBeNull();
  });
});

describe("published races in the record", () => {
  it("counts a winner missing from the forecast as a miss with no chance", () => {
    const entry = historyEntry(2026, 5, "a", "b");
    entry.drivers = entry.drivers.filter((driver) => driver.driverId === "a");
    const result = buildBacktestRecord([entry]);
    expect(result.analytics.races).toBe(1);
    expect(result.rows[0]).toMatchObject({ winnerCorrect: false, actualWinner: { id: "b" } });
    expect(result.rows[0].logLoss).toBeCloseTo(-Math.log(1e-15));
  });

  it("adds finished races after the last backtest race from published snapshots only", () => {
    const history = [historyEntry(2026, 19, "a", "a")];
    const finished: FinishedRace[] = [
      { season: 2026, round: 19, time: null, results: history[0].actual.results },
      { season: 2026, round: 99, time: null, results: [{ driverId: "b", position: 1, positionText: "1", grid: 1, points: 25, status: "Finished", classified: true }] },
    ];
    const published = historyEntry(2026, 99, "a", "b");
    const read = (_report: PublishedForecastReport | null, season: number, round: number) => (round === 99 ? { ...published, actual: undefined } : null);
    const merged = mergePublishedHistory(history, null, finished, read);
    expect(merged.map((entry) => entry.race.round)).toEqual([19, 99]);
    expect(merged[1]).toMatchObject({ source: "published", actual: { results: finished[1].results } });
    const record = buildBacktestRecord(merged);
    expect(record.rows[0]).toMatchObject({ round: 99, published: true, winnerCorrect: false });
    expect(mergePublishedHistory(history, null, finished, () => null)).toHaveLength(1);
  });
});
