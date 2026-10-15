"use client";

import type { DriverForecast } from "@/lib/data";
import { predictedOrder } from "@/lib/forecast";
import { SortTh, sortRows, useSort, type SortValue } from "@/components/ui/sortable";
import { ForecastRow } from "./forecast-row";

interface ForecastTableProps {
  drivers: DriverForecast[];
  poleMs: number | null;
}

type ForecastSort = "place" | "driver" | "win" | "podium" | "points" | "dnf";

interface PlacedDriver {
  driver: DriverForecast;
  place: number;
}

/** Predicted finishing order: one compact row per driver; the full factor breakdown opens per row. */
export function ForecastTable({ drivers, poleMs }: ForecastTableProps) {
  const { sort, toggle } = useSort<ForecastSort>("place", "asc");
  const ordered = predictedOrder(drivers);
  const placed = ordered.map((driver, i) => ({ driver, place: i + 1 }));
  const sorted = sortRows(placed, sort, forecastValue);
  return (
    <div className="scroll-x">
      {/* the last row keeps its toggle and link hit areas inside the table, so the container never overflows downwards */}
      <table className="data-table max-sm:[&_td]:px-2! max-sm:[&_th]:px-2! sm:min-w-[560px] [&>tbody>tr:last-child_button]:before:bottom-0 max-sm:[&>tbody>tr:last-child_.tap-hit]:-mb-3.5! max-sm:[&>tbody>tr:last-child_.tap-hit]:pb-3.5!">
        <thead>
          <tr>
            <SortTh sortKey="place" sort={sort} onSort={toggle} firstDir="asc" align="start" className="w-10 tnum" title="Predicted finishing position">
              <HeadLabel>Pos</HeadLabel>
            </SortTh>
            <SortTh sortKey="driver" sort={sort} onSort={toggle} firstDir="asc" align="start" className="!pl-3">
              <HeadLabel>Driver</HeadLabel>
            </SortTh>
            <SortTh sortKey="win" sort={sort} onSort={toggle} className="num sm:w-32">
              <HeadLabel>Win</HeadLabel>
            </SortTh>
            <SortTh sortKey="podium" sort={sort} onSort={toggle} className="num sm:w-32">
              <HeadLabel>Podium</HeadLabel>
            </SortTh>
            <SortTh sortKey="points" sort={sort} onSort={toggle} className="num hidden w-32 md:table-cell">
              <HeadLabel>Points</HeadLabel>
            </SortTh>
            <SortTh sortKey="dnf" sort={sort} onSort={toggle} firstDir="asc" className="num pr-4!">
              <HeadLabel>DNF</HeadLabel>
            </SortTh>
            <th className="hidden xl:table-cell" title="Chance of each finishing place, P1 at the left. Darker squares are more likely. The palest are under 1%.">
              <HeadLabel>P1 to P22</HeadLabel>
            </th>
            <th className="hidden lg:table-cell">
              <HeadLabel>Main factors</HeadLabel>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => (
            <ForecastRow key={p.driver.driverId} driver={p.driver} place={p.place} poleMs={poleMs} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function forecastValue(row: PlacedDriver, key: ForecastSort): SortValue {
  if (key === "place") return row.place;
  if (key === "driver") return row.driver.name;
  if (key === "win") return row.driver.pWin;
  if (key === "podium") return row.driver.pPodium;
  if (key === "points") return row.driver.pPoints;
  return row.driver.pDnf;
}

/** Every header shares one box (same height, icon and text centred) so the labels line up. */
function HeadLabel({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex h-4 items-center gap-1 leading-none">
      {icon}
      {children}
    </span>
  );
}
