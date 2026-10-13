import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentSeason, getDrivers, getEntryList, getLookups, getStandings } from "@/lib/data";
import type { Driver, Lookups } from "@/lib/data";
import { PageIntro } from "@/components/ui/page-intro";
import { Section } from "@/components/ui/section";
import { TeamLogo } from "@/components/ui/team-logo";
import { TeamName } from "@/components/ui/team-name";
import { EntityIndex, type IndexRow } from "@/components/stats/entity-index";
import { IconHelmet, IconHistory } from "@/components/icons";

export const metadata: Metadata = {
  title: "Drivers",
};

export default async function DriversPage() {
  const season = await getCurrentSeason();
  const entries = await getEntryList(season);
  const standings = await getStandings(season);
  const drivers = await getDrivers();
  const lookups = await getLookups();
  const standingById = new Map((standings?.drivers.list ?? []).map((s) => [s.id, s]));
  const grid = [...entries.drivers].sort((a, b) => (standingById.get(a.driverId)?.position ?? 99) - (standingById.get(b.driverId)?.position ?? 99));
  const rows: IndexRow[] = drivers.map((d) => indexRow(d, lookups));

  return (
    <>
      <PageIntro label="Drivers" title={`${drivers.length} drivers since 1950`} dek={`${entries.drivers.length} on the ${season} grid.`} />
      <Section title={`${season} grid`} icon={IconHelmet} flush>
        {/* one column read top to bottom, capped so the few columns stay close together */}
        <div className="max-w-3xl">
          <div className="scroll-x">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="num w-10">Pos</th>
                  <th>Driver</th>
                  <th className="num hidden w-12 sm:table-cell">No.</th>
                  <th className="hidden sm:table-cell">Team</th>
                  <th className="num">Points</th>
                </tr>
              </thead>
              <tbody>
                {grid.map((d) => {
                  const standing = standingById.get(d.driverId);
                  return (
                    <tr key={d.driverId}>
                      <td className="num text-ink-2">{standing?.position ?? ""}</td>
                      <td>
                        <Link href={`/drivers/${d.driverId}`} className="flex items-center gap-2 text-ink hover:underline underline-offset-2">
                          {/* on phones the team column is hidden, so the logo moves in front of the name */}
                          <TeamLogo constructorId={d.constructorId} name={d.team} color={d.teamColor} size={18} season={season} className="sm:hidden" />
                          <span className="font-[550]">{d.name}</span>
                        </Link>
                      </td>
                      <td className="num hidden text-ink-3 sm:table-cell">{d.number ?? ""}</td>
                      <td className="hidden text-ink-2 sm:table-cell">
                        <TeamName constructorId={d.constructorId} name={d.team} color={d.teamColor} season={season} size={18} />
                      </td>
                      <td className="num text-ink">{standing?.points ?? 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </Section>
      <Section title="All drivers" icon={IconHistory} flush>
        <EntityIndex rows={rows} columns={["Starts", "Wins", "Podiums", "Poles", "Titles", "Points"]} hrefBase="/drivers" label="drivers" defaultSort={1} />
      </Section>
    </>
  );
}

function indexRow(d: Driver, lookups: Lookups): IndexRow {
  const lastTeam = d.career.constructorIds[d.career.constructorIds.length - 1] ?? "";
  const span = d.career.firstSeason === d.career.lastSeason ? String(d.career.firstSeason) : `${d.career.firstSeason} to ${d.career.lastSeason}`;
  return {
    id: d.driverId,
    name: `${d.givenName} ${d.familyName}`,
    sub: d.nationality ?? "",
    color: lookups.teamColor(lastTeam),
    team: { constructorId: lastTeam, name: lookups.teamName(lastTeam), season: d.career.lastSeason },
    countryCode: d.countryCode,
    span,
    numbers: [d.career.starts, d.career.wins, d.career.podiums, d.career.poles, d.career.titles, d.career.points],
  };
}
