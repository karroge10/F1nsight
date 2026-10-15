import type { Metadata } from "next";
import Link from "next/link";
import { getLookups, getRecords, getSeasons } from "@/lib/data";
import type { Lookups } from "@/lib/data";
import { formatPoints } from "@/lib/format";
import { PageIntro } from "@/components/ui/page-intro";
import { Section } from "@/components/ui/section";
import { TeamLogo } from "@/components/ui/team-logo";
import { TeamName } from "@/components/ui/team-name";
import { Meter } from "@/components/ui/prob-bar";
import { SortableTable, type SortColumn } from "@/components/ui/sortable-table";
import { IconCalendar, IconGarage, IconHelmet } from "@/components/icons";

export const metadata: Metadata = {
  title: "History and records",
};

export default async function HistoryPage() {
  const seasons = await getSeasons();
  const records = await getRecords();
  const lookups = await getLookups();
  const driverRecords = records.filter((g) => g.key.startsWith("drivers-"));
  const constructorRecords = records.filter((g) => g.key.startsWith("constructors-"));

  return (
    <>
      <PageIntro label="History" title="Every champion since 1950, and the records" />

      <Section title="Driver records" icon={IconHelmet} info="Points are as awarded, so totals from eras with different scoring systems do not compare one to one." flush>
        <RecordGrid groups={driverRecords} hrefBase="/drivers" />
      </Section>
      <Section title="Constructor records" icon={IconGarage} flush>
        <RecordGrid groups={constructorRecords} hrefBase="/teams" teamLookups={lookups} />
      </Section>

      <Section title={`${seasons.length} seasons`} icon={IconCalendar} flush>
        <div className="scroll-x">
          <SortableTable
            className="data-table min-w-[640px]"
            columns={SEASON_COLUMNS}
            rows={seasons.map((s) => ({
              key: String(s.season),
              values: {
                season: s.season,
                rounds: s.rounds,
                driver: s.driverChampion ? lookups.driverName(s.driverChampion.driverId) : null,
                car: s.driverChampion?.constructorId ? lookups.teamName(s.driverChampion.constructorId) : null,
                points: s.driverChampion?.points,
                wins: s.driverChampion?.wins,
                constructor: s.constructorChampion ? lookups.teamName(s.constructorChampion.constructorId) : null,
                constructorPoints: s.constructorChampion?.points,
              },
              row: (
                <tr>
                  <td>
                    <Link href={`/standings/${s.season}`} className="timing text-ink hover:underline underline-offset-2">
                      {s.season}
                    </Link>
                    {s.inProgress ? <span className="ml-2 text-caption text-ink-3">in progress</span> : null}
                  </td>
                  <td className="num text-ink-2">{s.inProgress ? `${s.completedRounds} / ${s.rounds}` : s.rounds}</td>
                  <td>
                    {s.driverChampion ? (
                      <Link href={`/drivers/${s.driverChampion.driverId}`} className="flex items-center gap-2 text-ink hover:underline underline-offset-2">
                        {/* below md the car column is hidden, so the logo moves in front of the name */}
                        <TeamLogo constructorId={s.driverChampion.constructorId ?? ""} name={lookups.teamName(s.driverChampion.constructorId ?? "")} color={lookups.teamColor(s.driverChampion.constructorId ?? "")} size={18} season={s.season} className="md:hidden" />
                        {lookups.driverName(s.driverChampion.driverId)}
                        {s.inProgress ? <span className="text-caption text-ink-3">leads</span> : null}
                      </Link>
                    ) : (
                      ""
                    )}
                  </td>
                  <td className="hidden text-ink-2 md:table-cell">
                    {s.driverChampion?.constructorId ? <TeamName constructorId={s.driverChampion.constructorId} name={lookups.teamName(s.driverChampion.constructorId)} color={lookups.teamColor(s.driverChampion.constructorId)} season={s.season} /> : null}
                  </td>
                  <td className="num text-ink">{s.driverChampion ? formatPoints(s.driverChampion.points) : ""}</td>
                  <td className="num hidden text-ink-2 sm:table-cell">{s.driverChampion?.wins ?? ""}</td>
                  <td>
                    {s.constructorChampion ? (
                      <Link href={`/teams/${s.constructorChampion.constructorId}`} className="flex items-center gap-2 text-ink hover:underline underline-offset-2">
                        <TeamLogo constructorId={s.constructorChampion.constructorId} name={lookups.teamName(s.constructorChampion.constructorId)} color={lookups.teamColor(s.constructorChampion.constructorId)} size={18} season={s.season} />
                        {lookups.teamName(s.constructorChampion.constructorId)}
                      </Link>
                    ) : (
                      <span className="text-ink-3">{s.season < 1958 ? "not awarded" : ""}</span>
                    )}
                  </td>
                  <td className="num hidden text-ink lg:table-cell">{s.constructorChampion ? formatPoints(s.constructorChampion.points) : ""}</td>
                </tr>
              ),
            }))}
          />
        </div>
      </Section>
    </>
  );
}

const SEASON_COLUMNS: SortColumn[] = [
  { key: "season", label: "Season" },
  { key: "rounds", label: "Rounds", className: "num" },
  { key: "driver", label: "Drivers' champion", firstDir: "asc" },
  { key: "car", label: "Car", firstDir: "asc", className: "hidden md:table-cell" },
  { key: "points", label: "Points", className: "num" },
  { key: "wins", label: "Wins", className: "num hidden sm:table-cell" },
  { key: "constructor", label: "Constructors' champion", firstDir: "asc" },
  { key: "constructorPoints", label: "Points", className: "num hidden lg:table-cell" },
];

/** Top-ten lists. Constructor lists pass `teamLookups`, so each team carries its logo. */
function RecordGrid({ groups, hrefBase, teamLookups }: { groups: Awaited<ReturnType<typeof getRecords>>; hrefBase: string; teamLookups?: Lookups }) {
  return (
    <div className="grid gap-x-10 gap-y-8 md:grid-cols-2 xl:grid-cols-3">
      {groups.map((group) => {
        const max = group.entries[0]?.value ?? 1;
        return (
          <div key={group.key}>
            {/* a list title under the section heading: quieter, so the two levels do not read alike */}
            <h3 className="text-ui text-ink-2">{group.title}</h3>
            <ol className="mt-2 divide-y divide-rule">
              {group.entries.slice(0, 8).map((e, i) => {
                const ratio = e.value / max;
                const valueText = Number.isInteger(e.value) ? String(e.value) : e.value.toFixed(1);
                return (
                  <li key={e.id} className="grid grid-cols-[1.25rem_minmax(0,1fr)_4rem_3.5rem] items-center gap-2 py-1.5 text-ui">
                    <span className="timing text-caption text-ink-3">{i + 1}</span>
                    <Link href={`${hrefBase}/${e.id}`} className="tap flex min-w-0 items-center gap-2 text-ink hover:underline underline-offset-2">
                      {teamLookups ? <TeamLogo constructorId={e.id} name={e.label} color={teamLookups.teamColor(e.id)} size={18} /> : null}
                      <span className="min-w-0 truncate">
                        {e.label}
                        <span className="ml-2 hidden text-caption text-ink-3 sm:inline">{e.detail}</span>
                      </span>
                    </Link>
                    <Meter ratio={ratio} />
                    <span className="timing text-end text-table text-ink">{valueText}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        );
      })}
    </div>
  );
}

