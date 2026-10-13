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
import { IconCalendar, IconCrown, IconFastestLap, IconGarage, IconGridSlot, IconHelmet, IconListNumbers, IconMedal, IconTrophy } from "@/components/icons";

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
          <table className="data-table min-w-[640px]">
            <thead>
              <tr>
                <th>Season</th>
                <th className="num">Rounds</th>
                <th>Drivers&apos; champion</th>
                <th className="hidden md:table-cell">Car</th>
                <th className="num">Points</th>
                <th className="num hidden sm:table-cell">Wins</th>
                <th>Constructors&apos; champion</th>
                <th className="num hidden lg:table-cell">Points</th>
              </tr>
            </thead>
            <tbody>
              {seasons.map((s) => (
                <tr key={s.season}>
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
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}

/** Top-ten lists. Constructor lists pass `teamLookups`, so each team carries its logo. */
function RecordGrid({ groups, hrefBase, teamLookups }: { groups: Awaited<ReturnType<typeof getRecords>>; hrefBase: string; teamLookups?: Lookups }) {
  return (
    <div className="grid gap-x-10 gap-y-8 md:grid-cols-2 xl:grid-cols-3">
      {groups.map((group) => {
        const max = group.entries[0]?.value ?? 1;
        const Icon = recordIcon(group.key);
        return (
          <div key={group.key}>
            <h3 className="flex items-center gap-2 text-ui font-[550] text-ink">
              <Icon size="1rem" className="text-ink-3" />
              {group.title}
            </h3>
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

function recordIcon(key: string) {
  if (key.endsWith("-wins")) return IconTrophy;
  if (key.endsWith("-poles")) return IconGridSlot;
  if (key.endsWith("-podiums")) return IconMedal;
  if (key.endsWith("-titles")) return IconCrown;
  if (key.endsWith("-fastestLaps")) return IconFastestLap;
  return IconListNumbers;
}
