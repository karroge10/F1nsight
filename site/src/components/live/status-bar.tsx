"use client";

import type { ReactNode } from "react";
import type { LiveState } from "@/lib/live/reducer";
import { IconChequered, IconDrop, IconFlag, IconRainDrop, IconSafetyCar, IconThermometer, IconTrackTemp, IconVsc, IconWindArrow } from "@/components/icons";

interface StatusBarProps {
  state: LiveState;
}

const ICON_SIZE = "1.125rem";

/**
 * One line above the map: track state with its icon, lap or clock, the session, and on the
 * right the weather readout (or the connection state while nothing plays yet).
 */
export function StatusBar({ state }: StatusBarProps) {
  const status = state.session ? trackStatus(state.trackState) : { label: "No session", icon: null };
  const isRace = state.session?.code === "R" || state.session?.code === "S";
  const lapText = state.lap ? (state.lap.total ? `${state.lap.current} / ${state.lap.total}` : String(state.lap.current)) : "";
  const clockText = state.clock?.remainingMs !== null && state.clock?.remainingMs !== undefined ? formatRemaining(state.clock.remainingMs) : "";
  const partText = state.sessionPart ? `Q${state.sessionPart}` : "";
  const pending = pendingLabel(state);
  return (
    <div className="track-status flex flex-wrap items-center gap-x-5 gap-y-2 border-y border-rule py-2" data-status={!state.session ? "idle" : state.trackState === "vscEnding" ? "vsc" : state.trackState}>
      <span className="flex items-center gap-2">
        {/* the track state colour; with no session there is no state to show */}
        {state.session ? <span className="inline-block h-5 w-1.5 rounded-chip" style={{ background: "var(--status)" }} aria-hidden="true" /> : null}
        {status.icon ? <span className="text-ink-2">{status.icon}</span> : null}
        <span className="text-ui font-[550] text-ink">{status.label}</span>
      </span>
      {isRace && lapText ? (
        <span className="flex items-baseline gap-2">
          <span className="label">Lap</span>
          <span className="timing text-ui text-ink">{lapText}</span>
        </span>
      ) : null}
      {!isRace && (partText || clockText) ? (
        <span className="flex items-baseline gap-2">
          {partText ? <span className="timing text-ui text-ink">{partText}</span> : null}
          {clockText ? <span className="timing text-ui text-ink-2">{clockText}</span> : null}
        </span>
      ) : null}
      {state.session ? (
        <span className="min-w-0 truncate text-ui text-ink-2">
          {state.session.meeting ?? state.session.name} {state.session.season}, {state.session.name}
        </span>
      ) : null}
      <span className="ml-auto flex items-center gap-2 text-caption text-ink-3">
        {state.connection === "live" ? <span className="live-dot inline-block size-2 rounded-full bg-accent" aria-hidden="true" /> : null}
        {state.connection === "live" ? <span className="mr-2">Live</span> : null}
        {state.weather ? <Weather state={state} /> : pending}
      </span>
    </div>
  );
}

/** Air, track, humidity, wind, rain: numbers first, one icon each. */
function Weather({ state }: { state: LiveState }) {
  const w = state.weather;
  if (!w) return null;
  return (
    <span className="timing flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-2" aria-label="Weather">
      <span className="inline-flex items-center gap-1" title="Air temperature">
        <IconThermometer size="1rem" className="text-ink-3" />
        {w.airTemp.toFixed(0)}°
      </span>
      <span className="inline-flex items-center gap-1" title="Track temperature">
        <IconTrackTemp size="1rem" className="text-ink-3" />
        {w.trackTemp.toFixed(0)}°
      </span>
      <span className="inline-flex items-center gap-1" title="Humidity">
        <IconDrop size="1rem" className="text-ink-3" />
        {Math.round(w.humidity)}%
      </span>
      <span className="inline-flex items-center gap-1" title={`Wind ${compass(w.windDirection)}`}>
        <IconWindArrow size="1rem" className="text-ink-3" style={{ transform: `rotate(${w.windDirection}deg)` }} />
        {w.windSpeed.toFixed(1)} m/s
      </span>
      {w.rainfall ? (
        <span className="inline-flex items-center gap-1 text-[var(--tyre-wet)]" title="Rain">
          <IconRainDrop size="1rem" />
          Rain
        </span>
      ) : null}
    </span>
  );
}

function trackStatus(trackState: LiveState["trackState"]): { label: string; icon: ReactNode } {
  switch (trackState) {
    case "sc":
      return { label: "Safety car", icon: <IconSafetyCar size={ICON_SIZE} /> };
    case "vsc":
      return { label: "Virtual safety car", icon: <IconVsc size={ICON_SIZE} /> };
    case "vscEnding":
      return { label: "VSC ending", icon: <IconVsc size={ICON_SIZE} /> };
    case "red":
      return { label: "Red flag", icon: <IconFlag size={ICON_SIZE} color="var(--status-red)" /> };
    case "yellow":
      return { label: "Yellow flag", icon: <IconFlag size={ICON_SIZE} color="var(--status-yellow)" /> };
    case "chequered":
      return { label: "Chequered flag", icon: <IconChequered size={ICON_SIZE} /> };
    default:
      return { label: "Green", icon: <IconFlag size={ICON_SIZE} color="var(--status-green)" /> };
  }
}

/** What to say on the right while there is no weather yet. */
function pendingLabel(state: LiveState): string {
  switch (state.connection) {
    case "loading":
      return "Loading session";
    case "connecting":
      return "Connecting";
    case "ended":
      return "Session finished";
    case "idle":
    case "offline":
      return state.error ?? "No live session now";
    default:
      return "";
  }
}

function formatRemaining(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function compass(deg: number) {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const idx = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return dirs[idx];
}
