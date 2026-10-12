import Link from "next/link";
import type { Prediction, SeasonStandings } from "@/lib/data";
import type { EntryList } from "@/lib/data";
import { formatPercent, formatPoints } from "@/lib/format";
import { ProbBar } from "@/components/ui/prob-bar";
import { TeamLogo } from "@/components/ui/team-logo";

interface TitleOddsProps {
  prediction: Prediction;
  standings: SeasonStandings | null;
  entries: EntryList;
  totalRounds: number;
}

export function TitleOdds({ prediction, standings, entries, totalRounds }: TitleOddsProps) {
  const driverById = new Map(entries.drivers.map((d) => [d.driverId, d]));
  const teamById = new Map(entries.constructors.map((c) => [c.constructorId, c]));
  const driverStanding = new Map((standings?.drivers.list ?? []).map((s) => [s.id, s]));
  const teamStanding = new Map((standings?.constructors.list ?? []).map((s) => [s.id, s]));
  const drivers = [...prediction.championship.drivers].sort((a, b) => b.pTitle - a.pTitle || b.expectedFinalPoints - a.expectedFinalPoints).slice(0, 5);
  const constructors = [...prediction.championship.constructors]
    .sort((a, b) => b.pTitle - a.pTitle || (teamStanding.get(b.constructorId)?.points ?? 0) - (teamStanding.get(a.constructorId)?.points ?? 0))
    .slice(0, 5);
  const remaining = standings ? totalRounds - standings.drivers.rounds : null;

  return (
    <div className="grid gap-8 md:grid-cols-2">
      <div>
        <h3 className="text-h3 font-[550] text-ink">
          Drivers&apos; title <span className="text-ui font-normal text-ink-3">{remaining !== null ? `${remaining} rounds left` : ""}</span>
        </h3>
        <ul className="mt-3 divide-y divide-rule">
          {drivers.map((d) => {
            const info = driverById.get(d.driverId);
            const standing = driverStanding.get(d.driverId);
            const pointsText = standing ? formatPoints(standing.points) : "";
            const expectedText = formatPoints(Math.round(d.expectedFinalPoints));
            return (
              <li key={d.driverId} className="flex items-center gap-3 py-2">
                <TeamLogo constructorId={info?.constructorId ?? ""} name={info?.team ?? ""} color={info?.teamColor ?? "#8A8F98"} size={24} season={entries.season} />
                <Link href={`/drivers/${d.driverId}`} className="tap-hit min-w-0 flex-1 truncate text-ui text-ink hover:underline underline-offset-2">
                  {info?.name ?? d.driverId}
                </Link>
                <span className="timing hidden text-caption text-ink-3 sm:inline">
                  {pointsText} pts, exp. {expectedText}
                </span>
                <ProbBar value={d.pTitle} width="w-20" label="title" />
              </li>
            );
          })}
        </ul>
      </div>
      <div>
        <h3 className="text-h3 font-[550] text-ink">Constructors&apos; title</h3>
        <ul className="mt-3 divide-y divide-rule">
          {constructors.map((c) => {
            const info = teamById.get(c.constructorId);
            const standing = teamStanding.get(c.constructorId);
            const pointsText = standing ? formatPoints(standing.points) : "";
            const percentText = formatPercent(c.pTitle);
            return (
              <li key={c.constructorId} className="flex items-center gap-3 py-2">
                <TeamLogo constructorId={c.constructorId} name={info?.name ?? c.constructorId} color={info?.color ?? "#8A8F98"} size={24} season={entries.season} />
                <Link href={`/teams/${c.constructorId}`} className="tap-hit min-w-0 flex-1 truncate text-ui text-ink hover:underline underline-offset-2">
                  {info?.name ?? c.constructorId}
                </Link>
                <span className="timing hidden text-caption text-ink-3 sm:inline">{pointsText} pts</span>
                <span className="timing text-table text-ink w-12 text-end">{percentText}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
