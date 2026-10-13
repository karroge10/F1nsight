"use client";

import { useCallback, useEffect, useState } from "react";
import type { LiveReplaySession } from "@/lib/live/replay-sessions";
import { useLiveSession, type ReplayTarget } from "@/lib/live/use-live-session";
import { togglePin } from "@/lib/live/highlight";
import { TrackMap } from "./track-map";
import { TimingTower } from "./timing-tower";
import { StatusBar } from "./status-bar";
import { RaceControlMenu } from "./race-control-menu";
import { PitStopsMenu } from "./pit-stops-menu";
import { Player } from "./player";
import { SessionBrowser } from "./session-browser";
import "./live.css";

interface LiveViewProps {
  replay: ReplayTarget | null;
  /** True when no session was picked in the URL: a live session then wins over the default replay. */
  preferLive: boolean;
  sessions: LiveReplaySession[];
}

/**
 * Live page body: the timing tower on the left, the track map on the right with the pit stops
 * and race control menus in its corner, then, for replays, the player. The tower is exactly as
 * tall as the right column and scrolls inside if the field does not fit. Clicking a driver in
 * the tower or on the map pins that car: it lights on the map, the rest fade, and the pit stops
 * and race control logs narrow to it; clicking again, Esc or "All drivers" clears. If a session is
 * live and no replay is picked it opens live, otherwise the newest replay; picking a session from
 * the list below switches to that replay. Replays start playing straight away.
 */
export function LiveView({ replay, preferLive, sessions }: LiveViewProps) {
  const { state, controls } = useLiveSession({ replay, preferLive });
  const [pinned, setPinned] = useState<number | null>(null);
  const isLive = state.connection === "live";
  const isReplay = !isLive && replay !== null;
  const isRace = !state.session || state.session.code === "R" || state.session.code === "S";
  const pinnedDriver = pinned !== null ? (state.drivers.get(pinned) ?? null) : null;
  const season = state.session?.season ?? null;
  const listed = sessions.find((s) => s.season === season && s.round === state.session?.round);
  const select = useCallback((number: number) => setPinned((current) => togglePin(current, number)), []);
  const clearPin = useCallback(() => setPinned(null), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setPinned(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="mx-auto max-w-[1440px] px-4 sm:px-6">
      <StatusBar state={state} raceName={listed?.raceName ?? null} />

      <div className={"mt-4 grid gap-4 lg:grid-cols-[28.5rem_minmax(0,1fr)] " + (isReplay ? "lg:grid-rows-[auto_auto]" : "")}>
        <div className="relative rounded-control bg-bg-sunken p-2 sm:p-4 lg:col-start-2 lg:row-start-1">
          <TrackMap state={state} highlight={pinned} onSelect={select} className="mx-auto block h-auto w-full lg:h-[min(64vh,620px)] lg:w-auto lg:max-w-full" />
          <div className="absolute right-3 top-3 flex items-center gap-2">
            <PitStopsMenu stops={state.pitStops} drivers={state.drivers} season={season} driver={pinnedDriver} onClearDriver={clearPin} />
            <RaceControlMenu messages={state.raceControl} driver={pinnedDriver} onClearDriver={clearPin} />
          </div>
        </div>

        {isReplay ? (
          <div className="lg:col-start-2 lg:row-start-2">
            <Player state={state} controls={controls} />
          </div>
        ) : null}

        <div className={"relative lg:col-start-1 lg:row-start-1 lg:min-h-0 " + (isReplay ? "lg:row-span-2" : "")}>
          <div className="lg:absolute lg:inset-0 lg:overflow-y-auto">
            <TimingTower rows={state.timing} drivers={state.drivers} season={season} showDrs={state.hasDrs} isRace={isRace} pinned={pinned} onSelect={select} />
          </div>
        </div>
      </div>

      <div className="mt-10 hairline-y pt-4">
        <h2 className="section-title">Replay a session</h2>
        <div className="mt-3">
          <SessionBrowser sessions={sessions} selected={replay} />
        </div>
      </div>
    </div>
  );
}
