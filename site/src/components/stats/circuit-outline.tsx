import type { TrackOutline } from "@/lib/data";
import { projectTrack } from "@/lib/live/project";

/** Static outline for circuit pages, same projection as the live map. */
export function CircuitOutline({ track }: { track: TrackOutline }) {
  const projected = projectTrack({ outline: track.outline, rotation: track.rotation, corners: track.corners, sectors: [] });
  return (
    <svg viewBox={projected.viewBox} className="h-auto w-full max-w-xl" role="img" aria-label={`${track.name} outline`}>
      <path d={projected.path} fill="none" stroke="var(--rule-strong)" strokeWidth={9 * projected.scale} strokeLinejoin="round" strokeLinecap="round" />
      <path d={projected.path} fill="none" stroke="var(--bg)" strokeWidth={3 * projected.scale} strokeLinejoin="round" strokeLinecap="round" />
      {projected.corners.map((c) => (
        <text key={c.number} x={c.x} y={c.y} fontSize={14 * projected.scale} textAnchor="middle" dy="0.35em" fill="var(--ink-2)" fontFamily="var(--font-sans)">
          {c.number}
        </text>
      ))}
      <rect x={projected.finish[0] - 2 * projected.scale} y={projected.finish[1] - 9 * projected.scale} width={4 * projected.scale} height={18 * projected.scale} fill="var(--ink)" />
    </svg>
  );
}
