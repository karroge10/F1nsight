import { describe, expect, it } from "vitest";
import { combinations, fantasyDeadline } from "./fantasy";

describe("fantasy", () => {
  it("combinations count matches n choose k", () => {
    const combos = combinations([1, 2, 3, 4, 5], 2);
    expect(combos.length).toBe(10);
  });

  it("locks teams at sprint qualifying on sprint weekends, at qualifying otherwise", () => {
    expect(fantasyDeadline({ qualifying: "2026-10-24T21:00:00Z" })).toBe("2026-10-24T21:00:00Z");
    expect(fantasyDeadline({ sprintQualifying: "2026-10-09T12:30:00Z", qualifying: "2026-10-10T13:00:00Z" })).toBe("2026-10-09T12:30:00Z");
    expect(fantasyDeadline({})).toBeNull();
  });
});
