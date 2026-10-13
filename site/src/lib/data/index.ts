// Public data access layer. Server components and route handlers import from here only. The
// site is a static export, so these run at build time: rebuild after a data refresh.
// All functions are async so the storage underneath (fixtures today, sqlite + published JSON
// tomorrow) can change without touching components.

import * as source from "./source";
import type { FixtureRace, FixtureSeason } from "./fixtures-source";
import type { FantasyFile } from "@/lib/fantasy/engine/types";
import type { FantasyRoundsFile } from "@/lib/fantasy/thresholds";
import { marketFromRounds } from "@/lib/fantasy/market";
import type { SessionRef, SessionTelemetry, TelemetryIndexEntry } from "@/lib/telemetry";
import { activeSource } from "./source";
import type {
  Circuit,
  Constructor,
  Driver,
  FantasyMarket,
  Prediction,
  PredictionHistoryEntry,
  Race,
  RaceStatus,
  RaceSummary,
  SeasonStandings,
  SeasonSummary,
  SessionCode,
  SessionKey,
  SessionReport,
  TrackOutline,
} from "./types";

export type * from "./types";
export { LAP_FLAG_DELETED, LAP_FLAG_PERSONAL_BEST, LAP_FLAG_PIT_IN, LAP_FLAG_PIT_OUT } from "./types";

export interface EntryListDriver {
  driverId: string;
  code: string;
  number: number | null;
  name: string;
  givenName: string;
  familyName: string;
  constructorId: string;
  team: string;
  teamColor: string;
}

export interface EntryList {
  season: number;
  drivers: EntryListDriver[];
  constructors: Constructor[];
}

export interface RecordEntry {
  id: string;
  label: string;
  value: number;
  detail?: string;
}

export interface RecordGroup {
  key: string;
  title: string;
  unit: string;
  entries: RecordEntry[];
}

export async function getDataSource(): Promise<"sqlite" | "fixtures"> {
  return activeSource();
}

export async function getCurrentSeason(): Promise<number> {
  return source.readIndex().currentSeason;
}

export async function getSeasons(): Promise<SeasonSummary[]> {
  const list = source.readSeasonSummaries();
  return [...list].sort((a, b) => b.season - a.season);
}

export async function getCalendar(season: number, now: Date = new Date()): Promise<RaceSummary[]> {
  const data = source.readSeason(season);
  if (!data) return [];
  return summarizeRaces(data, now);
}

export async function getNextRace(now: Date = new Date()): Promise<RaceSummary | null> {
  const season = await getCurrentSeason();
  const calendar = await getCalendar(season, now);
  const next = calendar.find((r) => r.status === "next");
  return next ?? null;
}

export async function getLastCompletedRace(now: Date = new Date()): Promise<RaceSummary | null> {
  const season = await getCurrentSeason();
  const calendar = await getCalendar(season, now);
  const completed = calendar.filter((r) => r.status === "completed");
  return completed.length ? completed[completed.length - 1] : null;
}

export async function getRace(season: number, round: number, now: Date = new Date()): Promise<Race | null> {
  const data = source.readSeason(season);
  if (!data) return null;
  const summaries = summarizeRaces(data, now);
  const summary = summaries.find((r) => r.round === round);
  const raw = data.races.find((r) => r.round === round);
  if (!summary || !raw) return null;
  const laps = source.readLaps(season, round);
  return {
    ...summary,
    results: raw.results,
    sprint: raw.sprint,
    qualifying: raw.qualifying,
    laps,
  };
}

export async function getStandings(season: number): Promise<SeasonStandings | null> {
  const data = source.readSeason(season);
  if (!data) return null;
  return { season, drivers: data.standings.drivers, constructors: data.standings.constructors };
}

export async function getEntryList(season: number): Promise<EntryList> {
  const data = source.readSeason(season);
  const drivers = source.readDrivers();
  const constructors = source.readConstructors();
  const driverById = new Map(drivers.map((d) => [d.driverId, d]));
  const constructorById = new Map(constructors.map((c) => [c.constructorId, c]));
  const seen = new Map<string, EntryListDriver>();
  const teamIds = new Set<string>();
  const races = data ? [...data.races].reverse() : [];
  for (const race of races) {
    for (const row of race.results) {
      teamIds.add(row.constructorId);
      if (seen.has(row.driverId)) continue;
      const driver = driverById.get(row.driverId);
      const team = constructorById.get(row.constructorId);
      if (!driver) continue;
      seen.set(row.driverId, {
        driverId: driver.driverId,
        code: driver.code ?? driver.familyName.slice(0, 3).toUpperCase(),
        number: row.number ?? driver.number,
        name: `${driver.givenName} ${driver.familyName}`,
        givenName: driver.givenName,
        familyName: driver.familyName,
        constructorId: row.constructorId,
        team: team?.name ?? row.constructorId,
        teamColor: team?.color ?? "#8A8F98",
      });
    }
  }
  const entryDrivers = [...seen.values()].sort((a, b) => a.team.localeCompare(b.team) || a.familyName.localeCompare(b.familyName));
  const entryConstructors = [...teamIds]
    .map((id) => constructorById.get(id))
    .filter((c): c is Constructor => Boolean(c))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { season, drivers: entryDrivers, constructors: entryConstructors };
}

export interface Lookups {
  driverName: (id: string) => string;
  driverCode: (id: string) => string;
  teamName: (id: string) => string;
  teamColor: (id: string) => string;
}

export async function getLookups(): Promise<Lookups> {
  const drivers = source.readDrivers();
  const constructors = source.readConstructors();
  const driverById = new Map(drivers.map((d) => [d.driverId, d]));
  const teamById = new Map(constructors.map((c) => [c.constructorId, c]));
  return {
    driverName: (id) => {
      const d = driverById.get(id);
      return d ? `${d.givenName} ${d.familyName}` : id;
    },
    driverCode: (id) => {
      const d = driverById.get(id);
      return d?.code ?? (d ? d.familyName.slice(0, 3).toUpperCase() : id.slice(0, 3).toUpperCase());
    },
    teamName: (id) => teamById.get(id)?.name ?? id,
    teamColor: (id) => teamById.get(id)?.color ?? "#8A8F98",
  };
}

export async function getDrivers(): Promise<Driver[]> {
  return source.readDrivers();
}

export async function getDriver(driverId: string): Promise<Driver | null> {
  const drivers = source.readDrivers();
  return drivers.find((d) => d.driverId === driverId) ?? null;
}

export async function getDriverSeasonResults(driverId: string, season: number): Promise<{ race: RaceSummary; result: Race["results"][number] | null; sprint: Race["sprint"][number] | null; qualifying: Race["qualifying"][number] | null }[]> {
  const data = source.readSeason(season);
  if (!data) return [];
  const summaries = summarizeRaces(data, new Date());
  const rows = [];
  for (const raw of data.races) {
    if (raw.results.length === 0) continue;
    const race = summaries.find((s) => s.round === raw.round);
    if (!race) continue;
    const result = raw.results.find((r) => r.driverId === driverId) ?? null;
    const sprint = raw.sprint.find((r) => r.driverId === driverId) ?? null;
    const qualifying = raw.qualifying.find((r) => r.driverId === driverId) ?? null;
    if (!result && !sprint && !qualifying) continue;
    rows.push({ race, result, sprint, qualifying });
  }
  return rows;
}

export async function getConstructors(): Promise<Constructor[]> {
  return source.readConstructors();
}

export async function getConstructor(constructorId: string): Promise<Constructor | null> {
  const constructors = source.readConstructors();
  return constructors.find((c) => c.constructorId === constructorId) ?? null;
}

export async function getConstructorSeasonResults(constructorId: string, season: number): Promise<{ race: RaceSummary; results: Race["results"] }[]> {
  const data = source.readSeason(season);
  if (!data) return [];
  const summaries = summarizeRaces(data, new Date());
  const rows = [];
  for (const raw of data.races) {
    if (raw.results.length === 0) continue;
    const race = summaries.find((s) => s.round === raw.round);
    if (!race) continue;
    const results = raw.results.filter((r) => r.constructorId === constructorId);
    if (results.length === 0) continue;
    rows.push({ race, results });
  }
  return rows;
}

export async function getCircuits(): Promise<Circuit[]> {
  return source.readCircuits();
}

export async function getCircuit(circuitId: string): Promise<Circuit | null> {
  const circuits = source.readCircuits();
  return circuits.find((c) => c.circuitId === circuitId) ?? null;
}

export async function getTrackOutline(circuitId: string): Promise<TrackOutline | null> {
  return source.readTrack(circuitId);
}

export async function getAvailableTracks(): Promise<string[]> {
  return source.readIndex().tracks;
}

export async function getNextRacePrediction(): Promise<Prediction> {
  return source.readPrediction();
}

export async function getPredictionSource(): Promise<"published" | "fixture"> {
  return source.predictionSource();
}

export async function getPredictionHistory(): Promise<PredictionHistoryEntry[]> {
  return source.readPredictionHistory();
}

/** The market from data/serve/fantasy_rounds.json when published; the game rules stay the fixture snapshot. */
export async function getFantasyMarket(): Promise<FantasyMarket> {
  const fixture = source.readFantasyMarket();
  const rounds = source.readFantasyRounds();
  if (!rounds || rounds.rounds.length === 0) return fixture;
  const drivers = source.readDrivers();
  const constructors = source.readConstructors();
  return marketFromRounds(rounds, fixture.rules, drivers, constructors);
}

export async function getFantasyFile(): Promise<FantasyFile> {
  return source.readFantasyFile();
}

export async function getFantasyRounds(): Promise<FantasyRoundsFile | null> {
  return source.readFantasyRounds();
}

export async function getTelemetryIndex(): Promise<TelemetryIndexEntry[]> {
  const index = source.readTelemetryIndex();
  return index.map((entry) => ({ ...entry, eventName: calendarRaceName(entry.season, entry.round) ?? entry.eventName }));
}

/** One session's fastest-lap telemetry, with driver names in the site's full-name form (FastF1 has "Kimi Antonelli"). */
export async function getSessionTelemetry(ref: SessionRef): Promise<SessionTelemetry | null> {
  const session = source.readSessionTelemetry(ref);
  if (!session) return null;
  const entries = await getEntryList(session.season);
  const drivers = session.drivers.map((d) => ({ ...d, name: entryName(entries, d.code, d.number) ?? d.name }));
  const eventName = calendarRaceName(session.season, session.round) ?? session.eventName;
  return { ...session, eventName, drivers };
}

/** The exported timing report of one session (practice, qualifying, sprint, race), or null. */
export async function getSessionReport(season: number, round: number, code: SessionCode): Promise<SessionReport | null> {
  const report = source.readSessionReport(season, round, code);
  if (!report) return null;
  return { ...report, eventName: calendarRaceName(season, round) ?? report.eventName };
}

export async function getRaceLapsAvailability(): Promise<{ season: number; round: number }[]> {
  return source.readIndex().lapFiles;
}

export async function getRecords(): Promise<RecordGroup[]> {
  const drivers = source.readDrivers();
  const constructors = source.readConstructors();
  const name = (d: Driver) => `${d.givenName} ${d.familyName}`;
  const span = (d: Driver) => `${d.career.firstSeason} to ${d.career.lastSeason}`;
  const topDrivers = (key: keyof Driver["career"], unit: string, title: string): RecordGroup => {
    const entries = [...drivers]
      .filter((d) => typeof d.career[key] === "number" && (d.career[key] as number) > 0)
      .sort((a, b) => (b.career[key] as number) - (a.career[key] as number))
      .slice(0, 10)
      .map((d) => ({ id: d.driverId, label: name(d), value: d.career[key] as number, detail: span(d) }));
    return { key: `drivers-${String(key)}`, title, unit, entries };
  };
  const topConstructors = (key: keyof Constructor["career"], unit: string, title: string): RecordGroup => {
    const entries = [...constructors]
      .filter((c) => typeof c.career[key] === "number" && (c.career[key] as number) > 0)
      .sort((a, b) => (b.career[key] as number) - (a.career[key] as number))
      .slice(0, 10)
      .map((c) => ({ id: c.constructorId, label: c.name, value: c.career[key] as number, detail: `${c.career.firstSeason} to ${c.career.lastSeason}` }));
    return { key: `constructors-${String(key)}`, title, unit, entries };
  };
  return [
    topDrivers("wins", "wins", "Most Grand Prix wins"),
    topDrivers("poles", "poles", "Most pole positions"),
    topDrivers("podiums", "podiums", "Most podiums"),
    topDrivers("titles", "titles", "Most drivers' championships"),
    topDrivers("starts", "starts", "Most race starts"),
    topDrivers("points", "points", "Most career points"),
    topDrivers("fastestLaps", "fastest laps", "Most fastest laps (2004 onwards)"),
    topConstructors("wins", "wins", "Most wins by constructor"),
    topConstructors("titles", "titles", "Most constructors' championships"),
    topConstructors("starts", "races", "Most races entered by constructor"),
  ];
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

export function summarizeRaces(data: FixtureSeason, now: Date): RaceSummary[] {
  const summaries = data.races.map((race) => toSummary(race, now));
  let nextAssigned = false;
  for (const summary of summaries) {
    if (summary.status === "upcoming" && !nextAssigned) {
      summary.status = "next";
      nextAssigned = true;
    }
  }
  return summaries;
}

function toSummary(race: FixtureRace, now: Date): RaceSummary {
  const hasResults = race.results.length > 0;
  const raceTime = race.time ? new Date(race.time) : new Date(`${race.date}T23:59:59Z`);
  const weekendOver = raceTime.getTime() + 4 * 3600 * 1000 < now.getTime();
  let status: RaceStatus = "upcoming";
  if (race.cancelled) status = "cancelled";
  else if (hasResults || weekendOver) status = "completed";
  const sessions: Partial<Record<SessionKey, string>> = {};
  for (const [key, value] of Object.entries(race.sessions || {})) {
    if (value) sessions[key as SessionKey] = value;
  }
  return {
    season: race.season,
    round: race.round,
    raceName: race.raceName,
    circuitId: race.circuitId,
    circuitName: race.circuitName,
    locality: race.locality,
    country: race.country,
    countryCode: race.countryCode ?? null,
    date: race.date,
    time: race.time,
    sessions,
    hasSprint: race.hasSprint,
    scheduledLaps: race.scheduledLaps,
    cancelled: race.cancelled,
    url: race.url,
    status,
    hasResults,
  };
}

/** Full name of the season entrant with this code (the car number settles a shared code), or null. */
/** The calendar's name for a round; FastF1 exports keep the original name of a relocated race ("Bahrain Grand Prix" held in Malaysia). */
function calendarRaceName(season: number, round: number): string | null {
  const race = source.readSeason(season)?.races.find((r) => r.round === round);
  return race?.raceName ?? null;
}

function entryName(entries: EntryList, code: string, number: string): string | null {
  const byCode = entries.drivers.filter((d) => d.code === code);
  const byNumber = byCode.find((d) => String(d.number) === number);
  const match = byNumber ?? (byCode.length === 1 ? byCode[0] : null);
  return match?.name ?? null;
}
