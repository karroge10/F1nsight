// Season backtest of the fantasy optimiser, as published for the site (fixtures/fantasy/backtest.json,
// written by research/fantasy-backtest/run.ts). Plain data plus the small helpers the view uses.

export interface BacktestPick {
  code: string;
  color: string;
  /** Transferred in this round. */
  changed: boolean;
}

export interface BacktestRound {
  round: number;
  raceName: string;
  raceCode: string;
  country: string;
  sprint: boolean;
  drivers: BacktestPick[];
  constructors: BacktestPick[];
  transfersIn: string[];
  transfersOut: string[];
  boost: string | null;
  extraBoost: string | null;
  chip: string | null;
  penalty: number;
  points: number;
  cumulative: number;
  formCumulative: number;
  /** Ownership-weighted average player, cumulative; null without ownership data. */
  averageCumulative: number | null;
  hindsightCumulative: number;
  teamValue: number;
  bank: number;
}

export interface BacktestWorldRank {
  rank: number;
  low: number;
  high: number;
  percentile: number | null;
}

/** A known reference score (e.g. the current global leader) and our total as a share of it. */
export interface BacktestLeader {
  points: number;
  round: number;
  label: string;
  /** Our total as a percentage of the leader's, one decimal. */
  share: number | null;
  source?: string;
  sourceUpdatedAt?: string | null;
}

export interface BacktestSeason {
  season: number;
  total: number;
  hindsight: number;
  form: number;
  keep: number;
  /** Ownership-weighted average player total (no penalties, no chips); null without ownership data. */
  average: number | null;
  finalTeamValue: number;
  players: number | null;
  worldRank: BacktestWorldRank | null;
  /** Global leader reference; null when not known (2024 and 2025 not published). */
  leader?: BacktestLeader | null;
  transfers: number;
  penalties: number;
  chips: string[];
  rounds: BacktestRound[];
}

export interface FantasyBacktest {
  generatedAt: string;
  method: string;
  seasons: BacktestSeason[];
}

/** Our total as a percentage of the hindsight bound, one decimal. */
export function hindsightShare(season: BacktestSeason): number {
  if (season.hindsight <= 0) return 0;
  return Math.round((1000 * season.total) / season.hindsight) / 10;
}

/** Signed difference as text: "+186", "-82", "0". */
export function signed(value: number): string {
  const rounded = Math.round(value);
  if (rounded > 0) return `+${rounded}`;
  return String(rounded);
}

/** Readable chip name for a chip id. */
export function chipLabel(chip: string | null): string | null {
  if (!chip) return null;
  const names: Record<string, string> = {
    autopilot: "Autopilot",
    extraBoost: "x3 Boost",
    wildcard: "Wildcard",
    limitless: "Limitless",
    finalFix: "Final Fix",
    noNegative: "No Negative",
  };
  return names[chip] ?? chip;
}
