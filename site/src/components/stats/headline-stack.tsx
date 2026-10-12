import type { ReactNode } from "react";
import { DriverTag, type DriverTeam } from "./driver-tag";

export interface HeadlineItem {
  label: string;
  /** Driver code, or any short value when `team` is absent. */
  value: string;
  note?: ReactNode;
  /** The driver's team; draws its logo before the code. */
  team?: DriverTeam;
}

/** Winner, pole and fastest lap (or any three facts) stacked one per line in the page header. */
export function HeadlineStack({ items, season = null }: { items: HeadlineItem[]; season?: number | null }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-2">
      {items.map((item) => (
        <Row key={item.label} item={item} season={season} />
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function Row({ item, season }: { item: HeadlineItem; season: number | null }) {
  return (
    <>
      <dt className="label">{item.label}</dt>
      <dd className="flex flex-wrap items-baseline gap-x-3">
        <span className="headline text-h2 text-ink">{item.team ? <DriverTag text={item.value} team={item.team} season={season} logo={24} /> : item.value}</span>
        {item.note ? <span className="text-caption text-ink-3">{item.note}</span> : null}
      </dd>
    </>
  );
}
