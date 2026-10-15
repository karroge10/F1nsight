// Small shared pieces of the fantasy planner: the page meta passed from the server, the asset
// view the tables read, code chips with a team colour line, and number formatting.

import type { CSSProperties, ReactNode } from "react";

export interface PlannerRace {
  round: number;
  /** Short name, e.g. "United States". */
  name: string;
  /** Country (name or code) for the flag. */
  country: string | null;
}

export interface PlannerMeta {
  season: number;
  round: number;
  raceName: string;
  country: string | null;
  /** Team lock (ISO), or null when the schedule is unknown. */
  deadline: string | null;
  /** This race, then the horizon races. */
  races: PlannerRace[];
  /** Three-letter driver codes and short constructor codes by asset id. */
  codes: Record<string, string>;
  /** Points in the last two scored rounds, oldest first. */
  recent: { rounds: number[]; points: Record<string, (number | null)[]> };
}

export interface AssetView {
  id: string;
  kind: "driver" | "constructor";
  code: string;
  color: string;
  price: number;
  points: number;
  priceChange: number;
  pickable: boolean;
  probs: Record<string, number> | undefined;
}

export type AssetLookup = (id: string) => AssetView | undefined;

/** Code with the team colour line; green tint when new against last week, Boost badge when boosted. */
export function CodeChip({ asset, changed = false, multiplier = 1 }: { asset: AssetView; changed?: boolean; multiplier?: number }) {
  const tint = changed ? "bg-[color-mix(in_oklch,var(--delta-up)_14%,transparent)] shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--delta-up)_45%,transparent)]" : "bg-bg-raised";
  const title = `${asset.code}: ${fixed1(asset.points)} pts, ${money(asset.price)}, price ${signed(asset.priceChange, 2)}M`;
  return (
    <span title={title} className={"inline-flex h-6 items-center gap-1.5 rounded-control ps-1.5 pe-2 text-caption font-[650] text-ink " + tint}>
      <TeamLine color={asset.color} className="h-3.5" />
      {asset.code}
      {multiplier > 1 ? <BoostBadge multiplier={multiplier} small /> : null}
    </span>
  );
}

/** Code with the team colour line, for table cells. */
export function CodeCell({ asset }: { asset: AssetView }) {
  return (
    <span className="inline-flex items-center gap-2 font-[650] text-ink">
      <TeamLine color={asset.color} className="h-4" />
      {asset.code}
    </span>
  );
}

export function TeamLine({ color, className = "" }: { color: string; className?: string }) {
  const style = { "--tc": color } as CSSProperties;
  return <span aria-hidden="true" className={"inline-block w-[3px] shrink-0 rounded-[2px] bg-[var(--tc)] " + className} style={style} />;
}

export function BoostBadge({ multiplier, small = false }: { multiplier: number; small?: boolean }) {
  const size = small ? "text-[0.5625rem] px-[3px]" : "text-[0.625rem] px-1";
  return (
    <span className={"rounded-[3px] bg-ink font-[750] leading-[1.4] text-bg " + size} title={multiplier === 3 ? "3x Boost" : "Boost: scores double"}>
      x{multiplier}
    </span>
  );
}

/** Text tone of a change: green up, red down, muted at zero. */
export function tone(value: number): string {
  if (value > 0.001) return "text-delta-up";
  if (value < -0.001) return "text-delta-down";
  return "text-ink-3";
}

/** Projected points of an optimiser result after Boost, chip and transfer penalties. The result's
 * score is the optimiser's objective, which adds a team value term under "Points + value". */
export function projectedPoints(result: { expectedPoints: number; penalty: number }): number {
  return result.expectedPoints - result.penalty;
}

export function fixed1(value: number): string {
  return value.toFixed(1);
}

/** Signed number with a real minus sign, "±0.0" at zero. */
export function signed(value: number, digits = 1): string {
  const rounded = Number(value.toFixed(digits));
  const magnitude = Math.abs(rounded).toFixed(digits);
  if (rounded > 0) return `+${magnitude}`;
  if (rounded < 0) return `−${magnitude}`;
  return `±${magnitude}`;
}

/** Money in $M with a real minus sign, e.g. "$32.4M", "−$0.6M". */
export function money(value: number): string {
  const magnitude = Math.abs(value).toFixed(1);
  const sign = value < -0.049 ? "−" : "";
  return `${sign}$${magnitude}M`;
}

/** One-line footnote under a view. */
export function Footnote({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-caption text-ink-2">{children}</p>;
}
