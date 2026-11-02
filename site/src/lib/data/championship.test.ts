import { describe, expect, it } from "vitest";
import { championshipStatus } from "./championship";
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
});
