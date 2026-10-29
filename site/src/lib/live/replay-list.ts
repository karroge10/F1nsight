// Client-safe half of the replay list: picking a session from the URL and merging in the live
// service archive when the service is reachable. The build-time half is replay-sessions.ts.

import type { ReplaySession } from "@/lib/data/types";
import { liveServiceHttp } from "@/lib/live/client";
import { sessionName } from "@/lib/sessions";

/** A replayable session plus the host country, for the flag in the replay list. */
export interface LiveReplaySession extends ReplaySession {
  country: string | null;
}

export interface LiveSearchParams {
  season?: string;
  round?: string;
  session?: string;
}

export interface ReplayWeekend {
  season: number;
  round: number;
  raceName: string;
  country: string | null;
  date: string;
  hasSprint: boolean;
}

/** The session the URL asks for, or the same round's first session, or nothing. */
export function pickSession(sessions: LiveReplaySession[], params: LiveSearchParams): LiveReplaySession | null {
  if (sessions.length === 0) return null;
  const season = Number(params.season);
  const round = Number(params.round);
  const code = params.session ?? "R";
  const exact = sessions.find((s) => s.season === season && s.round === round && s.session === code);
  if (exact) return exact;
  if (params.session !== undefined) return null;
  const sameRound = sessions.find((s) => s.season === season && s.round === round);
  return sameRound ?? null;
}

/** The prerendered sessions plus the service archive's, the service winning on duplicates, newest first. */
export function mergeSessions(local: LiveReplaySession[], service: LiveReplaySession[]): LiveReplaySession[] {
  const merged = new Map<string, LiveReplaySession>();
  for (const s of local) merged.set(`${s.season}-${s.round}-${s.session}`, s);
  for (const s of service) merged.set(`${s.season}-${s.round}-${s.session}`, s);
  const out = [...merged.values()];
  out.sort((a, b) => b.season - a.season || b.round - a.round || sessionOrder(a.session) - sessionOrder(b.session));
  return out;
}

/** The most recently completed session in the newest weekend with replay data. */
export function pickDefaultSession(sessions: LiveReplaySession[]): LiveReplaySession | null {
  if (sessions.length === 0) return null;
  const latestWeekend = sessions.reduce((latest, session) => {
    if (session.season > latest.season || (session.season === latest.season && session.round > latest.round)) return session;
    return latest;
  });
  const weekend = sessions.filter((s) => s.season === latestWeekend.season && s.round === latestWeekend.round);
  return weekend.sort((a, b) => defaultSessionOrder(a.session) - defaultSessionOrder(b.session))[0] ?? null;
}

/** This season's sessions in the live service archive, or none when there is no service. */
export async function fetchServiceReplays(season: number): Promise<LiveReplaySession[]> {
  const base = liveServiceHttp();
  if (!base) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(`${base}/sessions?season=${season}`, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) return [];
    const json = (await response.json()) as { sessions?: ServiceSession[] };
    const list = json.sessions ?? [];
    return list.filter((s) => s.round !== null && s.replay).map(toReplaySession);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

interface ServiceSession {
  season: number;
  round: number | null;
  session: string;
  name: string;
  meeting: string;
  country?: string | null;
  start: string;
  replay: string | null;
}

function toReplaySession(s: ServiceSession): LiveReplaySession {
  return {
    season: s.season,
    round: s.round as number,
    raceName: s.meeting,
    circuitId: null,
    session: s.session,
    sessionName: sessionName(s.session, s.name),
    date: s.start,
    source: "service",
    country: s.country ?? null,
  };
}

function sessionOrder(code: string) {
  const order = ["FP1", "FP2", "FP3", "SQ", "S", "Q", "R"];
  const idx = order.indexOf(code);
  return idx === -1 ? 99 : idx;
}

function defaultSessionOrder(code: string) {
  const order = ["R", "Q", "S", "SQ", "FP3", "FP2", "FP1"];
  const idx = order.indexOf(code);
  return idx === -1 ? 99 : idx;
}
