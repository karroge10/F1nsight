import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { vi } from "vitest";
import type { FixtureSeason } from "./fixtures-source";
import { mergeOfficialResults } from "./official-results";

const raceSource = "https://www.formula1.com/race-result";
const qualifyingSource = "https://www.formula1.com/qualifying";

function season(results: FixtureSeason["races"][number]["results"] = [], qualifying: FixtureSeason["races"][number]["qualifying"] = []): FixtureSeason {
  return {
    season: 2026,
    races: [{
      season: 2026,
      round: 18,
      raceName: "United States Grand Prix",
      circuitId: "americas",
      circuitName: "Circuit of The Americas",
      locality: "Austin",
      country: "USA",
      countryCode: "USA",
      date: "2026-10-25",
      time: null,
      sessions: {},
      hasSprint: false,
      scheduledLaps: null,
      cancelled: false,
      url: null,
      results,
      sprint: [],
      qualifying,
    }],
    standings: { drivers: { rounds: 0, list: [] }, constructors: { rounds: 0, list: [] } },
  };
}

const official = {
  races: [{
    season: 2026,
    round: 18,
    results: [{
      position: 1,
      positionText: "1",
      driverId: "antonelli",
      constructorId: "mercedes",
      number: 12,
      grid: null,
      laps: 56,
      status: "Finished",
      classified: true,
      points: 25,
      timeMs: 5716650,
      fastestLapRank: null,
    }],
    qualifying: [{ position: 1, driverId: "antonelli", constructorId: "mercedes", number: 12, q1: 95390, q2: 94278, q3: 94035 }],
    sources: { race: raceSource, qualifying: qualifyingSource },
  }],
};

describe("official results fallback", () => {
  it("fills absent race and qualifying data with source links", () => {
    const result = mergeOfficialResults(season(), official);

    expect(result.races[0].results[0].driverId).toBe("antonelli");
    expect(result.races[0].qualifying[0].q3).toBe(94035);
    expect(result.races[0].officialSources).toEqual({ race: raceSource, qualifying: qualifyingSource });
  });

  it("keeps existing base rows and fills only a missing session", () => {
    const existing = [{ ...official.races[0].results[0], grid: 2 }];
    const result = mergeOfficialResults(season(existing), official);

    expect(result.races[0].results[0].grid).toBe(2);
    expect(result.races[0].qualifying).toHaveLength(1);
    expect(result.races[0].officialSources).toEqual({ qualifying: qualifyingSource });
  });

  it("serves the imported Austin rows through the data layer", async ({ skip }) => {
    const dataDir = process.env.F1_DATA_DIR ? path.resolve(process.env.F1_DATA_DIR) : path.resolve(process.cwd(), "../data");
    if (!fs.existsSync(path.join(dataDir, "serve/f1.sqlite")) || !fs.existsSync(path.join(dataDir, "serve/official_results.json"))) skip();
    vi.stubEnv("F1_DATA_SOURCE", "sqlite");
    try {
      const { getCalendar, getRace } = await import("./index");
      const race = await getRace(2026, 18, new Date("2026-10-28T12:00:00Z"));
      const calendarRace = (await getCalendar(2026, new Date("2026-10-28T12:00:00Z"))).find((entry) => entry.round === 18);

      expect(race?.results).toHaveLength(22);
      expect(race?.results[0].driverId).toBe("antonelli");
      expect(race?.results[0].grid).toBeNull();
      expect(race?.qualifying).toHaveLength(22);
      expect(race?.officialSources?.race).toBe("https://www.formula1.com/en/results/2026/races/1297/united-states/race-result");
      expect(calendarRace?.hasResults).toBe(true);
      expect(calendarRace?.officialSources?.qualifying).toBe("https://www.formula1.com/en/results/2026/races/1297/united-states/qualifying");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
