import type { BacktestRaceRecord } from "@/lib/model-record";
import type { DriverForecast } from "@/lib/data";
import { documentedPick } from "@/lib/publication-evidence";
import { TeamLogo } from "@/components/ui/team-logo";

export function CalendarPrediction({ record, forecast }: { record: BacktestRaceRecord | null; forecast?: DriverForecast | null; publicationVerified?: boolean }) {
  const driver = record?.predictedWinner ?? forecast;
  if (!driver) return <span className="text-caption text-ink-3">Not available</span>;
  const probability = record ? record.predictedWinner.probability : forecast!.pWin;
  return <span className="inline-flex items-center gap-2 whitespace-nowrap text-ui">
    <TeamLogo constructorId={driver.constructorId} name={driver.team} color={driver.teamColor} size={18} season={record?.season} />
    <span className={"font-[550] " + (record ? record.winnerCorrect ? "text-delta-up" : "text-delta-down" : "text-ink")}>{driver.name}</span>
    <span className="timing text-caption text-ink-3">{(probability * 100).toFixed(1)}%</span>
  </span>;
}

export function RacePrediction({ record, forecastDrivers = [], publicationVerified = false }: { record: BacktestRaceRecord | null; forecastDrivers?: DriverForecast[]; publicationVerified?: boolean }) {
  const forecast = [...forecastDrivers].sort((a, b) => b.pWin - a.pWin)[0];
  if (!record && !forecast) return null;
  const documented = record ? documentedPick(record.season, record.round) : null;
  return <div className="mx-auto mt-4 max-w-[1440px] px-4 sm:px-6">
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-y border-rule py-3">
      <span className="text-caption text-ink-3">Race win prediction</span>
      <CalendarPrediction record={record} forecast={forecast} />
      <span className="text-caption text-ink-3">{record ? "Retrospective backtest" : "Not yet scored"}</span>
      <details className="text-caption text-ink-3">
        <summary className="cursor-pointer text-ink-2">Forecast details</summary>
        <p className="mt-2 max-w-2xl">{record ? `Updated ${record.stage === "post-qualifying" ? "after qualifying" : record.stage === "post-practice" ? "after practice" : "before the weekend"}. ` : "Current race forecast. "}Predicted finishes appear beside the race results, ranked by expected finish. {publicationVerified ? "A verified pre-race publication is archived." : "Publication before the race is not verified for this snapshot."}</p>
        {documented ? <p className="mt-2 max-w-2xl">A separate pre-race pick of {documented.name} at {Math.round(documented.probability * 100)}% was recorded on 9 Oct 2026. The results comparison uses the later retrospective backtest.</p> : null}
      </details>
    </div>
  </div>;
}
