import Link from "next/link";
import type { Lookups, QualifyingRow, ResultRow } from "@/lib/data";
import { formatGap, formatLapTime, formatPoints, formatRaceTime, positionLabel } from "@/lib/format";
import { TeamLogo } from "@/components/ui/team-logo";
import { TeamName } from "@/components/ui/team-name";
import { DriverTag } from "./driver-tag";

interface ResultsTableProps {
  results: ResultRow[];
  lookups: Lookups;
  compact?: boolean;
  /** Season of the session, so team logos show that year's brand. Defaults to the latest. */
  season?: number | null;
}

export function ResultsTable({ results, lookups, compact, season = null }: ResultsTableProps) {
  const winnerTime = results.find((r) => r.position === 1)?.timeMs ?? null;
  const showFastest = results.some((r) => r.fastestLapRank !== null);
  return (
    <div className="scroll-x">
      <table className="data-table min-w-[560px]">
        <thead>
          <tr>
            <th className="num w-10">Pos</th>
            <th>Driver</th>
            <th className="hidden md:table-cell">Team</th>
            <th className="num">Grid</th>
            <th className="num hidden sm:table-cell">Laps</th>
            <th className="num">Time / status</th>
            <th className="num">Pts</th>
            {showFastest && !compact ? <th className="num hidden lg:table-cell">Fastest lap</th> : null}
          </tr>
        </thead>
        <tbody>
          {results.map((row, i) => {
            const label = positionLabel(row.positionText);
            const time = row.position === 1 ? formatRaceTime(row.timeMs) : row.timeMs !== null && winnerTime !== null && row.classified ? formatGap(row.timeMs - winnerTime) : row.status;
            const gained = row.grid && row.position ? row.grid - row.position : null;
            const pointsText = row.points ? formatPoints(row.points) : "";
            const fastest = row.fastestLapMs ? formatLapTime(row.fastestLapMs) : "";
            return (
              <tr key={`${row.driverId}-${row.number ?? i}`} className={row.classified ? "" : "text-ink-3"}>
                <td className="num text-ink-2">{label}</td>
                <td>
                  <Link href={`/drivers/${row.driverId}`} className="flex items-center gap-2 text-ink hover:underline underline-offset-2">
                    {/* below md the team column is hidden, so the logo moves in front of the name */}
                    <TeamLogo constructorId={row.constructorId} name={lookups.teamName(row.constructorId)} color={lookups.teamColor(row.constructorId)} size={18} season={season} className="md:hidden" />
                    <span className="font-[550]">{lookups.driverName(row.driverId)}</span>
                  </Link>
                </td>
                <td className="hidden text-ink-2 md:table-cell">
                  <Link href={`/teams/${row.constructorId}`} className="hover:underline underline-offset-2">
                    <TeamName constructorId={row.constructorId} name={lookups.teamName(row.constructorId)} color={lookups.teamColor(row.constructorId)} season={season} />
                  </Link>
                </td>
                <td className="num text-ink-2">
                  {row.grid === 0 ? "PL" : row.grid ?? ""}
                  {gained !== null && gained !== 0 ? <span className={"ml-1 text-caption " + (gained > 0 ? "text-delta-up" : "text-delta-down")}>{gained > 0 ? `+${gained}` : gained}</span> : null}
                </td>
                <td className="num hidden text-ink-2 sm:table-cell">{row.laps ?? ""}</td>
                <td className={"num " + (row.classified ? "text-ink" : "text-ink-3")}>{time}</td>
                <td className="num text-ink">{pointsText}</td>
                {showFastest && !compact ? (
                  <td className={"num hidden lg:table-cell " + (row.fastestLapRank === 1 ? "text-sector-purple" : "text-ink-3")}>
                    {fastest}
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

export function QualifyingTable({ qualifying, lookups, season = null }: { qualifying: QualifyingRow[]; lookups: Lookups; season?: number | null }) {
  const hasQ3 = qualifying.some((q) => q.q3 !== null);
  const hasQ2 = qualifying.some((q) => q.q2 !== null);
  const bestQ1 = minOf(qualifying.map((q) => q.q1));
  const bestQ2 = minOf(qualifying.map((q) => q.q2));
  const bestQ3 = minOf(qualifying.map((q) => q.q3));
  return (
    <div className="scroll-x">
      <table className="data-table phone-tight sm:min-w-[480px]">
        <thead>
          <tr>
            <th className="num w-10">Pos</th>
            <th>Driver</th>
            <th className="hidden md:table-cell">Team</th>
            <th className="num">{hasQ2 ? "Q1" : "Time"}</th>
            {hasQ2 ? <th className="num">Q2</th> : null}
            {hasQ3 ? <th className="num">Q3</th> : null}
          </tr>
        </thead>
        <tbody>
          {qualifying.map((q) => {
            const team = { constructorId: q.constructorId, name: lookups.teamName(q.constructorId), color: lookups.teamColor(q.constructorId) };
            return (
              <tr key={`${q.driverId}-${q.number ?? ""}`}>
                <td className="num text-ink-2">{q.position ?? ""}</td>
                <td>
                  {/* on phones the code stands in for the name, so the three part times fit */}
                  <DriverTag text={lookups.driverName(q.driverId)} compactText={lookups.driverCode(q.driverId)} team={team} season={season} logo={18} href={`/drivers/${q.driverId}`} logoClassName="md:hidden" className="font-[550] text-ink" />
                </td>
                <td className="hidden text-ink-2 md:table-cell">
                  <TeamName constructorId={team.constructorId} name={team.name} color={team.color} season={season} />
                </td>
                <td className={"num " + (q.q1 !== null && q.q1 === bestQ1 ? "text-sector-purple" : "text-ink")}>{formatLapTime(q.q1)}</td>
                {hasQ2 ? <td className={"num " + (q.q2 !== null && q.q2 === bestQ2 ? "text-sector-purple" : "text-ink")}>{formatLapTime(q.q2)}</td> : null}
                {hasQ3 ? <td className={"num " + (q.q3 !== null && q.q3 === bestQ3 ? "text-sector-purple" : "text-ink")}>{formatLapTime(q.q3)}</td> : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function minOf(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null && v > 0);
  return present.length ? Math.min(...present) : null;
}
