import { describe, expect, it } from "vitest";
import { gridPlacement, trackSampler } from "./track-motion";

describe("track motion", () => {
  it("samples distance consistently across uneven outline vertices", () => {
    const track = trackSampler([[0, 0], [1, 0], [100, 0], [100, 100], [0, 100]]);
    expect(track.length).toBe(400);
    expect(track.sample(0.25).point).toEqual([100, 0]);
    expect(track.sample(1.25).point).toEqual([100, 0]);
  });
  it("places the starting field in staggered two-column slots", () => {
    const track = trackSampler([[0, 0], [1000, 0], [1000, 1000], [0, 1000]]);
    const slots = [1, 2, 3].map(rank => {
      const grid = gridPlacement(rank, track.length, -1000);
      return track.sample(1 - grid.offset, grid.lateral).point;
    });
    expect(slots[0][0]).toBe(-25);
    expect(slots[1][0]).toBe(25);
    expect(slots[2][0]).toBe(-25);
    expect(slots[1][1] - slots[0][1]).toBeCloseTo(80);
    expect(slots[2][1] - slots[0][1]).toBeCloseTo(160);
    expect(Math.abs(gridPlacement(1, track.length, 12000).lateral)).toBeLessThan(1);
  });
});
