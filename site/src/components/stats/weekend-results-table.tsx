import Link from "next/link";
import type { Lookups, ResultRow } from "@/lib/data";
import { formatGap, formatLapTime, formatPoints, formatRaceTime, positionLabel } from "@/lib/format";
import type { RaceAnalysis } from "@/lib/race-analysis";
import { TeamName } from "@/components/ui/team-name";
import { DriverTag } from "./driver-tag";

interface WeekendResultsTableProps {
  results: ResultRow[];
  /** Per-driver overtakes and pit stops, folded in as columns when known. */
  analysis: RaceAnalysis | null;
  lookups: Lookups;
  season: number;
  /** Sprint: no fastest lap column. */
  compact?: boolean;
}

/**
 * Race or sprint classification: grid and places gained, laps, time or status, points, and from
 * the analysis the on-track overtakes and pit stops of each driver.
 */
export function WeekendResultsTable({ results, analysis, lookups, season, compact = false }: WeekendResultsTableProps) {
  const winnerTime = results.find((r) => r.position === 1)?.timeMs ?? null;
  const showFastest = !compact && results.some((r) => r.fastestLapRank !== null);
  const rowsById = new Map((analysis?.rows ?? []).map((r) => [r.driverId, r]));
  const showOvertakes = analysis !== null && analysis.overtakesTotal !== null;
  const showStops = analysis !== null && analysis.rows.some((r) => r.pitStops > 0);
  return (
    <div className="scroll-x">
      <table className="data-table sm:min-w-[560px]">
        <thead>
          <tr>
            <th className="num w-10">Pos</th>
            <th>Driver</th>
            <th className="hidden md:table-cell">Team</th>
            <th className="num">Grid</th>
            <th className="num hidden sm:table-cell">Laps</th>
            <th className="num">Time / status</th>
            <th className="num">Pts</th>
            {showOvertakes ? <th className="num hidden sm:table-cell">Overtakes</th> : null}
            {showStops ? <th className="num hidden sm:table-cell">Stops</th> : null}
            {showFastest ? <th className="num hidden lg:table-cell">Fastest lap</th> : null}
          </tr>
        </thead>
        <tbody>
          {results.map((row, i) => {
            const extra = rowsById.get(row.driverId) ?? null;
            const team = { constructorId: row.constructorId, name: lookups.teamName(row.constructorId), color: lookups.teamColor(row.constructorId) };
            const time = timeText(row, winnerTime);
            const gained = row.grid && row.position ? row.grid - row.position : null;
            return (
              <tr key={`${row.driverId}-${row.number ?? i}`} className={row.classified ? "" : "text-ink-3"}>
                <td className="num text-ink-2">{positionLabel(row.positionText)}</td>
                <td>
                  {/* below md the team column is hidden, so the logo stays in front of the name; on phones the code stands in for the name */}
                  <DriverTag text={lookups.driverName(row.driverId)} compactText={lookups.driverCode(row.driverId)} team={team} season={season} href={`/drivers/${row.driverId}`} logoClassName="md:hidden" className="font-[550] text-ink" />
                </td>
                <td className="hidden text-ink-2 md:table-cell">
                  <Link href={`/teams/${row.constructorId}`} className="hover:underline underline-offset-2">
                    <TeamName constructorId={team.constructorId} name={team.name} color={team.color} season={season} />
                  </Link>
                </td>
                <td className="num text-ink-2">
                  {row.grid === 0 ? "PL" : row.grid ?? ""}
                  {gained !== null && gained !== 0 ? <span className={"ml-1 text-caption " + (gained > 0 ? "text-delta-up" : "text-delta-down")}>{gained > 0 ? `+${gained}` : gained}</span> : null}
                </td>
                <td className="num hidden text-ink-2 sm:table-cell">{row.laps ?? ""}</td>
                <td className={"num " + (row.classified ? "text-ink" : "text-ink-3")}>{time}</td>
                <td className="num text-ink">{row.points ? formatPoints(row.points) : ""}</td>
                {showOvertakes ? <td className="num hidden text-ink-2 sm:table-cell">{extra?.overtakes ?? ""}</td> : null}
                {showStops ? <td className="num hidden text-ink-2 sm:table-cell">{extra ? extra.pitStops : ""}</td> : null}
                {showFastest ? (
                  <td className={"num hidden lg:table-cell " + (row.fastestLapRank === 1 ? "text-sector-purple" : "text-ink-3")}>
                    {row.fastestLapMs ? formatLapTime(row.fastestLapMs) : ""}
                    {row.fastestLapNumber ? <span className="ml-1 text-caption text-ink-3">L{row.fastestLapNumber}</span> : null}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** The winner's race time, everyone else's gap to it, or the status for the lapped and retired. */
function timeText(row: ResultRow, winnerTime: number | null): string {
  if (row.position === 1) return formatRaceTime(row.timeMs);
  if (row.timeMs !== null && winnerTime !== null && row.classified) return formatGap(row.timeMs - winnerTime);
  return row.status;
}
