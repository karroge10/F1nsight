import { describe, expect, it } from "vitest";
import type { Constructor, Driver, FantasyRules } from "@/lib/data/types";
import { marketFromRounds } from "./market";
import type { FantasyRoundsFile } from "./thresholds";

const RULES = { floor: 3, ceiling: 34 } as FantasyRules;
const DRIVERS = [{ driverId: "gasly", code: "GAS", givenName: "Pierre", familyName: "Gasly" }] as Driver[];
const CONSTRUCTORS = [
  { constructorId: "alpine", name: "Alpine", color: "#FF87BC" },
  { constructorId: "rb", name: "Racing Bulls", color: "#6692FF" },
] as Constructor[];

describe("fantasy market from the served rounds", () => {
  const file: FantasyRoundsFile = {
    season: 2026,
    rounds: [
      {
        round: 1,
        assets: [
          { id: "gasly", fantasyId: "18", kind: "driver", constructorId: "alpine", price: 10.8, points: 12, active: true },
          { id: "alpine", fantasyId: "23", kind: "constructor", constructorId: "alpine", price: 18.5, points: 20, active: true },
        ],
      },
      {
        round: 2,
        assets: [
          { id: "gasly", fantasyId: "18", kind: "driver", constructorId: "alpine", price: 10.2, points: null, active: true, selectedPct: 20 },
          { id: "gasly", fantasyId: "99", kind: "driver", constructorId: "rb", price: 9.7, points: null, active: false },
          { id: "alpine", fantasyId: "23", kind: "constructor", constructorId: "alpine", price: 18.8, points: null, active: true },
        ],
      },
    ],
  };
  const market = marketFromRounds(file, RULES, DRIVERS, CONSTRUCTORS);

  it("takes the gameday and prices from the latest round", () => {
    expect(market.gameday).toBe(2);
    expect(market.rounds).toEqual([1, 2]);
    expect(market.drivers).toHaveLength(1);
    expect(market.drivers[0]).toMatchObject({ code: "GAS", name: "Pierre Gasly", team: "Alpine", price: 10.2, previousPrice: 10.8, selectedPct: 20, active: true });
  });

  it("keeps the price and points history and sums the season", () => {
    expect(market.drivers[0].priceHistory).toEqual([10.8, 10.2]);
    expect(market.drivers[0].pointsHistory).toEqual([12, null]);
    expect(market.drivers[0].seasonPoints).toBe(12);
    expect(market.constructors[0]).toMatchObject({ name: "Alpine", teamColor: "#FF87BC", price: 18.8, previousPrice: 18.5, seasonPoints: 20 });
  });
});
