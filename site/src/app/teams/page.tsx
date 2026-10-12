import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties } from "react";
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
      <PageIntro label="Teams" title={`${entries.constructors.length} constructors in ${season}, ${constructors.length} since 1950`} />
      <Section title={`${season} constructors`} icon={IconGarage} flush>
        <ul className="grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
          {current.map((c, i) => {
            const standing = standingById.get(c.constructorId);
            const drivers = entries.drivers.filter((d) => d.constructorId === c.constructorId).map((d) => d.name);
            return (
              <li key={c.constructorId} className="stagger-in border-b border-rule" style={{ "--stagger": Math.min(i, 12) } as CSSProperties}>
                <Link href={`/teams/${c.constructorId}`} className="flex min-h-11 items-center gap-3 py-3 hover:bg-bg-hover">
                  <span className="timing w-6 text-end text-table text-ink-3">{standing?.position ?? ""}</span>
                  <TeamLogo constructorId={c.constructorId} name={c.name} color={c.color} size={36} season={season} />
                  <span className="min-w-0 flex-1 text-ui font-[550] leading-tight text-ink">
                    <span className="block truncate">{c.name}</span>
                    <span className="hidden truncate text-caption font-normal text-ink-3 md:block">{drivers.join(", ")}</span>
                  </span>
                  <span className="timing w-12 text-end text-table text-ink">{standing ? formatPoints(standing.points) : 0}</span>
                </Link>
              </li>
            );
          })}
        </ul>
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
