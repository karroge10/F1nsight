import { getCalendar, getLookups, getSeasons, getStandings } from "@/lib/data";
import { PageIntro } from "@/components/ui/page-intro";
import { Section, SectionTitle } from "@/components/ui/section";
import { IconForecast, IconGarage, IconHelmet } from "@/components/icons";
import { SeasonPicker } from "./season-picker";
import { ConstructorStandingsTable, DriverStandingsTable } from "./standings-tables";
import { ProgressionChart } from "./progression-chart";

export async function StandingsPageContent({ season }: { season: number }) {
  const standings = await getStandings(season);
  const calendar = await getCalendar(season);
  const seasons = await getSeasons();
  const lookups = await getLookups();
  const summary = seasons.find((s) => s.season === season);
  const roundsDone = standings?.drivers.rounds ?? 0;
  const lastRace = calendar.find((r) => r.round === roundsDone);
  const inProgress = summary?.inProgress ?? false;
  const dek = lastRace ? `${inProgress ? "After" : "Final, after"} round ${roundsDone} of ${summary?.rounds ?? calendar.length}, ${lastRace.raceName}.` : "No results yet.";

  return (
    <>
      <PageIntro
        label={
          <>
            Standings <span className="mx-1.5 text-ink-3">/</span> {season}
          </>
        }
        title={`${season} championship`}
        dek={dek}
        aside={<SeasonPicker seasons={seasons.map((s) => s.season)} current={season} hrefFor={(s) => `/standings/${s}`} />}
      />
      {standings ? (
        <>
          <div className="mx-auto mt-6 grid max-w-[1440px] gap-10 px-4 sm:px-6 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <SectionTitle title="Drivers" icon={IconHelmet} />
              <div className="mt-3" />
              <DriverStandingsTable standings={standings} lookups={lookups} />
            </div>
            <div className="lg:col-span-5">
              <SectionTitle title="Constructors" icon={IconGarage} />
              <div className="mt-3" />
              {season >= 1958 ? <ConstructorStandingsTable standings={standings} lookups={lookups} /> : <p className="text-ui text-ink-3">The constructors&apos; championship started in 1958.</p>}
            </div>
          </div>
          {roundsDone > 1 ? (
            <>
              <Section title="Drivers, round by round" icon={IconForecast}>
                <ProgressionChart table={standings.drivers} races={calendar} lookups={lookups} kind="drivers" title={`${season} drivers' points after each round`} />
              </Section>
              {season >= 1958 ? (
                <Section title="Constructors, round by round" icon={IconForecast}>
                  <ProgressionChart table={standings.constructors} races={calendar} lookups={lookups} kind="constructors" emphasise={5} title={`${season} constructors' points after each round`} />
                </Section>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
    </>
  );
}
