// Lineup helpers for the fantasy planner: slots that may be empty, transfers counted from last
// week's saved team, and placing an optimiser team into the slots so kept picks stay put.
// Pure functions, tested.

export interface Lineup {
  drivers: (string | null)[];
  constructors: (string | null)[];
}

export interface FullLineup {
  drivers: string[];
  constructors: string[];
}

export function lineupIds(lineup: Lineup): string[] {
  const all = [...lineup.drivers, ...lineup.constructors];
  return all.filter((id): id is string => id !== null);
}

/** Every slot filled with a different asset. */
export function isLineupComplete(lineup: Lineup): lineup is FullLineup {
  const all = [...lineup.drivers, ...lineup.constructors];
  const filled = all.every((id) => id !== null);
  return filled && new Set(all).size === all.length;
}

export function isLineupEmpty(lineup: Lineup): boolean {
  return lineupIds(lineup).length === 0;
}

/** Same picks, in any slot order. */
export function sameLineup(a: Lineup, b: Lineup): boolean {
  const left = lineupIds(a).sort().join(",");
  const right = lineupIds(b).sort().join(",");
  return left === right;
}

/** Picks in the draft that were not in the saved team. A new (empty) saved team has no transfers. */
export function transfersIn(saved: Lineup, draft: Lineup): string[] {
  if (isLineupEmpty(saved)) return [];
  const before = new Set(lineupIds(saved));
  return lineupIds(draft).filter((id) => !before.has(id));
}

/** The draft with an optimiser team placed in it: kept picks stay in their slots, new picks fill the freed ones. */
export function placeTeam(previous: Lineup, team: FullLineup): Lineup {
  const drivers = placeInSlots(previous.drivers, team.drivers);
  const constructors = placeInSlots(previous.constructors, team.constructors);
  return { drivers, constructors };
}

/** Slot order for `next`: ids already in `previous` keep their slot, the others fill the free slots in order. */
export function placeInSlots(previous: (string | null)[], next: string[]): (string | null)[] {
  const wanted = new Set(next);
  const slots = previous.map((id) => (id !== null && wanted.has(id) ? id : null));
  const placed = new Set(slots);
  const incoming = next.filter((id) => !placed.has(id));
  for (const id of incoming) {
    const free = slots.indexOf(null);
    if (free >= 0) slots[free] = id;
    else slots.push(id);
  }
  return slots;
}

export function lineupValue(lineup: Lineup, priceOf: (id: string) => number | undefined): number {
  let total = 0;
  for (const id of lineupIds(lineup)) total += priceOf(id) ?? 0;
  return total;
}
