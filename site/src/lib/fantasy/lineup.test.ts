import { describe, expect, it } from "vitest";
import { isLineupComplete, lineupValue, placeInSlots, placeTeam, sameLineup, transfersIn, type Lineup } from "./lineup";

const saved: Lineup = { drivers: ["norris", "lawson", "bearman", "hulkenberg", "albon"], constructors: ["mclaren", "audi"] };

describe("lineup helpers", () => {
  it("counts transfers from last week's team, none for a new team", () => {
    const draft: Lineup = { drivers: ["norris", "russell", "bearman", null, "albon"], constructors: ["mclaren", "ferrari"] };
    expect(transfersIn(saved, draft)).toEqual(["russell", "ferrari"]);
    const empty: Lineup = { drivers: [null, null, null, null, null], constructors: [null, null] };
    expect(transfersIn(empty, saved)).toEqual([]);
  });

  it("places an optimiser team so kept picks stay in their slots", () => {
    const team = { drivers: ["albon", "russell", "norris", "bearman", "piastri"], constructors: ["ferrari", "mclaren"] };
    const placed = placeTeam(saved, team);
    expect(placed.drivers).toEqual(["norris", "russell", "bearman", "piastri", "albon"]);
    expect(placed.constructors).toEqual(["mclaren", "ferrari"]);
    expect(sameLineup(placed, team)).toBe(true);
    expect(placeInSlots([null, null], ["a", "b"])).toEqual(["a", "b"]);
  });

  it("knows a complete lineup and its value", () => {
    expect(isLineupComplete(saved)).toBe(true);
    expect(isLineupComplete({ ...saved, drivers: ["norris", "norris", "bearman", "hulkenberg", "albon"] })).toBe(false);
    expect(lineupValue(saved, () => 10)).toBe(70);
  });
});
