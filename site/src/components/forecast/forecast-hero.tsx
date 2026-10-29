import Link from "next/link";
import type { DriverForecast, Prediction, RaceSummary } from "@/lib/data";
import { formatLapTime, formatPercent } from "@/lib/format";
import { forecastStageText, predictedOrder } from "@/lib/forecast";
import { HeroCountdown, HeroSchedule } from "./hero-clock";
import { weekendSchedule } from "@/components/stats/weekend-schedule";
import { DriverPortrait } from "@/components/ui/driver-portrait";
import { Flag } from "@/components/ui/flag";
import { TeamLogo } from "@/components/ui/team-logo";
import { Info } from "@/components/ui/info";
import { IconCalendar, IconFastestLap, IconHistory, IconMap, IconMedal, IconPulse, IconSprint, IconTrophy } from "@/components/icons";

interface ForecastHeroProps {
  prediction: Prediction;
  race: RaceSummary | null;
  now: Date;
  totalRounds: number;
  facts: CircuitFacts;
}

export interface CircuitFacts {
  lastWinner: { season: number; driverId: string; name: string } | null;
  lapRecord: { timeMs: number; driverId: string; name: string; season: number } | null;
}

/**
 * Hero on an 8px scale. Left: race identity with circuit facts, then the countdown. Right: the
 * winner (the P1 of the predicted order) beside the photo, the predicted podium with
 * each driver's chance of that exact place, then the weekend schedule in the visitor's time
 * zone. Both columns are flex columns whose last block is pushed down, so their bottoms align. All numbers use the sans with tabular figures; no monospace in this block.
 */
export function ForecastHero({ prediction, race, now, totalRounds, facts }: ForecastHeroProps) {
  const ordered = predictedOrder(prediction.drivers);
  const winner = ordered[0];
  const podium = ordered.slice(0, 3);
  const schedule = weekendSchedule(race, prediction.race.date);
  const stage = forecastStageText(prediction.race.stage, prediction.race.inputsUsed ?? []);
  const builtAt = now.toISOString();

  return (
    <div className="mx-auto max-w-[1440px] px-4 pt-8 sm:px-6 sm:pt-12">
      <div className="grid gap-10 lg:grid-cols-12 lg:gap-8">
        <div className="stagger-in flex flex-col lg:col-span-7" style={{ "--stagger": 0 } as React.CSSProperties}>
          <p className="eyebrow mb-2 flex h-6 items-center gap-2">
            <IconCalendar size="1rem" />
            Round {prediction.race.round} of {totalRounds}
            {prediction.race.hasSprint ? (
              <>
                <span className="text-ink-3">/</span>
                <IconSprint size="1rem" />
                Sprint weekend
              </>
            ) : null}
          </p>
          <h1 className="display text-[clamp(5rem,2.25rem+7.75vw,7.75rem)] leading-[0.95] text-ink">{prediction.race.raceName}</h1>
          <dl className="mt-6 grid max-w-xl grid-cols-[1.25rem_auto_1fr] items-baseline gap-x-3 gap-y-2 text-body">
            <FactIcon><IconMap size="1rem" className="text-ink-3" /></FactIcon>
            <dt className="text-ink-3">Circuit</dt>
            <dd className="text-ink">
              <Link href={`/circuits/${prediction.race.circuitId}`} className="tap-hit hover:underline underline-offset-2">
                {prediction.race.circuitName}
              </Link>
              <span className="text-ink-2">
                , <span className="whitespace-nowrap"><Flag of={prediction.race.country} keepSpace={false} className="mr-1.5" />
                {prediction.race.country}</span>
              </span>
            </dd>
            {facts.lastWinner ? (
              <>
                <FactIcon><IconHistory size="1rem" className="text-ink-3" /></FactIcon>
                <dt className="text-ink-3">Last winner</dt>
                <dd className="text-ink">
                  <Link href={`/drivers/${facts.lastWinner.driverId}`} className="tap-hit hover:underline underline-offset-2">
                    {facts.lastWinner.name}
                  </Link>
                  <span className="timing text-ink-3"> ({facts.lastWinner.season})</span>
                </dd>
              </>
            ) : null}
            {facts.lapRecord ? (
              <>
                <FactIcon><IconFastestLap size="1rem" className="text-ink-3" /></FactIcon>
                <dt className="text-ink-3">Lap record</dt>
                <dd className="text-ink">
                  <span className="timing">{formatLapTime(facts.lapRecord.timeMs)}</span>
                  <span className="text-ink-2">, </span>
                  {/* name and year wrap as one piece, so the year is never alone on a line */}
                  <span className="whitespace-nowrap">
                    <span className="text-ink-2">{facts.lapRecord.name}</span>
                    <span className="timing text-ink-3"> ({facts.lapRecord.season})</span>
                  </span>
                </dd>
              </>
            ) : null}
            <FactIcon><IconPulse size="1rem" className="text-accent" /></FactIcon>
            <dt className="text-ink-3">Forecast</dt>
            <dd className="flex items-center gap-1.5 text-ink">
              {stage.label}
              <Info text={stage.detail} />
            </dd>
          </dl>
          <p className="mt-3 text-ui text-ink-3">
            Updated <time dateTime={prediction.generatedAt}>{new Date(prediction.generatedAt).toISOString().replace("T", " ").slice(0, 16)} UTC</time>
            {prediction.race.inputsUsed.length ? ` · Includes ${prediction.race.inputsUsed.join(", ")}` : " · Before practice"}
          </p>

          <p className="mt-1 text-caption text-ink-3">
            {prediction.model.market ? `Market-blended forecast: model weight ${Math.round(prediction.model.market.modelWeight * 100)}%, ${prediction.model.market.source} weight ${Math.round((1 - prediction.model.market.modelWeight) * 100)}%` : "Forecast source: model simulation"}
            {prediction.model.market ? <Info text="These are configured weights in a logarithmic blend of model and market winner probabilities, not confidence scores. They were selected in an earlier historical experiment. Market information also adjusts the race simulation, including podium and points probabilities. Backtest results on the Model record page are reported separately." /> : null}
          </p>
          <div className="mt-auto max-w-xl pt-8">
            <HeroCountdown schedule={schedule} builtAt={builtAt} />
          </div>
        </div>

        <div className="stagger-in flex flex-col lg:col-span-5" style={{ "--stagger": 1 } as React.CSSProperties}>
          <p className="flex h-6 items-center gap-2 text-ui text-ink-2">
            <IconTrophy size="1.125rem" className="text-ink" />
            Predicted Winner
          </p>

          <div className="mt-4 grid grid-cols-[7rem_1fr] items-center gap-x-5">
            <DriverPortrait driverId={winner.driverId} name={winner.name} teamColor={winner.teamColor} size={112} />
            <div className="min-w-0">
              <Link href={`/drivers/${winner.driverId}`} className="tap-hit headline block truncate text-h2 text-ink hover:underline underline-offset-2">
                {winner.name}
              </Link>
              <p className="mt-1 flex items-center gap-2 text-ui text-ink-2">
                <TeamLogo constructorId={winner.constructorId} name={winner.team} color={winner.teamColor} size={18} />
                {winner.team}
                <span className="timing text-ink-3">#{winner.number}</span>
              </p>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                <Stat label="Win" value={formatPercent(winner.pWin)} />
                <Stat label="Podium" value={formatPercent(winner.pPodium)} />
                <Stat label="Finish" value="P1" />
                <Stat label="DNF" value={formatPercent(winner.pDnf)} />
              </dl>
            </div>
          </div>

          <div className="mt-6 border-t border-rule pt-4">
            <p className="flex items-center gap-2 text-ui text-ink-2">
              <IconMedal size="1.125rem" className="text-ink" />
              Predicted Podium
              <Info text="The top three of the predicted finishing order. The percentage is each driver's chance of finishing in exactly that place." />
            </p>
            <ol className="mt-2 divide-y divide-rule">
              {podium.map((d, i) => (
                <PodiumRow key={d.driverId} driver={d} place={i} />
              ))}
            </ol>
          </div>

          <div className="mt-6 flex flex-col gap-2 border-t border-rule pt-4">
            <p className="flex items-center gap-2 text-ui text-ink-2">
              <IconCalendar size="1.125rem" className="text-ink" />
              Weekend schedule
            </p>
            <HeroSchedule season={prediction.race.season} round={prediction.race.round} schedule={schedule} builtAt={builtAt} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, info }: { label: string; value: string; info?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="flex items-center gap-1 text-caption text-ink-3">
        {label}
        {info ? <Info text={info} /> : null}
      </dt>
      <dd className="headline timing text-[1.75rem] leading-none text-ink">{value}</dd>
    </div>
  );
}

function PodiumRow({ driver, place }: { driver: DriverForecast; place: number }) {
  const chance = driver.positionDist[place] ?? 0;
  const chanceText = formatPercent(chance);
  const podiumText = formatPercent(driver.pPodium);
  return (
    <li className="grid grid-cols-[2rem_18px_1fr_auto] items-center gap-x-3 py-2">
      <span className="timing text-ui text-ink-3">P{place + 1}</span>
      <TeamLogo constructorId={driver.constructorId} name={driver.team} color={driver.teamColor} size={18} />
      <Link href={`/drivers/${driver.driverId}`} className="tap-hit min-w-0 truncate text-ui text-ink hover:underline underline-offset-2">
        {driver.name}
      </Link>
      <span className="timing text-end text-ui text-ink">
        {chanceText}
        <span className="ml-2 hidden text-caption text-ink-3 sm:inline">podium {podiumText}</span>
      </span>
    </li>
  );
}

/** Icon box one text line tall at the top of its row, so it stays beside the first line when a value wraps. */
function FactIcon({ children }: { children: React.ReactNode }) {
  return <span className="flex h-[1lh] items-center self-start">{children}</span>;
}
