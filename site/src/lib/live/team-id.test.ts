import { describe, expect, it } from "vitest";
import { constructorIdForTeam } from "./team-id";

describe("constructorIdForTeam", () => {
  it("maps live feed team names to logo ids", () => {
    expect(constructorIdForTeam("Red Bull Racing")).toBe("red_bull");
    expect(constructorIdForTeam("Racing Bulls")).toBe("rb");
    expect(constructorIdForTeam("RB")).toBe("rb");
    expect(constructorIdForTeam("Visa Cash App RB")).toBe("rb");
    expect(constructorIdForTeam("red_bull")).toBe("red_bull");
    expect(constructorIdForTeam("Kick Sauber")).toBe("sauber");
    expect(constructorIdForTeam("Kick Sauber", 2025)).toBe("sauber");
    expect(constructorIdForTeam("Kick Sauber", 2026)).toBe("audi");
    expect(constructorIdForTeam("Haas F1 Team")).toBe("haas");
    expect(constructorIdForTeam("Aston Martin")).toBe("aston_martin");
    expect(constructorIdForTeam("Audi")).toBe("audi");
    expect(constructorIdForTeam("Cadillac")).toBe("cadillac");
    expect(constructorIdForTeam(null)).toBeNull();
    expect(constructorIdForTeam("Brabham")).toBeNull();
  });
});
