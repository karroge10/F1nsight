"use client";

import { useMemo, useState } from "react";
import { SectionTitle } from "@/components/ui/section";
import { DriverTag, type DriverTeam } from "./driver-tag";
import { IconPitBox } from "@/components/icons";
import { SortTh, sortRows, useSort, type SortValue } from "@/components/ui/sortable";

/** One pit stop with the driver already resolved, so the table needs no lookups on the client. */
export interface PitStopRow {
  driverId: string;
  code: string;
  name: string;
  team: DriverTeam;
  stop: number;
  lap: number | null;
  durationMs: number | null;
}

export type PitSort = "fastest" | "lap" | "driver";

/** Header columns; a header click reorders on top of the control's order until the control changes. */
type PitColumn = "lap" | "driver" | "stop" | "time";

const SORTS: { key: PitSort; label: string }[] = [
  { key: "lap", label: "By lap" },
  { key: "fastest", label: "Fastest" },
  { key: "driver", label: "By driver" },
];

// Pit lane times above this are red flag stoppages and sort last under "Fastest".
const STOPPAGE_MS = 120000;

interface PitStopsPanelProps {
  pitStops: PitStopRow[];
  info?: string;
  initialSort?: PitSort;
  /** Beside another card on wide screens: take the row's height and scroll inside it. */
  fill?: boolean;
  season?: number | null;
}

/**
 * Pit stops card: the section title with the sort control on the same line, then the table in
 * a box that fills the card and scrolls inside when the list is long.
 */
export function PitStopsPanel({ pitStops, info, initialSort = "lap", fill = false, season = null }: PitStopsPanelProps) {
  const [sort, setSort] = useState<PitSort>(initialSort);
  const control = (
    <span role="group" aria-label="Sort pit stops" className="inline-flex rounded-control border border-rule">
      {SORTS.map((s) => (
        <button key={s.key} type="button" onClick={() => setSort(s.key)} aria-pressed={sort === s.key} className={"press segment -my-px h-9 rounded-control px-2 text-ui sm:px-3 " + (sort === s.key ? "segment-on" : "text-ink-2 hover:text-ink")}>
          {s.label}
        </button>
      ))}
    </span>
  );
  return (
    <div className="flex min-h-0 flex-col">
      <SectionTitle title="Pit stops" icon={IconPitBox} info={info} aside={control} />
      <div className={"mt-3 min-h-0 flex-1" + (fill ? " table-fill" : "")}>
        <div className="scroll-x table-scroll">
          <PitStopsTable key={sort} pitStops={pitStops} sort={sort} season={season} />
        </div>
      </div>
    </div>
  );
}

/** Pit stops in the given order; the fastest normal stop is purple, stoppages are faded. */
export function PitStopsTable({ pitStops, sort, season = null }: { pitStops: PitStopRow[]; sort: PitSort; season?: number | null }) {
  const normal = pitStops.filter((p) => p.durationMs !== null && p.durationMs < STOPPAGE_MS);
  const fastest = normal.length ? Math.min(...normal.map((p) => p.durationMs as number)) : null;
  const base = useMemo(() => sortStops(pitStops, sort), [pitStops, sort]);
  const { sort: column, toggle } = useSort<PitColumn>(null);
  const sorted = sortRows(base, column, pitValue);
  return (
    <table className="data-table sm:min-w-[360px]">
      <thead>
        <tr>
          <SortTh sortKey="lap" sort={column} onSort={toggle} firstDir="asc" className="num w-10">
            Lap
          </SortTh>
          <SortTh sortKey="driver" sort={column} onSort={toggle} firstDir="asc" align="start">
            Driver
          </SortTh>
          <SortTh sortKey="stop" sort={column} onSort={toggle} className="num">
            Stop
          </SortTh>
          <SortTh sortKey="time" sort={column} onSort={toggle} firstDir="asc" className="num">
            Pit lane time
          </SortTh>
        </tr>
      </thead>
      <tbody>
        {sorted.map((p) => {
          const long = p.durationMs !== null && p.durationMs >= STOPPAGE_MS;
          const durationText = p.durationMs !== null ? `${(p.durationMs / 1000).toFixed(3)}` : "";
          return (
            <tr key={`${p.driverId}-${p.stop}`} className={long ? "text-ink-3" : ""}>
              <td className="num text-ink-2">{p.lap ?? ""}</td>
              <td>
                <span className="text-ink sm:hidden">
                  <DriverTag text={p.code} team={p.team} season={season} />
                </span>
                <span className="hidden text-ink sm:inline">
                  <DriverTag text={p.name} team={p.team} season={season} />
                </span>
              </td>
              <td className="num text-ink-2">{p.stop}</td>
              <td className={"num " + (p.durationMs === fastest ? "text-sector-purple" : long ? "text-ink-3" : "text-ink")}>
                {durationText}
                {long ? <span className="ml-1 text-caption">stoppage</span> : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function sortStops(stops: PitStopRow[], sort: PitSort): PitStopRow[] {
  const list = [...stops];
  if (sort === "fastest") {
    list.sort((a, b) => stopRank(a) - stopRank(b));
  } else if (sort === "driver") {
    list.sort((a, b) => a.name.localeCompare(b.name) || a.stop - b.stop);
  } else {
    list.sort((a, b) => (a.lap ?? 0) - (b.lap ?? 0) || a.stop - b.stop);
  }
  return list;
}

function pitValue(stop: PitStopRow, key: PitColumn): SortValue {
  if (key === "lap") return stop.lap;
  if (key === "driver") return stop.name;
  if (key === "stop") return stop.stop;
  return stop.durationMs;
}

/** Sort key for the fastest-first order: unknown times go last, stoppages before them. */
function stopRank(stop: PitStopRow): number {
  if (stop.durationMs === null) return Number.MAX_SAFE_INTEGER;
  return stop.durationMs;
}
