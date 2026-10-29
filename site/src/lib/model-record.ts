import fs from "node:fs";
import path from "node:path";
import type { PredictionHistoryEntry } from "@/lib/data";

export type PublishedScore = {
  winnerProbability: number;
  logLoss: number;
  brier: number;
  topPick: string;
  winnerCorrect: boolean;
};

export type PublishedStageRecord = {
  forecastHash: string;
  verifiedAt: string;
  generatedAt: string;
  model: string;
  inputsUsed: string[];
  scores: {
    model: PublishedScore | null;
    market: PublishedScore | null;
    published: PublishedScore | null;
  };
};

export type PublishedRaceRecord = {
  raceId: number;
  winner: string;
  stages: Partial<Record<"pre-weekend" | "post-practice" | "post-qualifying", PublishedStageRecord>>;
  status: "scored" | "no-published-pre-race-forecast";
};

export type PublishedForecastReport = {
  schemaVersion: number;
  generatedAt: string;
  races: PublishedRaceRecord[];
};

export type BacktestRaceRecord = {
  key: string;
  season: number;
  round: number;
  raceName: string;
  model: string;
  stage: string;
  predictedWinner: { id: string; code: string; name: string; probability: number; constructorId: string; team: string; teamColor: string };
  actualWinner: { id: string; code: string; name: string };
  winnerCorrect: boolean;
  logLoss: number;
  brier: number;
  spearman: number | null;
  exactPositionHits: number;
  exactPositionDenominator: number;
  exactPositionAccuracy: number | null;
  order: { id: string; name: string; code: string; winRank: number; predictedPosition: number; expectedPosition: number; actualPosition: number | null; pWin: number; pPodium: number; pPoints: number }[];
};

export type BacktestAnalytics = {
  races: number;
  correct: number;
  accuracy: number | null;
  meanLogLoss: number | null;
  meanBrier: number | null;
  currentCorrectRun: number;
};

type MetricsEntry = PredictionHistoryEntry & {
  metrics?: Record<string, { logLossWin?: number; brierWin?: number; spearman?: number }>;
};

export function readPublishedForecastReport(): PublishedForecastReport | null {
  const candidates = [
    path.join(process.cwd(), "public/reports/published-forecasts.json"),
    path.resolve(process.cwd(), "../data/reports/published-forecasts.json"),
  ];
  const file = candidates.find((candidate) => fs.existsSync(candidate));
  if (!file) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as PublishedForecastReport;
}

export function buildPublishedRaceRows(report: PublishedForecastReport | null): PublishedRaceRecord[] {
  if (!report) return [];
  return [...report.races].sort((a, b) => b.raceId - a.raceId);
}

export function hasVerifiedPublication(report: PublishedForecastReport | null, season: number, round: number): boolean {
  const race = report?.races.find((item) => item.raceId === season * 100 + round);
  return Boolean(race && Object.values(race.stages).some((stage) => stage && stage.verifiedAt));
}

export function buildBacktestRecord(history: PredictionHistoryEntry[]): { rows: BacktestRaceRecord[]; analytics: BacktestAnalytics } {
  const rows = history.flatMap((raw) => {
    const entry = raw as MetricsEntry;
    const predicted = [...entry.drivers].sort((a, b) =>
      b.pWin - a.pWin || b.pPodium - a.pPodium || b.pPoints - a.pPoints,
    )[0];
    const actual = entry.actual.results.find((result) => result.position === 1);
    if (!predicted || !actual) return [];
    const actualDriver = entry.drivers.find((driver) => driver.driverId === actual.driverId);
    if (!actualDriver) return [];
    const probabilities = entry.drivers.map((driver) => driver.pWin);
    const actualChance = actualDriver.pWin;
    const stageMetrics = entry.metrics?.[entry.race.stage];
    const actualPositions = new Map(entry.actual.results.map(result => [result.driverId, result.classified === false ? null : result.position]));
    const positionOrder = [...entry.drivers].sort((a, b) => a.expectedPosition - b.expectedPosition || b.pWin - a.pWin);
    const order = [...entry.drivers].sort((a, b) => b.pWin - a.pWin || b.pPodium - a.pPodium || b.pPoints - a.pPoints);
    const exactPositionDenominator = positionOrder.filter((driver) => {
      const actualPosition = actualPositions.get(driver.driverId);
      return typeof actualPosition === "number";
    }).length;
    const exactPositionHits = positionOrder.filter((driver, index) => {
      const actualPosition = actualPositions.get(driver.driverId);
      return typeof actualPosition === "number" && actualPosition === index + 1;
    }).length;
    return [{
      key: `${entry.race.season}-${entry.race.round}-${entry.race.stage}`,
      season: entry.race.season,
      round: entry.race.round,
      raceName: entry.race.raceName,
      model: entry.model.version,
      stage: entry.race.stage,
      predictedWinner: { id: predicted.driverId, code: predicted.code, name: predicted.name, probability: predicted.pWin, constructorId: predicted.constructorId, team: predicted.team, teamColor: predicted.teamColor },
      actualWinner: { id: actualDriver.driverId, code: actualDriver.code, name: actualDriver.name },
      winnerCorrect: predicted.driverId === actual.driverId,
      logLoss: typeof stageMetrics?.logLossWin === "number" ? stageMetrics.logLossWin : -Math.log(Math.max(actualChance, 1e-15)),
      brier: typeof stageMetrics?.brierWin === "number" ? stageMetrics.brierWin : probabilities.reduce((sum, chance, index) => {
        const driverId = entry.drivers[index].driverId;
        return sum + (chance - Number(driverId === actual.driverId)) ** 2;
      }, 0) / entry.drivers.length,
      exactPositionHits,
      exactPositionDenominator,
      exactPositionAccuracy: exactPositionDenominator ? exactPositionHits / exactPositionDenominator : null,
      order: order.map((driver, i) => ({ id: driver.driverId, name: driver.name, code: driver.code, winRank: i + 1, predictedPosition: positionOrder.findIndex((item) => item.driverId === driver.driverId) + 1, expectedPosition: driver.expectedPosition, actualPosition: actualPositions.get(driver.driverId) ?? null, pWin: driver.pWin, pPodium: driver.pPodium, pPoints: driver.pPoints })),
      spearman: typeof stageMetrics?.spearman === "number" ? stageMetrics.spearman : null,
    }];
  }).sort((a, b) => b.season - a.season || b.round - a.round);

  const correct = rows.filter((row) => row.winnerCorrect).length;
  let currentCorrectRun = 0;
  for (const row of rows) {
    if (!row.winnerCorrect) break;
    currentCorrectRun += 1;
  }
  const analytics = {
    races: rows.length,
    correct,
    accuracy: rows.length ? correct / rows.length : null,
    meanLogLoss: rows.length ? rows.reduce((sum, row) => sum + row.logLoss, 0) / rows.length : null,
    meanBrier: rows.length ? rows.reduce((sum, row) => sum + row.brier, 0) / rows.length : null,
    currentCorrectRun,
  };
  return { rows, analytics };
}
