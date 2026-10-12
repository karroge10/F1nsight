// F1 Fantasy 2026 game rules for the optimiser, with the documented best guesses exposed as
// config (see RuleAssumptions). Sources: data/raw/fantasy/rules_2026.json and the official
// FAQ text in data/raw/fantasy/official/2026/translations_en.json.

import type { ChipId, ChipRule, GameRules, Objective, RiskPreference } from "./types";

export const CHIP_RULES: Record<ChipId, ChipRule> = {
  limitless: {
    id: "limitless",
    name: "Limitless",
    effect:
      "Unlimited transfers and no cost cap for one race. The original team is restored after the race, and no free transfer carries into the next race week.",
    availableFromTeamRace: 2,
  },
  wildcard: {
    id: "wildcard",
    name: "Wildcard",
    effect: "Unlimited transfers within the cost cap before the next Grand Prix. The new team stays.",
    availableFromTeamRace: 2,
  },
  finalFix: {
    id: "finalFix",
    name: "Final Fix",
    effect:
      "One change between the end of Qualifying and the start of the Grand Prix, with no penalty. The outgoing pick keeps the points already scored. The incoming pick scores from the race onwards and inherits the Boost. The original team returns after the race.",
    availableFromTeamRace: 2,
  },
  autopilot: {
    id: "autopilot",
    name: "Autopilot",
    effect: "The x2 Boost moves to the highest scoring driver in the team after the weekend.",
    availableFromTeamRace: 1,
  },
  noNegative: {
    id: "noNegative",
    name: "No Negative",
    effect:
      "Every negative scoring category stops at zero for every driver and constructor for the whole race week. Extra transfer penalties still apply.",
    availableFromTeamRace: 1,
  },
  extraBoost: {
    id: "extraBoost",
    name: "x3 Boost",
    effect: "One driver scores x3. The regular x2 Boost then goes to another driver.",
    availableFromTeamRace: 1,
  },
};

export const RULES_2026: GameRules = {
  season: 2026,
  drivers: 5,
  constructors: 2,
  budget: 100,
  priceFloor: 3,
  priceCeiling: 34,
  freeTransfersPerRace: 2,
  maxCarryOver: 1,
  extraTransferPenalty: 10,
  boostMultiplier: 2,
  extraBoostMultiplier: 3,
  chipsPerRace: 1,
  seasonRounds: 23,
  chips: CHIP_RULES,
  assumptions: {
    extraBoostKeepsRegularBoost: true,
    wildcardCarryOver: 0,
    limitlessCarryOver: 0,
    finalFixAllowsConstructor: true,
    finalFixInfoShare: 0.15,
    noNegativeFallback: "clampTotal",
    priceTierSplit: 18.5,
    priceWindow: 3,
  },
};

/**
 * Game rules from the `rules` block of fantasy.json (a copy of rules_2026.json), falling back
 * to RULES_2026 for anything missing. `overrides` replaces any field, including assumptions.
 */
export function rulesFromContract(raw: unknown, overrides?: Partial<GameRules>): GameRules {
  const root = readObject(raw);
  const team = readObject(root?.team);
  const priceChange = readObject(root?.price_change);
  const bounds = readObject(priceChange?.bounds);
  const penalty = readNumber(team?.extra_transfer_penalty);
  const base: GameRules = {
    ...RULES_2026,
    season: readNumber(root?.season) ?? RULES_2026.season,
    drivers: readNumber(team?.drivers) ?? RULES_2026.drivers,
    constructors: readNumber(team?.constructors) ?? RULES_2026.constructors,
    budget: readNumber(team?.budget_musd) ?? RULES_2026.budget,
    priceFloor: readNumber(team?.price_floor_musd) ?? readNumber(bounds?.floor) ?? RULES_2026.priceFloor,
    priceCeiling:
      readNumber(team?.price_ceiling_musd) ?? readNumber(bounds?.ceiling) ?? RULES_2026.priceCeiling,
    freeTransfersPerRace: readNumber(team?.free_transfers_per_race) ?? RULES_2026.freeTransfersPerRace,
    maxCarryOver: readNumber(team?.free_transfer_carry_over) ?? RULES_2026.maxCarryOver,
    extraTransferPenalty: penalty === undefined ? RULES_2026.extraTransferPenalty : Math.abs(penalty),
  };
  const assumptions = { ...base.assumptions, ...overrides?.assumptions };
  return { ...base, ...overrides, assumptions };
}

/** Objective for a plain risk preference. */
export function objectiveFromRisk(risk: RiskPreference | undefined): Objective {
  if (risk === "safe") return { kind: "meanStd", lambda: 0.5 };
  if (risk === "aggressive") return { kind: "quantile", q: 0.75 };
  return { kind: "expected" };
}

/** Free transfers for the next race, given this race's allowance and the transfers used. */
export function nextFreeTransfers(rules: GameRules, available: number, used: number, chip: ChipId | null): number {
  if (chip === "limitless") return rules.freeTransfersPerRace + rules.assumptions.limitlessCarryOver;
  if (chip === "wildcard") return rules.freeTransfersPerRace + rules.assumptions.wildcardCarryOver;
  const unused = Math.max(0, available - used);
  const carry = Math.min(rules.maxCarryOver, unused);
  return rules.freeTransfersPerRace + carry;
}

/** Transfer penalty in points (positive) for a number of net changes. */
export function transferPenalty(rules: GameRules, transfers: number, freeTransfers: number, chip: ChipId | null): number {
  if (chip === "limitless" || chip === "wildcard") return 0;
  const extra = Math.max(0, transfers - freeTransfers);
  return extra * rules.extraTransferPenalty;
}

function readObject(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
