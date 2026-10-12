// Compact chip advice for the fantasy page: one row per chip (now, best later slot, advice)
// plus a one-line season plan and, when a chip worth more now is still held, the reason in a
// few words. Pure functions over the engine's ChipPlan, tested.

import type { ChipAdvice, ChipId, ChipPlan } from "@/lib/fantasy/engine/types";

export interface RoundInfo {
  round: number;
  raceName: string;
  hasSprint: boolean;
}

export interface ChipRow {
  chip: ChipId;
  name: string;
  /** Extra points if played this weekend (null when it cannot be played). */
  now: number | null;
  /** Extra points in its best later slot. */
  later: number | null;
  /** "R18 sprint", "R19" or "later race"; null when there is no later slot. */
  laterWhere: string | null;
  advice: "play" | "hold" | "used" | "locked";
  /** A few words when the advice needs a reason, e.g. "x3 Boost wins this weekend". */
  note: string | null;
}

/** One row per chip, in the engine's order. */
export function chipRows(plan: ChipPlan, rounds: RoundInfo[]): ChipRow[] {
  const playing = plan.advice.find((a) => a.recommendation === "play") ?? null;
  return plan.advice.map((item) => chipRow(item, playing, rounds));
}

/** "Plan: x3 Boost R17, Final Fix R19", or null when nothing is scheduled. */
export function chipPlanLine(plan: ChipPlan, names: Record<ChipId, string>, rounds: RoundInfo[]): string | null {
  if (plan.schedule.length === 0) return null;
  const parts = plan.schedule.map((slot) => `${names[slot.chip]} ${roundLabel(slot.round, rounds)}`);
  return `Plan: ${parts.join(", ")}`;
}

/** "R18 sprint" for a known sprint round, "R18" otherwise, "later race" beyond the horizon. */
export function roundLabel(round: number, rounds: RoundInfo[]): string {
  if (round <= 0) return "later race";
  const info = rounds.find((r) => r.round === round);
  return info?.hasSprint ? `R${round} sprint` : `R${round}`;
}

function chipRow(item: ChipAdvice, playing: ChipAdvice | null, rounds: RoundInfo[]): ChipRow {
  const base = { chip: item.chip, name: item.name };
  if (!item.available) return { ...base, now: null, later: null, laterWhere: null, advice: "used", note: null };
  const where = laterSlot(item);
  const laterWhere = where === null ? null : roundLabel(where, rounds);
  const later = item.holdValue > 0 ? item.holdValue : null;
  if (item.recommendation === "unavailable" || (item.unavailableReason && item.valueNow === 0)) {
    return { ...base, now: null, later, laterWhere, advice: "locked", note: "Not yet unlocked" };
  }
  if (item.recommendation === "play") return { ...base, now: item.valueNow, later, laterWhere, advice: "play", note: null };
  const note = holdNote(item, playing, laterWhere);
  return { ...base, now: item.valueNow, later, laterWhere, advice: "hold", note };
}

/**
 * Round of the best later slot: the planned round when that is a later race, else the best
 * horizon round, else none. A chip played now is planned for this race, so its later slot is
 * the best horizon round.
 */
function laterSlot(item: ChipAdvice): number | null {
  const plannedLater = item.recommendation !== "play" && item.plannedRound !== null;
  if (plannedLater) return item.plannedRound;
  const best = item.valueByRound.reduce<{ round: number; value: number } | null>((acc, v) => (!acc || v.value > acc.value ? v : acc), null);
  return best && best.value > 0 ? best.round : null;
}

/**
 * Why a chip is held. Worth more now than later: one chip per race, and another chip wins this
 * weekend. Worth more later: where it is better.
 */
function holdNote(item: ChipAdvice, playing: ChipAdvice | null, laterWhere: string | null): string | null {
  if (item.valueNow <= 0.5) return "Little value now";
  const betterNow = item.valueNow >= item.holdValue;
  if (betterNow && playing && playing.chip !== item.chip) return `${playing.name} wins this weekend`;
  if (betterNow) return "Better saved: one chip per race";
  return laterWhere ? `Better at ${laterWhere}` : "Better later";
}
