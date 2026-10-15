// Codes, names and team colours for the hindsight view, built from the season's entry list.

import type { getEntryList } from "@/lib/data";
import type { HindsightLabels } from "@/components/fantasy/hindsight-view";

type EntryListData = Awaited<ReturnType<typeof getEntryList>>;

/** `constructorCode` maps a constructor id to its short code, the same one the planner shows. */
export function buildHindsightLabels(entries: EntryListData, constructorCode: (id: string) => string): HindsightLabels {
  const labels: HindsightLabels = { codes: {}, names: {}, colors: {} };
  for (const d of entries.drivers) {
    labels.codes[d.driverId] = d.code;
    labels.names[d.driverId] = d.name;
    labels.colors[d.driverId] = d.teamColor;
  }
  for (const c of entries.constructors) {
    labels.names[c.constructorId] = c.name;
    labels.codes[c.constructorId] = constructorCode(c.constructorId);
    labels.colors[c.constructorId] = c.color;
  }
  return labels;
}
