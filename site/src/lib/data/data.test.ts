import { describe, expect, it } from "vitest";
import {
  getCalendar,
  getCircuit,
  getConstructor,
  getDriver,
  getEntryList,
  getFantasyMarket,
  getNextRace,
  getNextRacePrediction,
  getPredictionHistory,
  getRace,
  getRecords,
  getSeasons,
  getStandings,
  getTrackOutline,
} from "./index";

const NOW = new Date("2026-10-07T12:00:00Z");

describe("calendar", () => {
  it("marks completed, next and upcoming races relative to now", async () => {
    const calendar = await getCalendar(2026, NOW);
    expect(calendar.length).toBe(23);
    const statuses = calendar.map((r) => r.status);
    expect(statuses.filter((s) => s === "next").length).toBe(1);
    const next = calendar.find((r) => r.status === "next");
    expect(next?.round).toBe(17);
    expect(next?.circuitId).toBe("marina_bay");
    expect(calendar[15].status).toBe("completed");
    expect(calendar[22].status).toBe("upcoming");
  });

  it("exposes session times for the next race", async () => {
    const next = await getNextRace(NOW);
    expect(next?.sessions.race).toBe("2026-10-11T12:00:00Z");
    expect(next?.hasSprint).toBe(true);
    expect(next?.sessions.sprintQualifying).toBeDefined();
  });
});

describe("races and standings", () => {
  it("returns a race with results, qualifying and laps", async () => {
    const race = await getRace(2026, 13, NOW);
    expect(race?.raceName).toBe("Italian Grand Prix");
    expect(race?.results.length).toBe(22);
    expect(race?.results[0].position).toBe(1);
    expect(race?.qualifying.length).toBeGreaterThan(0);
    expect(race?.laps).not.toBeNull();
    expect(Object.keys(race?.laps?.laps ?? {}).length).toBe(22);
  });

  it("returns null for an unknown race", async () => {
    const race = await getRace(2026, 99, NOW);
    expect(race).toBeNull();
  });

  it("standings progression has one value per completed round", async () => {
    const standings = await getStandings(2026);
    expect(standings?.drivers.rounds).toBe(16);
    const leader = standings?.drivers.list[0];
    expect(leader?.pointsByRound.length).toBe(16);
    expect(leader?.points).toBe(leader?.pointsByRound[15]);
    const sorted = [...(standings?.drivers.list ?? [])].every((row, i, arr) => i === 0 || (arr[i - 1].position ?? 0) <= (row.position ?? 0));
    expect(sorted).toBe(true);
  });

  it("history goes back to 1950", async () => {
    const seasons = await getSeasons();
    const first = seasons[seasons.length - 1];
    expect(first.season).toBe(1950);
    expect(first.driverChampion?.driverId).toBe("farina");
    const race = await getRace(1950, 1, NOW);
    expect(race?.results.length).toBeGreaterThan(10);
  });
});

describe("entities", () => {
  it("entry list has 22 drivers and 11 teams for 2026", async () => {
    const entries = await getEntryList(2026);
    expect(entries.drivers.length).toBeGreaterThanOrEqual(22);
    expect(entries.drivers.map((d) => d.driverId)).toContain("lawson");
    expect(entries.constructors.length).toBe(11);
    expect(entries.constructors.map((c) => c.constructorId)).toContain("cadillac");
  });

  it("driver and constructor career aggregates", async () => {
    const hamilton = await getDriver("hamilton");
    expect(hamilton?.career.wins).toBeGreaterThan(100);
    expect(hamilton?.career.titles).toBe(7);
    const ferrari = await getConstructor("ferrari");
    expect(ferrari?.career.firstSeason).toBe(1950);
    expect(ferrari?.color).toMatch(/^#/);
  });

  it("circuit has a lap record and race list", async () => {
    const monza = await getCircuit("monza");
    expect(monza?.raceCount).toBeGreaterThan(70);
    expect(monza?.lapRecord?.timeMs).toBeGreaterThan(60000);
    const outline = await getTrackOutline("monza");
    expect(outline?.outline.length).toBeGreaterThan(100);
  });

  it("records are sorted descending", async () => {
    const records = await getRecords();
    const wins = records.find((g) => g.key === "drivers-wins");
    expect(wins?.entries[0].value).toBeGreaterThanOrEqual(wins?.entries[1].value ?? 0);
  });
});

describe("predictions and fantasy", () => {
  it("prediction follows the SPEC contract and is internally consistent", async () => {
    const prediction = await getNextRacePrediction();
    expect(prediction.race.round).toBe(17);
    expect(prediction.drivers.length).toBe(22);
    for (const driver of prediction.drivers) {
      const sum = driver.positionDist.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 2);
      expect(driver.pWin).toBeCloseTo(driver.positionDist[0], 2);
      expect(driver.pPodium).toBeGreaterThanOrEqual(driver.pWin);
      expect(driver.pPoints).toBeGreaterThanOrEqual(driver.pPodium);
      expect(driver.fantasy.p10).toBeLessThanOrEqual(driver.fantasy.p90);
    }
    const titleSum = prediction.championship.drivers.reduce((a, d) => a + d.pTitle, 0);
    expect(titleSum).toBeCloseTo(1, 2);
    expect(prediction.model.backtest.baseline.name).toBe("grid order");
  });

  it("prediction history has actual results attached", async () => {
    const history = await getPredictionHistory();
    expect(history.length).toBeGreaterThan(0);
    const last = history[history.length - 1];
    expect(last.actual.results.length).toBe(22);
    expect(last.race.round).toBe(16);
  });

  it("fantasy market has prices inside the rule bounds", async () => {
    const market = await getFantasyMarket();
    expect(market.rules.budget).toBe(100);
    for (const asset of [...market.drivers, ...market.constructors]) {
      expect(asset.price).toBeGreaterThanOrEqual(market.rules.floor);
      expect(asset.price).toBeLessThanOrEqual(market.rules.ceiling);
    }
  });
});
