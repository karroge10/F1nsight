import type { Lookups, ResultRow } from "@/lib/data";
import { formatGap, formatLapTime } from "@/lib/format";
import { SectionTitle } from "@/components/ui/section";
import { PitStopsPanel, type PitStopRow } from "./pit-stops-table";
import { DriverTag } from "./driver-tag";
import { IconFastestLap } from "@/components/icons";
import { SortableTable, type SortColumn } from "@/components/ui/sortable-table";

// Holds the title row at the height of the pit stops sort switch on wide screens, so both
// titles and both tables start level.
const TITLE_SPACER = <span aria-hidden className="hidden h-9 lg:block" />;

interface RaceDetailPairProps {
  fastestLaps: ResultRow[];
  pitStops: PitStopRow[];
  pitInfo: string;
  lookups: Lookups;
  season?: number | null;
}

/**
 * Fastest laps beside pit stops, two cards of equal height. The fastest laps show in full and
 * set the height on wide screens; the pit stops scroll inside it, and are capped and scroll on
 * their own when the cards stack.
 */
export function RaceDetailPair({ fastestLaps, pitStops, pitInfo, lookups, season = null }: RaceDetailPairProps) {
  if (fastestLaps.length === 0 && pitStops.length === 0) return null;
  const fastestMs = fastestLaps[0]?.fastestLapMs ?? 0;
  return (
    <div className="stagger-in mx-auto mt-10 grid w-full max-w-[1440px] grid-cols-1 gap-x-10 gap-y-10 px-4 sm:mt-14 sm:px-6 lg:grid-cols-2 lg:items-stretch">
      {fastestLaps.length > 0 ? (
        <div className="flex min-h-0 flex-col">
          <SectionTitle title="Fastest laps" icon={IconFastestLap} aside={TITLE_SPACER} />
          <div className="scroll-x mt-3">
            <SortableTable
              className="data-table min-w-[320px]"
              columns={FASTEST_COLUMNS}
              initialKey="rank"
              initialDir="asc"
              rows={fastestLaps.map((r) => ({
                key: r.driverId,
                values: { rank: r.fastestLapRank, name: lookups.driverName(r.driverId), lap: r.fastestLapNumber, time: r.fastestLapMs },
                row: (
                  <tr>
                    <td className="num text-ink-2">{r.fastestLapRank}</td>
                    <td className="text-ink">
                      <DriverTag text={lookups.driverName(r.driverId)} team={teamOf(r.constructorId, lookups)} season={season} href={`/drivers/${r.driverId}`} />
                    </td>
                    <td className="num hidden text-ink-2 sm:table-cell">{r.fastestLapNumber ?? ""}</td>
                    <td className={"num " + (r.fastestLapRank === 1 ? "text-sector-purple" : "text-ink")}>{formatLapTime(r.fastestLapMs)}</td>
                    <td className="num text-ink-2">{r.fastestLapRank === 1 ? "" : formatGap((r.fastestLapMs ?? 0) - fastestMs)}</td>
                  </tr>
                ),
              }))}
            />
          </div>
        </div>
      ) : null}
      {pitStops.length > 0 ? <PitStopsPanel pitStops={pitStops} info={pitInfo} fill={fastestLaps.length > 0} season={season} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const FASTEST_COLUMNS: SortColumn[] = [
  { key: "rank", label: "Rank", firstDir: "asc", className: "num w-10" },
  { key: "name", label: "Driver", firstDir: "asc" },
  { key: "lap", label: "Lap", firstDir: "asc", className: "num hidden sm:table-cell" },
  { key: "time", label: "Time", firstDir: "asc", className: "num" },
  { label: "Gap", className: "num" },
];

function teamOf(constructorId: string, lookups: Lookups) {
  return { constructorId, name: lookups.teamName(constructorId), color: lookups.teamColor(constructorId) };
}
