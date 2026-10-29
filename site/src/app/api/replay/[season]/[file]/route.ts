import { notFound } from "next/navigation";
import { getEntryList, getRace, getTrackOutline, getSessionReport } from "@/lib/data";
import { replayableSessions } from "@/lib/live/replay-sessions";
import type { SessionCode } from "@/lib/data";
import type { ReplayPayload } from "@/lib/live/mock-stream";

type Params = Promise<{ season: string; file: string }>;

export const dynamic = "force-static";
export const dynamicParams = false;

/** One file per race with lap data and a track outline: `/api/replay/2025/16.json`. */
export async function generateStaticParams(): Promise<{ season: string; file: string }[]> {
  const sessions = await replayableSessions();
  const params = sessions.filter((s) => s.source === "fixture").map((s) => ({ season: String(s.season), file: s.session === "R" ? `${s.round}.json` : `${s.round}_${s.session}.json` }));
  return params;
}

/** Replay fixture for the mock stream: real laps, pit stops and track outline for one race, written at build time. */
export async function GET(_request: Request, context: { params: Params }) {
  const params = await context.params;
  const season = Number(params.season);
  const match = /^(\d+)(?:_(FP1|FP2|FP3|SQ|S|Q))?\.json$/.exec(params.file);
  if (!match) notFound();
  const round = Number(match[1]);
  const code = (match[2] ?? "R") as SessionCode;
  const payload = code === "R" ? await replayPayload(season, round) : await sessionPayload(season, round, code);
  if (!payload) notFound();
  return Response.json(payload);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function replayPayload(season: number, round: number): Promise<ReplayPayload | null> {
  const race = await getRace(season, round);
  if (!race || !race.laps) return null;
  const track = await getTrackOutline(race.circuitId);
  if (!track) return null;
  const entries = await getEntryList(season);
  const entryById = new Map(entries.drivers.map((d) => [d.driverId, d]));

  const drivers: ReplayPayload["drivers"] = race.results.map((row) => {
    const entry = entryById.get(row.driverId);
    const laps = race.laps?.laps[row.driverId] ?? [];
    const pitLaps = (race.laps?.pitStops ?? []).filter((p) => p.driverId === row.driverId && p.lap !== null).map((p) => p.lap as number);
    const retired = !row.classified || row.positionText === "R";
    return {
      driverId: row.driverId,
      number: row.number ?? entry?.number ?? 0,
      code: entry?.code ?? row.driverId.slice(0, 3).toUpperCase(),
      name: entry?.name ?? row.driverId,
      team: entry?.team ?? row.constructorId,
      teamColor: entry?.teamColor ?? "#8A8F98",
      grid: row.grid,
      laps,
      pitLaps,
      retiredAfterLap: retired ? laps.length : null,
    };
  });

  const payload: ReplayPayload = {
    session: {
      key: season * 100 + round,
      season,
      round,
      code: "R",
      name: "Race",
      type: "Race",
      meeting: race.raceName,
      location: race.locality,
      country: race.country,
      circuit: race.circuitName,
      start: race.time,
      totalLaps: race.scheduledLaps ?? Math.max(...drivers.map((d) => d.laps.length)),
    },
    track: {
      outline: track.outline,
      rotation: track.rotation,
      corners: track.corners.map((c) => ({ number: c.number, letter: null, x: c.x, y: c.y, angle: c.angle })),
      sectors: timingSectors(track.outline.length),
      finish: track.outline[0] ?? null,
      source: track.source,
    },
    drivers,
  };
  return payload;
}

function timingSectors(points: number): { number: number; start: number; end: number }[] {
  const third = Math.floor(points / 3);
  return [
    { number: 1, start: 0, end: third },
    { number: 2, start: third, end: third * 2 },
    { number: 3, start: third * 2, end: points - 1 },
  ];
}

async function sessionPayload(season: number, round: number, code: SessionCode): Promise<ReplayPayload | null> {
  const race = await getRace(season, round);
  const report = await getSessionReport(season, round, code);
  if (!race || !report?.lapStarts) return null;
  const track = await getTrackOutline(race.circuitId);
  if (!track) return null;
  return {
    session: { season, round, code, name: report.sessionName, meeting: race.raceName, start: null, totalLaps: null },
    track: { outline: track.outline, rotation: track.rotation, corners: track.corners, sectors: timingSectors(track.outline.length), finish: track.outline[0] },
    drivers: report.drivers.filter((d) => d.number !== null).map((d) => ({ driverId: d.driverId, number: d.number!, code: d.code, name: d.name, team: d.team, teamColor: d.color ?? "#8A8F98", grid: null, laps: [], pitLaps: [], retiredAfterLap: null })),
    report,
  };
}
