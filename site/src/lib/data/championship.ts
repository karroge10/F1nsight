import type { FixtureSeason } from "./fixtures-source";
import type { RaceSummary, SeasonSummary, StandingRow, StandingsTable } from "./types";

export interface ChampionshipStatus {
  driverId: string | null;
  constructorId: string | null;
}

const CONFIRMED_TITLES: Record<number, Partial<ChampionshipStatus>> = {
  2026: { driverId: "antonelli" },
};

type ChampionshipCalendar = Pick<RaceSummary, "round" | "cancelled" | "hasSprint">[];

export function nextChampionshipBattle(table: StandingsTable, calendar: ChampionshipCalendar, season: number,
  championId: string | null = null, constructors = false): { position: number | null; secured: { id: string; position: number }[] } {
  const ordered = [...table.list].sort((a, b) => b.points - a.points || (a.position ?? Infinity) - (b.position ?? Infinity) || b.wins - a.wins);
  const secured: { id: string; position: number }[] = championId ? [{ id: championId, position: 1 }] : [];
  const remaining = calendar.filter(race => !race.cancelled && race.round > table.rounds);
  const maximum = remaining.reduce((points, race) => points + (constructors ? 43 : 25)
    + (season <= 2024 ? 1 : 0) + (race.hasSprint ? (constructors ? 15 : 8) : 0), 0);
  const ahead = (upper: StandingRow, lower: StandingRow) => upper.points > lower.points + maximum
    || (upper.points === lower.points + maximum && upper.wins > lower.wins + remaining.length);
  const pool = ordered.filter(row => row.id !== championId);
  const canResolve = season >= 2022 && table.rounds > 0 && calendar.length > 0 && table.list.length >= 2;
  if (canResolve) {
    while (pool.length > 0) {
      const candidate = pool[0];
      const finalPosition = remaining.length === 0 && candidate.position === secured.length + 1;
      if (!finalPosition && !pool.slice(1).every(row => ahead(candidate, row))) break;
      secured.push({ id: candidate.id, position: secured.length + 1 });
      pool.shift();
    }
  }
  return { position: pool.length > 0 || ordered.length === 0 ? secured.length + 1 : null, secured };
}

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
    if (data.races.length < summary.rounds) return null;
    return nextChampionshipBattle(table, data.races, summary.season, null, team).secured[0]?.id ?? null;
  };
  return {
    driverId: confirmed?.driverId ?? (data ? clinched(data.standings.drivers, false) : null),
    constructorId: confirmed?.constructorId ?? (data ? clinched(data.standings.constructors, true) : null),
  };
}
