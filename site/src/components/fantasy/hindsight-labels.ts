// Codes, names and team colours for the hindsight view, built from the season's entry list, and
// the race labels (name, short code, flag) from its calendar.

import type { getEntryList } from "@/lib/data";
import type { RaceSummary } from "@/lib/data/types";
import type { RaceLabel } from "@/lib/fantasy/hindsight";
import type { HindsightLabels } from "@/components/fantasy/hindsight-view";

type EntryListData = Awaited<ReturnType<typeof getEntryList>>;

/** Same short codes as the backtest table (research/fantasy-backtest/run.ts). */
const RACE_CODES: Record<string, string> = {
  "Bahrain Grand Prix": "BHR",
  "Saudi Arabian Grand Prix": "SAU",
  "Australian Grand Prix": "AUS",
  "Japanese Grand Prix": "JPN",
  "Chinese Grand Prix": "CHN",
  "Miami Grand Prix": "MIA",
  "Emilia Romagna Grand Prix": "EMI",
  "Monaco Grand Prix": "MON",
  "Canadian Grand Prix": "CAN",
  "Spanish Grand Prix": "ESP",
  "Austrian Grand Prix": "AUT",
  "British Grand Prix": "GBR",
  "Hungarian Grand Prix": "HUN",
  "Belgian Grand Prix": "BEL",
  "Dutch Grand Prix": "NED",
  "Italian Grand Prix": "ITA",
  "Azerbaijan Grand Prix": "AZE",
  "Singapore Grand Prix": "SIN",
  "United States Grand Prix": "USA",
  "Mexico City Grand Prix": "MEX",
  "São Paulo Grand Prix": "SAP",
  "Las Vegas Grand Prix": "LVG",
  "Qatar Grand Prix": "QAT",
  "Abu Dhabi Grand Prix": "ABU",
  "Barcelona Grand Prix": "BAR",
  "Bahrain Grand Prix in Malaysia": "MAL",
};

/** Race name, short code and flag country by round. */
export function buildRaceLabels(calendar: RaceSummary[]): Record<number, RaceLabel> {
  const labels: Record<number, RaceLabel> = {};
  for (const race of calendar) {
    const code = RACE_CODES[race.raceName] ?? race.raceName.slice(0, 3).toUpperCase();
    labels[race.round] = { name: race.raceName, code, country: race.countryCode ?? race.country ?? null };
  }
  return labels;
}

/** `constructorCode` maps a constructor id to its short code, the same one the planner shows. */
export function buildHindsightLabels(entries: EntryListData, constructorCode: (id: string) => string): HindsightLabels {
  const labels: HindsightLabels = { codes: {}, names: {}, colors: {} };
  for (const d of entries.drivers) {
    labels.codes[d.driverId] = d.code;
    labels.names[d.driverId] = d.name;
    labels.colors[d.driverId] = d.teamColor;
  }
  for (const c of entries.constructors) {
    labels.names[c.constructorId] = c.name;
    labels.codes[c.constructorId] = constructorCode(c.constructorId);
    labels.colors[c.constructorId] = c.color;
  }
  return labels;
}
