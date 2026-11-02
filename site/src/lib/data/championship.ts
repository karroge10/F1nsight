import type { FixtureSeason } from "./fixtures-source";
import type { SeasonSummary, StandingsTable } from "./types";

export interface ChampionshipStatus {
  driverId: string | null;
  constructorId: string | null;
}

const CONFIRMED_TITLES: Record<number, Partial<ChampionshipStatus>> = {
  2026: { driverId: "antonelli" },
};

export function championshipStatus(summary: SeasonSummary, data: FixtureSeason | null): ChampionshipStatus {
  if (!summary.inProgress) {
    return {
      driverId: summary.driverChampion?.driverId ?? null,
      constructorId: summary.constructorChampion?.constructorId ?? null,
    };
  }
  const confirmed = CONFIRMED_TITLES[summary.season];
  const clinched = (table: StandingsTable, team: boolean): string | null => {
    if (!data || summary.season < 2022 || table.list.length < 2 || table.rounds === 0) return null;
    if (data.races.filter(race => !race.cancelled).length !== summary.rounds) return null;
    const remaining = data.races.filter(race => !race.cancelled && race.round > table.rounds);
    const maximum = remaining.reduce((points, race) => points + (team ? 43 : 25)
      + (summary.season <= 2024 ? 1 : 0) + (race.hasSprint ? (team ? 15 : 8) : 0), 0);
    const ordered = [...table.list].sort((a, b) => b.points - a.points);
    return ordered[0].points > ordered[1].points + maximum ? ordered[0].id : null;
  };
  return {
    driverId: confirmed?.driverId ?? (data ? clinched(data.standings.drivers, false) : null),
    constructorId: confirmed?.constructorId ?? (data ? clinched(data.standings.constructors, true) : null),
  };
}
