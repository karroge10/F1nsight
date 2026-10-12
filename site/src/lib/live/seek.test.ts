import { describe, expect, it } from "vitest";
import { clampToTimeline } from "./seek";

const timeline = { start: -3_000_000, end: 9_000_000, green: 0 };

describe("clampToTimeline", () => {
  it("keeps a target inside the recording", () => {
    expect(clampToTimeline(120_000, timeline)).toBe(120_000);
  });

  it("stops at the start when stepping back past it", () => {
    expect(clampToTimeline(-3_010_000, timeline)).toBe(-3_000_000);
    expect(clampToTimeline(-1e12, timeline)).toBe(-3_000_000);
  });

  it("stops at the end when stepping forward past it", () => {
    expect(clampToTimeline(9_500_000, timeline)).toBe(9_000_000);
  });

  it("sends a broken target to the start", () => {
    expect(clampToTimeline(Number.NaN, timeline)).toBe(-3_000_000);
    expect(clampToTimeline(Number.NEGATIVE_INFINITY, timeline)).toBe(-3_000_000);
  });

  it("never goes below zero without a timeline", () => {
    expect(clampToTimeline(-5000, null)).toBe(0);
    expect(clampToTimeline(5000, null)).toBe(5000);
  });
});
