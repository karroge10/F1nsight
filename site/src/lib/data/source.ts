// Chooses the storage behind the data layer: sqlite when data/serve/f1.sqlite exists
// (and F1_DATA_SOURCE is not "fixtures"), otherwise the JSON fixtures.

import * as fixtures from "./fixtures-source";
import * as sqlite from "./sqlite-source";
import type { SessionRef } from "@/lib/telemetry";
import type { SessionCode } from "./types";
import { mergeOfficialResults } from "./official-results";

export type SourceKind = "sqlite" | "fixtures";

export function activeSource(): SourceKind {
  return sqlite.sqliteAvailable() ? "sqlite" : "fixtures";
}

const impl = () => (sqlite.sqliteAvailable() ? sqlite : fixtures);

export const readIndex = () => impl().readIndex();
export const readSeason = (season: number) => {
  const data = impl().readSeason(season);
  if (!data || !sqlite.sqliteAvailable()) return data;
  const official = fixtures.readOfficialResults(season);
  if (!official) return data;
  return mergeOfficialResults(data, official);
};
export const readSeasonSummaries = () => impl().readSeasonSummaries();
export const readDrivers = () => impl().readDrivers();
export const readConstructors = () => impl().readConstructors();
export const readCircuits = () => impl().readCircuits();
export const readLaps = (season: number, round: number) => impl().readLaps(season, round);
export const readTrack = (circuitId: string) => fixtures.readTrack(circuitId);
export const readPrediction = () => fixtures.readPrediction();
export const readPredictionHistory = () => fixtures.readPredictionHistory();
export const readFantasyMarket = () => fixtures.readFantasyMarket();
export const readFantasyFile = () => fixtures.readFantasyFile();
export const readFantasyRounds = () => fixtures.readFantasyRounds();
export const readFantasyBacktest = () => fixtures.readFantasyBacktest();
export const readTelemetryIndex = () => fixtures.readTelemetryIndex();
export const readSessionTelemetry = (ref: SessionRef) => fixtures.readSessionTelemetry(ref);
export const readSessionReport = (season: number, round: number, code: SessionCode) => fixtures.readSessionReport(season, round, code);
export const predictionSource = () => fixtures.predictionSource();

export const readSessionReportIndex = () => fixtures.readSessionReportIndex();
