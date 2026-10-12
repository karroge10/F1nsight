// Replay seeks are clamped on the client too, so the slider, the skip buttons and the lap jumps
// can never ask for a time outside the recording (the service clamps as well).

import type { LiveTimeline } from "@/lib/data/types";

/** The seek target inside [start, end] of the timeline; without a timeline, never below the start of the feed. */
export function clampToTimeline(t: number, timeline: LiveTimeline | null): number {
  const start = timeline?.start ?? 0;
  if (!Number.isFinite(t)) return start;
  const capped = timeline ? Math.min(timeline.end, t) : t;
  return Math.max(start, capped);
}
