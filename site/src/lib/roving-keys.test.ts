import { describe, expect, it } from "vitest";
import { rovingIndex } from "./roving-keys";

describe("rovingIndex", () => {
  it("moves with the arrow keys and wraps at the ends", () => {
    expect(rovingIndex("ArrowRight", 0, 3)).toBe(1);
    expect(rovingIndex("ArrowDown", 2, 3)).toBe(0);
    expect(rovingIndex("ArrowLeft", 0, 3)).toBe(2);
    expect(rovingIndex("ArrowUp", 1, 3)).toBe(0);
  });

  it("jumps to the ends with Home and End", () => {
    expect(rovingIndex("Home", 2, 4)).toBe(0);
    expect(rovingIndex("End", 0, 4)).toBe(3);
  });

  it("ignores other keys", () => {
    expect(rovingIndex("Enter", 1, 3)).toBeNull();
    expect(rovingIndex("a", 1, 3)).toBeNull();
  });
});
