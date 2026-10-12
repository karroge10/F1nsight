import { getAvailableTracks, getCalendar, getRaceLapsAvailability } from "@/lib/data";
import { mergeSessions, type LiveReplaySession } from "@/lib/live/replay-list";
import { sessionName } from "@/lib/sessions";

export type { LiveReplaySession, LiveSearchParams } from "@/lib/live/replay-list";

/**
 * Every race that replays from the files written at build time (lap data plus a track outline),
 * newest first. The live service archive adds more sessions in the browser when it is reachable.
 */
export async function replayableSessions(): Promise<LiveReplaySession[]> {
  const local = await fixtureSessions();
  return mergeSessions(local, []);
}

async function fixtureSessions(): Promise<LiveReplaySession[]> {
  const lapFiles = await getRaceLapsAvailability();
  const tracks = new Set(await getAvailableTracks());
  const seasons = [...new Set(lapFiles.map((l) => l.season))];
  const out: LiveReplaySession[] = [];
  for (const season of seasons) {
    const calendar = await getCalendar(season);
    for (const race of calendar) {
      const hasLaps = lapFiles.some((l) => l.season === season && l.round === race.round);
      if (!hasLaps || !tracks.has(race.circuitId)) continue;
      out.push({ season, round: race.round, raceName: race.raceName, circuitId: race.circuitId, session: "R", sessionName: sessionName("R"), date: race.date, source: "fixture", country: race.country });
    }
  }
  return out;
}
