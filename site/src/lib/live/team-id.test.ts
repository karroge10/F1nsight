import { describe, expect, it } from "vitest";
import { constructorIdForTeam } from "./team-id";

describe("constructorIdForTeam", () => {
  it("maps live feed team names to logo ids", () => {
    expect(constructorIdForTeam("Red Bull Racing")).toBe("red_bull");
    expect(constructorIdForTeam("Racing Bulls")).toBe("rb");
    expect(constructorIdForTeam("Kick Sauber")).toBe("sauber");
    expect(constructorIdForTeam("Haas F1 Team")).toBe("haas");
    expect(constructorIdForTeam("Aston Martin")).toBe("aston_martin");
    expect(constructorIdForTeam("Audi")).toBe("audi");
    expect(constructorIdForTeam("Cadillac")).toBe("cadillac");
    expect(constructorIdForTeam(null)).toBeNull();
    expect(constructorIdForTeam("Brabham")).toBeNull();
  });
});
