import Link from "next/link";
import type { Lookups, SeasonStandings } from "@/lib/data";
import { formatPoints } from "@/lib/format";
import { IconArrowDown, IconArrowUp, IconMinus } from "@/components/icons";
import { TeamLogo } from "@/components/ui/team-logo";
import { TeamNames } from "@/components/ui/team-name";

interface StandingsTablesProps {
  standings: SeasonStandings;
  lookups: Lookups;
  limit?: number;
}

export function DriverStandingsTable({ standings, lookups, limit }: StandingsTablesProps) {
  const rows = limit ? standings.drivers.list.slice(0, limit) : standings.drivers.list;
  const leaderPoints = rows[0]?.points ?? 0;
  return (
    <div className="scroll-x">
      <table className="data-table sm:min-w-[420px]">
        <thead>
          <tr>
            <th className="num w-10">Pos</th>
            <th className="w-6" aria-label="Change since last round" />
            <th>Driver</th>
            <th className="hidden sm:table-cell">Team</th>
            <th className="num">Points</th>
            <th className="num hidden md:table-cell">Gap</th>
            <th className="num">Wins</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const teamId = row.constructorIds?.[row.constructorIds.length - 1] ?? "";
            const teams = (row.constructorIds ?? []).map((id) => ({ constructorId: id, name: lookups.teamName(id), color: lookups.teamColor(id) }));
            const gap = leaderPoints - row.points;
            const pointsText = formatPoints(row.points);
            const gapText = gap === 0 ? "" : `−${formatPoints(gap)}`;
            return (
              <tr key={row.id}>
                <td className="num text-ink-2">{row.position ?? ""}</td>
                <td className="!px-0">
                  <Movement row={row} />
                </td>
                <td>
                  <Link href={`/drivers/${row.id}`} className="flex items-center gap-2 text-ink hover:underline underline-offset-2">
                    {/* on phones the team column is hidden, so the logo moves in front of the name */}
                    <TeamLogo constructorId={teamId} name={lookups.teamName(teamId)} color={lookups.teamColor(teamId)} size={18} season={standings.season} className="sm:hidden" />
                    <span className="font-[550]">{lookups.driverName(row.id)}</span>
                  </Link>
                </td>
                <td className="hidden text-ink-2 sm:table-cell">
                  <TeamNames teams={teams} season={standings.season} />
                </td>
                <td className="num text-ink">{pointsText}</td>
                <td className="num hidden text-ink-3 md:table-cell">{gapText}</td>
                <td className="num text-ink-2">{row.wins}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ConstructorStandingsTable({ standings, lookups, limit }: StandingsTablesProps) {
  const rows = limit ? standings.constructors.list.slice(0, limit) : standings.constructors.list;
  const leaderPoints = rows[0]?.points ?? 0;
  return (
    <div className="scroll-x">
      <table className="data-table sm:min-w-[360px]">
        <thead>
          <tr>
            <th className="num w-10">Pos</th>
            <th className="w-6" aria-label="Change since last round" />
            <th>Constructor</th>
            <th className="num">Points</th>
            <th className="num hidden md:table-cell">Gap</th>
            <th className="num">Wins</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const gap = leaderPoints - row.points;
            const pointsText = formatPoints(row.points);
            const gapText = gap === 0 ? "" : `−${formatPoints(gap)}`;
            return (
              <tr key={row.id}>
                <td className="num text-ink-2">{row.position ?? ""}</td>
                <td className="!px-0">
                  <Movement row={row} />
                </td>
                <td>
                  <Link href={`/teams/${row.id}`} className="flex items-center gap-2 text-ink hover:underline underline-offset-2">
                    <TeamLogo constructorId={row.id} name={lookups.teamName(row.id)} color={lookups.teamColor(row.id)} size={28} season={standings.season} />
                    <span className="font-[550]">{lookups.teamName(row.id)}</span>
                  </Link>
                </td>
                <td className="num text-ink">{pointsText}</td>
                <td className="num hidden text-ink-3 md:table-cell">{gapText}</td>
                <td className="num text-ink-2">{row.wins}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Position change against the previous round: up, down or level. */
function Movement({ row }: { row: SeasonStandings["drivers"]["list"][number] }) {
  const positions = row.positionByRound;
  if (positions.length < 2) return <span className="inline-block w-4" />;
  const current = positions[positions.length - 1];
  const previous = positions[positions.length - 2];
  if (current === null || previous === null) return <span className="inline-block w-4" />;
  const delta = previous - current;
  if (delta > 0) return <IconArrowUp size="0.875rem" className="text-delta-up" label={`up ${delta}`} />;
  if (delta < 0) return <IconArrowDown size="0.875rem" className="text-delta-down" label={`down ${-delta}`} />;
  return <IconMinus size="0.875rem" className="text-ink-3" label="no change" />;
}
