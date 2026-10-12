import { describe, expect, it } from "vitest";
import type { PitStop, PredictionHistoryEntry, ResultRow } from "@/lib/data";
import { analyseRace, formatPlaces } from "./race-analysis";

const row = (driverId: string, grid: number, position: number | null, extra: Partial<ResultRow> = {}): ResultRow => ({
  position,
  positionText: position === null ? "R" : String(position),
  driverId,
  constructorId: "team",
  number: null,
  grid,
  laps: 50,
  status: position === null ? "Retired" : "Finished",
  classified: position !== null,
  points: 0,
  timeMs: null,
  fastestLapRank: null,
  ...extra,
});

const results = [row("a", 3, 1, { fastestLapRank: 1 }), row("b", 1, 2), row("c", 10, 3), row("d", 2, null)];
const stops: PitStop[] = [
  { driverId: "a", stop: 1, lap: 20, durationMs: 23000, localTime: null },
  { driverId: "b", stop: 1, lap: 21, durationMs: 21500, localTime: null },
  { driverId: "b", stop: 2, lap: 30, durationMs: 900000, localTime: null },
];
const forecast = {
  race: { stage: "post-qualifying" },
  drivers: [
    { driverId: "a", expectedPosition: 2.2 },
    { driverId: "c", expectedPosition: 9.6 },
  ],
} as unknown as PredictionHistoryEntry;

describe("race analysis", () => {
  it("counts places gained, overtakes, stops and the forecast delta per driver", () => {
    const analysis = analyseRace(results, stops, [{ driverId: "c", count: 7 }, { driverId: "a", count: 2 }], forecast);
    const c = analysis.rows.find((r) => r.driverId === "c");
    expect(c?.gained).toBe(7);
    expect(c?.overtakes).toBe(7);
    expect(c?.vsForecast).toBe(7);
    const b = analysis.rows.find((r) => r.driverId === "b");
    expect(b?.pitStops).toBe(1);
    expect(b?.fastestStopMs).toBe(21500);
    const d = analysis.rows.find((r) => r.driverId === "d");
    expect(d?.gained).toBeNull();
    expect(analysis.overtakesTotal).toBe(9);
    expect(analysis.biggestMover?.driverId).toBe("c");
    expect(analysis.bestVsForecast?.driverId).toBe("c");
    expect(analysis.fastestStop?.driverId).toBe("b");
    expect(analysis.fastestLap?.driverId).toBe("a");
    expect(analysis.dnfs.map((r) => r.driverId)).toEqual(["d"]);
  });

  it("has no forecast pick without a forecast or when nobody beat it", () => {
    const none = analyseRace(results, [], [], null);
    expect(none.bestVsForecast).toBeNull();
    expect(none.overtakesTotal).toBeNull();
    const worse = { ...forecast, drivers: [{ driverId: "a", expectedPosition: 1 }] } as unknown as PredictionHistoryEntry;
    expect(analyseRace(results, [], [], worse).bestVsForecast).toBeNull();
  });

  it("formats signed places", () => {
    expect(formatPlaces(3)).toBe("+3");
    expect(formatPlaces(0)).toBe("0");
    expect(formatPlaces(-2)).toBe("−2");
  });
});
