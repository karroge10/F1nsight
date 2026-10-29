import { describe, expect, it } from "vitest";
import { mergeSessions, pickDefaultSession, pickSession, type LiveReplaySession } from "./replay-list";

const race: LiveReplaySession = { season: 2026, round: 17, raceName: "Singapore Grand Prix", circuitId: "marina_bay", session: "R", sessionName: "Race", date: "2026-10-11", source: "fixture", country: "Singapore" };

describe("replay selection", () => {
  it("does not silently substitute a race for unavailable qualifying", () => {
    expect(pickSession([race], { season: "2026", round: "17", session: "Q" })).toBeNull();
  });
  it("keeps seasons distinct and replaces duplicate session sources", () => {
    const service = { ...race, source: "service" as const };
    const sessions = mergeSessions([race, { ...race, season: 2025 }], [service, { ...service, session: "Q" }]);
    expect(sessions).toHaveLength(3);
    expect(sessions.find((s) => s.season === 2026 && s.session === "R")?.source).toBe("service");
  });
  it("sorts weekend sessions chronologically and defaults to the race", () => {
    const fp1 = { ...race, session: "FP1", sessionName: "Practice 1" };
    const qualifying = { ...race, session: "Q", sessionName: "Qualifying" };
    const sessions = mergeSessions([race, qualifying, fp1], []);
    expect(sessions.map((s) => s.session)).toEqual(["FP1", "Q", "R"]);
    expect(pickDefaultSession(sessions)?.session).toBe("R");
  });
  it("defaults to the latest available session when the weekend has no race replay", () => {
    const sessions = mergeSessions([
      { ...race, session: "FP1", sessionName: "Practice 1" },
      { ...race, session: "Q", sessionName: "Qualifying" },
    ], []);
    expect(pickDefaultSession(sessions)?.session).toBe("Q");
  });
});
