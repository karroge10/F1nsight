import type { DriverForecast } from "@/lib/data";
import { predictedOrder } from "@/lib/forecast";
import { ForecastRow } from "./forecast-row";

interface ForecastTableProps {
  drivers: DriverForecast[];
  poleMs: number | null;
}

/** Predicted finishing order: one compact row per driver; the full factor breakdown opens per row. */
export function ForecastTable({ drivers, poleMs }: ForecastTableProps) {
  const ordered = predictedOrder(drivers);
  return (
    <div className="scroll-x">
      {/* the last row keeps its toggle and link hit areas inside the table, so the container never overflows downwards */}
      <table className="data-table max-sm:[&_td]:px-2! max-sm:[&_th]:px-2! sm:min-w-[560px] [&>tbody>tr:last-child_button]:before:bottom-0 max-sm:[&>tbody>tr:last-child_.tap-hit]:-mb-3.5! max-sm:[&>tbody>tr:last-child_.tap-hit]:pb-3.5!">
        <thead>
          <tr>
            <th className="w-10 tnum" title="Predicted finishing position">
              <HeadLabel>Pos</HeadLabel>
            </th>
            <th className="!pl-3">
              <HeadLabel>Driver</HeadLabel>
            </th>
            <th className="num sm:w-32">
              <HeadLabel>Win</HeadLabel>
            </th>
            <th className="num sm:w-32">
              <HeadLabel>Podium</HeadLabel>
            </th>
            <th className="num hidden w-32 md:table-cell">
              <HeadLabel>Points</HeadLabel>
            </th>
            <th className="num pr-4!">
              <HeadLabel>DNF</HeadLabel>
            </th>
            <th className="hidden xl:table-cell" title="Chance of each finishing place, P1 at the left. Darker squares are more likely. The palest are under 1%.">
              <HeadLabel>P1 to P22</HeadLabel>
            </th>
            <th className="hidden lg:table-cell">
              <HeadLabel>Main factors</HeadLabel>
            </th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((d, i) => (
            <ForecastRow key={d.driverId} driver={d} place={i + 1} poleMs={poleMs} />
          ))}
        </tbody>
      </table>
    </div>
  );
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
