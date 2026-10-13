import type { Metadata } from "next";
import { getCalendar, getCurrentSeason, getNextRace } from "@/lib/data";
import { replayableSessions } from "@/lib/live/replay-sessions";
import { LivePage as LivePageBody } from "@/components/live/live-page";

export const metadata: Metadata = {
  title: "Live timing and replay",
  description: "Large track map with a broadcast-style timing tower, race control and weather. Replays past sessions when nothing is live.",
};

export default async function LivePage() {
  const sessions = await replayableSessions();
  const race = await getNextRace();
  const next = race ? { raceName: race.raceName, time: race.sessions.race ?? null } : null;
  const season = await getCurrentSeason();
  const calendar = await getCalendar(season);
  const raceNames = Object.fromEntries(calendar.map((r) => [`${r.season}-${r.round}`, r.raceName]));
  return <LivePageBody sessions={sessions} next={next} raceNames={raceNames} />;
}
