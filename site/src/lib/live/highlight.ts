import type { LiveCar } from "@/lib/data/types";

/** Opacity of a car dot that is neither highlighted nor part of a highlight. */
export const DIM_OPACITY = 0.3;

/** Clicking the pinned car again releases it. */
export function togglePin(pinned: number | null, number: number): number | null {
  return pinned === number ? null : number;
}

/** Dot opacity for a car given its status and the active highlight. */
export function carOpacity(status: LiveCar["status"], number: number, highlight: number | null): number {
  if (highlight === number) return 1;
  const base = status === "retired" || status === "stopped" ? 0.3 : status === "pit" ? 0.55 : status === "stale" ? 0.5 : 1;
  if (highlight === null) return base;
  return Math.min(base, DIM_OPACITY);
}
