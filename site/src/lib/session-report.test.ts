import { describe, expect, it } from "vitest";
import type { SessionReport } from "@/lib/data";
import { longRuns, qualifyingGroups, toRaceLaps, toResultRows } from "./session-report";
import { sessionFinished, sessionSpec } from "./sessions";

const base: SessionReport = {
  season: 2026,
  round: 16,
  code: "R",
  sessionName: "Race",
  eventName: "Bahrain Grand Prix",
  drivers: [
    { number: 3, code: "VER", driverId: "max_verstappen", constructorId: "red_bull", name: "Max Verstappen", team: "Red Bull Racing", color: "#4781D7" },
    { number: 12, code: "ANT", driverId: "antonelli", constructorId: "mercedes", name: "Kimi Antonelli", team: "Mercedes", color: "#27F4D2" },
    { number: 77, code: "BOT", driverId: "bottas", constructorId: "cadillac", name: "Valtteri Bottas", team: "Cadillac", color: "#909090" },
  ],
  classification: [
    { driverId: "max_verstappen", position: 1, positionText: "1", grid: 1, timeMs: 6434808, status: "Finished", points: 25, laps: 55, q1Ms: null, q2Ms: null, q3Ms: null, bestLapMs: 98220, bestLapNumber: 55, bestLapCompound: "S" },
    { driverId: "antonelli", position: 2, positionText: "2", grid: 3, timeMs: 2307, status: "Finished", points: 18, laps: 55, q1Ms: null, q2Ms: null, q3Ms: null, bestLapMs: 98900, bestLapNumber: 50, bestLapCompound: "S" },
    { driverId: "bottas", position: 3, positionText: "R", grid: 19, timeMs: null, status: "Retired", points: 0, laps: 7, q1Ms: null, q2Ms: null, q3Ms: null, bestLapMs: 119953, bestLapNumber: 7, bestLapCompound: "S" },
  ],
  laps: {
    max_verstappen: [
      [1, 100000, null, null, null, "S", 1, 1, 4],
      [2, 99000, null, null, null, "S", 2, 1, 0],
      [3, 98500, null, null, null, "S", 3, 1, 0],
      [4, 98400, null, null, null, "S", 4, 1, 0],
      [5, 98300, null, null, null, "S", 5, 1, 0],
      [6, 98220, null, null, null, "S", 6, 1, 8],
      [7, 120000, null, null, null, "S", 7, 1, 2],
    ],
  },
  stints: [],
  pitStops: [{ driverId: "max_verstappen", stop: 1, lap: 7, durationMs: 22000 }],
  sectorBests: [],
  speedTrap: [],
  weather: null,
};

describe("race classification from the session report", () => {
  it("turns the winner's total and the others' gaps into result rows", () => {
    const rows = toResultRows(base);
    expect(rows[0].timeMs).toBe(6434808);
    expect(rows[1].timeMs).toBe(6434808 + 2307);
    expect(rows[1].classified).toBe(true);
    expect(rows[2].classified).toBe(false);
    expect(rows[2].positionText).toBe("R");
    expect(rows[2].status).toBe("Retired");
    expect(rows[0].fastestLapRank).toBe(1);
    expect(rows[1].constructorId).toBe("mercedes");
  });

  it("labels lapped cars by laps down", () => {
    const lapped = { ...base, classification: base.classification.map((r) => (r.driverId === "antonelli" ? { ...r, laps: 54, timeMs: 1360, status: "Lapped" } : r)) };
    const rows = toResultRows(lapped);
    expect(rows[1].timeMs).toBeNull();
    expect(rows[1].status).toBe("+1 lap");
  });

  it("builds the lap chart shape with positions and pit stops", () => {
    const laps = toRaceLaps(base);
    expect(laps?.laps.max_verstappen[0]).toEqual([1, 1, 100000]);
    expect(laps?.pitStops[0].durationMs).toBe(22000);
  });
});

describe("practice long runs", () => {
  it("averages representative laps only (no in or out laps, within 8% of the best)", () => {
    const runs = longRuns(base);
    expect(runs).toHaveLength(1);
    expect(runs[0].laps).toBe(5);
    expect(runs[0].bestMs).toBe(98220);
    expect(runs[0].averageMs).toBe(Math.round((99000 + 98500 + 98400 + 98300 + 98220) / 5));
  });
});

describe("qualifying groups", () => {
  it("splits the field by the last part each driver set a time in", () => {
    const quali: SessionReport = {
      ...base,
      code: "Q",
      classification: [
        { ...base.classification[0], position: 1, positionText: "1", q1Ms: 96000, q2Ms: 95500, q3Ms: 95100 },
        { ...base.classification[1], position: 2, positionText: "2", q1Ms: 96100, q2Ms: 95600, q3Ms: null },
        { ...base.classification[2], position: 3, positionText: "3", q1Ms: 96200, q2Ms: null, q3Ms: null },
      ],
    };
    const groups = qualifyingGroups(quali);
    expect(groups.map((g) => g.stage)).toEqual([3, 2, 1]);
    expect(groups[1].bestMs).toBe(95500);
    expect(groups[2].rows[0].driverId).toBe("bottas");
  });
});

describe("session slugs and timing", () => {
  it("maps keys, codes and slugs to one spec", () => {
    expect(sessionSpec("sprintQualifying")?.code).toBe("SQ");
    expect(sessionSpec("SQ")?.slug).toBe("sq");
    expect(sessionSpec("fp2")?.key).toBe("fp2");
    expect(sessionSpec("nope")).toBeNull();
  });

  it("counts a session as finished after its slot plus the grace", () => {
    const start = "2026-10-02T04:30:00Z";
    expect(sessionFinished("fp1", start, new Date("2026-10-02T05:35:00Z"))).toBe(false);
    expect(sessionFinished("fp1", start, new Date("2026-10-02T05:45:00Z"))).toBe(true);
    expect(sessionFinished("race", "2026-10-04T07:00:00Z", new Date("2026-10-04T09:00:00Z"))).toBe(false);
  });
});
