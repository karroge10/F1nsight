import Link from "next/link";
import { getCalendar, getLookups, getRace, getSeasons } from "@/lib/data";
import { formatDate } from "@/lib/format";
import { PageIntro } from "@/components/ui/page-intro";
import { Flag } from "@/components/ui/flag";
import { TeamLogo } from "@/components/ui/team-logo";
import { SeasonPicker } from "./season-picker";

export async function CalendarPageContent({ season }: { season: number }) {
  const calendar = await getCalendar(season);
  const seasons = await getSeasons();
  const lookups = await getLookups();
  const winners = new Map<number, { driverId: string; constructorId: string } | null>();
  const poles = new Map<number, { driverId: string; constructorId: string } | null>();
  for (const race of calendar) {
    if (!race.hasResults) continue;
    const full = await getRace(season, race.round);
    const winner = full?.results.find((r) => r.position === 1) ?? null;
    winners.set(race.round, winner ? { driverId: winner.driverId, constructorId: winner.constructorId } : null);
    const pole = full?.results.find((r) => r.grid === 1) ?? full?.qualifying.find((q) => q.position === 1) ?? null;
    poles.set(race.round, pole ? { driverId: pole.driverId, constructorId: pole.constructorId } : null);
  }
  const completed = calendar.filter((r) => r.status === "completed").length;

  return (
    <>
      <PageIntro
        label={
          <>
            Races <span className="mx-1.5 text-ink-3">/</span> {season}
          </>
        }
        title={`${season} calendar and results`}
        dek={completed < calendar.length ? `${completed} of ${calendar.length} rounds completed.` : `${calendar.length} rounds.`}
        aside={<SeasonPicker seasons={seasons.map((s) => s.season)} current={season} hrefFor={(s) => `/races/${s}`} />}
      />
      <div className="mx-auto mt-6 max-w-[1440px] px-4 sm:px-6">
        <div className="scroll-x">
          <table className="data-table min-w-[640px]">
            <thead>
              <tr>
                <th className="num w-10">Rd</th>
                <th>Grand Prix</th>
                <th className="hidden md:table-cell">Circuit</th>
                <th>Date</th>
                <th>Winner</th>
                <th className="hidden lg:table-cell">Pole</th>
                <th className="hidden sm:table-cell">Format</th>
              </tr>
            </thead>
            <tbody>
              {calendar.map((race) => {
                const winner = winners.get(race.round) ?? null;
                const pole = poles.get(race.round) ?? null;
                const dateText = formatDate(race.date, { day: "numeric", month: "short" });
                const isNext = race.status === "next";
                return (
                  <tr key={race.round} className={race.status === "upcoming" ? "text-ink-3" : ""}>
                    <td className="num text-ink-2">{race.round}</td>
                    <td>
                      <Link href={`/races/${season}/${race.round}`} className="font-[550] text-ink hover:underline underline-offset-2">
                        {race.raceName}
                      </Link>
                      {isNext ? <span className="selected-pill ml-2 rounded-chip px-1.5 py-0.5 text-caption font-[600] uppercase tracking-wide">Next</span> : null}
                      {race.cancelled ? <span className="ml-2 text-caption text-ink-3">cancelled</span> : null}
                    </td>
                    <td className="hidden text-ink-2 md:table-cell">
                      <Link href={`/circuits/${race.circuitId}`} className="hover:underline underline-offset-2">
                        {race.circuitName}
                      </Link>
                      <span className="ml-2 text-caption text-ink-3">
                        <Flag of={race.country} fallback={race.countryCode} keepSpace={false} className="mr-1.5 align-[-1px]" />
                        {race.country}
                      </span>
                    </td>
                    <td className="timing text-ink-2">{dateText}</td>
                    <td>
                      {winner ? (
                        <Link href={`/drivers/${winner.driverId}`} className="flex items-center gap-2 text-ink hover:underline underline-offset-2">
                          <TeamLogo constructorId={winner.constructorId} name={lookups.teamName(winner.constructorId)} color={lookups.teamColor(winner.constructorId)} size={18} season={season} />
                          {lookups.driverName(winner.driverId)}
                        </Link>
                      ) : null}
                    </td>
                    <td className="hidden text-ink-2 lg:table-cell">
                      {pole ? (
                        <span className="flex items-center gap-2">
                          <TeamLogo constructorId={pole.constructorId} name={lookups.teamName(pole.constructorId)} color={lookups.teamColor(pole.constructorId)} size={18} season={season} />
                          {lookups.driverName(pole.driverId)}
                        </span>
                      ) : null}
                    </td>
                    <td className="hidden text-caption text-ink-3 sm:table-cell">{race.hasSprint ? "Sprint weekend" : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
