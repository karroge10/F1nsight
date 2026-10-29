import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getConstructor, getConstructors, getConstructorSeasonResults, getCurrentSeason, getEntryList } from "@/lib/data";
import { formatPoints, positionLabel } from "@/lib/format";
import { EntityHeader } from "@/components/stats/entity-header";
import { Section } from "@/components/ui/section";
import { IconCalendar, IconHistory } from "@/components/icons";
import { Flag } from "@/components/ui/flag";
import { TeamLogo } from "@/components/ui/team-logo";
import { SortableTable, type SortColumn } from "@/components/ui/sortable-table";

type Params = Promise<{ id: string }>;

export const dynamicParams = false;

export async function generateStaticParams(): Promise<{ id: string }[]> {
  const teams = await getConstructors();
  return teams.map((t) => ({ id: t.constructorId }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const team = await getConstructor(id);
  return { title: team ? team.name : "Team" };
}

export default async function TeamPage({ params }: { params: Params }) {
  const { id } = await params;
  const team = await getConstructor(id);
  if (!team) notFound();
  const currentSeason = await getCurrentSeason();
  const activeSeason = team.career.lastSeason ?? currentSeason;
  const seasonResults = await getConstructorSeasonResults(id, activeSeason);
  const entries = await getEntryList(activeSeason);
  const drivers = entries.drivers.filter((d) => d.constructorId === id);
  const seasonsDesc = [...team.seasons].sort((a, b) => b.season - a.season);
  const span = team.career.firstSeason === team.career.lastSeason ? String(team.career.firstSeason) : `${team.career.firstSeason} to ${team.career.lastSeason}`;
  const seasonColumns = teamSeasonColumns(drivers);
  const titleSeasons = team.seasons.filter((s) => s.position === 1 && s.season !== currentSeason && s.season >= 1958).map((s) => s.season);

  return (
    <>
      <EntityHeader
        label={
          <>
            <Link href="/teams" className="hover:text-ink">
              Teams
            </Link>
            {team.nationality ? (
              <>
                <span className="mx-1.5 text-ink-3">/</span>
                <Flag of={team.nationality} fallback={team.countryCode} keepSpace={false} className="mr-1.5" />
                {team.nationality}
              </>
            ) : null}
          </>
        }
        title={team.name}
        color={team.color}
        media={<TeamLogo constructorId={team.constructorId} name={team.name} color={team.color} size={112} season={team.career.lastSeason} />}
        meta={
          <>
            {span}. {team.career.driverCount} drivers have raced for the team.
            {drivers.length ? ` ${activeSeason} line-up: ${drivers.map((d) => d.name).join(", ")}.` : ""}
          </>
        }
        figures={[
          { label: "Races", value: team.career.starts },
          { label: "Wins", value: team.career.wins },
          { label: "Podiums", value: team.career.podiums },
          { label: "Poles", value: team.career.poles },
          { label: "Titles", value: team.career.titles, note: titleSeasons.length > 6 ? `${titleSeasons.length} seasons` : titleSeasons.join(", ") },
          { label: "Points", value: formatPoints(team.career.points) },
        ]}
      />

      {seasonResults.length > 0 ? (
        <Section title={`${activeSeason} season`} icon={IconCalendar} flush>
          <div className="scroll-x">
            <SortableTable className="data-table min-w-[520px]" columns={seasonColumns} initialKey="round" initialDir="desc"
              rows={seasonResults.map(({ race, results }) => {
                  const total = results.reduce((a, r) => a + r.points, 0);
                  const values: Record<string, number | string | null> = { round: race.round, name: race.raceName, total };
                  for (const d of drivers) {
                    const r = results.find((x) => x.driverId === d.driverId);
                    values[d.driverId] = r ? r.position ?? 100 : null;
                  }
                  const tr = (
                    <tr>
                      <td className="num text-ink-2">{race.round}</td>
                      <td>
                        <Link href={`/races/${race.season}/${race.round}`} className="text-ink hover:underline underline-offset-2">
                          {race.raceName}
                        </Link>
                      </td>
                      {drivers.map((d) => {
                        const r = results.find((x) => x.driverId === d.driverId);
                        return (
                          <td key={d.driverId} className={"num " + (r?.position === 1 ? "font-[600] text-ink" : r?.classified ? "text-ink" : "text-ink-3")}>
                            {r ? positionLabel(r.positionText) : ""}
                          </td>
                        );
                      })}
                      <td className="num text-ink">{total ? formatPoints(total) : ""}</td>
                    </tr>
                  );
                  return { key: String(race.round), values, row: tr };
                })}
            />
          </div>
        </Section>
      ) : null}

      <Section title="Championships" icon={IconHistory} flush>
        <div className="scroll-x">
          <SortableTable
            className="data-table min-w-[360px]"
            columns={CHAMPIONSHIP_COLUMNS}
            initialKey="season"
            initialDir="desc"
            rows={seasonsDesc.map((s) => ({
              key: String(s.season),
              values: { season: s.season, pos: s.position, points: s.points, wins: s.wins },
              row: (
                <tr>
                  <td>
                    <Link href={`/standings/${s.season}`} className="timing text-ink hover:underline underline-offset-2">
                      {s.season}
                    </Link>
                  </td>
                  <td className={"num " + (s.position === 1 ? "font-[600] text-ink" : "text-ink-2")}>{s.position ?? ""}</td>
                  <td className="num text-ink">{formatPoints(s.points)}</td>
                  <td className="num text-ink-2">{s.wins}</td>
                </tr>
              ),
            }))}
          />
        </div>
      </Section>
    </>
  );
}

const CHAMPIONSHIP_COLUMNS: SortColumn[] = [
  { key: "season", label: "Season" },
  { key: "pos", label: "Pos", firstDir: "asc", className: "num" },
  { key: "points", label: "Points", className: "num" },
  { key: "wins", label: "Wins", className: "num" },
];

/** Round and race, a finishing position column per driver of the season, then the team's points. */
function teamSeasonColumns(drivers: { driverId: string; code: string }[]): SortColumn[] {
  const driverColumns: SortColumn[] = drivers.map((d) => ({ key: d.driverId, label: d.code, firstDir: "asc", className: "num" }));
  return [{ key: "round", label: "Rd", firstDir: "asc", className: "num w-10" }, { key: "name", label: "Grand Prix", firstDir: "asc" }, ...driverColumns, { key: "total", label: "Team pts", className: "num" }];
}
