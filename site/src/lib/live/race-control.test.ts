import { describe, expect, it } from "vitest";
import type { LiveDriver, RaceControlMessage } from "@/lib/data/types";
import { mentionsDriver } from "./race-control";

const piastri: LiveDriver = { number: 81, code: "PIA", name: "Oscar Piastri", team: "McLaren", teamColor: "#f80" };

function message(text: string, driver: string | null = null): RaceControlMessage {
  return { utc: "2026-10-04T13:00:00", lap: 3, category: "Other", flag: null, scope: null, sector: null, driver, status: null, mode: null, message: text };
}

describe("mentionsDriver", () => {
  it("matches the driver field, CAR nn and the (CODE) form, nothing else", () => {
    expect(mentionsDriver(message("TRACK LIMITS", "81"), piastri)).toBe(true);
    expect(mentionsDriver(message("CAR 81 (PIA) TIME 1:31.2 DELETED"), piastri)).toBe(true);
    expect(mentionsDriver(message("FIA STEWARDS: INCIDENT INVOLVING CARS 81 AND 1"), piastri)).toBe(true);
    expect(mentionsDriver(message("CAR 8 (GAS) PIT LANE SPEEDING"), piastri)).toBe(false);
    expect(mentionsDriver(message("CAR 181 NOTED"), piastri)).toBe(false);
    expect(mentionsDriver(message("GREEN LIGHT - PIT EXIT OPEN"), piastri)).toBe(false);
  });
});
