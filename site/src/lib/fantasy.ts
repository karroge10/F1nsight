// Fantasy helpers shared by the fantasy pages: the team lock time and combinations.

import type { RaceSummary } from "@/lib/data";

/** Team lock of a weekend: the start of sprint qualifying on sprint weekends, of qualifying otherwise. */
export function fantasyDeadline(sessions: RaceSummary["sessions"]): string | null {
  return sessions.sprintQualifying ?? sessions.qualifying ?? null;
}

export function combinations<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  const pick: T[] = [];
  const walk = (start: number) => {
    if (pick.length === size) {
      out.push([...pick]);
      return;
    }
    for (let i = start; i <= items.length - (size - pick.length); i++) {
      pick.push(items[i]);
      walk(i + 1);
      pick.pop();
    }
  };
  walk(0);
  return out;
}
