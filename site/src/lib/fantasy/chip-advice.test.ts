import { describe, expect, it } from "vitest";
import type { ChipAdvice, ChipPlan } from "@/lib/fantasy/engine/types";
import { chipPlanLine, chipRows, roundLabel } from "./chip-advice";

const ROUNDS = [
  { round: 17, raceName: "Singapore Grand Prix", hasSprint: true },
  { round: 18, raceName: "United States Grand Prix", hasSprint: true },
  { round: 19, raceName: "Mexico City Grand Prix", hasSprint: false },
];

function advice(partial: Partial<ChipAdvice> & Pick<ChipAdvice, "chip" | "name">): ChipAdvice {
  return { available: true, valueNow: 0, confidence: "exact", valueByRound: [], holdValue: 0, recommendation: "hold", plannedRound: null, reason: "", ...partial };
}

const NAMES = { limitless: "Limitless", wildcard: "Wildcard", finalFix: "Final Fix", autopilot: "Autopilot", noNegative: "No Negative", extraBoost: "x3 Boost" };

describe("chip advice rows", () => {
  const plan: ChipPlan = {
    playNow: "extraBoost",
    advice: [
      advice({ chip: "limitless", name: "Limitless", valueNow: 57.6, holdValue: 53.6, plannedRound: 18, valueByRound: [{ round: 18, value: 53.6, estimated: false }] }),
      advice({ chip: "extraBoost", name: "x3 Boost", valueNow: 60, holdValue: 30, recommendation: "play", plannedRound: 17 }),
      advice({ chip: "finalFix", name: "Final Fix", valueNow: 1, holdValue: 4, plannedRound: 19, valueByRound: [{ round: 19, value: 4, estimated: true }] }),
      advice({ chip: "wildcard", name: "Wildcard", available: false, recommendation: "unavailable" }),
      advice({ chip: "autopilot", name: "Autopilot", valueNow: 0.2, holdValue: 0.2, plannedRound: -1 }),
    ],
    schedule: [
      { round: 17, chip: "extraBoost" },
      { round: 18, chip: "limitless" },
    ],
  };

  it("explains a held chip that is worth more now: another chip wins this weekend", () => {
    const rows = chipRows(plan, ROUNDS);
    const limitless = rows.find((r) => r.chip === "limitless")!;
    expect(limitless.advice).toBe("hold");
    expect(limitless.note).toBe("x3 Boost wins this weekend");
    expect(limitless.laterWhere).toBe("R18 sprint");
    expect(limitless.now).toBe(57.6);
    expect(limitless.later).toBe(53.6);
  });

  it("marks play, better-later, used and low-value chips", () => {
    const rows = chipRows(plan, ROUNDS);
    const byChip = Object.fromEntries(rows.map((r) => [r.chip, r]));
    expect(byChip.extraBoost.advice).toBe("play");
    expect(byChip.extraBoost.note).toBeNull();
    expect(byChip.finalFix.note).toBe("Better at R19");
    expect(byChip.wildcard.advice).toBe("used");
    expect(byChip.autopilot.note).toBe("Little value now");
    expect(byChip.autopilot.laterWhere).toBe("later race");
  });

  it("writes the season plan on one line with sprint rounds marked", () => {
    expect(chipPlanLine(plan, NAMES, ROUNDS)).toBe("Plan: x3 Boost R17 sprint, Limitless R18 sprint");
    expect(chipPlanLine({ ...plan, schedule: [] }, NAMES, ROUNDS)).toBeNull();
    expect(roundLabel(19, ROUNDS)).toBe("R19");
    expect(roundLabel(-2, ROUNDS)).toBe("later race");
  });
});

describe("chip advice rows: the chip played now", () => {
  it("shows its best later horizon round, not this race", () => {
    const plan: ChipPlan = {
      playNow: "extraBoost",
      advice: [advice({ chip: "extraBoost", name: "x3 Boost", valueNow: 50, holdValue: 26, recommendation: "play", plannedRound: 17, valueByRound: [{ round: 18, value: 26, estimated: false }, { round: 19, value: 20, estimated: false }] })],
      schedule: [{ round: 17, chip: "extraBoost" }],
    };
    const [row] = chipRows(plan, ROUNDS);
    expect(row.laterWhere).toBe("R18 sprint");
  });
});
