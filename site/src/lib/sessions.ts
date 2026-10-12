// Official F1 session names, shared by the hero, the schedule and the live page, plus the
// mapping between the three spellings of a session: the schedule key (`sprintQualifying`), the
// timing code (`SQ`) and the URL slug (`/races/2026/12/sq`).

import type { SessionCode, SessionKey } from "@/lib/data/types";

export interface SessionSpec {
  key: SessionKey;
  code: SessionCode;
  slug: string;
  /** Scheduled length, used to decide when a session has finished. */
  minutes: number;
}

export const SESSION_SPECS: SessionSpec[] = [
  { key: "fp1", code: "FP1", slug: "fp1", minutes: 60 },
  { key: "fp2", code: "FP2", slug: "fp2", minutes: 60 },
  { key: "fp3", code: "FP3", slug: "fp3", minutes: 60 },
  { key: "sprintQualifying", code: "SQ", slug: "sq", minutes: 45 },
  { key: "sprint", code: "S", slug: "sprint", minutes: 60 },
  { key: "qualifying", code: "Q", slug: "qualifying", minutes: 60 },
  { key: "race", code: "R", slug: "race", minutes: 150 },
];

const SESSION_NAMES: Record<string, string> = {
  fp1: "First Practice (FP1)",
  fp2: "Second Practice (FP2)",
  fp3: "Third Practice (FP3)",
  sprintqualifying: "Sprint Qualifying",
  sq: "Sprint Qualifying",
  sprint: "Sprint",
  s: "Sprint",
  qualifying: "Qualifying",
  q: "Qualifying",
  race: "Race",
  r: "Race",
};

// Results keep arriving for a while after the chequered flag; a session counts as finished
// this long after its scheduled end.
const FINISH_GRACE_MS = 10 * 60 * 1000;

/**
 * F1 name for a session key. Accepts the schedule keys (`fp1`, `sprintQualifying`, `race`)
 * and the timing codes (`FP1`, `SQ`, `R`) in any case. Unknown keys return the fallback, or
 * the key itself.
 */
export function sessionName(key: string, fallback?: string): string {
  const normalized = key.toLowerCase();
  return SESSION_NAMES[normalized] ?? fallback ?? key;
}

/** Spec for a schedule key, a timing code or a URL slug (any case), or null. */
export function sessionSpec(text: string): SessionSpec | null {
  const lower = text.toLowerCase();
  const found = SESSION_SPECS.find((s) => s.key.toLowerCase() === lower || s.code.toLowerCase() === lower || s.slug === lower);
  return found ?? null;
}

/** True once the session's scheduled slot (plus a short grace) has passed. */
export function sessionFinished(keyOrCode: string, startIso: string, now: Date): boolean {
  const spec = sessionSpec(keyOrCode);
  if (!spec) return false;
  const start = new Date(startIso).getTime();
  if (Number.isNaN(start)) return false;
  return start + spec.minutes * 60 * 1000 + FINISH_GRACE_MS < now.getTime();
}
