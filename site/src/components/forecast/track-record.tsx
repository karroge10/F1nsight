import { predictedOrder } from "@/lib/forecast";
import type { PredictionHistoryEntry, Prediction } from "@/lib/data";
import type { EntryList } from "@/lib/data";
import { formatPercent } from "@/lib/format";
import { Figure } from "@/components/ui/figure";
import { TrackRecordTable, type TrackRecordRow } from "./track-record-table";

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
  const rows = recent.map((entry) => recordRow(entry, metrics, code));

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
        <TrackRecordTable rows={rows} />
      </div>
    </div>
  );
}

/** One recent race as plain data for the sortable table: predicted and actual winner and podium. */
function recordRow(entry: PredictionHistoryEntry, metrics: Prediction["model"]["backtest"], code: (id: string | null | undefined) => string): TrackRecordRow {
  const predicted = predictedOrder(entry.drivers);
  const predictedWinner = predicted[0];
  const actualOrder = [...entry.actual.results].filter((r) => r.classified && r.position !== null).sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
  const actualWinner = actualOrder[0];
  const actualPodium = actualOrder.slice(0, 3);
  const actualIds = actualPodium.map((a) => a.driverId);
  const predictedPodium = predicted.slice(0, 3).map((d) => ({ driverId: d.driverId, code: d.code, inActual: actualIds.includes(d.driverId) }));
  const hit = Boolean(actualWinner && predictedWinner.driverId === actualWinner.driverId);
  return {
    key: `${entry.race.season}-${entry.race.round}-${entry.race.stage}`,
    season: entry.race.season,
    round: entry.race.round,
    raceName: entry.race.raceName.replace(" Grand Prix", " GP"),
    predictedCode: predictedWinner.code,
    predictedWinText: formatPercent(predictedWinner.pWin),
    actualCode: code(actualWinner?.driverId),
    hit,
    predictedPodium,
    actualPodium: actualPodium.map((a) => ({ driverId: a.driverId, code: code(a.driverId) })),
    correlation: entryCorrelation(entry, metrics),
  };
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
