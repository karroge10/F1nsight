import { describe, expect, it } from "vitest";
import { getAvailableTracks, getCalendar, getRaceLapsAvailability, getTrackOutline } from "@/lib/data";
import { replayableSessions } from "./replay-sessions";

describe("fixture replay coverage", () => {
  it("includes every race with local lap data and a real outline", async () => {
    const sessions = await replayableSessions();
    const raceKeys = new Set(sessions.filter(session => session.session === "R").map(session => `${session.season}-${session.round}`));
    const trackIds = await getAvailableTracks();
    const laps = await getRaceLapsAvailability();
    for (const season of new Set(laps.map(ref => ref.season))) {
      for (const race of await getCalendar(season)) {
        if (trackIds.includes(race.circuitId) && laps.some(ref => ref.season === season && ref.round === race.round)) expect(raceKeys.has(`${season}-${race.round}`)).toBe(true);
      }
    }
    expect(sessions.some((session) => session.season === 2024 && session.circuitId === "albert_park")).toBe(true);
    expect(sessions.some((session) => session.season === 2025 && session.circuitId === "suzuka")).toBe(true);

    expect(trackIds.length).toBeGreaterThanOrEqual(33);
    for (const circuitId of trackIds) {
      const track = await getTrackOutline(circuitId);
      expect(track?.outline.length).toBeGreaterThan(10);
      expect(track?.source).toMatch(/FastF1 telemetry|multiviewer/i);
    }
  });
});
