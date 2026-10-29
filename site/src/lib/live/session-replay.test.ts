import { describe, expect, it } from "vitest";
import type { SessionReport } from "@/lib/data/types";
import type { ReplayPayload } from "./mock-stream";
import { sessionSnapshot, sessionTimeline } from "./session-replay";

const report = {
  code: "Q", lapStarts: { a: [100000, 300000], b: [150000] },
  laps: { a: [[1, 90000, 30000, 30000, 30000, "S", 1, null, 0], [2, 80000, 25000, 25000, 30000, "S", 2, null, 1]], b: [[1, 85000, 25000, 30000, 30000, "M", 1, null, 0]] }, pitStops: [],
} as unknown as SessionReport;
const payload: ReplayPayload = {
  session: { season: 2026, round: 17, code: "Q", name: "Qualifying", start: null, totalLaps: null },
  track: { outline: [[0, 0], [100, 0], [100, 100], [0, 0]], rotation: 0, corners: [], sectors: [] },
  drivers: ["a", "b"].map((id, i) => ({ driverId: id, number: i + 1, code: id, name: id, team: "Team", teamColor: "#fff", grid: null, laps: [], pitLaps: [], retiredAfterLap: null })), report,
};

describe("session lap replay", () => {
  it("preserves real start offsets and garage gaps", () => {
    expect(sessionTimeline(payload)).toEqual({ origin: 100000, end: 280000 });
    const frame = sessionSnapshot(payload, 140000).find((m) => m.type === "frame");
    expect(frame?.type === "frame" && frame.cars).toHaveLength(0);
  });
  it("reveals completed laps only, ranks qualifying by best time and excludes deleted laps", () => {
    const early = sessionSnapshot(payload, 100000).find((m) => m.type === "timing");
    expect(early?.type === "timing" && early.rows[0].number).toBe(1);
    const late = sessionSnapshot(payload, 280000).find((m) => m.type === "timing");
    if (late?.type !== "timing") throw new Error("Missing timing");
    expect(late.rows.map((r) => r.number)).toEqual([2, 1]);
    expect(late.rows[1].bestLap.value).toBe("1:30.000");
    expect(late.rows[1].gap).toBe("+5.000");
    expect(late.rows[1].tyre).toBe("SOFT");
    expect(late.rows[0].tyre).toBe("MEDIUM");
  });
});
