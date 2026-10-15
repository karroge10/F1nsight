// Fixture-backed storage. Every reader in index.ts goes through this module, so swapping
// in the sqlite / predictions JSON readers means replacing these functions only.
//
// Resolution order for data that other agents publish:
//   1. ${F1_DATA_DIR}/predictions/next.json and history/*.json (the trained model output)
//   2. the fixtures in this folder
// F1_DATA_DIR defaults to ../data relative to the site folder (see SPEC.md layout).

import fs from "node:fs";
import path from "node:path";
import type { FantasyFile } from "@/lib/fantasy/engine/types";
import type { FantasyRoundsFile } from "@/lib/fantasy/thresholds";
import type { SessionRef, SessionTelemetry, TelemetryIndexEntry } from "@/lib/telemetry";
import type {
  Circuit,
  Constructor,
  Driver,
  FantasyMarket,
  Prediction,
  PredictionHistoryEntry,
  QualifyingRow,
  RaceLaps,
  ResultRow,
  SeasonSummary,
  SessionCode,
  SessionReport,
  StandingsTable,
  TrackOutline,
} from "./types";

export interface FixtureRace {
  season: number;
  round: number;
  raceName: string;
  circuitId: string;
  circuitName: string;
  locality: string;
  country: string;
  countryCode: string | null;
  date: string;
  time: string | null;
  sessions: Record<string, string>;
  hasSprint: boolean;
  scheduledLaps: number | null;
  cancelled: boolean;
  url: string | null;
  results: ResultRow[];
  sprint: ResultRow[];
  qualifying: QualifyingRow[];
}

export interface FixtureSeason {
  season: number;
  races: FixtureRace[];
  standings: { drivers: StandingsTable; constructors: StandingsTable };
}

interface FixtureIndex {
  generatedAt: string;
  currentSeason: number;
  seasons: number[];
  lapFiles: { season: number; round: number }[];
  tracks: string[];
}

const FIXTURE_DIR = path.join(process.cwd(), "src/lib/data/fixtures");
const DATA_DIR = process.env.F1_DATA_DIR ? path.resolve(process.env.F1_DATA_DIR) : path.resolve(process.cwd(), "../data");

const cache = new Map<string, unknown>();
// Published files (next.json, fantasy.json, history/*.json) are rewritten by the pipeline while
// the site runs; they are cached per file modification time so a refresh shows up on the next
// request without a restart.
const stampedCache = new Map<string, { stamp: string; value: unknown }>();

export function readIndex(): FixtureIndex {
  return readFixture<FixtureIndex>("index.json");
}

export function readSeason(season: number): FixtureSeason | null {
  return readOptionalFixture<FixtureSeason>(`seasons/${season}.json`);
}

export function readSeasonSummaries(): SeasonSummary[] {
  return readFixture<SeasonSummary[]>("history/seasons.json");
}

export function readDrivers(): Driver[] {
  return readFixture<Driver[]>("history/drivers.json");
}

export function readConstructors(): Constructor[] {
  return readFixture<Constructor[]>("history/constructors.json");
}

export function readCircuits(): Circuit[] {
  return readFixture<Circuit[]>("history/circuits.json");
}

export function readLaps(season: number, round: number): RaceLaps | null {
  return readOptionalFixture<RaceLaps>(`laps/${season}-${round}.json`);
}

export function readTrack(circuitId: string): TrackOutline | null {
  return readOptionalFixture<TrackOutline>(`tracks/${circuitId}.json`);
}

export function readPrediction(): Prediction {
  const published = readOptionalExternal<Prediction>("predictions/next.json");
  if (published) return published;
  return readFixture<Prediction>("predictions/next.json");
}

export function readPredictionHistory(): PredictionHistoryEntry[] {
  const externalDir = path.join(DATA_DIR, "predictions/history");
  const fixtureDir = path.join(FIXTURE_DIR, "predictions/history");
  const dir = externalEnabled() && fs.existsSync(externalDir) && fs.readdirSync(externalDir).length > 0 ? externalDir : fixtureDir;
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  const entries: PredictionHistoryEntry[] = [];
  for (const file of files) {
    const entry = readJsonStamped<PredictionHistoryEntry>(path.join(dir, file));
    entries.push(entry);
  }
  entries.sort((a, b) => a.race.season - b.race.season || a.race.round - b.race.round);
  return entries;
}

export function readFantasyMarket(): FantasyMarket {
  return readFixture<FantasyMarket>("fantasy/2026.json");
}

/** data/predictions/fantasy.json when published, otherwise a contract-shaped file from the fixtures. */
export function readFantasyFile(): FantasyFile {
  const published = readOptionalExternal<FantasyFile>("predictions/fantasy.json");
  if (published) return published;
  const market = readFantasyMarket();
  const prediction = readPrediction();
  const forecastByDriver = new Map(prediction.drivers.map((d) => [d.driverId, d]));
  const forecastByTeam = new Map(prediction.constructors.map((c) => [c.constructorId, c]));
  const assets: FantasyFile["assets"] = [];
  for (const d of market.drivers) {
    const f = forecastByDriver.get(d.driverId);
    assets.push({
      id: d.driverId,
      kind: "driver",
      name: d.name,
      constructorId: d.constructorId,
      teamColor: d.teamColor,
      price: d.price,
      expectedPoints: f?.fantasy.expectedPoints ?? 0,
      p10: f?.fantasy.p10,
      p90: f?.fantasy.p90,
      expectedPriceChange: f?.fantasy.expectedPriceChange ?? 0,
      priceChangeProbs: f?.fantasy.priceChangeProbs,
      recentPoints: d.pointsHistory.filter((p): p is number => p !== null).slice(-3),
      active: d.active,
    });
  }
  for (const c of market.constructors) {
    const f = forecastByTeam.get(c.constructorId);
    assets.push({
      id: c.constructorId,
      kind: "constructor",
      name: c.name,
      constructorId: c.constructorId,
      teamColor: c.teamColor,
      price: c.price,
      expectedPoints: f?.fantasy.expectedPoints ?? 0,
      p10: f?.fantasy.p10,
      p90: f?.fantasy.p90,
      expectedPriceChange: f?.fantasy.expectedPriceChange ?? 0,
      priceChangeProbs: f?.fantasy.priceChangeProbs,
      recentPoints: c.pointsHistory.filter((p): p is number => p !== null).slice(-3),
    });
  }
  return {
    generatedAt: prediction.generatedAt,
    season: prediction.race.season,
    round: prediction.race.round,
    raceName: prediction.race.raceName,
    hasSprint: prediction.race.hasSprint,
    stage: prediction.race.stage,
    synthetic: true,
    rules: null,
    assets,
  };
}

/** data/serve/fantasy_rounds.json (f1p.fantasy.serve_rounds): round-aligned prices and points, or null. */
export function readFantasyRounds(): FantasyRoundsFile | null {
  return readOptionalExternal<FantasyRoundsFile>("serve/fantasy_rounds.json");
}

/** data/serve/telemetry/index.json (f1p.fastf1.telemetry_export): exported sessions, newest first. */
export function readTelemetryIndex(): TelemetryIndexEntry[] {
  const index = readOptionalExternal<{ sessions: TelemetryIndexEntry[] }>("serve/telemetry/index.json");
  return index?.sessions ?? [];
}

/** One session's fastest-lap telemetry, or null when it was not exported. */
export function readSessionTelemetry(ref: SessionRef): SessionTelemetry | null {
  const round = String(ref.round).padStart(2, "0");
  return readOptionalExternal<SessionTelemetry>(`serve/telemetry/${ref.season}/${round}_${ref.code}.json`);
}

/** data/serve/sessions/<season>/<RR>_<code>.json (f1p.fastf1.session_export), or null when not exported. */
export function readSessionReport(season: number, round: number, code: SessionCode): SessionReport | null {
  const paddedRound = String(round).padStart(2, "0");
  return readOptionalExternal<SessionReport>(`serve/sessions/${season}/${paddedRound}_${code}.json`);
}

export function predictionSource(): "published" | "fixture" {
  const file = path.join(DATA_DIR, "predictions/next.json");
  return externalEnabled() && fs.existsSync(file) ? "published" : "fixture";
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function readFixture<T>(rel: string): T {
  const file = path.join(FIXTURE_DIR, rel);
  return readJsonCached<T>(file);
}

function readOptionalFixture<T>(rel: string): T | null {
  const file = path.join(FIXTURE_DIR, rel);
  if (!fs.existsSync(file)) return null;
  return readJsonCached<T>(file);
}

function externalEnabled(): boolean {
  return process.env.F1_DATA_SOURCE !== "fixtures";
}

function readOptionalExternal<T>(rel: string): T | null {
  if (!externalEnabled()) return null;
  const file = path.join(DATA_DIR, rel);
  if (!fs.existsSync(file)) return null;
  try {
    return readJsonStamped<T>(file);
  } catch {
    return null;
  }
}

function readJsonCached<T>(file: string): T {
  const hit = cache.get(file);
  if (hit) return hit as T;
  const parsed = readJsonFresh<T>(file);
  cache.set(file, parsed);
  return parsed;
}

function readJsonStamped<T>(file: string): T {
  const stat = fs.statSync(file);
  const stamp = `${stat.mtimeMs}:${stat.size}`;
  const hit = stampedCache.get(file);
  if (hit && hit.stamp === stamp) return hit.value as T;
  const parsed = readJsonFresh<T>(file);
  stampedCache.set(file, { stamp, value: parsed });
  return parsed;
}

function readJsonFresh<T>(file: string): T {
  const text = fs.readFileSync(file, "utf8");
  return JSON.parse(text) as T;
}
