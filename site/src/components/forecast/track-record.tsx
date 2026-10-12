import { predictedOrder } from "@/lib/forecast";
import Link from "next/link";
import type { PredictionHistoryEntry, Prediction } from "@/lib/data";
import type { EntryList } from "@/lib/data";
import { formatPercent } from "@/lib/format";
import { Figure } from "@/components/ui/figure";

interface TrackRecordProps {
  prediction: Prediction;
  history: PredictionHistoryEntry[];
  entries: EntryList;
}

export function TrackRecord({ prediction, history, entries }: TrackRecordProps) {
  const metrics = prediction.model.backtest;
  const codeById = new Map(entries.drivers.map((d) => [d.driverId, d.code]));
  const code = (id: string | null | undefined) => (id ? codeById.get(id) ?? id.slice(0, 3).toUpperCase() : "");
  const recent = [...history].sort((a, b) => b.race.season - a.race.season || b.race.round - a.race.round).slice(0, 8);
  const winnerText = formatPercent(metrics.winnerAccuracy);
  const podiumText = formatPercent(metrics.podiumHitRate);
  const spearmanText = metrics.spearman.toFixed(2);
  const baselineText = metrics.baseline.spearman.toFixed(2);
  const brierText = metrics.brier.toFixed(3);
  const racesText = metrics.races ? `${metrics.races} races, ${metrics.seasons.join(", ")}` : metrics.seasons.join(", ");

  return (
    <div className="grid gap-10 lg:grid-cols-12">
      <div className="lg:col-span-4">
        <div className="grid grid-cols-2 gap-x-6 gap-y-6">
          <Figure label="Winner called" value={winnerText} note={racesText} />
          <Figure label="Podium hits" value={podiumText} note="Predicted top three who finished there" />
          <Figure label="Order correlation" value={spearmanText} note={`Grid order baseline ${baselineText}`} />
          <Figure label="Brier score" value={brierText} note="Lower is better" />
        </div>
        <p className="mt-6 max-w-sm text-caption text-ink-3" title={prediction.model.notes}>
          Model {prediction.model.version}. {prediction.model.notes.split(".")[0]}.
        </p>
      </div>
      <div className="lg:col-span-8 scroll-x">
        <table className="data-table sm:min-w-[520px]">
          <thead>
            <tr>
              <th>Race</th>
              <th>
                <span className="sm:hidden">Pred.</span>
                <span className="hidden sm:inline">Predicted winner</span>
              </th>
              <th>
                <span className="sm:hidden">Actual</span>
                <span className="hidden sm:inline">Actual winner</span>
              </th>
              <th className="hidden sm:table-cell">Predicted podium</th>
              <th className="hidden sm:table-cell">Actual podium</th>
              <th className="num">Corr.</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((entry) => {
              const predicted = predictedOrder(entry.drivers);
              const predictedWinner = predicted[0];
              const predictedPodium = predicted.slice(0, 3);
              const actualOrder = [...entry.actual.results].filter((r) => r.classified && r.position !== null).sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
              const actualWinner = actualOrder[0];
              const actualPodium = actualOrder.slice(0, 3);
              const correlation = entryCorrelation(entry, metrics);
              const hit = actualWinner && predictedWinner.driverId === actualWinner.driverId;
              const predictedWinText = formatPercent(predictedWinner.pWin);
              return (
                <tr key={`${entry.race.season}-${entry.race.round}-${entry.race.stage}`}>
                  <td>
                    <Link href={`/races/${entry.race.season}/${entry.race.round}`} className="tap-hit text-ink hover:underline underline-offset-2">
                      <span className="timing mr-2 text-caption text-ink-3">
                        {entry.race.season} R{entry.race.round}
                      </span>
                      {entry.race.raceName.replace(" Grand Prix", " GP")}
                    </Link>
                  </td>
                  <td>
                    <span className={"timing " + (hit ? "text-ink" : "text-ink-2")}>{predictedWinner.code}</span>
                    <span className="timing ml-2 text-caption text-ink-3">{predictedWinText}</span>
                  </td>
                  <td className="timing text-ink">
                    {code(actualWinner?.driverId)}
                    <span className={"ml-2 inline-block size-1.5 rounded-full align-middle " + (hit ? "bg-delta-up" : "bg-rule-strong")} aria-label={hit ? "hit" : "miss"} />
                  </td>
                  <td className="timing hidden text-ink-2 sm:table-cell">
                    {predictedPodium.map((d) => {
                      const inActual = actualPodium.some((a) => a.driverId === d.driverId);
                      return (
                        <span key={d.driverId} className={"mr-2 " + (inActual ? "text-ink" : "text-ink-3")}>
                          {d.code}
                        </span>
                      );
                    })}
                  </td>
                  <td className="timing hidden text-ink sm:table-cell">
                    {actualPodium.map((a) => (
                      <span key={a.driverId} className="mr-2">
                        {code(a.driverId)}
                      </span>
                    ))}
                  </td>
                  <td className="num text-ink-2">{correlation === null ? "" : correlation.toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}


/** Spearman rank correlation between the predicted order and the actual finishing order. */
function entryCorrelation(entry: PredictionHistoryEntry, metrics: Prediction["model"]["backtest"]): number | null {
  const own = (entry as PredictionHistoryEntry & { metrics?: { spearman?: number } }).metrics?.spearman;
  if (typeof own === "number") return own;
  const perRace = metrics.perRace?.find((p) => p.round === entry.race.round);
  if (perRace) return perRace.spearman;
  const ordered = predictedOrder(entry.drivers);
  const predicted = ordered.map((d) => d.driverId);
  const actual = [...entry.actual.results].filter((r) => r.position !== null).sort((a, b) => (a.position ?? 99) - (b.position ?? 99)).map((r) => r.driverId);
  const common = actual.filter((id) => predicted.includes(id));
  const n = common.length;
  if (n < 3) return null;
  let d2 = 0;
  common.forEach((id, actualRank) => {
    const predictedRank = predicted.indexOf(id);
    d2 += (predictedRank - actualRank) ** 2;
  });
  return 1 - (6 * d2) / (n * (n * n - 1));
}
