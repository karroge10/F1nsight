// Public API of the fantasy engine (pure TypeScript, no React, no I/O). See README.md.

import { adviseChips } from "./chips";
import { explainTeam, explainTransfers } from "./explain";
import { prepareMarket, type Market, type PrepareOptions } from "./market";
import { DEFAULT_MAX_MS, evaluateTeam, optimiseTeam, resolveChip, resolveObjective } from "./optimiser";
import { preparePlan, solvePlan } from "./planner";
import type { ChipId, FantasyFile, Recommendation, TeamResult, TransferPlan, UserState } from "./types";

export interface RecommendOptions {
  /** Alternatives to return. Default 10. */
  topN?: number;
  /** Races in the transfer plan, this one included. Default 3. */
  planRounds?: number;
  /** Time limit of the single-race search (ms). Default 150. */
  maxMs?: number;
  /** Skip the chip advice (saves 100 to 300 ms). */
  skipChips?: boolean;
  prepare?: PrepareOptions;
}

/**
 * Everything the fantasy page needs in one call: best team and alternatives for this race,
 * a reason for every transfer, chip advice and the multi-race plan.
 * `input` is the parsed fantasy.json or a Market from prepareMarket (reuse it between calls).
 */
export function recommend(input: FantasyFile | Market, state: UserState, options: RecommendOptions = {}): Recommendation {
  const timings: Record<string, number> = {};
  let clock = performance.now();
  const lap = (name: string) => {
    const now = performance.now();
    timings[name] = now - clock;
    clock = now;
  };
  const market = isMarket(input) ? input : prepareMarket(input, options.prepare);
  lap("prepare");
  const objective = resolveObjective(state);
  const chip = resolveChip(market, state);
  const team = optimiseTeam(market, state, { topN: options.topN ?? 10, maxMs: options.maxMs ?? DEFAULT_MAX_MS });
  lap("optimise");
  const prepared = preparePlan(market, state, { rounds: options.planRounds ?? 3, objective });
  const structural: Partial<Record<number, ChipId>> = chip === "wildcard" || chip === "limitless" ? { [market.round]: chip } : {};
  const plan = solvePlan(prepared, structural);
  lap("plan");
  const chips = options.skipChips ? { playNow: null, advice: [], schedule: [] } : adviseChips(market, state, { prepared });
  lap("chips");
  const followed = followPlan(market, state, team.best, plan, chip);
  const best = followed.team;
  const explanations = best ? explainTransfers(market, best, { plan }) : [];
  const newTeam = !state.team;
  const notes = best ? explainTeam(market, best, { plan, chips, newTeam }) : ["No team fits the budget and the locked or banned picks."];
  if (followed.note) notes.unshift(followed.note);
  if (!team.exact) notes.push("The search hit its time limit, so this is the best team found, not a proven optimum.");
  notes.push(...market.warnings);
  lap("explain");
  return {
    generatedAt: market.generatedAt,
    season: market.season,
    round: market.round,
    raceName: market.raceName,
    synthetic: market.synthetic,
    objective,
    chip,
    team,
    recommended: best,
    followsPlan: followed.fromPlan,
    explanations,
    notes,
    chips,
    plan,
    timings,
  };
}

/** Use the plan's first race when it differs from the single-race best (it is better over the window). */
function followPlan(
  market: Market,
  state: UserState,
  best: TeamResult | null,
  plan: TransferPlan,
  chip: ChipId | null,
): { team: TeamResult | null; fromPlan: boolean; note: string | null } {
  const first = plan.stages[0];
  if (!best || !first || plan.stages.length < 2) return { team: best, fromPlan: false, note: null };
  // Limitless is a one-race team with no cap: the game restores the old team afterwards, so the
  // multi-race plan (which keeps the cap) must not replace it.
  if (chip === "limitless") return { team: best, fromPlan: false, note: null };
  const planIds = [...first.drivers, ...first.constructors].sort().join(",");
  const bestIds = [...best.drivers, ...best.constructors].sort().join(",");
  if (planIds === bestIds) return { team: best, fromPlan: false, note: null };
  const lineup = { drivers: first.drivers, constructors: first.constructors };
  const planned = evaluateTeam(market, state, lineup, { chip });
  if (!planned) return { team: best, fromPlan: false, note: null };
  const lost = best.score - planned.score;
  const note = `This week follows the ${plan.stages.length}-race plan: it scores ${lost.toFixed(1)} less than the best team for this race alone, and makes up for it in the next races.`;
  return { team: planned, fromPlan: true, note };
}

function isMarket(input: FantasyFile | Market): input is Market {
  return (input as Market).byId instanceof Map;
}

export * from "./types";
export { CHIP_RULES, RULES_2026, nextFreeTransfers, objectiveFromRisk, rulesFromContract, transferPenalty } from "./rules";
export { horizonMeans, horizonPriceChanges, noNegativeSet, prepareMarket } from "./market";
export type { Market, MarketAsset, PrepareOptions, ScenarioSet } from "./market";
export {
  DEFAULT_MAX_MS,
  budgetOf,
  chipPlayable,
  defaultPointsPerMillion,
  evaluateTeam,
  optimiseTeam,
  resolveChip,
  resolveObjective,
  scoreTeams,
  teamStats,
} from "./optimiser";
export type { OptimiseOptions } from "./optimiser";
export { planRounds, planTransfers, preparePlan, solvePlan } from "./planner";
export type { PlanOptions, PreparedPlan } from "./planner";
export { plannerBoard } from "./board";
export type { BoardOptions, PlannerBoard } from "./board";
export { adviseChips, finalFixValue } from "./chips";
export type { ChipOptions } from "./chips";
export { explainTeam, explainTransfers } from "./explain";
export { formForecast, predictionForecaster, runBacktest } from "./backtest";
export type { BacktestOptions, BacktestReport, Forecaster, HistoryFile, HistoryRow, PredictionHistory, SeasonBacktest, StrategyResult } from "./backtest";
export { effectiveGrid, negativeItems, qualiSegmentFromPosition, scoreConstructor, scoreDriver, scoringRulesFor } from "./scoring";
export type { DriverWeekend, PitInputs, ScoringRules, SessionResult, WeekendPoints } from "./scoring";
export { pointsNeededForRating, priceChange, rate as priceRating, tierOf as priceTier } from "./priceChange";
export type { PriceChange, PriceRating } from "./priceChange";
