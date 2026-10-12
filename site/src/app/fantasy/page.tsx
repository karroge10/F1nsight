import type { Metadata } from "next";
import Link from "next/link";
import { LocalTime } from "@/components/ui/local-time";
import { getEntryList, getFantasyMarket, getFantasyRounds, getNextRacePrediction, getRace } from "@/lib/data";
import { buildFantasyRows, fantasyDeadline } from "@/lib/fantasy";
import { thresholdsForRound } from "@/lib/fantasy/thresholds";
import { PageIntro } from "@/components/ui/page-intro";
import { Section } from "@/components/ui/section";
import { FantasyTable } from "@/components/fantasy/fantasy-table";
import { ProjectionNote } from "@/components/fantasy/projection-note";
import { Planner, type PlannerMeta } from "@/components/fantasy/planner";
import { IconCoins, IconTransfers } from "@/components/icons";
import { formatMoney, formatMoneySigned } from "@/lib/format";
import { TeamLogo } from "@/components/ui/team-logo";

export const metadata: Metadata = {
  title: "Fantasy planner",
  description: "Optimal transfers, boost and chip advice for your F1 Fantasy team, plus projected points, price changes and value for every asset. Free, no login.",
};

export default async function FantasyPage() {
  const market = await getFantasyMarket();
  const prediction = await getNextRacePrediction();
  const entries = await getEntryList(market.season);
  const fantasyRounds = await getFantasyRounds();
  const race = await getRace(prediction.race.season, prediction.race.round);
  // F1 Fantasy numbers its 2026 gamedays by meeting (GamedayId equals MeetingNumber in the game's
  // raceday feed), so the planned gameday is the forecast round; the market snapshot may be older.
  const gameday = prediction.race.round;
  const deadline = race ? fantasyDeadline(race.sessions) : null;
  const rows = buildFantasyRows(market, prediction);
  const thresholdMap = fantasyRounds ? thresholdsForRound(fantasyRounds, market.gameday) : new Map();
  const thresholds = Object.fromEntries(thresholdMap);
  const teams = entries.constructors.map((c) => ({ id: c.constructorId, name: c.name }));
  const risers = rows.filter((r) => r.active).sort((a, b) => b.expectedPriceChange - a.expectedPriceChange).slice(0, 3);
  const fallers = rows.filter((r) => r.active).sort((a, b) => a.expectedPriceChange - b.expectedPriceChange).slice(0, 3);
  const marketInfo = `Pts to rise: score needed this gameday for a price rise (green: projection clears it). Prices stay between ${formatMoney(market.rules.floor)} and ${formatMoney(market.rules.ceiling)}.`;
  const meta: PlannerMeta = {
    codes: Object.fromEntries(entries.drivers.map((d) => [d.driverId, d.code])),
    teams: Object.fromEntries(entries.constructors.map((c) => [c.constructorId, c.name])),
  };

  return (
    <>
      <PageIntro
        compact
        label={
          <>
            Fantasy <span className="mx-1.5 text-ink-3">/</span> Gameday {gameday}
          </>
        }
        title={`${prediction.race.raceName} planner`}
        dek={
          <span className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            {deadline ? (
              <span className="whitespace-nowrap">
                Deadline <LocalTime iso={deadline} />
              </span>
            ) : null}
            <Link href="/fantasy/hindsight" className="tap whitespace-nowrap text-ink underline underline-offset-2">
              Best possible teams
            </Link>
          </span>
        }
      />

      <Planner meta={meta} />

      <Section title="Prices and points" icon={IconCoins} info={marketInfo} flush>
        <FantasyTable rows={rows} teams={teams} thresholds={thresholds} />
        <p className="mt-3">
          <ProjectionNote />
        </p>
      </Section>

      <Section title="Price moves" icon={IconTransfers} flush>
        <div className="grid gap-8 md:grid-cols-2">
          <MoveList title="Likely to rise" rows={risers} />
          <MoveList title="Likely to fall" rows={fallers} />
        </div>
      </Section>
    </>
  );
}

function MoveList({ title, rows }: { title: string; rows: ReturnType<typeof buildFantasyRows> }) {
  return (
    <div>
      <h3 className="text-ui font-[550] text-ink">{title}</h3>
      <ul className="mt-2 divide-y divide-rule">
        {rows.map((r) => {
          const probs = Object.entries(r.priceChangeProbs).sort((a, b) => Number(a[0]) - Number(b[0]));
          const changeText = formatMoneySigned(r.expectedPriceChange, 2);
          return (
            <li key={r.id} className="grid grid-cols-[18px_3rem_4.5rem_minmax(0,1fr)] items-center gap-x-3 py-2 sm:grid-cols-[18px_10rem_4.5rem_minmax(0,1fr)]">
              <TeamLogo constructorId={r.constructorId} name={r.team} color={r.teamColor} size={18} />
              <span className="min-w-0 text-ui text-ink" title={r.name}>
                <span className="timing font-[550] sm:hidden">{r.code}</span>
                <span className="hidden truncate sm:block">{r.name}</span>
              </span>
              <span className={"timing text-end text-table " + (r.expectedPriceChange >= 0 ? "text-delta-up" : "text-delta-down")}>{changeText}</span>
              <span className="flex flex-wrap gap-1.5">
                {probs
                  .filter(([, v]) => v >= 0.02)
                  .map(([k, v]) => (
                    <span key={k} className="timing rounded-chip border border-rule px-1.5 py-0.5 text-caption text-ink-2">
                      {formatMoneySigned(Number(k))} <span className="text-ink-3">{Math.round(v * 100)}%</span>
                    </span>
                  ))}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
