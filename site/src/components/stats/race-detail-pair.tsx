import type { Lookups, ResultRow } from "@/lib/data";
import { formatGap, formatLapTime } from "@/lib/format";
import { SectionTitle } from "@/components/ui/section";
import { PitStopsPanel, type PitStopRow } from "./pit-stops-table";
import { DriverTag } from "./driver-tag";
import { IconFastestLap } from "@/components/icons";

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
            <table className="data-table min-w-[320px]">
              <thead>
                <tr>
                  <th className="num w-10">Rank</th>
                  <th>Driver</th>
                  <th className="num hidden sm:table-cell">Lap</th>
                  <th className="num">Time</th>
                  <th className="num">Gap</th>
                </tr>
              </thead>
              <tbody>
                {fastestLaps.map((r) => (
                  <tr key={r.driverId}>
                    <td className="num text-ink-2">{r.fastestLapRank}</td>
                    <td className="text-ink">
                      <DriverTag text={lookups.driverName(r.driverId)} team={teamOf(r.constructorId, lookups)} season={season} href={`/drivers/${r.driverId}`} />
                    </td>
                    <td className="num hidden text-ink-2 sm:table-cell">{r.fastestLapNumber ?? ""}</td>
                    <td className={"num " + (r.fastestLapRank === 1 ? "text-sector-purple" : "text-ink")}>{formatLapTime(r.fastestLapMs)}</td>
                    <td className="num text-ink-2">{r.fastestLapRank === 1 ? "" : formatGap((r.fastestLapMs ?? 0) - fastestMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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

function teamOf(constructorId: string, lookups: Lookups) {
  return { constructorId, name: lookups.teamName(constructorId), color: lookups.teamColor(constructorId) };
}
