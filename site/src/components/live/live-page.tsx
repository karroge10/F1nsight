"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { probeServiceOnce } from "@/lib/live/client";
import { fetchServiceReplays, mergeSessions, pickSession, type LiveReplaySession, type LiveSearchParams } from "@/lib/live/replay-list";
import { PageIntro } from "@/components/ui/page-intro";
import { LocalTime } from "@/components/ui/local-time";
import { LiveView } from "./live-view";

interface LivePageProps {
  /** Races that replay from the files written at build time. */
  sessions: LiveReplaySession[];
  next: { raceName: string; time: string | null } | null;
}

interface LiveNow {
  name: string;
  raceName: string | null;
}

const NO_PARAMS: LiveSearchParams = {};

/**
 * The live page body. The page is prerendered without a query, so the HTML shows the default
 * state; the replay picked in the URL (`?season=2025&round=16&session=R`), the live session and
 * the live service archive are all resolved in the browser.
 */
export function LivePage({ sessions, next }: LivePageProps) {
  return (
    <Suspense fallback={<LiveBody sessions={sessions} next={next} params={NO_PARAMS} />}>
      <LiveBodyFromUrl sessions={sessions} next={next} />
    </Suspense>
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function LiveBodyFromUrl({ sessions, next }: LivePageProps) {
  const search = useSearchParams();
  const params: LiveSearchParams = {
    season: search.get("season") ?? undefined,
    round: search.get("round") ?? undefined,
    session: search.get("session") ?? undefined,
  };
  return <LiveBody sessions={sessions} next={next} params={params} />;
}

function LiveBody({ sessions, next, params }: LivePageProps & { params: LiveSearchParams }) {
  const [serviceSessions, setServiceSessions] = useState<LiveReplaySession[] | null>(null);
  const live = useLiveNow();
  const all = mergeSessions(sessions, serviceSessions ?? []);
  const requested = pickSession(all, params);
  const unavailable = params.season !== undefined && requested === null && serviceSessions !== null;

  useEffect(() => {
    let cancelled = false;
    const season = new Date().getUTCFullYear();
    fetchServiceReplays(season).then((list) => {
      if (!cancelled) setServiceSessions(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const replay = requested ? { season: requested.season, round: requested.round, session: requested.session } : null;
  return (
    <>
      <PageIntro
        compact
        label={
          <>
            Live <span className="mx-1.5 text-ink-3">/</span> Track map and timing
          </>
        }
        title={requested ? `${requested.raceName} ${requested.season}, ${requested.sessionName.toLowerCase()}` : "Live timing and replays"}
        dek={unavailable ? "Replays of this session are not available here yet." : <LiveDek live={live} next={next} showWatchLive={requested !== null} />}
      />
      <LiveView replay={replay} sessions={all} />
    </>
  );
}

function LiveDek({ live, next, showWatchLive }: { live: LiveNow | null; next: LivePageProps["next"]; showWatchLive: boolean }) {
  if (live) {
    return (
      <>
        Live now: {live.raceName ? `${live.raceName}, ` : ""}
        {live.name.toLowerCase()}.
        {showWatchLive ? (
          <>
            {" "}
            <Link href="/live" className="font-[550] text-ink underline underline-offset-2">
              Watch live
            </Link>
          </>
        ) : null}
      </>
    );
  }
  if (!next) return null;
  return (
    <>
      Live when a session runs. Next: {next.raceName}
      {next.time ? (
        <>
          , <LocalTime iso={next.time} />
        </>
      ) : null}
      .
    </>
  );
}

/** The session running now, from the live service, or null when nothing is live or there is no service. */
function useLiveNow(): LiveNow | null {
  const [live, setLive] = useState<LiveNow | null>(null);
  useEffect(() => {
    let cancelled = false;
    probeServiceOnce().then((status) => {
      const session = status?.live ? status.session : null;
      if (cancelled || !session || typeof session.name !== "string") return;
      const raceName = typeof session.raceName === "string" ? session.raceName : null;
      setLive({ name: session.name, raceName });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return live;
}
