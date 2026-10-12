// Pure helpers over a SessionReport (data/serve/sessions): the shapes the result tables and
// charts need. No I/O, safe on server and client.

import type { Lookups, PitStop, RaceLaps, ResultRow, SessionClassificationRow, SessionReport } from "@/lib/data";
import { LAP_FLAG_DELETED, LAP_FLAG_PIT_IN, LAP_FLAG_PIT_OUT } from "@/lib/data";

export interface LongRun {
  driverId: string;
  compound: string | null;
  laps: number;
  averageMs: number;
  bestMs: number;
}

export interface QualifyingGroup {
  /** 3 for the drivers who ran the final part, 2 for those out in the second, 1 for the first. */
  stage: 1 | 2 | 3;
  rows: SessionClassificationRow[];
  /** Fastest time of that part, the reference for the gaps. */
  bestMs: number | null;
}

// A representative lap is at most this much slower than the driver's best of the session.
const LONG_RUN_TOLERANCE = 1.08;
const LONG_RUN_MIN_LAPS = 5;

/**
 * The site's own names and colours (so a driver reads the same on every page), with the
 * report's entry list filling in anyone the history database does not know yet.
 */
export function reportLookups(report: SessionReport, site: Lookups): Lookups {
  const byDriver = new Map(report.drivers.map((d) => [d.driverId, d]));
  const byTeam = new Map(report.drivers.map((d) => [d.constructorId, d]));
  const known = (value: string, id: string) => value !== id;
  return {
    driverName: (id) => {
      const name = site.driverName(id);
      return known(name, id) ? name : byDriver.get(id)?.name ?? name;
    },
    driverCode: (id) => byDriver.get(id)?.code ?? site.driverCode(id),
    teamName: (id) => {
      const name = site.teamName(id);
      return known(name, id) ? name : byTeam.get(id)?.team ?? name;
    },
    teamColor: (id) => site.teamColor(id),
  };
}

/** Race or sprint classification in the shape of the Jolpica results tables. */
export function toResultRows(report: SessionReport): ResultRow[] {
  const teamOf = new Map(report.drivers.map((d) => [d.driverId, d]));
  const winner = report.classification.find((r) => r.position === 1) ?? null;
  const winnerTime = winner?.timeMs ?? null;
  const winnerLaps = winner?.laps ?? null;
  const fastestOrder = [...report.classification].filter((r) => r.bestLapMs !== null).sort((a, b) => (a.bestLapMs ?? 0) - (b.bestLapMs ?? 0));
  const fastestRank = new Map(fastestOrder.map((r, i) => [r.driverId, i + 1]));
  return report.classification.map((row) => {
    const classified = row.position !== null && /^\d+$/.test(row.positionText);
    const lapped = classified && winnerLaps !== null && row.laps !== null && row.laps < winnerLaps;
    const lapsDown = lapped ? (winnerLaps as number) - (row.laps as number) : 0;
    let timeMs: number | null = null;
    if (row.position === 1) timeMs = row.timeMs;
    else if (classified && !lapped && row.timeMs !== null && winnerTime !== null) timeMs = winnerTime + row.timeMs;
    const status = lapped ? `+${lapsDown} ${lapsDown === 1 ? "lap" : "laps"}` : classified ? row.status : retirementStatus(row.status);
    return {
      position: classified ? row.position : null,
      positionText: row.positionText || (row.position ? String(row.position) : ""),
      driverId: row.driverId,
      constructorId: teamOf.get(row.driverId)?.constructorId ?? "",
      number: teamOf.get(row.driverId)?.number ?? null,
      grid: row.grid,
      laps: row.laps,
      status,
      classified,
      points: row.points,
      timeMs,
      fastestLapRank: fastestRank.get(row.driverId) ?? null,
      fastestLapMs: row.bestLapMs,
      fastestLapNumber: row.bestLapNumber,
    };
  });
}

/** Position by lap and pit stops in the shape of the lap chart and pit stop table. */
export function toRaceLaps(report: SessionReport): RaceLaps | null {
  const laps: RaceLaps["laps"] = {};
  let anyPosition = false;
  for (const [driverId, list] of Object.entries(report.laps)) {
    const tuples: RaceLaps["laps"][string] = [];
    for (const lap of list) {
      if (lap[0] === null) continue;
      if (lap[7] !== null) anyPosition = true;
      tuples.push([lap[0], lap[7], lap[1]]);
    }
    if (tuples.length) laps[driverId] = tuples;
  }
  if (!anyPosition) return null;
  const pitStops: PitStop[] = report.pitStops.map((p) => ({ driverId: p.driverId, stop: p.stop, lap: p.lap, durationMs: p.durationMs, localTime: null }));
  return { season: report.season, round: report.round, laps, pitStops };
}

/** Laps a driver completed in the session. */
export function lapsCompleted(report: SessionReport, driverId: string): number {
  const list = report.laps[driverId] ?? [];
  return list.filter((lap) => lap[1] !== null).length;
}

/**
 * Long runs in a practice session: stints of at least five representative laps (timed, not
 * deleted, not in or out laps, within 8% of the driver's best), fastest average first.
 */
export function longRuns(report: SessionReport): LongRun[] {
  const out: LongRun[] = [];
  for (const [driverId, list] of Object.entries(report.laps)) {
    const timed = list.filter((lap) => lap[1] !== null).map((lap) => lap[1] as number);
    if (timed.length === 0) continue;
    const best = Math.min(...timed);
    const limit = best * LONG_RUN_TOLERANCE;
    const byStint = new Map<string, { compound: string | null; times: number[] }>();
    let stintKey = 0;
    for (const lap of list) {
      const flags = lap[8];
      if (flags & LAP_FLAG_PIT_OUT) stintKey += 1;
      const time = lap[1];
      const representative = time !== null && !(flags & LAP_FLAG_DELETED) && !(flags & (LAP_FLAG_PIT_IN | LAP_FLAG_PIT_OUT)) && time <= limit;
      if (!representative) continue;
      const key = `${stintKey}:${lap[5] ?? ""}`;
      const entry = byStint.get(key) ?? { compound: lap[5], times: [] };
      entry.times.push(time as number);
      byStint.set(key, entry);
    }
    for (const entry of byStint.values()) {
      if (entry.times.length < LONG_RUN_MIN_LAPS) continue;
      const sum = entry.times.reduce((a, b) => a + b, 0);
      out.push({ driverId, compound: entry.compound, laps: entry.times.length, averageMs: Math.round(sum / entry.times.length), bestMs: Math.min(...entry.times) });
    }
  }
  out.sort((a, b) => a.averageMs - b.averageMs);
  return out;
}

/**
 * Qualifying rows split by the part they reached, in classification order. A driver's part is
 * the last one they set a time in, and never below that of anyone classified behind them.
 */
export function qualifyingGroups(report: SessionReport): QualifyingGroup[] {
  const rows = [...report.classification].sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
  const stages: (1 | 2 | 3)[] = rows.map((r) => (r.q3Ms !== null ? 3 : r.q2Ms !== null ? 2 : 1));
  for (let i = rows.length - 2; i >= 0; i--) {
    if (stages[i + 1] > stages[i]) stages[i] = stages[i + 1];
  }
  const groups: QualifyingGroup[] = [];
  for (const stage of [3, 2, 1] as const) {
    const members = rows.filter((_, i) => stages[i] === stage);
    if (members.length === 0) continue;
    const times = rows.map((r) => partTime(r, stage)).filter((t): t is number => t !== null && t > 0);
    groups.push({ stage, rows: members, bestMs: times.length ? Math.min(...times) : null });
  }
  return groups;
}

/** Timing calls a retired car "Lapped" or "Finished" by where it stopped; the table wants why it is out. */
function retirementStatus(status: string): string {
  if (status === "Lapped" || status === "Finished" || status === "") return "Retired";
  return status;
}

/** The time a driver set in one part of qualifying. */
export function partTime(row: SessionClassificationRow, stage: 1 | 2 | 3): number | null {
  if (stage === 3) return row.q3Ms;
  if (stage === 2) return row.q2Ms;
  return row.q1Ms;
}
