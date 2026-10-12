import { describe, expect, it } from "vitest";
import { carOpacity, DIM_OPACITY, togglePin } from "./highlight";

describe("highlight", () => {
  it("clicking the pinned car releases it", () => {
    expect(togglePin(null, 44)).toBe(44);
    expect(togglePin(44, 44)).toBeNull();
    expect(togglePin(44, 1)).toBe(1);
  });

  it("dims every other car and keeps status fades when nothing is highlighted", () => {
    expect(carOpacity("onTrack", 1, null)).toBe(1);
    expect(carOpacity("pit", 1, null)).toBe(0.55);
    expect(carOpacity("onTrack", 1, 1)).toBe(1);
    expect(carOpacity("onTrack", 2, 1)).toBe(DIM_OPACITY);
    expect(carOpacity("retired", 2, 1)).toBe(0.3);
  });
});
