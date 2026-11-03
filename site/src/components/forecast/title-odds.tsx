import Link from "next/link";
import type { EntryList, Prediction, RaceSummary, SeasonStandings, StandingsTable } from "@/lib/data";
import { nextChampionshipBattle } from "@/lib/data/championship";
import { formatPoints } from "@/lib/format";
import { ProbBar } from "@/components/ui/prob-bar";
import { TeamLogo } from "@/components/ui/team-logo";
import { ChampionBadge } from "@/components/ui/champion-badge";

interface TitleOddsProps {
  prediction: Prediction;
  standings: SeasonStandings | null;
  entries: EntryList;
  calendar: RaceSummary[];
}

interface Contender {
  id: string;
  pTitle: number;
  positionDist?: number[];
  expectedFinalPoints?: number;
}

interface Entrant {
  name: string;
  constructorId: string;
  color: string;
}

export function TitleOdds({ prediction, standings, entries, calendar }: TitleOddsProps) {
  const current = standings?.season === prediction.race.season ? standings : null;
  const drivers = new Map(entries.drivers.map(d => [d.driverId, { name: d.name, constructorId: d.constructorId, color: d.teamColor }]));
  const teams = new Map(entries.constructors.map(c => [c.constructorId, { name: c.name, constructorId: c.constructorId, color: c.color }]));
  return (
    <div className="grid gap-8 md:grid-cols-2">
      <ChampionshipColumn kind="drivers" season={entries.season} calendar={calendar} table={current?.drivers}
        championId={current?.championship.driverId ?? null} entrants={drivers}
        contenders={prediction.championship.drivers.map(d => ({ ...d, id: d.driverId }))} />
      <ChampionshipColumn kind="constructors" season={entries.season} calendar={calendar} table={current?.constructors}
        championId={current?.championship.constructorId ?? null} entrants={teams}
        contenders={prediction.championship.constructors.map(c => ({ ...c, id: c.constructorId }))} />
    </div>
  );
}

function ChampionshipColumn({ kind, season, calendar, table, championId, entrants, contenders }: {
  kind: "drivers" | "constructors";
  season: number;
  calendar: RaceSummary[];
  table?: StandingsTable;
  championId: string | null;
  entrants: Map<string, Entrant>;
  contenders: Contender[];
}) {
  const battle = nextChampionshipBattle(table ?? { rounds: 0, list: [] }, calendar, season, championId, kind === "constructors");
  const secured = new Set(battle.secured.map(row => row.id));
  const standingById = new Map(table?.list.map(row => [row.id, row]) ?? []);
  const position = battle.position;
  const positionsAvailable = position === 1 || (position !== null && contenders.length > 0
    && contenders.every(row => row.positionDist && row.positionDist.length === contenders.length
      && row.positionDist.every(value => Number.isFinite(value) && value >= 0 && value <= 1))
    && battle.secured.every(fixed => (contenders.find(row => row.id === fixed.id)?.positionDist?.[fixed.position - 1] ?? 0) >= 0.999));
  const rows = contenders.filter(row => !secured.has(row.id)).map(row => ({
    ...row, chance: position === 1 ? row.pTitle : row.positionDist?.[(position ?? 1) - 1] ?? 0,
  })).sort((a, b) => b.chance - a.chance || (b.expectedFinalPoints ?? 0) - (a.expectedFinalPoints ?? 0)).slice(0, 5);
  const href = kind === "drivers" ? "/drivers" : "/teams";
  const remaining = calendar.filter(race => !race.cancelled && race.round > (table?.rounds ?? 0)).length;
  return (
    <div>
      <h3 className="text-h3 font-[550] text-ink">{kind === "drivers" ? "Drivers' championship" : "Constructors' championship"}</h3>
      {battle.secured.length > 0 ? (
        <ul className="mt-3 divide-y divide-rule">
          {battle.secured.map(fixed => {
            const info = entrants.get(fixed.id);
            const standing = standingById.get(fixed.id);
            return (
              <li key={fixed.id} className={`flex items-center gap-3 py-2 text-ui ${fixed.position === 1 ? "champion-row px-2" : ""}`}>
                <TeamLogo constructorId={info?.constructorId ?? ""} name={info?.name ?? fixed.id} color={info?.color ?? "#8A8F98"} size={24} season={season} />
                <Link href={`${href}/${fixed.id}`} className="tap-hit min-w-0 flex-1 truncate text-ui text-ink hover:underline underline-offset-2">{info?.name ?? fixed.id}</Link>
                {standing ? <span className="timing hidden text-caption text-ink-3 sm:inline">{formatPoints(standing.points)} pts</span> : null}
                {fixed.position === 1 ? <ChampionBadge season={season} /> : <span className="text-caption text-ink-2">P{fixed.position} secured</span>}
              </li>
            );
          })}
        </ul>
      ) : null}
      {position === null ? <p className="mt-3 text-ui text-ink-3">All positions decided.</p> : (
        <>
          <h4 className="mt-4 flex flex-wrap items-baseline gap-x-2 text-ui font-[550] text-ink">
            {position === 1 ? "Title odds" : `Fight for P${position}`}
            <span className="text-caption font-normal text-ink-3">{remaining} rounds left</span>
          </h4>
          {!positionsAvailable || rows.length === 0 ? <p className="mt-2 text-caption text-ink-3">Position odds will be available after the next forecast refresh.</p> : (
            <ul className="mt-2 divide-y divide-rule">
              {rows.map(row => {
                const info = entrants.get(row.id);
                return (
                  <li key={row.id} className="flex items-center gap-3 py-2">
                    <TeamLogo constructorId={info?.constructorId ?? ""} name={info?.name ?? row.id} color={info?.color ?? "#8A8F98"} size={24} season={season} />
                    <Link href={`${href}/${row.id}`} className="tap-hit min-w-0 flex-1 truncate text-ui text-ink hover:underline underline-offset-2">{info?.name ?? row.id}</Link>
                    {row.expectedFinalPoints !== undefined ? <span className="timing hidden text-caption text-ink-3 sm:inline">exp. {formatPoints(Math.round(row.expectedFinalPoints))} pts</span> : null}
                    <ProbBar value={row.chance} width="w-20" label={`P${position}`} />
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
