"use client";

// Fastest-lap comparison: two drivers of one session, speed / throttle / brake / gap against
// distance, and a track map coloured by speed or by the quicker driver. Driver choice lives in
// the URL (?s=2026-16-Q&a=RUS&b=ANT) so a comparison can be shared.

import { useMemo, useState, type PointerEvent } from "react";
import { distances, fasterBySample, formatLapTime, pickPair, sessionKey, speedBins, telemetryTeamId, timeDelta, type SessionTelemetry, type TelemetryDriver, type TelemetryIndexEntry } from "@/lib/telemetry";
import { handleRovingKey } from "@/lib/roving-keys";
import { Figure } from "@/components/ui/figure";
import { TeamName } from "@/components/ui/team-name";

interface TelemetryExplorerProps {
  session: SessionTelemetry;
  index: TelemetryIndexEntry[];
  initialA: string | null;
  initialB: string | null;
  onChooseSession: (key: string) => void;
}

type MapMode = "speed" | "faster";

const WIDTH = 960;
/** Narrow viewBox for phones: the SVG scales to about 360px, so labels stay near 12px. */
const COMPACT_WIDTH = 420;
const PAD = { left: 48, right: 16 };
const PANELS = [
  { key: "speed", label: "Speed km/h", height: 170 },
  { key: "throttle", label: "Throttle %", height: 80 },
  { key: "brake", label: "Brake", height: 36 },
  { key: "delta", label: "Gap s", height: 90 },
] as const;
const PANEL_GAP = 14;
/** Room above each frame for its title, so the title never sits on the traces. */
const LABEL_H = 24;
const PANEL_TOPS = PANELS.map((_, i) => PANELS.slice(0, i).reduce((sum, p) => sum + LABEL_H + p.height + PANEL_GAP, 0) + LABEL_H);
const PLOT_BOTTOM = PANELS.reduce((sum, p) => sum + LABEL_H + p.height + PANEL_GAP, 0) - PANEL_GAP;
const SPEED_BINS = 5;

export function TelemetryExplorer({ session, index, initialA, initialB, onChooseSession }: TelemetryExplorerProps) {
  const [codes, setCodes] = useState<{ a: string | null; b: string | null }>({ a: initialA, b: initialB });
  const [mode, setMode] = useState<MapMode>("speed");
  const [first, second] = pickPair(session, codes.a, codes.b);
  const currentKey = sessionKey(session);

  function chooseDriver(slot: "a" | "b", code: string) {
    const next = { ...codes, [slot]: code };
    setCodes(next);
    const params = new URLSearchParams({ s: currentKey });
    const pair = pickPair(session, next.a, next.b);
    params.set("a", pair[0].code);
    if (pair[1]) params.set("b", pair[1].code);
    window.history.replaceState(null, "", `/telemetry?${params.toString()}`);
  }

  const gap = second ? (second.lapTimeMs - first.lapTimeMs) / 1000 : null;
  const sameColor = second !== null && second.color.toLowerCase() === first.color.toLowerCase();

  return (
    <div>
      <form className="flex flex-wrap items-end gap-4" onSubmit={(e) => e.preventDefault()}>
        <label className="flex w-full min-w-0 flex-col gap-1 text-caption text-ink-3 sm:w-auto">
          Session
          <select value={currentKey} onChange={(e) => onChooseSession(e.target.value)} className="h-11 w-full min-w-0 rounded-control border border-rule bg-bg px-2 text-base text-ink sm:h-9 sm:text-ui">
            <SessionOptions index={index} current={session} />
          </select>
        </label>
        <DriverSelect label="Driver A" value={first.code} drivers={session.drivers} onChange={(code) => chooseDriver("a", code)} />
        <DriverSelect label="Driver B" value={second?.code ?? ""} drivers={session.drivers.filter((d) => d.code !== first.code)} onChange={(code) => chooseDriver("b", code)} />
      </form>

      <dl className="mt-6 grid grid-cols-2 gap-6 sm:grid-cols-4">
        <Figure label={<DriverLabel driver={first} />} value={formatLapTime(first.lapTimeMs)} note={<LapNote driver={first} season={session.season} />} />
        {second ? <Figure label={<DriverLabel driver={second} dashed={sameColor} />} value={formatLapTime(second.lapTimeMs)} note={<LapNote driver={second} season={session.season} />} /> : null}
        {gap !== null ? <Figure label="Gap" value={`${gap >= 0 ? "+" : "−"}${Math.abs(gap).toFixed(3)}s`} note={`${second?.code} to ${first.code}`} /> : null}
        <Figure label="Top speed" value={`${Math.max(...first.speed)} / ${second ? Math.max(...second.speed) : ""}`} note="km/h" />
      </dl>

      <div className="mt-8 grid gap-10 xl:grid-cols-12">
        <div className="min-w-0 xl:col-span-8">
          <div className="hidden md:block">
            <Traces first={first} second={second} dashed={sameColor} width={WIDTH} fontSize={12} />
          </div>
          <div className="md:hidden">
            <Traces first={first} second={second} dashed={sameColor} width={COMPACT_WIDTH} fontSize={15} />
          </div>
        </div>
        <div className="min-w-0 xl:col-span-4">
          <div role="radiogroup" aria-label="Track map colour" onKeyDown={handleRovingKey} className="inline-flex rounded-control border border-rule p-0.5">
            {(["speed", "faster"] as const).map((m) => (
              <button key={m} type="button" role="radio" tabIndex={mode === m ? 0 : -1} aria-checked={mode === m} onClick={() => setMode(m)} className={"press h-11 rounded-[3px] px-3 text-ui sm:h-8 " + (mode === m ? "selected-pill" : "text-ink-2 hover:text-ink")}>
                {m === "speed" ? `${first.code} speed` : "Quicker driver"}
              </button>
            ))}
          </div>
          <TrackHeatmap first={first} second={second} mode={mode} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// pieces
// ---------------------------------------------------------------------------

function SessionOptions({ index, current }: { index: TelemetryIndexEntry[]; current: SessionTelemetry }) {
  const seasons = [...new Set(index.map((e) => e.season))];
  const known = index.some((e) => sessionKey(e) === sessionKey(current));
  return (
    <>
      {known ? null : <option value={sessionKey(current)}>{`${current.season} R${current.round} ${current.eventName} ${current.sessionName}`}</option>}
      {seasons.map((season) => (
        <optgroup key={season} label={String(season)}>
          {index
            .filter((e) => e.season === season)
            .map((e) => (
              <option key={sessionKey(e)} value={sessionKey(e)}>
                {`R${e.round} ${e.eventName}, ${e.sessionName}`}
              </option>
            ))}
        </optgroup>
      ))}
    </>
  );
}

function DriverSelect({ label, value, drivers, onChange }: { label: string; value: string; drivers: TelemetryDriver[]; onChange: (code: string) => void }) {
  return (
    <label className="flex min-w-0 max-w-full flex-col gap-1 text-caption text-ink-3">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-11 w-full min-w-0 rounded-control border border-rule bg-bg px-2 text-base text-ink sm:h-9 sm:text-ui">
        {drivers.map((d) => (
          <option key={d.code} value={d.code}>
            {`${d.name}, ${formatLapTime(d.lapTimeMs)}`}
          </option>
        ))}
      </select>
    </label>
  );
}

/** "Lap 12, [logo] Mercedes" under a driver's lap time. */
function LapNote({ driver, season }: { driver: TelemetryDriver; season: number }) {
  const constructorId = telemetryTeamId(driver.team);
  return (
    <>
      Lap {driver.lapNumber}, <TeamName constructorId={constructorId} name={driver.team} color={driver.color} season={season} size={16} />
    </>
  );
}

function DriverLabel({ driver, dashed = false }: { driver: TelemetryDriver; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg width="18" height="6" aria-hidden="true">
        <line x1="0" y1="3" x2="18" y2="3" stroke={driver.color} strokeWidth="2.5" strokeDasharray={dashed ? "4 3" : undefined} />
      </svg>
      {driver.code}
    </span>
  );
}

function Traces({ first, second, dashed, width, fontSize }: { first: TelemetryDriver; second: TelemetryDriver | null; dashed: boolean; width: number; fontSize: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const xsFirst = useMemo(() => distances(first), [first]);
  const delta = useMemo(() => (second ? timeDelta(first, second) : null), [first, second]);
  const length = Math.max(first.length, second?.length ?? 0);
  const plotW = width - PAD.left - PAD.right;
  const toX = (d: number) => PAD.left + (d / (length || 1)) * plotW;
  const totalHeight = PLOT_BOTTOM + PANEL_GAP + 20;
  const n = first.speed.length;

  // A finger lifting also fires pointerleave; keep the tapped readout, clear only for a mouse.
  function onLeave(event: PointerEvent<SVGSVGElement>) {
    if (event.pointerType === "mouse") setHover(null);
  }
  function onMove(event: PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = ((event.clientX - box.left) / box.width) * width;
    const fraction = (ratio - PAD.left) / plotW;
    const clamped = Math.min(1, fraction);
    const bounded = Math.max(0, clamped);
    const sample = Math.round(bounded * (n - 1));
    setHover(sample);
  }

  const panels = PANELS.map((panel, i) => {
    const y0 = PANEL_TOPS[i];
    const range = panelRange(panel.key, first, second, delta);
    const toY = (v: number) => y0 + panel.height - ((v - range.min) / (range.max - range.min || 1)) * panel.height;
    const valuesFirst = panel.key === "delta" ? null : first[panel.key];
    const valuesSecond = panel.key === "delta" || !second ? null : second[panel.key];
    return (
      <g key={panel.key}>
        <rect x={PAD.left} y={y0} width={plotW} height={panel.height} fill="none" stroke="var(--rule)" />
        <text x={PAD.left - 6} y={y0 + fontSize} textAnchor="end" fontSize={fontSize} className="fill-[var(--ink-3)]">
          {range.max}
        </text>
        <text x={PAD.left - 6} y={y0 + panel.height} textAnchor="end" fontSize={fontSize} className="fill-[var(--ink-3)]">
          {range.min}
        </text>
        <text x={PAD.left} y={y0 - 7} fontSize={fontSize} className="fill-[var(--ink-2)]">
          {panel.label}
        </text>
        {panel.key === "delta" && delta ? (
          <>
            <line x1={PAD.left} x2={PAD.left + plotW} y1={toY(0)} y2={toY(0)} stroke="var(--rule-strong)" strokeDasharray="2 3" />
            <polyline points={linePoints(xsFirst, delta, toX, toY)} fill="none" stroke={second?.color} strokeWidth="1.5" strokeDasharray={dashed ? "5 3" : undefined} />
          </>
        ) : null}
        {valuesSecond && second ? <polyline points={linePoints(distances(second), valuesSecond, toX, toY)} fill="none" stroke={second.color} strokeWidth="1.5" strokeDasharray={dashed ? "5 3" : undefined} /> : null}
        {valuesFirst ? <polyline points={linePoints(xsFirst, valuesFirst, toX, toY)} fill="none" stroke={first.color} strokeWidth="1.5" /> : null}
      </g>
    );
  });

  const hoverX = hover !== null ? toX(xsFirst[hover]) : null;
  const readout = hover !== null ? readoutText(hover, first, second, delta) : "Move over or touch the chart for values";

  return (
    <figure className="min-w-0">
      <p className="timing min-h-12 text-caption text-ink-2 sm:min-h-6" aria-live="polite">
        {readout}
      </p>
      <svg viewBox={`0 0 ${width} ${totalHeight}`} className="mt-2 w-full touch-pan-y" role="img" aria-label={`Speed, throttle, brake and gap against distance, ${first.code}${second ? ` and ${second.code}` : ""}`} onPointerDown={onMove} onPointerMove={onMove} onPointerLeave={onLeave}>
        {panels}
        {hoverX !== null ? <line x1={hoverX} x2={hoverX} y1={LABEL_H} y2={PLOT_BOTTOM} stroke="var(--ink-3)" strokeWidth="1" /> : null}
        <text x={PAD.left} y={totalHeight - 4} fontSize={fontSize} className="fill-[var(--ink-3)]">
          0 m
        </text>
        <text x={PAD.left + plotW} y={totalHeight - 4} textAnchor="end" fontSize={fontSize} className="fill-[var(--ink-3)]">
          {`${Math.round(length)} m`}
        </text>
      </svg>
      <figcaption className="mt-2 text-caption text-ink-3">Fastest lap of each driver against lap distance. Gap above zero: {second?.code ?? "B"} behind {first.code} at that point.</figcaption>
    </figure>
  );
}

function TrackHeatmap({ first, second, mode }: { first: TelemetryDriver; second: TelemetryDriver | null; mode: MapMode }) {
  const view = useMemo(() => trackView(first), [first]);
  const colorIndex = useMemo(() => (mode === "faster" && second ? fasterBySample(first, second) : speedBins(first, SPEED_BINS)), [first, second, mode]);
  const segments = [];
  for (let i = 1; i < first.x.length; i++) {
    const color = mode === "faster" && second ? fasterColor(colorIndex[i], first, second) : `var(--prob-${colorIndex[i] + 1})`;
    segments.push(<line key={i} x1={view.x(first.x[i - 1])} y1={view.y(first.y[i - 1])} x2={view.x(first.x[i])} y2={view.y(first.y[i])} stroke={color} strokeWidth="7" strokeLinecap="round" />);
  }
  const min = Math.min(...first.speed);
  const max = Math.max(...first.speed);
  return (
    <figure className="mt-4">
      <svg viewBox={`0 0 ${view.width} ${view.height}`} className="w-full" role="img" aria-label={mode === "faster" ? "Track map coloured by the quicker driver" : `Track map coloured by ${first.code}'s speed`}>
        <polyline points={first.x.map((x, i) => `${view.x(x)},${view.y(first.y[i])}`).join(" ")} fill="none" stroke="var(--rule)" strokeWidth="11" strokeLinejoin="round" />
        {segments}
      </svg>
      <figcaption className="mt-2 flex flex-wrap items-center gap-3 text-caption text-ink-3">
        {mode === "faster" && second ? (
          <>
            <Swatch color={first.color} label={`${first.code} quicker`} />
            <Swatch color={second.color} label={`${second.code} quicker`} />
            <Swatch color="var(--ink-3)" label="level" />
          </>
        ) : (
          <>
            <span className="timing">{min} km/h</span>
            <span className="flex">
              {Array.from({ length: SPEED_BINS }, (_, i) => (
                <span key={i} className="h-2 w-6" style={{ background: `var(--prob-${i + 1})` }} />
              ))}
            </span>
            <span className="timing">{max} km/h</span>
          </>
        )}
      </figcaption>
    </figure>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-2 w-4 rounded-chip" style={{ background: color }} />
      {label}
    </span>
  );
}

function panelRange(key: (typeof PANELS)[number]["key"], first: TelemetryDriver, second: TelemetryDriver | null, delta: number[] | null): { min: number; max: number } {
  if (key === "throttle") return { min: 0, max: 100 };
  if (key === "brake") return { min: 0, max: 1 };
  if (key === "delta") {
    const values = delta ?? [0];
    const magnitudes = values.map(Math.abs);
    const extent = Math.max(0.1, ...magnitudes);
    const rounded = Math.ceil(extent * 10) / 10;
    return { min: -rounded, max: rounded };
  }
  const all = second ? [...first.speed, ...second.speed] : first.speed;
  const slowest = Math.min(...all);
  const fastest = Math.max(...all);
  const low = Math.floor(slowest / 20) * 20;
  const high = Math.ceil(fastest / 20) * 20;
  return { min: low, max: high };
}

function linePoints(xs: number[], values: number[], toX: (d: number) => number, toY: (v: number) => number): string {
  const parts: string[] = [];
  for (let i = 0; i < values.length; i++) {
    const x = toX(xs[i]).toFixed(1);
    const y = toY(values[i]).toFixed(1);
    parts.push(`${x},${y}`);
  }
  return parts.join(" ");
}

function readoutText(i: number, first: TelemetryDriver, second: TelemetryDriver | null, delta: number[] | null): string {
  const xs = distances(first);
  const at = `${Math.round(xs[i])} m`;
  const describe = (d: TelemetryDriver) => `${d.code} ${d.speed[i]} km/h, ${d.throttle[i]}% throttle${d.brake[i] ? ", braking" : ""}, gear ${d.gear[i]}`;
  const gapText = delta ? `, gap ${delta[i] >= 0 ? "+" : "−"}${Math.abs(delta[i]).toFixed(3)}s` : "";
  return second ? `${at}: ${describe(first)}; ${describe(second)}${gapText}` : `${at}: ${describe(first)}`;
}

function fasterColor(value: number, first: TelemetryDriver, second: TelemetryDriver): string {
  if (value > 0) return first.color;
  if (value < 0) return second.color;
  return "var(--ink-3)";
}

/** Fits the lap's X/Y (1/10 m, y up) into an SVG box with a margin, y flipped for screen space. */
function trackView(driver: TelemetryDriver) {
  const minX = Math.min(...driver.x);
  const maxX = Math.max(...driver.x);
  const minY = Math.min(...driver.y);
  const maxY = Math.max(...driver.y);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const size = 400;
  const margin = 12;
  const scale = (size - margin * 2) / Math.max(spanX, spanY);
  const width = Math.round(spanX * scale + margin * 2);
  const height = Math.round(spanY * scale + margin * 2);
  return {
    width,
    height,
    x: (v: number) => (margin + (v - minX) * scale).toFixed(1),
    y: (v: number) => (margin + (maxY - v) * scale).toFixed(1),
  };
}
