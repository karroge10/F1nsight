// SQLite-backed storage for the stats domain, reading v2/data/serve/f1.sqlite read only with
// Node's built-in sqlite module. Returns the same shapes as fixtures-source so index.ts does
// not care which one is active. Predictions, fantasy and track outlines still come from the
// published JSON / fixtures (see fixtures-source).

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { FixtureRace, FixtureSeason } from "./fixtures-source";
import * as fixtures from "./fixtures-source";
import { teamColor } from "./team-colors";
import type { Circuit, Constructor, Driver, QualifyingRow, RaceLaps, ResultRow, SeasonSummary, StandingRow, StandingsTable } from "./types";

const DATA_DIR = process.env.F1_DATA_DIR ? path.resolve(process.env.F1_DATA_DIR) : path.resolve(process.cwd(), "../data");
export const SQLITE_FILE = path.join(DATA_DIR, "serve/f1.sqlite");

// The pipeline replaces f1.sqlite with an atomic rename after every refresh. On Windows a
// rename fails while any process holds the file open, so the connection is closed after a short
// idle period, and every cached query result is dropped when the file on disk changes.
const IDLE_CLOSE_MS = 1500;
const FRESHNESS_CHECK_MS = 2000;

let db: DatabaseSync | null = null;
let idleTimer: NodeJS.Timeout | null = null;
let fileStamp: string | null = null;
let lastFreshnessCheck = 0;
const cache = new Map<string, unknown>();

export function sqliteAvailable(): boolean {
  if (process.env.F1_DATA_SOURCE === "fixtures") return false;
  return fs.existsSync(SQLITE_FILE);
}

export function readIndex() {
  return cached("index", () => {
    const current = one<{ season: number }>("select max(season) as season from seasons where completedRounds > 0");
    const seasons = all<{ season: number }>("select season from seasons order by season").map((r) => r.season);
    const lapRows = all<{ season: number; round: number }>("select distinct season, round from lap_times where season >= 2024 order by season, round");
    const fixtureIndex = fixtures.readIndex();
    return {
      generatedAt: new Date().toISOString(),
      currentSeason: current?.season ?? fixtureIndex.currentSeason,
      seasons,
      lapFiles: lapRows,
      tracks: fixtureIndex.tracks,
    };
  });
}

export function readSeason(season: number): FixtureSeason | null {
  return cached(`season:${season}`, () => {
    const races = all<RaceRow>("select * from races where season = ? order by round", season);
    if (races.length === 0) return null;
    const results = groupBy(all<ResultDb>("select * from results where season = ? order by raceId, positionOrder", season), (r) => r.raceId);
    const sprints = groupBy(all<ResultDb>("select * from sprint_results where season = ? order by raceId, positionOrder", season), (r) => r.raceId);
    const quali = groupBy(all<QualiDb>("select * from qualifying where season = ? order by raceId, position", season), (r) => r.raceId);
    const fixtureRaces: FixtureRace[] = races.map((race) => {
      const raceResults = (results.get(race.raceId) ?? []).map(toResultRow);
      const sprintResults = (sprints.get(race.raceId) ?? []).map(toResultRow);
      const qualifying = (quali.get(race.raceId) ?? []).map(toQualifyingRow);
      const circuit = circuitRow(race.circuitId);
      const laps = raceResults.reduce((m, r) => Math.max(m, r.laps ?? 0), 0);
      const sessions: Record<string, string> = {};
      if (race.fp1Utc) sessions.fp1 = race.fp1Utc;
      if (race.fp2Utc) sessions.fp2 = race.fp2Utc;
      if (race.fp3Utc) sessions.fp3 = race.fp3Utc;
      if (race.sprintQualifyingUtc) sessions.sprintQualifying = race.sprintQualifyingUtc;
      if (race.sprintUtc) sessions.sprint = race.sprintUtc;
      if (race.qualifyingUtc) sessions.qualifying = race.qualifyingUtc;
      if (race.raceUtc) sessions.race = race.raceUtc;
      return {
        season,
        round: race.round,
        raceName: race.raceName,
        circuitId: race.circuitId,
        circuitName: circuit?.circuitName ?? race.circuitId,
        locality: circuit?.locality ?? "",
        country: circuit?.country ?? "",
        countryCode: circuit?.countryCode ?? null,
        date: race.date,
        time: race.raceUtc ?? null,
        sessions,
        hasSprint: Boolean(race.hasSprint),
        scheduledLaps: laps > 0 ? laps : null,
        cancelled: false,
        url: race.url,
        results: raceResults,
        sprint: sprintResults,
        qualifying,
      };
    });
    return {
      season,
      races: fixtureRaces,
      standings: {
        drivers: standingsTable(season, "driver_standings", "driverId"),
        constructors: standingsTable(season, "constructor_standings", "constructorId"),
      },
    };
  });
}

export function readSeasonSummaries(): SeasonSummary[] {
  return cached("seasonSummaries", () => {
    const rows = all<SeasonSummaryDb>("select * from season_summary order by season");
    const finals = all<{ season: number; driverId: string; constructorIds: string | null }>("select season, driverId, constructorIds from season_final_driver_standings where position = 1");
    const finalTeam = new Map(finals.map((f) => [f.season, lastTeam(f.constructorIds)]));
    return rows.map((row) => ({
      season: row.season,
      rounds: row.rounds,
      completedRounds: row.completedRounds,
      inProgress: !row.isComplete,
      driverChampion: row.driverLeaderId
        ? { driverId: row.driverLeaderId, points: row.driverLeaderPoints ?? 0, wins: row.driverLeaderWins ?? 0, constructorId: finalTeam.get(row.season) ?? null }
        : null,
      constructorChampion: row.constructorLeaderId && row.season >= 1958 ? { constructorId: row.constructorLeaderId, points: row.constructorLeaderPoints ?? 0, wins: 0 } : null,
    }));
  });
}

export function readDrivers(): Driver[] {
  return cached("drivers", () => {
    const rows = all<DriverDb & DriverCareerDb>(
      "select d.*, c.entries, c.starts, c.wins, c.podiums, c.poles, c.fastestLaps, c.sprintWins, c.points, c.titles, c.firstRaceId, c.lastRaceId, c.constructorIds from drivers d join driver_career c on c.driverId = d.driverId order by d.familyName, d.givenName",
    );
    const seasonRows = groupBy(
      all<{ season: number; driverId: string; position: number | null; points: number; wins: number; constructorIds: string | null }>("select season, driverId, position, points, wins, constructorIds from season_final_driver_standings order by season"),
      (r) => r.driverId,
    );
    const winRows = groupBy(
      all<{ driverId: string; season: number; round: number; raceName: string; constructorId: string }>("select r.driverId, r.season, r.round, ra.raceName, r.constructorId from results r join races ra on ra.raceId = r.raceId where r.position = 1 order by r.season, r.round"),
      (r) => r.driverId,
    );
    return rows.map((row) => ({
      driverId: row.driverId,
      code: row.code,
      number: row.permanentNumber,
      givenName: row.givenName,
      familyName: row.familyName,
      nationality: row.nationality,
      countryCode: row.countryCode,
      dateOfBirth: row.dateOfBirth,
      url: row.url,
      career: {
        starts: row.starts ?? 0,
        wins: row.wins ?? 0,
        sprintWins: row.sprintWins ?? 0,
        podiums: row.podiums ?? 0,
        poles: row.poles ?? 0,
        fastestLaps: row.fastestLaps ?? 0,
        points: row.points ?? 0,
        titles: row.titles ?? 0,
        firstSeason: row.firstRaceId ? Math.floor(row.firstRaceId / 100) : null,
        lastSeason: row.lastRaceId ? Math.floor(row.lastRaceId / 100) : null,
        constructorIds: splitList(row.constructorIds),
      },
      seasons: (seasonRows.get(row.driverId) ?? []).map((s) => ({ season: s.season, position: s.position, points: s.points, wins: s.wins, constructorIds: splitList(s.constructorIds) })),
      wins: (winRows.get(row.driverId) ?? []).map((w) => ({ season: w.season, round: w.round, raceName: w.raceName, constructorId: w.constructorId })),
    }));
  });
}

export function readConstructors(): Constructor[] {
  return cached("constructors", () => {
    const rows = all<ConstructorDb & ConstructorCareerDb>(
      "select c.*, k.entries, k.wins, k.podiums, k.poles, k.points, k.titles, k.drivers, k.firstRaceId, k.lastRaceId from constructors c join constructor_career k on k.constructorId = c.constructorId order by c.name",
    );
    const seasonRows = groupBy(
      all<{ season: number; constructorId: string; position: number | null; points: number; wins: number }>("select season, constructorId, position, points, wins from season_final_constructor_standings order by season"),
      (r) => r.constructorId,
    );
    return rows.map((row) => ({
      constructorId: row.constructorId,
      name: row.name,
      nationality: row.nationality,
      countryCode: row.countryCode,
      color: teamColor(row.constructorId, row.primaryColor),
      url: row.url,
      career: {
        starts: row.entries ?? 0,
        wins: row.wins ?? 0,
        podiums: row.podiums ?? 0,
        poles: row.poles ?? 0,
        points: row.points ?? 0,
        titles: row.titles ?? 0,
        firstSeason: row.firstRaceId ? Math.floor(row.firstRaceId / 100) : null,
        lastSeason: row.lastRaceId ? Math.floor(row.lastRaceId / 100) : null,
        driverCount: row.drivers ?? 0,
      },
      seasons: (seasonRows.get(row.constructorId) ?? []).map((s) => ({ season: s.season, position: s.position, points: s.points, wins: s.wins })),
    }));
  });
}

export function readCircuits(): Circuit[] {
  return cached("circuits", () => {
    const rows = all<CircuitDb & CircuitStatsDb>(
      "select c.*, s.racesHeld, s.firstSeason, s.lastSeason, s.lapRecordMs, s.lapRecordDriverId, s.lapRecordRaceId from circuits c join circuit_stats s on s.circuitId = c.circuitId where s.racesHeld > 0 order by c.circuitName",
    );
    const winners = groupBy(
      all<{ circuitId: string; season: number; round: number; raceName: string; driverId: string; constructorId: string }>("select circuitId, season, round, raceName, driverId, constructorId from v_circuit_winners order by season desc"),
      (r) => r.circuitId,
    );
    const poles = new Map(all<{ raceId: number; driverId: string }>("select raceId, driverId from race_poles").map((p) => [p.raceId, p.driverId]));
    const recordTeams = new Map(
      all<{ raceId: number; driverId: string; constructorId: string }>("select r.raceId, r.driverId, r.constructorId from results r join circuit_stats s on s.lapRecordRaceId = r.raceId and s.lapRecordDriverId = r.driverId").map((r) => [`${r.raceId}:${r.driverId}`, r.constructorId]),
    );
    return rows.map((row) => ({
      circuitId: row.circuitId,
      name: row.circuitName,
      locality: row.locality,
      country: row.country,
      countryCode: row.countryCode,
      lat: row.lat,
      lng: row.lng,
      altitude: row.alt,
      url: row.url,
      firstSeason: row.firstSeason,
      lastSeason: row.lastSeason,
      raceCount: row.racesHeld,
      lapRecord:
        row.lapRecordMs && row.lapRecordDriverId && row.lapRecordRaceId
          ? { timeMs: row.lapRecordMs, driverId: row.lapRecordDriverId, constructorId: recordTeams.get(`${row.lapRecordRaceId}:${row.lapRecordDriverId}`) ?? "", season: Math.floor(row.lapRecordRaceId / 100) }
          : null,
      races: (winners.get(row.circuitId) ?? []).map((w) => ({
        season: w.season,
        round: w.round,
        raceName: w.raceName,
        winnerDriverId: w.driverId,
        winnerConstructorId: w.constructorId,
        poleDriverId: poles.get(w.season * 100 + w.round) ?? null,
      })),
    }));
  });
}

export function readLaps(season: number, round: number): RaceLaps | null {
  return cached(`laps:${season}:${round}`, () => {
    const raceId = season * 100 + round;
    const lapRows = all<{ driverId: string; lap: number; position: number | null; timeMs: number | null }>("select driverId, lap, position, timeMs from lap_times where raceId = ? order by driverId, lap", raceId);
    if (lapRows.length === 0) return null;
    const laps: RaceLaps["laps"] = {};
    for (const row of lapRows) {
      const arr = laps[row.driverId] ?? (laps[row.driverId] = []);
      arr.push([row.lap, row.position, row.timeMs]);
    }
    const pitStops = all<{ driverId: string; stop: number; lap: number | null; durationMs: number | null; localTime: string | null }>("select driverId, stop, lap, durationMs, localTime from pit_stops where raceId = ? order by lap, stop", raceId);
    return { season, round, laps, pitStops };
  });
}

export const readTrack = fixtures.readTrack;
export const readPrediction = fixtures.readPrediction;
export const readPredictionHistory = fixtures.readPredictionHistory;
export const readFantasyMarket = fixtures.readFantasyMarket;
export const predictionSource = fixtures.predictionSource;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

interface RaceRow {
  raceId: number;
  season: number;
  round: number;
  raceName: string;
  circuitId: string;
  date: string;
  raceUtc: string | null;
  hasSprint: number;
  hasResults: number;
  fp1Utc: string | null;
  fp2Utc: string | null;
  fp3Utc: string | null;
  qualifyingUtc: string | null;
  sprintQualifyingUtc: string | null;
  sprintUtc: string | null;
  url: string | null;
}

interface ResultDb {
  raceId: number;
  driverId: string;
  constructorId: string;
  number: number | null;
  grid: number | null;
  position: number | null;
  positionText: string;
  positionOrder: number;
  points: number;
  laps: number | null;
  timeMs: number | null;
  fastestLapRank: number | null;
  fastestLap: number | null;
  fastestLapTimeMs: number | null;
  status: string;
}

interface QualiDb {
  raceId: number;
  driverId: string;
  constructorId: string;
  number: number | null;
  position: number | null;
  q1Ms: number | null;
  q2Ms: number | null;
  q3Ms: number | null;
}

interface SeasonSummaryDb {
  season: number;
  rounds: number;
  completedRounds: number;
  isComplete: number;
  driverLeaderId: string | null;
  driverLeaderPoints: number | null;
  driverLeaderWins: number | null;
  constructorLeaderId: string | null;
  constructorLeaderPoints: number | null;
}

interface DriverDb {
  driverId: string;
  permanentNumber: number | null;
  code: string | null;
  givenName: string;
  familyName: string;
  dateOfBirth: string | null;
  nationality: string | null;
  countryCode: string | null;
  url: string | null;
}

interface DriverCareerDb {
  entries: number;
  starts: number;
  wins: number;
  podiums: number;
  poles: number;
  fastestLaps: number;
  sprintWins: number;
  points: number;
  titles: number;
  firstRaceId: number | null;
  lastRaceId: number | null;
  constructorIds: string | null;
}

interface ConstructorDb {
  constructorId: string;
  name: string;
  nationality: string | null;
  countryCode: string | null;
  primaryColor: string | null;
  url: string | null;
}

interface ConstructorCareerDb {
  entries: number;
  wins: number;
  podiums: number;
  poles: number;
  points: number;
  titles: number;
  drivers: number;
  firstRaceId: number | null;
  lastRaceId: number | null;
}

interface CircuitDb {
  circuitId: string;
  circuitName: string;
  locality: string;
  country: string;
  countryCode: string | null;
  lat: number;
  lng: number;
  alt: number | null;
  url: string | null;
}

interface CircuitStatsDb {
  racesHeld: number;
  firstSeason: number;
  lastSeason: number;
  lapRecordMs: number | null;
  lapRecordDriverId: string | null;
  lapRecordRaceId: number | null;
}

function toResultRow(r: ResultDb): ResultRow {
  return {
    position: r.position,
    positionText: r.positionText,
    driverId: r.driverId,
    constructorId: r.constructorId,
    number: r.number,
    grid: r.grid,
    laps: r.laps,
    status: r.status,
    classified: r.position !== null,
    points: r.points,
    timeMs: r.timeMs,
    fastestLapRank: r.fastestLapRank,
    fastestLapMs: r.fastestLapTimeMs,
    fastestLapNumber: r.fastestLap,
  };
}

function toQualifyingRow(q: QualiDb): QualifyingRow {
  return { position: q.position, driverId: q.driverId, constructorId: q.constructorId, number: q.number, q1: q.q1Ms, q2: q.q2Ms, q3: q.q3Ms };
}

function standingsTable(season: number, table: "driver_standings" | "constructor_standings", idColumn: "driverId" | "constructorId"): StandingsTable {
  const rows = all<{ round: number; id: string; points: number; position: number | null; wins: number; constructorIds?: string | null }>(
    `select round, ${idColumn} as id, points, position, wins${idColumn === "driverId" ? ", constructorIds" : ""} from ${table} where season = ? order by round`,
    season,
  );
  const rounds = rows.reduce((m, r) => Math.max(m, r.round), 0);
  const byId = new Map<string, typeof rows>();
  for (const row of rows) {
    const arr = byId.get(row.id) ?? [];
    arr.push(row);
    byId.set(row.id, arr);
  }
  const list: StandingRow[] = [];
  for (const [id, entries] of byId) {
    const pointsByRound: number[] = [];
    const positionByRound: (number | null)[] = [];
    let last = { points: 0, position: null as number | null };
    for (let r = 1; r <= rounds; r++) {
      const atRound = entries.find((e) => e.round === r);
      if (atRound) last = { points: atRound.points, position: atRound.position };
      pointsByRound.push(last.points);
      positionByRound.push(last.position);
    }
    const final = entries[entries.length - 1];
    list.push({
      id,
      position: final.position,
      points: final.points,
      wins: final.wins,
      constructorIds: idColumn === "driverId" ? splitList(final.constructorIds ?? null) : undefined,
      pointsByRound,
      positionByRound,
    });
  }
  list.sort((a, b) => (a.position ?? 99) - (b.position ?? 99) || b.points - a.points);
  return { rounds, list };
}

function circuitRow(circuitId: string) {
  return cached(`circuit:${circuitId}`, () => one<CircuitDb>("select * from circuits where circuitId = ?", circuitId));
}

function lastTeam(list: string | null): string | null {
  const parts = splitList(list);
  return parts.length ? parts[parts.length - 1] : null;
}

function splitList(list: string | null): string[] {
  if (!list) return [];
  return list
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function groupBy<T, K>(rows: T[], key: (row: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const arr = out.get(k) ?? [];
    arr.push(row);
    out.set(k, arr);
  }
  return out;
}

function connection(): DatabaseSync {
  if (!db) {
    db = new DatabaseSync(SQLITE_FILE, { readOnly: true });
  }
  scheduleIdleClose();
  return db;
}

function all<T>(sql: string, ...params: (string | number)[]): T[] {
  const statement = connection().prepare(sql);
  return statement.all(...params) as T[];
}

function one<T>(sql: string, ...params: (string | number)[]): T | null {
  const statement = connection().prepare(sql);
  const row = statement.get(...params);
  return (row as T | undefined) ?? null;
}

function cached<T>(key: string, compute: () => T): T {
  dropCacheIfFileChanged();
  const hit = cache.get(key);
  if (hit !== undefined) return hit as T;
  const value = compute();
  cache.set(key, value);
  return value;
}

function scheduleIdleClose(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(closeConnection, IDLE_CLOSE_MS);
  idleTimer.unref();
}

function closeConnection(): void {
  idleTimer = null;
  if (!db) return;
  db.close();
  db = null;
}

/** Clears the query cache (and the open handle) when f1.sqlite was replaced since the last look. */
function dropCacheIfFileChanged(): void {
  const now = Date.now();
  if (now - lastFreshnessCheck < FRESHNESS_CHECK_MS) return;
  lastFreshnessCheck = now;
  const stamp = currentFileStamp();
  if (stamp === fileStamp) return;
  if (fileStamp !== null) {
    cache.clear();
    closeConnection();
  }
  fileStamp = stamp;
}

function currentFileStamp(): string {
  try {
    const stat = fs.statSync(SQLITE_FILE);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return "missing";
  }
}
