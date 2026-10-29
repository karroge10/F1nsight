"use client";

import { useCallback, useEffect, useState } from "react";
import type { LiveReplaySession } from "@/lib/live/replay-sessions";
import type { ReplayWeekend } from "@/lib/live/replay-list";
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
  weekends: ReplayWeekend[];
  replay: ReplayTarget | null;
  /** True when no session was picked in the URL: a live session then wins over the default replay. */
  preferLive: boolean;
  sessions: LiveReplaySession[];
}

/**
 * Live page body: the status bar with the pit stops and race control menus, the timing tower on
 * the left, the track map on the right, then, for replays, the player. The tower is exactly as
 * tall as the right column and scrolls inside if the field does not fit. Clicking a driver in
 * the tower or on the map pins that car: it lights on the map, the rest fade, and the pit stops
 * and race control logs narrow to it; clicking again, Esc or "All drivers" clears. If a session is
 * live and no replay is picked it opens live, otherwise the newest replay; picking a session from
 * the list below switches to that replay. Replays start playing straight away.
 */
export function LiveView({ replay, preferLive, sessions, weekends }: LiveViewProps) {
  const { state, controls } = useLiveSession({ replay, preferLive });
  const [showLabels, setShowLabels] = useState(true);
  const [showCorners, setShowCorners] = useState(false);
  const [zoom, setZoom] = useState(1);
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
      <StatusBar
        state={state}
        raceName={listed?.raceName ?? null}
        actions={
          state.session ? (
            <>
              <PitStopsMenu stops={state.pitStops} drivers={state.drivers} season={season} driver={pinnedDriver} onClearDriver={clearPin} />
              {state.source !== "mock" ? <RaceControlMenu messages={state.raceControl} driver={pinnedDriver} onClearDriver={clearPin} /> : null}
            </>
          ) : null
        }
      />

      {state.source === "mock" ? <p className="mt-3 text-caption text-ink-3">Reconstructed from recorded lap times. Car positions are estimated; recorded race-control messages and weather are unavailable.</p> : null}
      <div className="mt-3 grid items-start gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <section aria-label="Track and playback" className="min-w-0 overflow-hidden rounded-control border border-rule bg-bg-sunken lg:col-start-2 lg:row-start-1">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-3 py-2">
            <h2 className="text-ui font-[600] text-ink">Track map</h2>
            <div className="flex flex-wrap items-center gap-2 text-caption text-ink-2">
              <button type="button" aria-pressed={showLabels} onClick={() => setShowLabels(value => !value)} className="map-option">Driver codes <span aria-hidden="true">{showLabels ? "On" : "Off"}</span></button>
              <button type="button" aria-pressed={showCorners} onClick={() => setShowCorners(value => !value)} className="map-option">Corners <span aria-hidden="true">{showCorners ? "On" : "Off"}</span></button>
            </div>
          </div>
          <div className="relative overflow-hidden p-2">
            <TrackMap state={state} highlight={pinned} onSelect={select} showLabels={showLabels} showCorners={showCorners} zoom={zoom} className="mx-auto block h-[350px] w-full sm:h-[460px]" />
            <div className="absolute top-12 right-3 flex flex-col rounded-control border border-rule bg-bg/95" role="group" aria-label="Map zoom">
              <button type="button" aria-label="Zoom in" onClick={() => setZoom(value => Math.min(3, value * 1.25))} className="min-h-9 min-w-9">+</button>
              <button type="button" aria-label="Reset map zoom" onClick={() => setZoom(1)} className="min-h-9 min-w-9 border-y border-rule text-caption">1:1</button>
              <button type="button" aria-label="Zoom out" onClick={() => setZoom(value => Math.max(1, value / 1.25))} className="min-h-9 min-w-9">-</button>
            </div>
          </div>
          <SessionInsights state={state} selected={pinned} onSelect={select} />
          {isReplay ? <div className="border-t border-rule p-2"><Player state={state} controls={controls} /></div> : null}
        </section>
        <section aria-label="Timing tower" className="min-w-0 overflow-hidden rounded-control border border-rule bg-bg lg:col-start-1 lg:row-start-1">
          <div className="flex min-h-12 items-center justify-between gap-2 border-b border-rule px-3 py-2">
            <h2 className="text-ui font-[600] text-ink">Leaderboard</h2>
            {pinnedDriver ? <button type="button" onClick={clearPin} className="min-h-8 rounded-control border border-rule px-2 text-caption text-ink-2">{pinnedDriver.code} selected <span className="ml-1" aria-hidden="true">×</span><span className="sr-only">, show all drivers</span></button> : <span className="text-caption text-ink-3">{state.timing.length || state.drivers.size} drivers</span>}
          </div>
          <TimingTower rows={state.timing} drivers={state.drivers} season={season} showDrs={state.hasDrs} isRace={isRace} pinned={pinned} onSelect={select} expanded />
        </section>
      </div>

      <div className="mt-10 hairline-y pt-4">
        <h2 className="section-title">Replay a session</h2>
        <div className="mt-3">
          <SessionBrowser sessions={sessions} selected={replay} weekends={weekends} />
        </div>
      </div>
    </div>
  );
}

function SessionInsights({ state, selected, onSelect }: { state: import("@/lib/live/reducer").LiveState; selected: number | null; onSelect: (number: number) => void }) {
  const number = selected ?? state.timing[0]?.number;
  const driver = number !== undefined ? state.drivers.get(number) : null;
  const row = state.timing.find(item => item.number === number);
  const stops = state.pitStops.slice(0, 4);
  return <div className="grid gap-px border-t border-rule bg-rule sm:grid-cols-2">
    <section className="bg-bg p-3" aria-label="Driver detail">
      <h3 className="text-caption font-[600] text-ink">{driver?.name ?? "Driver detail"}</h3>
      {row ? <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-caption"><dt className="text-ink-3">Position</dt><dd className="timing text-right">P{row.pos}</dd><dt className="text-ink-3">Gap to leader</dt><dd className="timing text-right">{row.gap ?? (row.pos === 1 ? "Leader" : "Unavailable")}</dd><dt className="text-ink-3">Last lap</dt><dd className="timing text-right">{row.lastLap.value ?? "Not set"}</dd><dt className="text-ink-3">Best lap</dt><dd className="timing text-right">{row.bestLap.value ?? "Not set"}</dd></dl> : <p className="mt-3 text-caption text-ink-3">Select a driver in the leaderboard or map.</p>}
    </section>
    <section className="bg-bg p-3" aria-label="Recent pit stops"><h3 className="text-caption font-[600] text-ink">Recent pit stops</h3>
      {stops.length ? <ol className="mt-2">{stops.map((stop, index) => <li key={`${stop.number}-${stop.t}-${index}`}><button type="button" onClick={() => onSelect(stop.number)} className="flex min-h-8 w-full items-center justify-between gap-2 border-b border-rule text-caption"><span className="font-[550]">{state.drivers.get(stop.number)?.code ?? stop.number}</span><span className="timing text-ink-3">L{stop.lap ?? "?"}</span><span className="timing">{stop.duration === null ? "Time unavailable" : `${(stop.duration / 1000).toFixed(1)}s`}</span></button></li>)}</ol> : <p className="mt-3 text-caption text-ink-3">No stops recorded at this point in the session.</p>}
    </section>
  </div>;
}
