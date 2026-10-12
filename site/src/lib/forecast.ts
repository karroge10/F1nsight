// Pure helpers that turn the model's raw forecast fields into readable numbers.

import type { DriverForecast, ForecastStage, KeyFactor, ReasonFactor } from "@/lib/data";

/** Session codes the model lists in `inputsUsed`, in weekend order, with their display names. */
const SESSION_NAMES: Record<string, string> = {
  FP1: "FP1",
  FP2: "FP2",
  FP3: "FP3",
  SQ: "Sprint Qualifying",
  S: "Sprint",
  Q: "Qualifying",
};

export interface StageText {
  label: string;
  detail: string;
}

/** Fixed "why" fields, shown for every driver in this order. */
export const WHY_FIELDS = [
  { kind: "form", label: "Recent finishes" },
  { kind: "quali_pace", label: "One-lap pace" },
  { kind: "team", label: "Car pace" },
  { kind: "championship", label: "Championship" },
] as const;

export interface WhyRow {
  kind: string;
  label: string;
  value: string | null;
  impact: ReasonFactor["impact"];
  detail: string | null;
}

/**
 * The model's predicted finishing order for the race. Ranked by model strength: win chance
 * first, ties broken by podium chance, then points chance. Every view (hero, finishing order
 * table, model record) uses this one order, so "Predicted P1" means the same driver everywhere.
 */
export function predictedOrder<T extends Pick<DriverForecast, "pWin" | "pPodium" | "pPoints">>(drivers: T[]): T[] {
  return [...drivers].sort(compareStrength);
}

/**
 * What the forecast is based on, for the hero: "Pre-weekend forecast" before any session has
 * run, otherwise "Updated after <session>" naming the latest session the model used.
 */
export function forecastStageText(stage: ForecastStage, inputsUsed: string[]): StageText {
  const latest = latestSession(inputsUsed);
  if (stage === "pre-weekend" || latest === null) {
    return { label: "Pre-weekend forecast", detail: "Based on form, qualifying record and circuit history. Updated after each practice session and after qualifying." };
  }
  const label = `Updated after ${latest}`;
  if (stage === "post-qualifying") {
    return { label, detail: `Includes the starting grid from ${latest}. Final forecast for the race.` };
  }
  return { label, detail: `Includes pace from ${latest}. Updated again after the next session and after qualifying.` };
}

/**
 * The fixed set of "why" rows for one driver. Fields the model did not publish for this
 * driver come back with a null value, so every driver shows the same rows. Percent gaps to
 * pole are converted to seconds when a reference pole lap is known.
 */
export function whyRows(driver: DriverForecast, poleMs: number | null): WhyRow[] {
  if (driver.keyFactors && driver.keyFactors.length) return driver.keyFactors.map(keyFactorRow);
  const factors = driver.factors ?? [];
  return WHY_FIELDS.map((field) => {
    const factor = factors.find((f) => f.kind === field.kind);
    const raw = factor ? factor.value.replace(/^avg\s+/, "") : null;
    const value = raw === null ? null : paceInSeconds(raw, poleMs);
    return { kind: field.kind, label: field.label, value, impact: factor?.impact ?? "neutral", detail: factor?.detail ?? null };
  });
}

/**
 * One row from the model's keyFactors. Label and detail come from the data; the value is
 * formatted by unit: pace gaps in seconds, reliability as a DNF percent, track history with
 * its number of visits. Anything else uses the model's own text.
 */
export function keyFactorRow(factor: KeyFactor): WhyRow {
  const value = keyFactorValue(factor);
  return { kind: factor.key, label: factor.label, value, impact: factor.impact, detail: factor.detail || null };
}

/**
 * The rows that moved this driver's forecast most: the published rows (value not null) with
 * the largest absolute impact, at most `count`, in impact order.
 */
export function topWhyRows(rows: WhyRow[], count: number): WhyRow[] {
  const published = rows.filter((row) => row.value !== null);
  const ranked = published.sort((a, b) => impactSize(b.impact) - impactSize(a.impact));
  return ranked.slice(0, count);
}

/** "+0.42% to pole" with a 1:30.000 pole becomes "+0.378 s to pole". Other values pass through. */
export function paceInSeconds(value: string, poleMs: number | null): string {
  const match = /^([+-]?\d+(?:\.\d+)?)%\s*(.*)$/.exec(value.trim());
  if (!match || poleMs === null) return value;
  const percent = Number(match[1]);
  const seconds = (percent / 100) * (poleMs / 1000);
  const sign = seconds >= 0 ? "+" : "-";
  const rest = match[2] ? ` ${match[2]}` : "";
  return `${sign}${Math.abs(seconds).toFixed(3)} s${rest}`;
}

function keyFactorValue(factor: KeyFactor): string | null {
  if (factor.value === null) return null;
  if (typeof factor.seconds === "number") return formatGapSeconds(factor.seconds);
  if (factor.unit === "share") return `${Math.round(factor.value * 100)}% DNF`;
  if (factor.key === "trackHistory" && typeof factor.visits === "number") {
    const visitsText = factor.visits === 1 ? "1 visit" : `${factor.visits} visits`;
    return `avg P${factor.value.toFixed(1)}, ${visitsText}`;
  }
  return factor.text;
}

function formatGapSeconds(seconds: number): string {
  const sign = seconds >= 0 ? "+" : "-";
  return `${sign}${Math.abs(seconds).toFixed(3)} s`;
}

function latestSession(inputsUsed: string[]): string | null {
  const known = inputsUsed.filter((code) => code in SESSION_NAMES);
  const last = known[known.length - 1];
  return last ? SESSION_NAMES[last] : null;
}

function compareStrength(a: Pick<DriverForecast, "pWin" | "pPodium" | "pPoints">, b: Pick<DriverForecast, "pWin" | "pPodium" | "pPoints">): number {
  if (b.pWin !== a.pWin) return b.pWin - a.pWin;
  if (b.pPodium !== a.pPodium) return b.pPodium - a.pPodium;
  return b.pPoints - a.pPoints;
}

function impactSize(impact: WhyRow["impact"]): number {
  if (typeof impact === "number") return Math.abs(impact);
  return impact === "neutral" ? 0 : 0.01;
}
