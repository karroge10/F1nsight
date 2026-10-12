import { describe, expect, it } from "vitest";
import { decodePlannerState, defaultPlannerState, encodePlannerState, type PlannerState } from "./planner-state";
import { costCapError, DEFAULT_PICKER_SORT, isAffordable, shortfallText, spendableThisRound, migrateLegacyBank, nextSort, nextEmptySlot, parseCostCap, pickAsset, removePick, sortPickerAssets, swapCost, teamTotals, toggleBoost, type PickAsset } from "./team-selection";

const ASSETS: PickAsset[] = [
  { id: "ver", kind: "driver", price: 28, expectedPoints: 30, expectedPriceChange: 0.3 },
  { id: "ham", kind: "driver", price: 22, expectedPoints: 20, expectedPriceChange: -0.1 },
  { id: "law", kind: "driver", price: 6, expectedPoints: 9, expectedPriceChange: 0.2 },
  { id: "bea", kind: "driver", price: 7, expectedPoints: 8, expectedPriceChange: 0.1 },
  { id: "alb", kind: "driver", price: 8, expectedPoints: 7, expectedPriceChange: 0 },
  { id: "str", kind: "driver", price: 5, expectedPoints: 3, expectedPriceChange: -0.2 },
  { id: "mer", kind: "constructor", price: 25, expectedPoints: 35, expectedPriceChange: 0.2 },
  { id: "haa", kind: "constructor", price: 8, expectedPoints: 10, expectedPriceChange: 0.1 },
  { id: "fer", kind: "constructor", price: 24, expectedPoints: 28, expectedPriceChange: 0 },
];

function fullTeam(): PlannerState {
  return { ...defaultPlannerState(), drivers: ["ver", "ham", "law", "bea", "alb"], constructors: ["mer", "haa"], costCap: 105.5 };
}

const priceOf = (id: string) => ASSETS.find((a) => a.id === id)?.price ?? 0;

describe("pickAsset", () => {
  it("fills the first empty slot of the asset's kind without a target", () => {
    const state = pickAsset(defaultPlannerState(), { id: "ver", kind: "driver" }, null);
    expect(state.drivers).toEqual(["ver", null, null, null, null]);
    const next = pickAsset(state, { id: "mer", kind: "constructor" }, null);
    expect(next.constructors).toEqual(["mer", null]);
  });

  it("swaps into a filled target slot and drops the Boost of the asset sold", () => {
    const boosted = { ...fullTeam(), boost: "law" };
    const state = pickAsset(boosted, { id: "str", kind: "driver" }, { kind: "driver", index: 2 });
    expect(state.drivers).toEqual(["ver", "ham", "str", "bea", "alb"]);
    expect(state.boost).toBeNull();
  });

  it("keeps the Boost when another slot is swapped", () => {
    const boosted = { ...fullTeam(), boost: "ver" };
    const state = pickAsset(boosted, { id: "str", kind: "driver" }, { kind: "driver", index: 4 });
    expect(state.boost).toBe("ver");
  });

  it("ignores an asset already in the team, a full team without a target, and a target of the other kind", () => {
    const team = fullTeam();
    expect(pickAsset(team, { id: "ver", kind: "driver" }, { kind: "driver", index: 1 })).toBe(team);
    expect(pickAsset(team, { id: "str", kind: "driver" }, null)).toBe(team);
    const partial = { ...defaultPlannerState(), drivers: ["ver", null, null, null, null] };
    const state = pickAsset(partial, { id: "mer", kind: "constructor" }, { kind: "driver", index: 0 });
    expect(state.drivers[0]).toBe("ver");
    expect(state.constructors).toEqual(["mer", null]);
  });
});

describe("removePick and toggleBoost", () => {
  it("empties the slot and clears the Boost with it", () => {
    const state = removePick({ ...fullTeam(), boost: "ham" }, "ham");
    expect(state.drivers).toEqual(["ver", null, "law", "bea", "alb"]);
    expect(state.boost).toBeNull();
    expect(nextEmptySlot(state, "driver")).toEqual({ kind: "driver", index: 1 });
    expect(nextEmptySlot(state, "constructor")).toBeNull();
  });

  it("moves the Boost between picked drivers and toggles it off", () => {
    const on = toggleBoost(fullTeam(), "law");
    expect(on.boost).toBe("law");
    expect(toggleBoost(on, "ver").boost).toBe("ver");
    expect(toggleBoost(on, "law").boost).toBeNull();
    expect(toggleBoost(on, "mer")).toBe(on);
    expect(toggleBoost(on, "str")).toBe(on);
  });

  it("round-trips the Boost through the query string and drops one not in the team", () => {
    const state = { ...fullTeam(), boost: "law" };
    const query = encodePlannerState(state);
    expect(decodePlannerState(query).boost).toBe("law");
    expect(decodePlannerState("?d=ver,ham,,,&boost=str").boost).toBeNull();
  });
});

describe("teamTotals, swapCost and affordability", () => {
  it("sums value and points with the x2 Boost; money left is the Cost Cap minus the prices", () => {
    const totals = teamTotals({ ...fullTeam(), boost: "ver" }, ASSETS, 2);
    expect(totals.value).toBe(104);
    expect(totals.points).toBe(30 + 20 + 9 + 8 + 7 + 35 + 10 + 30);
    expect(totals.complete).toBe(true);
    expect(totals.leftToSpend).toBe(1.5);
    expect(totals.over).toBe(false);
  });

  it("flags a complete team that costs more than the Cost Cap", () => {
    const totals = teamTotals({ ...fullTeam(), costCap: 100 }, ASSETS, 2);
    expect(totals.leftToSpend).toBe(-4);
    expect(totals.over).toBe(true);
  });

  it("measures a team being built against the same Cost Cap", () => {
    const state = { ...defaultPlannerState(), drivers: ["ver", "ham", null, null, null] };
    const totals = teamTotals(state, ASSETS, 2);
    expect(totals.complete).toBe(false);
    expect(totals.leftToSpend).toBe(60);
  });

  it("prices a swap as the difference with the asset sold", () => {
    const team = fullTeam();
    const ferrari = ASSETS[8];
    expect(swapCost(team, ferrari, { kind: "constructor", index: 1 }, priceOf)).toBe(16);
    expect(swapCost(team, ferrari, { kind: "constructor", index: 0 }, priceOf)).toBe(-1);
    expect(swapCost(team, ferrari, null, priceOf)).toBe(24);
    expect(isAffordable(16, 1.5)).toBe(false);
    expect(isAffordable(-1, 1.5)).toBe(true);
    expect(isAffordable(1.5, 1.5)).toBe(true);
  });

  it("allows a swap when money left plus the outgoing price covers the incoming price", () => {
    const team = fullTeam();
    const ferrari = ASSETS[8];
    const target = { kind: "constructor" as const, index: 1 };
    const cost = swapCost(team, ferrari, target, priceOf);
    expect(isAffordable(cost, cost)).toBe(true);
    expect(isAffordable(cost, cost - 0.1)).toBe(false);
    expect(shortfallText(cost, cost - 1.2)).toBe("Need +$1.2M");
  });

  it("never lets a team over the cap overspend further", () => {
    expect(isAffordable(0.5, -2)).toBe(false);
    expect(isAffordable(0, -2)).toBe(true);
    expect(isAffordable(-1, -2)).toBe(true);
    expect(shortfallText(0.5, -2)).toBe("Need +$0.5M");
  });

  it("lifts the cap only while Limitless is played", () => {
    const limitless = { chipToPlay: "limitless" as const, chipsAvailable: ["limitless" as const] };
    const wildcard = { chipToPlay: "wildcard" as const, chipsAvailable: ["wildcard" as const] };
    const notOwned = { chipToPlay: "limitless" as const, chipsAvailable: [] };
    expect(isAffordable(30, spendableThisRound(limitless, 1))).toBe(true);
    expect(spendableThisRound(wildcard, 1)).toBe(1);
    expect(spendableThisRound(notOwned, 1)).toBe(1);
  });

  it("sorts the picker list best first by the chosen key", () => {
    const drivers = ASSETS.filter((a) => a.kind === "driver");
    const byValue = sortPickerAssets(drivers, "value").map((a) => a.id);
    expect(byValue[0]).toBe("law");
    const byPrice = sortPickerAssets(drivers, "price").map((a) => a.id);
    expect(byPrice[0]).toBe("ver");
    const byChange = sortPickerAssets(drivers, "expectedPriceChange").map((a) => a.id);
    expect(byChange.at(-1)).toBe("str");
  });
});

describe("parseCostCap and costCapError", () => {
  it("reads dot and comma decimals and rounds to 0.1M", () => {
    expect(parseCostCap("102.5")).toBe(102.5);
    expect(parseCostCap(" 102,5 ")).toBe(102.5);
    expect(parseCostCap("100.25")).toBe(100.3);
    expect(parseCostCap("103.")).toBe(103);
    expect(parseCostCap("0099")).toBe(99);
  });

  it("returns null for text that is not a number yet", () => {
    expect(parseCostCap("")).toBeNull();
    expect(parseCostCap("-")).toBeNull();
    expect(parseCostCap(".")).toBeNull();
    expect(parseCostCap("abc")).toBeNull();
    expect(parseCostCap("1e3")).toBeNull();
    expect(parseCostCap("1.2.3")).toBeNull();
  });

  it("does not clamp: out-of-range values are parsed and explained instead", () => {
    expect(parseCostCap("250")).toBe(250);
    expect(costCapError("250")).toBe("Max $200.0M");
    expect(costCapError("10")).toBe("Min $50.0M");
    expect(costCapError("")).toBe("Enter your Cost Cap");
    expect(costCapError("abc")).toBe("Numbers only, like 102.5");
    expect(costCapError("112.4")).toBeNull();
  });
});

describe("legacy bank migration", () => {
  it("folds the old bank into the Cost Cap as team value plus bank", () => {
    const legacy = { ...fullTeam(), costCap: 100, bank: 2.5 };
    const migrated = migrateLegacyBank(legacy, priceOf);
    expect(migrated.costCap).toBe(106.5);
    expect(migrated.bank).toBe(0);
  });

  it("keeps the default cap when the old team is incomplete or unknown, and ignores a zero bank", () => {
    const partial = { ...defaultPlannerState(), drivers: ["ver", null, null, null, null], bank: 3 };
    const migrated = migrateLegacyBank(partial, priceOf);
    expect(migrated.costCap).toBe(110);
    expect(migrated.bank).toBe(0);
    const team = fullTeam();
    expect(migrateLegacyBank(team, priceOf)).toBe(team);
  });

  it("reads old links with bank= and new ones with cap=", () => {
    expect(decodePlannerState("?bank=2.5").bank).toBe(2.5);
    const state = { ...fullTeam(), costCap: 104.2 };
    const query = encodePlannerState(state);
    expect(query).toContain("cap=104.2");
    expect(decodePlannerState(query).costCap).toBe(104.2);
    expect(encodePlannerState(defaultPlannerState())).toBe("");
  });
});

describe("picker sorting", () => {
  const named = ASSETS.filter((a) => a.kind === "driver").map((a) => ({ ...a, name: a.id }));

  it("defaults to projected points, best first", () => {
    expect(DEFAULT_PICKER_SORT).toEqual({ key: "expectedPoints", dir: "desc" });
    const ids = sortPickerAssets(named, DEFAULT_PICKER_SORT.key, DEFAULT_PICKER_SORT.dir).map((a) => a.id);
    expect(ids).toEqual(["ver", "ham", "law", "bea", "alb", "str"]);
  });

  it("reverses on ascending and sorts names A to Z", () => {
    const cheapest = sortPickerAssets(named, "price", "asc").map((a) => a.id);
    expect(cheapest[0]).toBe("str");
    const names = sortPickerAssets(named, "name").map((a) => a.id);
    expect(names).toEqual(["alb", "bea", "ham", "law", "str", "ver"]);
    const reversed = sortPickerAssets(named, "name", "desc").map((a) => a.id);
    expect(reversed[0]).toBe("ver");
  });

  it("flips the direction on a second click and starts a new column best first", () => {
    const flipped = nextSort(DEFAULT_PICKER_SORT, "expectedPoints");
    expect(flipped).toEqual({ key: "expectedPoints", dir: "asc" });
    expect(nextSort(flipped, "value")).toEqual({ key: "value", dir: "desc" });
    expect(nextSort(flipped, "name")).toEqual({ key: "name", dir: "asc" });
  });
});
