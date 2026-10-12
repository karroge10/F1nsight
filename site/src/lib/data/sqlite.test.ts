import { describe, expect, it } from "vitest";
import * as sqlite from "./sqlite-source";
import * as fixtures from "./fixtures-source";
import fs from "node:fs";

const available = fs.existsSync(sqlite.SQLITE_FILE);

describe.skipIf(!available)("sqlite source matches the fixture shapes", () => {
  it("reads the 2026 season with results and standings", () => {
    const season = sqlite.readSeason(2026);
    expect(season?.races.length).toBe(23);
    const monza = season?.races.find((r) => r.round === 13);
    expect(monza?.results[0].driverId).toBe("antonelli");
    expect(monza?.qualifying.length).toBeGreaterThan(20);
    // The refresh adds rounds during the season, so compare with the races that have results.
    const completed = season?.races.filter((r) => r.results.length > 0).length ?? 0;
    expect(completed).toBeGreaterThanOrEqual(16);
    expect(season?.standings.drivers.rounds).toBe(completed);
    expect(season?.standings.drivers.list[0].pointsByRound.length).toBe(completed);
  });

  it("reads drivers, constructors, circuits and laps", () => {
    const drivers = sqlite.readDrivers();
    const hamilton = drivers.find((d) => d.driverId === "hamilton");
    expect(hamilton?.career.titles).toBe(7);
    expect(hamilton?.wins.length).toBeGreaterThan(100);
    const constructors = sqlite.readConstructors();
    expect(constructors.find((c) => c.constructorId === "mercedes")?.color).toBe("#27F4D2");
    const circuits = sqlite.readCircuits();
    const monza = circuits.find((c) => c.circuitId === "monza");
    expect(monza?.raceCount).toBeGreaterThan(70);
    expect(monza?.races[0].winnerDriverId).toBeTruthy();
    const laps = sqlite.readLaps(2026, 13);
    expect(Object.keys(laps?.laps ?? {}).length).toBe(22);
  });

  it("season summaries cover 1950 to the current season", () => {
    const summaries = sqlite.readSeasonSummaries();
    expect(summaries[0].season).toBe(1950);
    expect(summaries[0].driverChampion?.driverId).toBe("farina");
    const fixtureSummaries = fixtures.readSeasonSummaries();
    expect(summaries.length).toBe(fixtureSummaries.length);
  });
});
