import type { FixtureRace, FixtureSeason } from "./fixtures-source";

export interface OfficialResultsCache {
  races: (Pick<FixtureRace, "season" | "round" | "results" | "qualifying"> & { sources: { race: string; qualifying: string } })[];
}

export function mergeOfficialResults(data: FixtureSeason, official: OfficialResultsCache): FixtureSeason {
  const fallback = new Map(official.races.filter((race) => race.season === data.season).map((race) => [race.round, race]));
  return {
    ...data,
    races: data.races.map((race) => {
      const cached = fallback.get(race.round);
      if (!cached) return race;
      const useRace = race.results.length === 0 && cached.results.length > 0;
      const useQualifying = race.qualifying.length === 0 && cached.qualifying.length > 0;
      if (!useRace && !useQualifying) return race;
      return {
        ...race,
        results: useRace ? cached.results : race.results,
        qualifying: useQualifying ? cached.qualifying : race.qualifying,
        officialSources: {
          ...(useRace ? { race: cached.sources.race } : {}),
          ...(useQualifying ? { qualifying: cached.sources.qualifying } : {}),
        },
      };
    }),
  };
}
