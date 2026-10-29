import type { Metadata } from "next";
import Link from "next/link";
import { getCalendar, getCircuit, getEntryList, getRace, getLookups, getNextRace, getNextRacePrediction, getPredictionHistory, getStandings } from "@/lib/data";
import { ForecastHero, type CircuitFacts } from "@/components/forecast/forecast-hero";
import type { Circuit, Lookups } from "@/lib/data";
import { ForecastTable } from "@/components/forecast/forecast-table";
import { TitleOdds } from "@/components/forecast/title-odds";
import { TrackRecord } from "@/components/forecast/track-record";
import { ConstructorForecastList } from "@/components/forecast/constructor-forecast";
import { Section } from "@/components/ui/section";
import { IconCrown, IconGarage, IconListNumbers, IconPulse } from "@/components/icons";

export const metadata: Metadata = {
  title: "F1nsight: next race forecast",
};

export default async function HomePage() {
  const now = new Date();
  const prediction = await getNextRacePrediction();
  const race = await getNextRace(now);
  const standings = await getStandings(prediction.race.season);
  const entries = await getEntryList(prediction.race.season);
  const history = await getPredictionHistory();
  const calendar = await getCalendar(prediction.race.season);
  const totalRounds = calendar.filter((r) => !r.cancelled).length;
  const circuit = await getCircuit(prediction.race.circuitId);
  const lookups = await getLookups();
  const previousRace = circuit?.races.find((r) => r.season < prediction.race.season) ?? null;
  const facts = circuitFacts(circuit, previousRace, lookups);
  const poleMs = previousRace ? await previousPoleMs(previousRace.season, previousRace.round) : null;

  return (
    <>
      <span
        hidden
        id="forecast-publication"
        data-forecast-generated-at={prediction.generatedAt}
        data-forecast-model={prediction.model.version}
        data-forecast-race={`${prediction.race.season}-${prediction.race.round}`}
        data-forecast-stage={prediction.race.stage}
      />
      <ForecastHero prediction={prediction} race={race} now={now} totalRounds={totalRounds} facts={facts} />

      <Section
        title="Race probabilities"
        icon={IconListNumbers}
        info="Drivers ranked by win chance, then podium and points chance. Percentages are the share of simulated races. Average finish is the mean simulated result. Sort recent form, one-lap gap, car gap or standings to compare inputs; open a row for the full breakdown."
        flush
      >
        <ForecastTable drivers={prediction.drivers} poleMs={poleMs} />
      </Section>

      <Section title="Title odds" icon={IconCrown} info="Share of simulated season endings in which each driver or team takes the title.">
        <TitleOdds prediction={prediction} standings={standings} entries={entries} totalRounds={totalRounds} />
      </Section>

      <Section title="Constructor points" icon={IconGarage} info="Expected race points for each team this weekend, both cars combined.">
        <ConstructorForecastList constructors={prediction.constructors} />
      </Section>

      <Section
        title="Backtest record"
        icon={IconPulse}
        info="Historical backtests against actual results. Verified forecasts published before each race are evaluated separately in the published forecast report."
        aside={
          <div className="flex flex-wrap gap-4">
            <Link href="/races" className="tap-hit hover:text-ink underline-offset-2 hover:underline">Predictions vs results</Link>
            <Link href="/fantasy" className="tap-hit hover:text-ink underline-offset-2 hover:underline">
              Fantasy for this race
            </Link>
          </div>
        }
      >
        <TrackRecord prediction={prediction} history={history} entries={entries} />
      </Section>
    </>
  );
}

function circuitFacts(circuit: Circuit | null, previousRace: Circuit["races"][number] | null, lookups: Lookups): CircuitFacts {
  const winnerId = previousRace?.winnerDriverId ?? null;
  const lastWinner = previousRace && winnerId ? { season: previousRace.season, driverId: winnerId, name: lookups.driverName(winnerId) } : null;
  const record = circuit?.lapRecord ?? null;
  const lapRecord = record ? { timeMs: record.timeMs, driverId: record.driverId, name: lookups.driverName(record.driverId), season: record.season } : null;
  return { lastWinner, lapRecord };
}

/** Pole lap from the last race at this circuit: the reference that turns percent gaps into seconds. */
async function previousPoleMs(season: number, round: number): Promise<number | null> {
  const race = await getRace(season, round);
  const pole = race?.qualifying.find((q) => q.position === 1);
  if (!pole) return null;
  return pole.q3 ?? pole.q2 ?? pole.q1 ?? null;
}
