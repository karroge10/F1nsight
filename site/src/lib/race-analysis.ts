// Numbers derived from a race or sprint classification, its pit stops, the overtake counts and
// our own pre-race forecast. Pure functions, safe on server and client.

import type { Lookups, PitStop, PredictionHistoryEntry, ResultRow } from "@/lib/data";
import type { PitStopRow } from "@/components/stats/pit-stops-table";

export interface OvertakeCount {
  driverId: string;
  count: number;
}

export interface DriverAnalysisRow {
  driverId: string;
  constructorId: string;
  grid: number | null;
  position: number | null;
  positionText: string;
  classified: boolean;
  status: string;
  /** Places gained from the grid (positive is forward), null without a grid or a finish. */
  gained: number | null;
  overtakes: number | null;
  /** Our forecast's expected finishing position before the race. */
  expectedPosition: number | null;
  /** Places better than the forecast (positive beat it). */
  vsForecast: number | null;
  pitStops: number;
  fastestStopMs: number | null;
}

export interface RaceAnalysis {
  rows: DriverAnalysisRow[];
  overtakesTotal: number | null;
  biggestMover: DriverAnalysisRow | null;
  bestVsForecast: DriverAnalysisRow | null;
  fastestStop: PitStop | null;
  fastestLap: ResultRow | null;
  dnfs: ResultRow[];
  forecastStage: string | null;
}

// Pit lane times above this are red flag stoppages, not stops.
const STOPPAGE_MS = 120000;

/** Everything the analysis section shows, in finishing order. */
export function analyseRace(results: ResultRow[], pitStops: PitStop[], overtakes: OvertakeCount[], forecast: PredictionHistoryEntry | null): RaceAnalysis {
  const overtakesById = new Map(overtakes.map((o) => [o.driverId, o.count]));
  const expectedById = new Map((forecast?.drivers ?? []).map((d) => [d.driverId, d.expectedPosition]));
  const stopsById = new Map<string, PitStop[]>();
  for (const stop of pitStops) {
    const list = stopsById.get(stop.driverId) ?? [];
    list.push(stop);
    stopsById.set(stop.driverId, list);
  }
  const rows: DriverAnalysisRow[] = results.map((r) => {
    const stops = stopsById.get(r.driverId) ?? [];
    const realStops = stops.filter((s) => s.durationMs !== null && s.durationMs < STOPPAGE_MS);
    const expected = expectedById.get(r.driverId) ?? null;
    const hasGrid = r.grid !== null && r.grid > 0;
    return {
      driverId: r.driverId,
      constructorId: r.constructorId,
      grid: r.grid,
      position: r.position,
      positionText: r.positionText,
      classified: r.classified,
      status: r.status,
      gained: hasGrid && r.classified && r.position !== null ? (r.grid as number) - r.position : null,
      overtakes: overtakesById.get(r.driverId) ?? null,
      expectedPosition: expected,
      vsForecast: expected !== null && r.classified && r.position !== null ? Math.round(expected) - r.position : null,
      pitStops: realStops.length,
      fastestStopMs: realStops.length ? Math.min(...realStops.map((s) => s.durationMs as number)) : null,
    };
  });
  const realStops = pitStops.filter((s) => s.durationMs !== null && s.durationMs < STOPPAGE_MS);
  const fastestStop = realStops.length ? realStops.reduce((best, s) => ((s.durationMs as number) < (best.durationMs as number) ? s : best)) : null;
  const movers = rows.filter((r) => r.gained !== null && r.gained > 0);
  const biggestMover = movers.length ? movers.reduce((best, r) => ((r.gained as number) > (best.gained as number) ? r : best)) : null;
  const beaters = rows.filter((r) => r.vsForecast !== null);
  const bestVsForecast = beaters.length ? beaters.reduce((best, r) => ((r.vsForecast as number) > (best.vsForecast as number) ? r : best)) : null;
  return {
    rows,
    overtakesTotal: overtakes.length ? overtakes.reduce((sum, o) => sum + o.count, 0) : null,
    biggestMover,
    bestVsForecast: bestVsForecast && (bestVsForecast.vsForecast as number) > 0 ? bestVsForecast : null,
    fastestStop,
    fastestLap: results.find((r) => r.fastestLapRank === 1) ?? null,
    dnfs: results.filter((r) => !r.classified),
    forecastStage: forecast?.race.stage ?? null,
  };
}

/** Pit stops with the driver resolved, the shape the client-side table takes. */
export function toPitStopRows(pitStops: PitStop[], results: ResultRow[], lookups: Lookups): PitStopRow[] {
  const teamOf = new Map(results.map((r) => [r.driverId, r.constructorId]));
  return pitStops.map((p) => {
    const constructorId = teamOf.get(p.driverId) ?? "";
    return {
      driverId: p.driverId,
      code: lookups.driverCode(p.driverId),
      name: lookups.driverName(p.driverId),
      team: { constructorId, name: lookups.teamName(constructorId), color: lookups.teamColor(constructorId) },
      stop: p.stop,
      lap: p.lap,
      durationMs: p.durationMs,
    };
  });
}

/** Signed places text: "+3", "0", "-2" (a real minus sign). */
export function formatPlaces(value: number): string {
  if (value === 0) return "0";
  return value > 0 ? `+${value}` : `−${Math.abs(value)}`;
}
