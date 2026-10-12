"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchServiceReplays, type LiveReplaySession } from "@/lib/live/replay-list";
import { IconPlay } from "@/components/icons";

interface ReplayLinkProps {
  season: number;
  round: number;
  /** Timing code: `R`, `Q`, `FP1`. */
  code: string;
  /** True when the session replays from the files written at build time. */
  prerendered: boolean;
}

const archives = new Map<number, Promise<LiveReplaySession[]>>();

/**
 * "Watch replay" for a session. Races with build-time replay files always get it; any other
 * session only when the live service is reachable and has it in its archive.
 */
export function ReplayLink({ season, round, code, prerendered }: ReplayLinkProps) {
  const inArchive = useInServiceArchive(season, round, code, !prerendered);
  if (!prerendered && !inArchive) return null;
  return (
    <Link href={`/live?season=${season}&round=${round}&session=${code}`} className="press inline-flex h-9 w-fit items-center gap-2 rounded-control border border-rule px-3.5 text-ui text-ink hover:border-rule-strong">
      <IconPlay size="1rem" />
      Watch replay
    </Link>
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function useInServiceArchive(season: number, round: number, code: string, enabled: boolean): boolean {
  const [found, setFound] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    seasonArchive(season).then((sessions) => {
      const match = sessions.some((s) => s.round === round && s.session === code);
      if (!cancelled && match) setFound(true);
    });
    return () => {
      cancelled = true;
    };
  }, [season, round, code, enabled]);
  return found;
}

function seasonArchive(season: number): Promise<LiveReplaySession[]> {
  const known = archives.get(season);
  if (known) return known;
  const loading = fetchServiceReplays(season);
  archives.set(season, loading);
  return loading;
}
