import { describe, expect, it } from "vitest";
import { fasterBySample, formatLapTime, parseSessionKey, pickPair, timeDelta, type SessionTelemetry, type TelemetryDriver } from "./telemetry";

describe("telemetry helpers", () => {
  it("parses session keys and rejects anything that could escape the folder", () => {
    expect(parseSessionKey("2026-16-Q")).toEqual({ season: 2026, round: 16, code: "Q" });
    expect(parseSessionKey("2026-16-XX")).toBeNull();
    expect(parseSessionKey("../2026-1-Q")).toBeNull();
    expect(parseSessionKey(undefined)).toBeNull();
  });

  it("ends the running gap at the real lap time difference", () => {
    const a = driver("AAA", 90000, [200, 250, 300, 250, 200]);
    const b = driver("BBB", 90500, [190, 240, 300, 260, 200]);
    const delta = timeDelta(a, b);
    expect(delta[0]).toBe(0);
    expect(delta[delta.length - 1]).toBeCloseTo(0.5, 9);
    expect(fasterBySample(a, b)).toEqual([1, 1, 0, -1, 0]);
  });

  it("falls back to the two fastest drivers and never pairs a driver with itself", () => {
    const session: SessionTelemetry = { season: 2026, round: 1, code: "Q", eventName: "Test", sessionName: "Qualifying", points: 5, drivers: [driver("AAA", 1, [1]), driver("BBB", 2, [1])] };
    expect(pickPair(session).map((d) => d?.code)).toEqual(["AAA", "BBB"]);
    expect(pickPair(session, "BBB", "BBB").map((d) => d?.code)).toEqual(["BBB", "AAA"]);
    expect(formatLapTime(78518)).toBe("1:18.518");
  });
});

function driver(code: string, lapTimeMs: number, speed: number[]): TelemetryDriver {
  const zeros = speed.map(() => 0);
  return { number: "1", code, name: code, team: "T", color: "#fff", lapNumber: 1, lapTimeMs, length: 5000, speed, throttle: zeros, brake: zeros, gear: zeros, x: zeros, y: zeros };
}


describe("telemetry recency", () => {
  it("selects the newest round and latest session without relying on file order", async () => {
    const { newestTelemetrySessions } = await import("./telemetry");
    const entries = [{ season: 2026, round: 17, code: "R" }, { season: 2026, round: 18, code: "Q" }, { season: 2026, round: 18, code: "R" }];
    expect(newestTelemetrySessions(entries as import("./telemetry").TelemetryIndexEntry[]).map((s) => `${s.round}-${s.code}`)).toEqual(["18-R", "18-Q", "17-R"]);
  });
});
