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
      <ForecastHero prediction={prediction} race={race} now={now} totalRounds={totalRounds} facts={facts} />

      <Section
        title="Finishing Order"
        icon={IconListNumbers}
        info="Drivers ranked by win chance, then podium and points chance. Percentages are the share of simulated races. Main factors shows the two model inputs that moved each forecast most; open a row for the full breakdown, the same fields for every driver."
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
        title="Model record"
        icon={IconPulse}
        info="Backtest over this season's completed rounds, and the last seven forecasts against the actual results."
        aside={
          <Link href="/fantasy" className="tap-hit hover:text-ink underline-offset-2 hover:underline">
            Fantasy for this race
          </Link>
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
