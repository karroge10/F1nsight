"use client";

// The parts of the home hero that depend on the clock and on the live service: the countdown
// and the weekend schedule. The page is prerendered, so both start from the build time and
// switch to the visitor's clock (and a live session, when the service reports one) after
// hydration.

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { probeServiceOnce } from "@/lib/live/client";
import { WeekendSchedule, type ScheduleEntry } from "@/components/stats/weekend-schedule";
import { Countdown } from "./countdown";

/** The session running right now, from the live service. */
export interface LiveSessionNow {
  name: string;
  start: string;
  end: string;
}

interface HeroClockProps {
  schedule: ScheduleEntry[];
  /** Build time, ISO: what the prerendered HTML is computed against. */
  builtAt: string;
}

const MINUTE_MS = 60 * 1000;

export function HeroCountdown({ schedule, builtAt }: HeroClockProps) {
  const now = useMinuteClock(builtAt);
  const live = useLiveSessionNow();
  const nextSession = schedule.find((s) => new Date(s.time).getTime() > now) ?? null;
  if (live) {
    return (
      <Link href="/live" className="group flex flex-col gap-3">
        <Countdown target={live.end} label={`${live.name} is live, ends in`} />
        <span className="inline-flex items-center gap-2 text-ui font-[550] text-ink group-hover:underline underline-offset-2">
          <span className="live-dot inline-block size-2 rounded-full bg-accent" aria-hidden="true" />
          Watch live timing
        </span>
      </Link>
    );
  }
  if (nextSession) return <Countdown target={nextSession.time} label={`${nextSession.label} starts in`} />;
  return <p className="label">Weekend complete</p>;
}

export function HeroSchedule({ schedule, builtAt, season, round }: HeroClockProps & { season: number; round: number }) {
  const now = useMinuteClock(builtAt);
  const live = useLiveSessionNow();
  const nextSession = schedule.find((s) => new Date(s.time).getTime() > now) ?? null;
  const liveKey = live ? (schedule.find((s) => new Date(s.time).getTime() === new Date(live.start).getTime())?.key ?? null) : null;
  const nowDate = new Date(now);
  return <WeekendSchedule season={season} round={round} schedule={schedule} now={nowDate} nextKey={liveKey ?? nextSession?.key ?? null} liveKey={liveKey} />;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Epoch ms, rounded down to the minute: the build time in the HTML, the visitor's clock after hydration. */
function useMinuteClock(builtAt: string): number {
  const builtMs = new Date(builtAt).getTime();
  return useSyncExternalStore(subscribeMinutes, currentMinute, () => builtMs);
}

function subscribeMinutes(onChange: () => void) {
  const id = window.setInterval(onChange, MINUTE_MS);
  return () => window.clearInterval(id);
}

function currentMinute(): number {
  return Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;
}

function useLiveSessionNow(): LiveSessionNow | null {
  const [live, setLive] = useState<LiveSessionNow | null>(null);
  useEffect(() => {
    let cancelled = false;
    probeServiceOnce().then((status) => {
      const session = status?.live ? status.session : null;
      if (cancelled || !session) return;
      if (typeof session.name !== "string" || typeof session.start !== "string" || typeof session.end !== "string") return;
      setLive({ name: session.name, start: session.start, end: session.end });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return live;
}
