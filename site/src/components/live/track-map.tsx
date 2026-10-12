"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LiveDriver } from "@/lib/data/types";
import { createCarAnimator, type LiveState } from "@/lib/live/reducer";
import { projectTrack } from "@/lib/live/project";
import { carOpacity } from "@/lib/live/highlight";

/** Smallest on-screen size of a car label and dot, so a narrow map stays readable. */
const MIN_LABEL_PX = 10;
const MIN_DOT_PX = 4.5;
const MIN_CORNER_PX = 9;

interface TrackMapProps {
  state: LiveState;
  /** Car to emphasise: full opacity, bigger dot, label always on; every other car fades. */
  highlight?: number | null;
  onHover?: (number: number | null) => void;
  onSelect?: (number: number) => void;
  /** Sizing classes for the svg; the default fills the container width. */
  className?: string;
}

/**
 * SVG track outline with one dot per car, moved imperatively on requestAnimationFrame. The
 * highlight props are optional: without them the map is static decoration and ignores the pointer.
 */
export function TrackMap({ state, highlight = null, onHover, onSelect, className = "h-auto w-full" }: TrackMapProps) {
  const projected = useMemo(() => (state.track && state.track.outline.length > 2 ? projectTrack(state.track) : null), [state.track]);
  const stateRef = useRef(state);
  const carRefs = useRef(new Map<number, SVGGElement>());
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const registerCar = useCallback((number: number, el: SVGGElement | null) => {
    if (el) carRefs.current.set(number, el);
    else carRefs.current.delete(number);
  }, []);
  const drivers = useMemo(() => orderDrivers(state.drivers, highlight), [state.drivers, highlight]);
  const highlightRef = useRef(highlight);
  useEffect(() => {
    highlightRef.current = highlight;
  }, [highlight]);
  const positionsAvailable = state.sources?.positionsAvailable ?? true;
  const estimated = state.positionsSource === "estimated";
  const svgRef = useRef<SVGSVGElement>(null);
  const unitsPerPx = useUnitsPerPx(svgRef, projected?.viewBox ?? null);
  const fontSize = projected ? Math.max(11 * projected.scale, MIN_LABEL_PX * unitsPerPx) : 0;
  const r = projected ? Math.max(11 * projected.scale, MIN_DOT_PX * unitsPerPx) : 0;
  const cornerSize = projected ? Math.max(9 * projected.scale, MIN_CORNER_PX * unitsPerPx) : 0;
  const sizeRef = useRef({ r, fontSize });
  useEffect(() => {
    sizeRef.current = { r, fontSize };
  }, [r, fontSize]);

  useEffect(() => {
    if (!projected) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const animate = createCarAnimator();
    let raf = 0;
    const loop = () => {
      const now = performance.now();
      const cars = animate(stateRef.current, now, reduced);
      const seen = new Set<number>();
      const positions = cars.map((car) => {
        const [px, py] = projected.project(car.x, car.y);
        return { number: car.number, px, py };
      });
      const { r: dotR, fontSize: labelSize } = sizeRef.current;
      const labelW = labelSize * 2.6 + dotR * 0.5;
      const labelH = labelSize * 1.3;
      const shown: { x1: number; x2: number; y: number }[] = [];
      const hl = highlightRef.current;
      // The highlighted car claims label space first, then cars on track; dimmed cars in the
      // pit lane only label what is left.
      const order = [...cars.keys()].sort((a, b) => labelRank(cars[a], hl) - labelRank(cars[b], hl));
      for (const index of order) {
        const car = cars[index];
        const g = carRefs.current.get(car.number);
        if (!g) continue;
        seen.add(car.number);
        const { px, py } = positions[index];
        const lit = hl === car.number;
        g.setAttribute("transform", `translate(${px.toFixed(1)} ${py.toFixed(1)})`);
        const box = { x1: px + dotR, x2: px + dotR + labelW, y: py };
        const dotUnderLabel = positions.some((p) => p.number !== car.number && p.px + dotR > box.x1 && p.px - dotR < box.x2 && Math.abs(p.py - py) < labelH);
        const labelOverlap = shown.some((b) => b.x1 < box.x2 && b.x2 > box.x1 && Math.abs(b.y - py) < labelH);
        const crowded = !lit && (dotUnderLabel || labelOverlap);
        const label = g.querySelector("text");
        if (label) label.style.visibility = crowded ? "hidden" : "visible";
        if (!crowded) shown.push(box);
        const dot = g.querySelector("circle");
        if (dot) dot.setAttribute("r", (lit ? dotR * 1.4 : dotR).toFixed(2));
        g.style.opacity = String(carOpacity(car.status, car.number, hl));
        g.style.visibility = "visible";
      }
      for (const [number, g] of carRefs.current) {
        if (!seen.has(number)) g.style.visibility = "hidden";
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [projected]);

  if (!projected) {
    return (
      <div className="flex aspect-[4/3] items-center justify-center rounded-control text-ui text-ink-3" role="status">
        {state.connection === "offline" ? "No session and no replay selected." : "Waiting for track data"}
      </div>
    );
  }

  return (
    <div className="relative">
      <svg ref={svgRef} viewBox={projected.viewBox} className={className} role="img" aria-label="Track map with car positions">
        <path d={projected.path} fill="none" stroke="color-mix(in oklch, var(--ink-3) 60%, var(--bg-sunken))" strokeWidth={10 * projected.scale} strokeLinejoin="round" strokeLinecap="round" />
        <path d={projected.path} fill="none" stroke="var(--bg)" strokeWidth={4 * projected.scale} strokeLinejoin="round" strokeLinecap="round" />
        {projected.sectorMarks.map((s) => (
          <circle key={`s${s.number}`} cx={s.x} cy={s.y} r={3.5 * projected.scale} fill="var(--bg)" stroke="var(--ink-3)" strokeWidth={1.5 * projected.scale} />
        ))}
        {projected.corners.map((c) => (
          <text key={`c${c.number}`} x={c.x} y={c.y} fontSize={cornerSize} textAnchor="middle" dy="0.35em" fill="var(--ink-3)" fontFamily="var(--font-sans)">
            {c.number}
          </text>
        ))}
        <rect x={projected.finish[0] - 2 * projected.scale} y={projected.finish[1] - 9 * projected.scale} width={4 * projected.scale} height={18 * projected.scale} fill="var(--ink)" />
        {positionsAvailable
          ? drivers.map((d) => <CarDot key={d.number} driver={d} r={r} fontSize={fontSize} register={registerCar} onHover={onHover} onSelect={onSelect} />)
          : null}
      </svg>
      {positionsAvailable && estimated ? (
        <p className="absolute left-3 top-3 rounded-chip bg-bg/85 px-1.5 py-0.5 text-caption text-ink-2" title="The map rebuilds car positions from timing data, not from the official position feed.">
          Estimated positions
        </p>
      ) : null}
      {!positionsAvailable ? (
        <p className="absolute inset-x-3 bottom-3 rounded-control bg-bg/85 px-3 py-2 text-caption text-ink-2 backdrop-blur-[2px]">
          Car positions are not available for this live session (the official feed needs an F1TV token). The timing tower, race control and weather are live.
        </p>
      ) : null}
    </div>
  );
}

interface CarDotProps {
  driver: LiveDriver;
  r: number;
  fontSize: number;
  register: (number: number, el: SVGGElement | null) => void;
  onHover?: (number: number | null) => void;
  onSelect?: (number: number) => void;
}

function CarDot({ driver, r, fontSize, register, onHover, onSelect }: CarDotProps) {
  const ref = useRef<SVGGElement>(null);
  useEffect(() => {
    register(driver.number, ref.current);
    return () => register(driver.number, null);
  }, [driver.number, register]);
  const interactive = Boolean(onHover || onSelect);
  return (
    <g
      ref={ref}
      data-car={driver.number}
      style={{ visibility: "hidden", transition: "opacity 300ms", cursor: interactive ? "pointer" : undefined }}
      onPointerEnter={onHover ? () => onHover(driver.number) : undefined}
      onPointerLeave={onHover ? () => onHover(null) : undefined}
      onClick={onSelect ? () => onSelect(driver.number) : undefined}
    >
      <circle r={r} fill={driver.teamColor} stroke="var(--bg)" strokeWidth={r * 0.25} />
      <text x={r * 1.5} y={0} dy="0.35em" fontSize={fontSize} fontWeight={600} fill="var(--ink)" fontFamily="var(--font-sans)" stroke="var(--bg)" strokeWidth={fontSize * 0.3} paintOrder="stroke" style={{ letterSpacing: "0.02em" }}>
        {driver.code}
      </text>
    </g>
  );
}

/** The highlighted car is rendered last so it paints above every other dot and label. */
function orderDrivers(drivers: Map<number, LiveDriver>, highlight: number | null): LiveDriver[] {
  const all = [...drivers.values()];
  if (highlight === null) return all;
  const lit = all.filter((d) => d.number === highlight);
  const rest = all.filter((d) => d.number !== highlight);
  return [...rest, ...lit];
}

function labelRank(car: { number: number; status: string }, highlight: number | null): number {
  if (car.number === highlight) return 0;
  return car.status === "pit" ? 2 : 1;
}

/** SVG units per CSS pixel at the map's current width. */
function useUnitsPerPx(svgRef: React.RefObject<SVGSVGElement | null>, viewBox: string | null): number {
  const [unitsPerPx, setUnitsPerPx] = useState(1);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !viewBox) return;
    const viewWidth = Number(viewBox.split(" ")[2]);
    const measure = () => {
      if (svg.clientWidth > 0) setUnitsPerPx(viewWidth / svg.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [svgRef, viewBox]);
  return unitsPerPx;
}
