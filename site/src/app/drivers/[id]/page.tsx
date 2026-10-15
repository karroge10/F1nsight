import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentSeason, getDriver, getDrivers, getDriverSeasonResults, getLookups } from "@/lib/data";
import type { Lookups } from "@/lib/data";
import { formatDate, formatLapTime, formatPoints, positionLabel } from "@/lib/format";
import { EntityHeader } from "@/components/stats/entity-header";
import { Section } from "@/components/ui/section";
import { Flag } from "@/components/ui/flag";
import { TeamLogo } from "@/components/ui/team-logo";
import { TeamName, TeamNames } from "@/components/ui/team-name";
import { Sparkline } from "@/components/ui/sparkline";
import { IconCalendar, IconHistory, IconTrophy } from "@/components/icons";
import { DriverPortrait } from "@/components/ui/driver-portrait";
import { SortableTable, type SortColumn } from "@/components/ui/sortable-table";

type Params = Promise<{ id: string }>;

export const dynamicParams = false;

export async function generateStaticParams(): Promise<{ id: string }[]> {
  const drivers = await getDrivers();
  return drivers.map((d) => ({ id: d.driverId }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const driver = await getDriver(id);
  return { title: driver ? `${driver.givenName} ${driver.familyName}` : "Driver" };
}

export default async function DriverPage({ params }: { params: Params }) {
  const { id } = await params;
  const driver = await getDriver(id);
  if (!driver) notFound();
  const lookups = await getLookups();
  const currentSeason = await getCurrentSeason();
  const activeSeason = driver.career.lastSeason ?? currentSeason;
  const seasonResults = await getDriverSeasonResults(id, activeSeason);
  const currentTeam = driver.career.constructorIds[driver.career.constructorIds.length - 1] ?? "";
  const seasonsDesc = [...driver.seasons].sort((a, b) => b.season - a.season);
  const winsDesc = [...driver.wins].sort((a, b) => b.season - a.season || b.round - a.round);
  const born = driver.dateOfBirth ? formatDate(driver.dateOfBirth, { day: "numeric", month: "long", year: "numeric" }) : null;
  const span = driver.career.firstSeason === driver.career.lastSeason ? String(driver.career.firstSeason) : `${driver.career.firstSeason} to ${driver.career.lastSeason}`;
  const careerTeams = teamItems(driver.career.constructorIds, lookups);
  const positions = seasonResults.map((r) => (r.result?.classified && r.result.position ? r.result.position : null));

  return (
    <>
      <EntityHeader
        label={
          <>
            <Link href="/drivers" className="hover:text-ink">
              Drivers
            </Link>
            {driver.number ? (
              <>
                <span className="mx-1.5 text-ink-3">/</span> #{driver.number}
              </>
            ) : null}
          </>
        }
        title={`${driver.givenName} ${driver.familyName}`}
        color={lookups.teamColor(currentTeam)}
        media={<DriverPortrait driverId={driver.driverId} name={`${driver.givenName} ${driver.familyName}`} teamColor={lookups.teamColor(currentTeam)} size={128} />}
        meta={
          <>
            {driver.nationality ? (
              <>
                <Flag of={driver.nationality} fallback={driver.countryCode} keepSpace={false} className="mr-1.5" />
                {driver.nationality}
              </>
            ) : null}
            {born ? `, born ${born}` : ""}. {span}, <TeamNames teams={careerTeams} suffix="." />
          </>
        }
        figures={[
          { label: "Starts", value: driver.career.starts },
          { label: "Wins", value: driver.career.wins },
          { label: "Podiums", value: driver.career.podiums },
          { label: "Poles", value: driver.career.poles },
          { label: "Titles", value: driver.career.titles, note: driver.seasons.filter((s) => s.position === 1 && s.season !== currentSeason).map((s) => s.season).join(", ") },
          { label: "Points", value: formatPoints(driver.career.points) },
          { label: "Fastest laps", value: driver.career.fastestLaps, note: "2004 onwards" },
        ]}
      />

      {seasonResults.length > 0 ? (
        <Section title={`${activeSeason} season`} icon={IconCalendar} aside={<Sparkline values={positions.map((p) => (p === null ? null : 23 - p))} width={140} height={24} title="finishing positions" />} flush>
          <div className="scroll-x">
            <SortableTable className="data-table min-w-[560px]" columns={SEASON_COLUMNS} initialKey="round" initialDir="asc"
              rows={seasonResults.map(({ race, result, sprint, qualifying }) => {
                  const points = (result?.points ?? 0) + (sprint?.points ?? 0);
                  const values = {
                    round: race.round,
                    name: race.raceName,
                    grid: result?.grid === 0 ? 100 : result?.grid,
                    quali: qualifying?.position,
                    finish: result ? result.position ?? 100 : null,
                    sprint: sprint ? sprint.position ?? 100 : null,
                    points,
                    fastest: result?.fastestLapRank,
                  };
                  const tr = (
                    <tr>
                      <td className="num text-ink-2">{race.round}</td>
                      <td>
                        <Link href={`/races/${race.season}/${race.round}`} className="text-ink hover:underline underline-offset-2">
                          {race.raceName}
                        </Link>
                      </td>
                      <td className="hidden text-ink-2 md:table-cell">
                        {result ? <TeamName constructorId={result.constructorId} name={lookups.teamName(result.constructorId)} color={lookups.teamColor(result.constructorId)} season={race.season} /> : null}
                      </td>
                      <td className="num text-ink-2">{result?.grid === 0 ? "PL" : result?.grid ?? ""}</td>
                      <td className="num text-ink-2">{qualifying?.position ?? ""}</td>
                      <td className={"num " + (result?.position === 1 ? "font-[600] text-ink" : result?.classified ? "text-ink" : "text-ink-3")}>{result ? positionLabel(result.positionText) : ""}</td>
                      <td className="num hidden text-ink-2 sm:table-cell">{sprint ? positionLabel(sprint.positionText) : ""}</td>
                      <td className="num text-ink">{points ? formatPoints(points) : ""}</td>
                      <td className={"num hidden lg:table-cell " + (result?.fastestLapRank === 1 ? "text-sector-purple" : "text-ink-3")}>{result?.fastestLapMs ? formatLapTime(result.fastestLapMs) : ""}</td>
                    </tr>
                  );
                  return { key: String(race.round), values, row: tr };
                })}
            />
          </div>
        </Section>
      ) : null}

      <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-x-10 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <Section title="Career" icon={IconHistory} flush>
            <div className="scroll-x">
              <SortableTable className="data-table min-w-[400px]" columns={CAREER_COLUMNS} initialKey="season" initialDir="desc"
                rows={seasonsDesc.map((s) => {
                    const seasonTeams = teamItems(s.constructorIds, lookups);
                    const values = { season: s.season, pos: s.position, points: s.points, wins: s.wins };
                    const tr = (
                      <tr>
                        <td>
                          <Link href={`/standings/${s.season}`} className="timing text-ink hover:underline underline-offset-2">
                            {s.season}
                          </Link>
                        </td>
                        <td>
                          <TeamNames teams={seasonTeams} season={s.season} className="text-ink-2" />
                        </td>
                        <td className={"num " + (s.position === 1 ? "font-[600] text-ink" : "text-ink-2")}>{s.position ?? ""}</td>
                        <td className="num text-ink">{formatPoints(s.points)}</td>
                        <td className="num text-ink-2">{s.wins}</td>
                      </tr>
                    );
                    return { key: String(s.season), values, row: tr };
                  })}
              />
            </div>
          </Section>
        </div>
        <div className="lg:col-span-5">
          <Section title={`${driver.wins.length} ${driver.wins.length === 1 ? "win" : "wins"}`} icon={IconTrophy} flush>
            {winsDesc.length === 0 ? (
              <p className="text-ui text-ink-3">No wins yet.</p>
            ) : (
              <ul className="max-h-[32rem] divide-y divide-rule overflow-y-auto text-ui">
                {winsDesc.map((w) => (
                  <li key={`${w.season}-${w.round}`}>
                    <Link href={`/races/${w.season}/${w.round}`} className="flex items-center gap-3 py-2 hover:bg-bg-hover">
                      <span className="timing text-caption text-ink-3">{w.season}</span>
                      <TeamLogo constructorId={w.constructorId} name={lookups.teamName(w.constructorId)} color={lookups.teamColor(w.constructorId)} size={18} season={w.season} />
                      <span className="text-ink">{w.raceName}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}

const SEASON_COLUMNS: SortColumn[] = [
  { key: "round", label: "Rd", firstDir: "asc", className: "num w-10" },
  { key: "name", label: "Grand Prix", firstDir: "asc" },
  { label: "Team", className: "hidden md:table-cell" },
  { key: "grid", label: "Grid", firstDir: "asc", className: "num" },
  { key: "quali", label: "Quali", firstDir: "asc", className: "num" },
  { key: "finish", label: "Finish", firstDir: "asc", className: "num" },
  { key: "sprint", label: "Sprint", firstDir: "asc", className: "num hidden sm:table-cell" },
  { key: "points", label: "Pts", className: "num" },
  { key: "fastest", label: "Fastest lap", firstDir: "asc", className: "num hidden lg:table-cell", title: "Sorted by fastest lap rank" },
];

const CAREER_COLUMNS: SortColumn[] = [
  { key: "season", label: "Season" },
  { label: "Team" },
  { key: "pos", label: "Pos", firstDir: "asc", className: "num" },
  { key: "points", label: "Points", className: "num" },
  { key: "wins", label: "Wins", className: "num" },
];

function teamItems(constructorIds: string[], lookups: Lookups) {
  return constructorIds.map((id) => ({ constructorId: id, name: lookups.teamName(id), color: lookups.teamColor(id) }));
}
