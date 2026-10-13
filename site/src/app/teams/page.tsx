import type { Metadata } from "next";
import Link from "next/link";
import { getConstructors, getCurrentSeason, getEntryList, getLookups, getStandings } from "@/lib/data";
import type { Constructor, Lookups } from "@/lib/data";
import { formatPoints } from "@/lib/format";
import { PageIntro } from "@/components/ui/page-intro";
import { Section } from "@/components/ui/section";
import { EntityIndex, type IndexRow } from "@/components/stats/entity-index";
import { IconGarage, IconHistory } from "@/components/icons";
import { TeamLogo } from "@/components/ui/team-logo";

export const metadata: Metadata = {
  title: "Teams",
};

export default async function TeamsPage() {
  const season = await getCurrentSeason();
  const entries = await getEntryList(season);
  const standings = await getStandings(season);
  const constructors = await getConstructors();
  const lookups = await getLookups();
  const standingById = new Map((standings?.constructors.list ?? []).map((s) => [s.id, s]));
  const current = [...entries.constructors].sort((a, b) => (standingById.get(a.constructorId)?.position ?? 99) - (standingById.get(b.constructorId)?.position ?? 99));
  const rows: IndexRow[] = constructors.map((c) => indexRow(c, lookups));

  return (
    <>
      <PageIntro label="Teams" title={`${constructors.length} constructors since 1950`} dek={`${entries.constructors.length} on the ${season} grid.`} />
      <Section title={`${season} constructors`} icon={IconGarage} flush>
        {/* one column read top to bottom, capped so the few columns stay close together */}
        <div className="max-w-3xl">
          <div className="scroll-x">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="num w-10">Pos</th>
                  <th>Constructor</th>
                  <th className="hidden md:table-cell">Drivers</th>
                  <th className="num">Points</th>
                </tr>
              </thead>
              <tbody>
                {current.map((c) => {
                  const standing = standingById.get(c.constructorId);
                  const drivers = entries.drivers.filter((d) => d.constructorId === c.constructorId).map((d) => d.name);
                  const pointsText = standing ? formatPoints(standing.points) : "0";
                  return (
                    <tr key={c.constructorId}>
                      <td className="num text-ink-2">{standing?.position ?? ""}</td>
                      <td>
                        <Link href={`/teams/${c.constructorId}`} className="flex items-center gap-2 text-ink hover:underline underline-offset-2">
                          <TeamLogo constructorId={c.constructorId} name={c.name} color={c.color} size={28} season={season} />
                          <span className="font-[550]">{c.name}</span>
                        </Link>
                      </td>
                      <td className="hidden text-ink-2 md:table-cell">{drivers.join(", ")}</td>
                      <td className="num text-ink">{pointsText}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </Section>
      <Section title="All constructors" icon={IconHistory} flush>
        <EntityIndex rows={rows} columns={["Races", "Wins", "Podiums", "Poles", "Titles", "Points"]} hrefBase="/teams" label="constructors" defaultSort={1} />
      </Section>
    </>
  );
}

function indexRow(c: Constructor, lookups: Lookups): IndexRow {
  const span = c.career.firstSeason === c.career.lastSeason ? String(c.career.firstSeason) : `${c.career.firstSeason} to ${c.career.lastSeason}`;
  return {
    id: c.constructorId,
    name: c.name,
    sub: c.nationality ?? "",
    color: lookups.teamColor(c.constructorId),
    team: { constructorId: c.constructorId, name: c.name, season: c.career.lastSeason },
    countryCode: c.countryCode,
    span,
    numbers: [c.career.starts, c.career.wins, c.career.podiums, c.career.poles, c.career.titles, c.career.points],
  };
}
