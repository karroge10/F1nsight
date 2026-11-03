import { describe, expect, it } from "vitest";
import { championshipStatus, nextChampionshipBattle } from "./championship";
import { getDriver, getSeasons, getStandings } from "./index";
import type { FixtureSeason } from "./fixtures-source";
import type { SeasonSummary } from "./types";

const summary: SeasonSummary = {
  season: 2027, rounds: 23, completedRounds: 22, inProgress: true,
  driverChampion: { driverId: "leader", points: 100, wins: 3, constructorId: "team" },
  constructorChampion: { constructorId: "team", points: 200, wins: 4 },
};

function season(gap: number, sprint = false): FixtureSeason {
  const row = (id: string, points: number) => ({ id, points, wins: 0, position: null, pointsByRound: [], positionByRound: [] });
  return {
    season: 2027,
    races: Array.from({ length: 23 }, (_, i) => ({ round: i + 1, cancelled: false, hasSprint: i === 22 && sprint })) as FixtureSeason["races"],
    standings: {
      drivers: { rounds: 22, list: [row("leader", 100), row("rival", 100 - gap)] },
      constructors: { rounds: 22, list: [row("team", 200), row("other", 200 - gap)] },
    },
  };
}

describe("confirmed championships", () => {
  it("recognizes Kimi even while source standings and forecasts lag", async () => {
    expect((await getStandings(2026))?.championship.driverId).toBe("antonelli");
    expect((await getSeasons()).find(s => s.season === 2026)?.driverTitleClinched).toBe(true);
    expect((await getDriver("antonelli"))?.career.titles).toBe(1);
  });

  it("does not turn a championship leader into a champion", () => {
    expect(championshipStatus(summary, season(20))).toEqual({ driverId: null, constructorId: null });
  });

  it("requires a strict points lead and accounts for sprint points", () => {
    expect(championshipStatus(summary, season(25)).driverId).toBeNull();
    expect(championshipStatus(summary, season(26)).driverId).toBe("leader");
    expect(championshipStatus(summary, season(26, true)).driverId).toBeNull();
    expect(championshipStatus(summary, season(34, true)).driverId).toBe("leader");
    expect(championshipStatus(summary, season(44)).constructorId).toBe("team");
    expect(championshipStatus(summary, season(44, true)).constructorId).toBeNull();
  });

  it("keeps historical champions and leaves unknown ongoing seasons open", () => {
    expect(championshipStatus({ ...summary, inProgress: false }, null)).toEqual({ driverId: "leader", constructorId: "team" });
    expect(championshipStatus(summary, null)).toEqual({ driverId: null, constructorId: null });
  });

  it("moves through secured positions independently for drivers and constructors", () => {
    const data = season(26);
    const row = (id: string, points: number) => ({ id, points, wins: 0, position: null, pointsByRound: [], positionByRound: [] });
    const table = { rounds: 22, list: [row("first", 200), row("second", 100), row("third", 60), row("fourth", 50)] };
    expect(nextChampionshipBattle(table, data.races, 2027).position).toBe(3);
    expect(nextChampionshipBattle(table, data.races, 2027).secured.map(row => row.id)).toEqual(["first", "second"]);
    expect(nextChampionshipBattle(table, data.races, 2027, null, true).position).toBe(2);
  });

  it("keeps a reachable position open, including sprints and points ties", () => {
    const data = season(25, true);
    expect(nextChampionshipBattle(data.standings.drivers, data.races, 2027).position).toBe(1);
    expect(nextChampionshipBattle(data.standings.drivers, data.races, 2027, "leader").position).toBeNull();
    expect(nextChampionshipBattle(data.standings.drivers, [], 2027).position).toBe(1);
  });

  it("recognizes a guaranteed wins countback and does not invent a deeper tiebreak", () => {
    const data = season(25);
    data.standings.drivers.list[0].wins = 5;
    data.standings.drivers.list[1].wins = 3;
    expect(championshipStatus(summary, data).driverId).toBe("leader");
    data.standings.drivers.list[1].wins = 4;
    expect(championshipStatus(summary, data).driverId).toBeNull();
  });

  it("stops offering odds once every position has been secured", () => {
    const data = season(50);
    expect(nextChampionshipBattle(data.standings.drivers, data.races, 2027).position).toBeNull();
    expect(nextChampionshipBattle(data.standings.drivers, data.races, 2027).secured).toHaveLength(2);
  });

  it("removes cancelled races from remaining points without treating their calendar entry as missing", () => {
    const data = season(1, true);
    data.races[data.races.length - 1].cancelled = true;
    expect(championshipStatus(summary, data).driverId).toBe("leader");
    expect(championshipStatus(summary, data).constructorId).toBe("team");
  });
});
