// Public types of the fantasy engine. Everything here is plain JSON data, so inputs and
// outputs can cross a Web Worker boundary with structured clone.

export type AssetKind = "driver" | "constructor";

export type ChipId = "limitless" | "wildcard" | "finalFix" | "autopilot" | "noNegative" | "extraBoost";

export const CHIP_IDS: readonly ChipId[] = [
  "limitless",
  "wildcard",
  "finalFix",
  "autopilot",
  "noNegative",
  "extraBoost",
];

// ---------------------------------------------------------------- fantasy.json contract

export interface FantasyFile {
  generatedAt: string;
  season: number;
  round: number;
  raceName: string;
  hasSprint: boolean;
  stage?: string;
  synthetic?: boolean;
  rules?: unknown;
  assets: FantasyAsset[];
  scenarios?: FantasyScenarios;
  horizon?: HorizonRound[];
}

export interface FantasyAsset {
  id: string;
  kind: AssetKind;
  fantasyId?: string | null;
  name: string;
  constructorId: string;
  teamColor?: string;
  price: number | null;
  expectedPoints: number;
  p10?: number;
  p90?: number;
  pNegative?: number;
  breakdown?: Partial<Record<string, number>>;
  expectedPriceChange?: number | null;
  priceChangeProbs?: Record<string, number>;
  /** Optional: the asset's last official gameday totals, oldest first (price rule window). */
  recentPoints?: number[];
  /** Optional: false for replaced or reserve assets. Missing means active. */
  active?: boolean;
}

export interface FantasyScenarios {
  n: number;
  /** points[i][j]: fantasy points of assets[j] in simulated weekend i. */
  points: number[][];
  /** Optional: sum of the negative scoring items (<= 0) per world and asset, for No Negative. */
  negative?: number[][];
  /** Optional: Grand Prix race session points per world and asset, for Final Fix. */
  race?: number[][];
}

export interface HorizonRound {
  round: number;
  raceName: string;
  circuitId?: string;
  hasSprint: boolean;
  expectedPoints: Record<string, number>;
  expectedPriceChange: Record<string, number>;
}

// ---------------------------------------------------------------- rules

export interface ChipRule {
  id: ChipId;
  name: string;
  /** Exact effect, in the game's words (official FAQ text, 2026). */
  effect: string;
  /** First race of the user's team where the chip may be played (1 = from the start). */
  availableFromTeamRace: number;
}

export interface GameRules {
  season: number;
  drivers: number;
  constructors: number;
  budget: number;
  priceFloor: number;
  priceCeiling: number;
  freeTransfersPerRace: number;
  /** Unused free transfers that carry over (2026: one, and carry-overs do not accumulate). */
  maxCarryOver: number;
  /** Points deducted per transfer beyond the free allowance (positive number). */
  extraTransferPenalty: number;
  boostMultiplier: number;
  extraBoostMultiplier: number;
  chipsPerRace: number;
  seasonRounds: number;
  chips: Record<ChipId, ChipRule>;
  /** Rules the game does not state precisely: documented best guesses, change if needed. */
  assumptions: RuleAssumptions;
}

export interface RuleAssumptions {
  /** x3 Boost: the regular x2 Boost still goes to another driver (FAQ: "you'll have to give that to another driver"). */
  extraBoostKeepsRegularBoost: boolean;
  /** Free transfers carried into the next race after a Wildcard (game text silent; guess: none). */
  wildcardCarryOver: number;
  /** Free transfers carried into the next race after Limitless (FAQ: none). */
  limitlessCarryOver: number;
  /** Final Fix may swap a constructor too, not only a driver (FAQ says "a single change to your team"). */
  finalFixAllowsConstructor: boolean;
  /** Final Fix without scenarios.race only: share of the race-points variance explained by what qualifying reveals (R squared, 0..1). */
  finalFixInfoShare: number;
  /** Without a scenarios.negative matrix, No Negative is approximated by clamping each asset's total at 0 (a lower bound). */
  noNegativeFallback: "clampTotal";
  /** Price rule: points per million thresholds and steps (reverse engineered, 98.9% match). */
  priceTierSplit: number;
  priceWindow: number;
}

// ---------------------------------------------------------------- user state and options

export interface TeamSelection {
  drivers: string[];
  constructors: string[];
}

export type RiskPreference = "safe" | "balanced" | "aggressive";

export type Objective =
  | { kind: "expected" }
  /** mean - lambda * sd of the team total over the joint scenarios. */
  | { kind: "meanStd"; lambda: number }
  /** The q-quantile of the team total over the joint scenarios (0.2 = a bad weekend, 0.8 = upside). */
  | { kind: "quantile"; q: number }
  /** Expected points plus pointsPerMillion times the expected team value change this round. */
  | { kind: "value"; pointsPerMillion?: number };

export interface UserState {
  /** Current team, or null when building a new team (unlimited free changes). */
  team: TeamSelection | null;
  /** Unspent money. Budget = value of the current team at today's prices + bank. */
  bank?: number;
  /** Total cost cap override (team value + bank). Takes priority over bank. */
  budget?: number;
  /** Free transfers available for this race (2, or 3 with a carried-over transfer). */
  freeTransfers?: number;
  /** The user's current Boost pick (kept when it is as good as the optimiser's). */
  boost?: string | null;
  chipsAvailable?: ChipId[];
  /** Chip the user wants to play this weekend (the game allows one per race). */
  chipsToPlay?: ChipId[];
  /** Assets that must stay in the team. */
  locked?: string[];
  /** Assets that must not be picked. */
  banned?: string[];
  risk?: RiskPreference;
  /** Explicit objective; overrides risk. */
  objective?: Objective;
  /** Races the user's team has completed (chip unlocks). Default 1 (mid-season team). */
  teamRacesCompleted?: number;
}

// ---------------------------------------------------------------- results

export interface TeamStats {
  mean: number;
  sd: number;
  p10: number;
  p50: number;
  p90: number;
  /** Average of the worst 10% of weekends. */
  worst10: number;
}

export interface TeamResult {
  drivers: string[];
  constructors: string[];
  /** x2 Boost driver (null under Autopilot, which picks the top scorer after the race). */
  boost: string | null;
  /** x3 Boost driver when the x3 Boost chip is played. */
  extraBoost: string | null;
  chip: ChipId | null;
  cost: number;
  budget: number;
  bankAfter: number;
  /** Objective score, transfer penalty already subtracted. */
  score: number;
  /** Expected team points this race with boost and chip, before the transfer penalty. */
  expectedPoints: number;
  penalty: number;
  transfersIn: string[];
  transfersOut: string[];
  transferCount: number;
  /** Sum of the expected price changes of the seven assets ($M). */
  expectedValueChange: number;
  stats: TeamStats;
}

export interface OptimiseResult {
  best: TeamResult | null;
  /** Top N distinct teams, best first (includes best). */
  alternatives: TeamResult[];
  objective: Objective;
  chip: ChipId | null;
  budget: number;
  freeTransfers: number;
  /** Teams scored exactly (after bounding). */
  evaluated: number;
  /** True when the search finished: the teams are proven optimal. False when the time limit cut it short. */
  exact: boolean;
  ms: number;
}

export interface TransferExplanation {
  out: string | null;
  in: string | null;
  kind: AssetKind;
  /** Expected points gain this race (in minus out, boost not included). */
  gainNow: number;
  /** Expected points gain over the planning window (this race plus horizon). */
  gainWindow: number;
  priceDelta: number;
  text: string;
}

export interface ChipAdvice {
  chip: ChipId;
  name: string;
  available: boolean;
  unavailableReason?: string;
  /** Estimated extra points from playing the chip this weekend. */
  valueNow: number;
  /**
   * How valueNow was computed: "exact" on the joint scenarios or the plan, "estimate" when the
   * file lacks the data (Final Fix without scenarios.race), "lower bound" for No Negative
   * without scenarios.negative.
   */
  confidence: "exact" | "estimate" | "lower bound";
  /** Estimated value in each later round considered (horizon rounds, then a typical later round). */
  valueByRound: { round: number; value: number; estimated: boolean }[];
  /** What holding it is worth: the value in the slot the season plan would give it. */
  holdValue: number;
  recommendation: "play" | "hold" | "unavailable";
  plannedRound: number | null;
  reason: string;
  /** Best team if the chip is played now (for structural chips). */
  team?: TeamResult;
}

export interface ChipPlan {
  playNow: ChipId | null;
  advice: ChipAdvice[];
  schedule: { round: number; chip: ChipId }[];
}

export interface PlanStage {
  round: number;
  raceName: string;
  drivers: string[];
  constructors: string[];
  boost: string | null;
  chip: ChipId | null;
  transfersIn: string[];
  transfersOut: string[];
  transferCount: number;
  freeTransfers: number;
  penalty: number;
  expectedPoints: number;
  cost: number;
  /** Cost cap at that race: value of the team held going in, plus the bank. */
  teamValue: number;
  bank: number;
}

export interface TransferPlan {
  stages: PlanStage[];
  /** Planning score: discounted expected points minus penalties (plus value term for the value objective). */
  score: number;
  /** Same horizon if the user makes no transfers at all. */
  holdScore: number;
  /** Same horizon if the user re-optimises one race at a time (no lookahead). */
  myopicScore: number;
  poolSize: number;
  ms: number;
}

export interface Recommendation {
  generatedAt: string;
  season: number;
  round: number;
  raceName: string;
  synthetic: boolean;
  objective: Objective;
  chip: ChipId | null;
  /** Best teams for this race alone (exact search). */
  team: OptimiseResult;
  /**
   * The team to field this week: the first race of the multi-race plan when it differs from
   * the single-race best (planning ahead pays), else team.best.
   */
  recommended: TeamResult | null;
  /** True when `recommended` comes from the plan rather than the single-race best. */
  followsPlan: boolean;
  explanations: TransferExplanation[];
  notes: string[];
  chips: ChipPlan;
  plan: TransferPlan;
  timings: Record<string, number>;
}
