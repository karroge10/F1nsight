import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties } from "react";
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
      <PageIntro compact label="Drivers" title={`The ${season} grid and every driver since 1950`} dek={`${entries.drivers.length} drivers this season, ${drivers.length} all time.`} />
      <Section title={`${season} grid`} icon={IconHelmet} flush>
        <ul className="grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {grid.map((d, i) => {
            const standing = standingById.get(d.driverId);
            return (
              <li key={d.driverId} className="stagger-in border-b border-rule" style={{ "--stagger": Math.min(i, 12) } as CSSProperties}>
                <Link href={`/drivers/${d.driverId}`} className="flex min-h-11 items-center gap-3 py-2 hover:bg-bg-hover">
                  <span className="timing w-6 text-end text-table text-ink-3">{standing?.position ?? ""}</span>
                  {/* below md the team line is hidden, so the logo moves in front of the name */}
                  <TeamLogo constructorId={d.constructorId} name={d.team} color={d.teamColor} size={18} season={season} className="md:hidden" />
                  <span className="min-w-0 flex-1 text-ui font-[550] leading-tight text-ink">
                    {d.name}
                    <span className="hidden text-caption font-normal text-ink-3 md:block">
                      <TeamName constructorId={d.constructorId} name={d.team} color={d.teamColor} season={season} size={14} />
                    </span>
                  </span>
                  <span className="timing w-10 text-end text-table text-ink">{standing?.points ?? 0}</span>
                </Link>
              </li>
            );
          })}
        </ul>
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
