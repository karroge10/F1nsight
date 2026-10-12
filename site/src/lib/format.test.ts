import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatGap, formatLapTime, formatPercent, formatRaceTime, formatSigned, positionLabel } from "./format";

describe("format", () => {
  it("formats lap times", () => {
    expect(formatLapTime(83504)).toBe("1:23.504");
    expect(formatLapTime(59999)).toBe("59.999");
    expect(formatLapTime(null)).toBe("");
  });

  it("formats race times with hours", () => {
    expect(formatRaceTime(6675281)).toBe("1:51:15.281");
  });

  it("formats gaps", () => {
    expect(formatGap(1234)).toBe("+1.234");
    expect(formatGap(61234)).toBe("+1:01.234");
  });

  it("formats percents and deltas", () => {
    expect(formatPercent(0.203)).toBe("20%");
    expect(formatPercent(0.004)).toBe("<1%");
    expect(formatPercent(0)).toBe("<1%");
    expect(formatPercent(0, 1)).toBe("<0.1%");
    expect(formatPercent(1)).toBe(">99%");
    expect(formatPercent(0.9961)).toBe(">99%");
    expect(formatSigned(0.3)).toBe("+0.3");
    expect(formatSigned(-0.6)).toBe("−0.6");
  });

  it("maps position codes", () => {
    expect(positionLabel("R")).toBe("DNF");
    expect(positionLabel("7")).toBe("7");
  });

  it("uses three-letter month names, September included", () => {
    expect(formatDate("2026-09-06T00:00:00Z")).toBe("6 Sep");
    expect(formatDate("2026-08-06T00:00:00Z")).toBe("6 Aug");
    expect(formatDateTime("2026-09-06T14:00:00Z", "UTC")).toContain("Sep");
    expect(formatDateTime("2026-09-06T14:00:00Z", "UTC")).not.toContain("Sept");
  });
});
