import Link from "next/link";
import type { Lookups, QualifyingRow, ResultRow } from "@/lib/data";
import { formatGap, formatLapTime, formatPoints, formatRaceTime, positionLabel } from "@/lib/format";
import { TeamLogo } from "@/components/ui/team-logo";
import { TeamName } from "@/components/ui/team-name";
import { SortableTable, type SortColumn } from "@/components/ui/sortable-table";
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
      <SortableTable className="data-table min-w-[560px]" columns={showFastest && !compact ? [...RESULT_COLUMNS, FASTEST_COLUMN] : RESULT_COLUMNS} initialKey="pos" initialDir="asc"
        rows={results.map((row, i) => {
            const label = positionLabel(row.positionText);
            const time = row.position === 1 ? formatRaceTime(row.timeMs) : row.timeMs !== null && winnerTime !== null && row.classified ? formatGap(row.timeMs - winnerTime) : row.status;
            const gained = row.grid && row.position ? row.grid - row.position : null;
            const pointsText = row.points ? formatPoints(row.points) : "";
            const fastest = row.fastestLapMs ? formatLapTime(row.fastestLapMs) : "";
            const values = { pos: i, name: lookups.driverName(row.driverId), grid: row.grid === 0 ? 100 : row.grid, laps: row.laps, points: row.points, fastest: row.fastestLapMs || null };
            const tr = (
              <tr className={row.classified ? "" : "text-ink-3"}>
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
            return { key: `${row.driverId}-${row.number ?? i}`, values, row: tr };
          })}
      />
    </div>
  );
}

export function QualifyingTable({ qualifying, lookups, season = null }: { qualifying: QualifyingRow[]; lookups: Lookups; season?: number | null }) {
  const hasQ3 = qualifying.some((q) => q.q3 !== null);
  const hasQ2 = qualifying.some((q) => q.q2 !== null);
  const bestQ1 = minOf(qualifying.map((q) => q.q1));
  const bestQ2 = minOf(qualifying.map((q) => q.q2));
  const bestQ3 = minOf(qualifying.map((q) => q.q3));
  const columns = qualifyingColumns(hasQ2, hasQ3);
  return (
    <div className="scroll-x">
      <SortableTable className="data-table phone-tight sm:min-w-[480px]" columns={columns} initialKey="pos" initialDir="asc"
        rows={qualifying.map((q, i) => {
            const team = { constructorId: q.constructorId, name: lookups.teamName(q.constructorId), color: lookups.teamColor(q.constructorId) };
            const values = { pos: i, name: lookups.driverName(q.driverId), q1: q.q1 || null, q2: q.q2 || null, q3: q.q3 || null };
            const tr = (
              <tr>
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
            return { key: `${q.driverId}-${q.number ?? ""}`, values, row: tr };
          })}
      />
    </div>
  );
}

const RESULT_COLUMNS: SortColumn[] = [
  { key: "pos", label: "Pos", firstDir: "asc", className: "num w-10" },
  { key: "name", label: "Driver", firstDir: "asc" },
  { label: "Team", className: "hidden md:table-cell" },
  { key: "grid", label: "Grid", firstDir: "asc", className: "num" },
  { key: "laps", label: "Laps", className: "num hidden sm:table-cell" },
  { label: "Time / status", className: "num" },
  { key: "points", label: "Pts", className: "num" },
];

const FASTEST_COLUMN: SortColumn = { key: "fastest", label: "Fastest lap", firstDir: "asc", className: "num hidden lg:table-cell" };

function qualifyingColumns(hasQ2: boolean, hasQ3: boolean): SortColumn[] {
  const columns: SortColumn[] = [
    { key: "pos", label: "Pos", firstDir: "asc", className: "num w-10" },
    { key: "name", label: "Driver", firstDir: "asc" },
    { label: "Team", className: "hidden md:table-cell" },
    { key: "q1", label: hasQ2 ? "Q1" : "Time", firstDir: "asc", className: "num" },
  ];
  if (hasQ2) columns.push({ key: "q2", label: "Q2", firstDir: "asc", className: "num" });
  if (hasQ3) columns.push({ key: "q3", label: "Q3", firstDir: "asc", className: "num" });
  return columns;
}

function minOf(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null && v > 0);
  return present.length ? Math.min(...present) : null;
}
