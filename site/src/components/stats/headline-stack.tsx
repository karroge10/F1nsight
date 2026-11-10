import type { ReactNode } from "react";
import type { IconComponent } from "@/components/icons";
import { DriverTag, type DriverTeam } from "./driver-tag";

export interface HeadlineItem {
  label: string;
  /** Driver code, or any short value when `team` is absent. */
  value: string;
  note?: ReactNode;
  /** The driver's team; draws its logo before the code. */
  team?: DriverTeam;
  /** Drawn before the label. */
  icon?: IconComponent;
}

// globals.css makes every svg a block; the label icon has to sit inline with the text.
const INLINE_ICON = { display: "inline-block", verticalAlign: "-0.2em" } as const;

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
      <dt className="label whitespace-nowrap">
        {item.icon ? <item.icon size="1rem" className="mr-1.5 text-ink-3" style={INLINE_ICON} /> : null}
        {item.label}
      </dt>
      <dd className="flex flex-wrap items-baseline gap-x-3">
        <span className="headline text-h2 text-ink">{item.team ? <DriverTag text={item.value} team={item.team} season={season} logo={24} /> : item.value}</span>
        {item.note ? <span className="text-caption text-ink-3">{item.note}</span> : null}
      </dd>
    </>
  );
}
