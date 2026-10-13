"use client";

import { useEffect, useMemo, useState } from "react";
import type { LiveState } from "@/lib/live/reducer";
import type { LiveControls } from "@/lib/live/use-live-session";
import { IconPause, IconPlay, IconSkipBack, IconSkipForward } from "@/components/icons";

interface PlayerProps {
  state: LiveState;
  controls: LiveControls;
}

const SPEEDS = [0.5, 1, 2, 4, 8, 16];
const SKIP_MS = 10000;

/**
 * Replay player: play/pause, speed, skip 10 s and one lap, jump to lap, a scrubber with
 * markers (safety cars, red flags, pit stops, lead changes), keyboard shortcuts.
 */
export function Player({ state, controls }: PlayerProps) {
  const [lapInput, setLapInput] = useState("");
  const timeline = state.timeline;
  const start = timeline?.start ?? 0;
  const end = timeline?.end ?? Math.max(state.t, 1);
  const green = timeline?.green ?? 0;
  const t = Math.min(Math.max(state.t, start), end);
  const ready = timeline !== null;
  const playing = !state.playback.paused && !state.playback.ended;
  const span = Math.max(1, end - start);
  const avgLapMs = useMemo(() => averageLap(state.lapMarks), [state.lapMarks]);

  const markers = useMemo(() => {
    const out: { t: number; kind: "sc" | "red" | "pit" | "lead" | "yellow"; title: string }[] = [];
    for (const m of state.statusMarks) {
      if (m.state === "sc" || m.state === "vsc") out.push({ t: m.t, kind: "sc", title: m.state === "sc" ? "Safety car" : "Virtual safety car" });
      else if (m.state === "red") out.push({ t: m.t, kind: "red", title: "Red flag" });
    }
    for (const p of state.pitStops) {
      const driver = state.drivers.get(p.number);
      out.push({ t: p.t, kind: "pit", title: `Pit stop, ${driver?.code ?? p.number}${p.lap ? ` lap ${p.lap}` : ""}` });
    }
    for (const l of state.leadChanges) {
      const driver = state.drivers.get(l.number);
      out.push({ t: l.t, kind: "lead", title: `${driver?.code ?? l.number} takes the lead` });
    }
    return out;
  }, [state.statusMarks, state.pitStops, state.leadChanges, state.drivers]);

  function togglePlay() {
    if (state.playback.ended) {
      controls.seek(start);
      controls.resume();
      return;
    }
    if (state.playback.paused) controls.resume();
    else controls.pause();
  }

  function skip(deltaMs: number) {
    controls.seek(Math.min(end, Math.max(start, t + deltaMs)));
  }

  function skipLap(delta: number) {
    const current = state.lap?.current ?? 1;
    const target = lapStart(current + delta);
    if (target === null) return;
    // Back from lap 1 (or from before the start) the lap 1 mark lies ahead: go to the very start.
    const backwardsButAhead = delta < 0 && target >= t;
    controls.seek(backwardsButAhead ? start : target);
  }

  function seekToLap(lap: number) {
    const target = lapStart(lap);
    if (target !== null) controls.seek(target);
  }

  /** When a lap began: its mark if it has been seen, otherwise an estimate from the average lap. */
  function lapStart(lap: number): number | null {
    const target = Math.max(1, lap);
    const mark = state.lapMarks.find((m) => m.lap === target);
    if (mark) return mark.t;
    if (!avgLapMs) return null;
    const last = state.lapMarks[state.lapMarks.length - 1];
    if (last) return last.t + (target - last.lap) * avgLapMs;
    return green + (target - 1) * avgLapMs;
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA")) return;
      switch (event.key) {
        case " ":
          event.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          event.preventDefault();
          if (event.shiftKey) skipLap(-1);
          else skip(-SKIP_MS);
          break;
        case "ArrowRight":
          event.preventDefault();
          if (event.shiftKey) skipLap(1);
          else skip(SKIP_MS);
          break;
        case "ArrowUp":
          event.preventDefault();
          stepSpeed(1);
          break;
        case "ArrowDown":
          event.preventDefault();
          stepSpeed(-1);
          break;
        default:
          break;
      }
    }
    function stepSpeed(direction: number) {
      const idx = SPEEDS.indexOf(state.playback.speed);
      const next = SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, (idx === -1 ? 1 : idx) + direction))];
      controls.setSpeed(next);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // intentionally re-bound each render so handlers see fresh state

  const elapsedText = formatClock(t - green);
  const totalText = formatClock(end - green);
  const lapText = state.lap ? (state.lap.total ? `Lap ${state.lap.current} of ${state.lap.total}` : `Lap ${state.lap.current}`) : "";
  const isRace = state.session?.code === "R" || state.session?.code === "S";
  const clockText = !isRace && state.clock?.remainingMs !== null && state.clock?.remainingMs !== undefined ? `${formatClock(state.clock.remainingMs)} left` : "";

  return (
    <div className="rounded-control border border-rule bg-bg p-3 sm:p-4" role="region" aria-label="Replay player">
      {/* three rows of 6px markers, 1px apart: lead changes, safety cars and red flags, pit stops */}
      <div className="relative h-5" aria-hidden="true">
        {markers.map((m, i) => {
          const left = `${(((m.t - start) / span) * 100).toFixed(2)}%`;
          const color = m.kind === "red" ? "var(--status-red)" : m.kind === "sc" ? "var(--status-yellow)" : m.kind === "lead" ? "var(--ink)" : "var(--ink-3)";
          const top = m.kind === "pit" ? "0.875rem" : m.kind === "lead" ? "0" : "0.4375rem";
          return <span key={i} title={m.title} className="absolute h-1.5 w-1.5 -translate-x-1/2 rounded-full" style={{ left, top, background: color, opacity: m.kind === "pit" ? 0.6 : 1 }} />;
        })}
      </div>
      <input
        type="range"
        min={Math.round(start)}
        max={Math.round(end)}
        step={1000}
        value={Math.round(t)}
        onChange={(e) => controls.seek(Number(e.target.value))}
        aria-label="Replay position"
        aria-valuetext={elapsedText}
        disabled={!ready}
        className="h-6 w-full cursor-pointer accent-[var(--accent)] disabled:cursor-default disabled:opacity-50"
      />
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex items-center gap-1">
          <IconButton label="Back one lap (Shift + Left)" onClick={() => skipLap(-1)} disabled={!ready}>
            <IconSkipBack size="1.125rem" />
          </IconButton>
          <IconButton label="Back 10 seconds (Left)" onClick={() => skip(-SKIP_MS)} disabled={!ready}>
            <span className="timing text-caption">-10s</span>
          </IconButton>
          <button
            type="button"
            onClick={togglePlay}
            aria-label={playing ? "Pause (Space)" : "Play (Space)"}
            className="press selected-pill inline-flex h-11 w-11 items-center justify-center rounded-control"
          >
            {playing ? <IconPause size="1.25rem" /> : <IconPlay size="1.25rem" />}
          </button>
          <IconButton label="Forward 10 seconds (Right)" onClick={() => skip(SKIP_MS)} disabled={!ready}>
            <span className="timing text-caption">+10s</span>
          </IconButton>
          <IconButton label="Forward one lap (Shift + Right)" onClick={() => skipLap(1)} disabled={!ready}>
            <IconSkipForward size="1.125rem" />
          </IconButton>
        </div>

        <div className="timing text-ui text-ink">
          {elapsedText}
          <span className="text-ink-3"> / {totalText}</span>
        </div>

        <div className="text-ui text-ink-2">
          {lapText}
          {clockText ? <span className="ml-3 text-ink-3">{clockText}</span> : null}
        </div>

        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            const lap = Number(lapInput);
            if (Number.isFinite(lap) && lap > 0) seekToLap(lap);
          }}
        >
          <label className="text-caption text-ink-3" htmlFor="jump-lap">
            Jump to lap
          </label>
          <input
            id="jump-lap"
            type="number"
            min={1}
            max={state.lap?.total ?? 99}
            value={lapInput}
            onChange={(e) => setLapInput(e.target.value)}
            disabled={!ready}
            className="timing h-8 w-16 rounded-control border border-rule bg-bg px-2 text-base text-ink sm:text-ui"
          />
        </form>

        <div role="group" aria-label="Playback speed (Up and Down arrows)" className="ml-auto inline-flex rounded-control border border-rule p-0.5">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => controls.setSpeed(s)}
              aria-pressed={state.playback.speed === s}
              className={"press timing h-8 min-w-9 rounded-[3px] px-1.5 text-caption " + (state.playback.speed === s ? "selected-pill" : "text-ink-2 hover:text-ink")}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>
      <p className="mt-2 text-caption text-ink-3">
        Markers: <span className="inline-block size-1.5 rounded-full align-middle" style={{ background: "var(--status-yellow)" }} /> safety car, <span className="inline-block size-1.5 rounded-full align-middle" style={{ background: "var(--status-red)" }} /> red flag,{" "}
        <span className="inline-block size-1.5 rounded-full align-middle bg-ink" /> lead change, <span className="inline-block size-1.5 rounded-full align-middle bg-ink-3" /> pit stop. Space plays, arrows skip, Shift + arrows skip a lap.
      </p>
    </div>
  );
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="press inline-flex h-10 min-w-10 items-center justify-center rounded-control px-1 text-ink-2 hover:bg-bg-hover hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

function averageLap(marks: { lap: number; t: number }[]): number | null {
  if (marks.length < 2) return null;
  const first = marks[0];
  const last = marks[marks.length - 1];
  const laps = last.lap - first.lap;
  return laps > 0 ? (last.t - first.t) / laps : null;
}

function formatClock(ms: number) {
  const sign = ms < 0 ? "-" : "";
  const total = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${sign}${h}:${mm}:${ss}` : `${sign}${mm}:${ss}`;
}
