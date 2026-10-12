import type { DriverForecast, ReasonFactor } from "@/lib/data";
import { whyRows, type WhyRow } from "@/lib/forecast";
import type { IconComponent } from "@/components/icons";
import { IconCrown, IconDnf, IconFastestLap, IconForecast, IconGarage, IconGauge, IconGridSlot, IconMap, IconPulse, IconTrophy } from "@/components/icons";

const KIND_ICON: Record<string, IconComponent> = {
  form: IconForecast,
  qualifying: IconGridSlot,
  quali_pace: IconFastestLap,
  wins: IconTrophy,
  circuit: IconMap,
  team: IconGarage,
  championship: IconCrown,
  volatility: IconPulse,
  pace: IconGauge,
  recentFinish: IconForecast,
  qualiGap: IconFastestLap,
  teamGap: IconGarage,
  trackHistory: IconMap,
  reliability: IconDnf,
};

/** Short labels for the expanded strip; the full label and sentence stay in the tooltip. */
const SHORT_LABEL: Record<string, string> = {
  form: "recent form",
  quali_pace: "one-lap",
  team: "car",
  championship: "standings",
  recentFinish: "recent races",
  qualiGap: "to pole",
  teamGap: "team's best to pole",
  trackHistory: "at this track",
  reliability: "reliability",
};

interface FactorChipsProps {
  driver: DriverForecast;
  /** Reference pole lap for this circuit, used to turn percent gaps into seconds. */
  poleMs: number | null;
  /** Rows to show; all rows (six with keyFactors) by default. */
  max?: number;
  className?: string;
}

/**
 * The reasons behind a forecast as a fixed list: the same fields in the same order for every
 * driver, one per line, label left and value right. A field the model did not publish for this
 * driver shows a dash. The full sentence from the model is the tooltip.
 */
export function FactorChips({ driver, poleMs, max, className = "" }: FactorChipsProps) {
  const allRows = whyRows(driver, poleMs);
  const rows = allRows.slice(0, max ?? allRows.length);
  return (
    <ul className={"grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 " + className}>
      {rows.map((row) => {
        const Icon = KIND_ICON[row.kind] ?? IconForecast;
        const valueClass = rowValueClass(row);
        const title = row.detail ?? undefined;
        return (
          <li key={row.kind} className="col-span-2 grid grid-cols-subgrid items-center text-caption leading-5 text-ink-2" title={title}>
            <span className="inline-flex items-center gap-1.5">
              <Icon size="0.875rem" className="shrink-0 text-ink-3" />
              {row.label}
            </span>
            <span className={"timing " + valueClass}>{row.value ?? "no data"}</span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The same rows as one horizontal strip for an expanded table row: icon, value, then a short
 * label. Wraps on narrow screens. The full label and the model's sentence are the tooltip.
 */
export function FactorStrip({ rows, className = "" }: { rows: WhyRow[]; className?: string }) {
  return (
    <ul className={"flex flex-wrap items-center gap-x-5 gap-y-1.5 text-caption leading-5 " + className}>
      {rows.map((row) => {
        const Icon = KIND_ICON[row.kind] ?? IconForecast;
        const valueClass = rowValueClass(row);
        const shortLabel = SHORT_LABEL[row.kind] ?? row.label;
        const title = row.detail ? `${row.label}: ${row.detail}` : row.label;
        return (
          <li key={row.kind} className="inline-flex items-center gap-1.5 whitespace-nowrap" title={title}>
            <Icon size="0.875rem" className="shrink-0 text-ink-3" />
            <span className={"timing " + valueClass}>{row.value ?? "no data"}</span>
            <span className="text-ink-3">{shortLabel}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function rowValueClass(row: WhyRow): string {
  const direction = impactDirection(row.impact);
  if (row.value === null) return "text-ink-3";
  if (direction === "helps") return "text-delta-up";
  if (direction === "hurts") return "text-delta-down";
  return "text-ink";
}

export function impactDirection(impact: ReasonFactor["impact"]): "helps" | "hurts" | "neutral" {
  if (typeof impact === "number") {
    if (impact > 0.02) return "helps";
    if (impact < -0.02) return "hurts";
    return "neutral";
  }
  return impact;
}
