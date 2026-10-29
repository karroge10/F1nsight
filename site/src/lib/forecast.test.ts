import { describe, expect, it } from "vitest";
import type { DriverForecast, KeyFactor } from "@/lib/data";
import { sessionName } from "./sessions";
import { factorCell, forecastStageText, paceInSeconds, predictedOrder, topWhyRows, whyRows } from "./forecast";

describe("forecast helpers", () => {
  it("orders drivers by win chance, then podium, then points", () => {
    const drivers = [
      { id: "a", pWin: 0.1, pPodium: 0.4, pPoints: 0.9 },
      { id: "b", pWin: 0.2, pPodium: 0.3, pPoints: 0.8 },
      { id: "c", pWin: 0.1, pPodium: 0.5, pPoints: 0.7 },
    ];
    const order = predictedOrder(drivers).map((d) => d.id);
    expect(order).toEqual(["b", "c", "a"]);
  });

  it("converts percent gaps to seconds", () => {
    expect(paceInSeconds("+0.42% to pole", 90000)).toBe("+0.378 s to pole");
    expect(paceInSeconds("+0.42% to pole", null)).toBe("+0.42% to pole");
    expect(paceInSeconds("avg P3.3", 90000)).toBe("avg P3.3");
  });
});

const KEY_FACTORS: KeyFactor[] = [
  { key: "recentFinish", label: "Recent average finish", value: 3.27, unit: "position", text: "avg P3.3", detail: "Has averaged P3.3.", impact: 0.106 },
  { key: "qualiGap", label: "One-lap gap to pole", value: 0.4178, unit: "percent", text: "+0.42% (+0.42s)", detail: "Qualified off pole.", seconds: 0.421, impact: 0.085 },
  { key: "teamGap", label: "Team's best-car gap to pole", value: null, unit: "percent", text: "no data", detail: "", seconds: null, impact: 0 },
  { key: "championship", label: "Championship position", value: 1, unit: "position", text: "P1", detail: "Sits 1st.", impact: 0.045 },
  { key: "trackHistory", label: "Track history here", value: 5, unit: "position", text: "avg P5.0 (1 visit)", detail: "One visit.", visits: 1, impact: -0.004 },
  { key: "reliability", label: "Reliability (own retirement rate)", value: 0.0354, unit: "share", text: "4% DNF", detail: "Retired from 4%.", impact: 0.004 },
];

describe("whyRows", () => {
  it("renders all six keyFactors in order with the data's labels and formatted values", () => {
    const driver = { keyFactors: KEY_FACTORS, factors: [] } as unknown as DriverForecast;
    const rows = whyRows(driver, 90000);
    expect(rows.map((r) => r.kind)).toEqual(["recentFinish", "qualiGap", "teamGap", "championship", "trackHistory", "reliability"]);
    expect(rows.map((r) => r.label)).toEqual(KEY_FACTORS.map((f) => f.label));
    expect(rows.map((r) => r.value)).toEqual(["avg P3.3", "+0.421 s", null, "P1", "avg P5.0, 1 visit", "4% DNF"]);
    expect(rows[2].detail).toBeNull();
    expect(rows[0].detail).toBe("Has averaged P3.3.");
  });

  it("pluralises visits and falls back to the factors parsing without keyFactors", () => {
    const many = { ...KEY_FACTORS[4], visits: 3 };
    const rows = whyRows({ keyFactors: [many] } as unknown as DriverForecast, null);
    expect(rows[0].value).toBe("avg P5.0, 3 visits");
    const legacy = { factors: [{ kind: "quali_pace", label: "x", value: "+0.50% to pole", impact: "helps" }] } as unknown as DriverForecast;
    const legacyRows = whyRows(legacy, 90000);
    expect(legacyRows).toHaveLength(4);
    expect(legacyRows[1].value).toBe("+0.450 s to pole");
  });
});

describe("session names", () => {
  it("uses F1 naming for schedule keys and timing codes", () => {
    expect(sessionName("fp1")).toBe("First Practice (FP1)");
    expect(sessionName("sprintQualifying")).toBe("Sprint Qualifying");
    expect(sessionName("SQ")).toBe("Sprint Qualifying");
    expect(sessionName("R")).toBe("Race");
    expect(sessionName("X", "Other")).toBe("Other");
  });
});

describe("top why rows", () => {
  it("keeps the published rows with the largest impact", () => {
    const rows = [
      { kind: "a", label: "A", value: "1", impact: 0.05, detail: null },
      { kind: "b", label: "B", value: null, impact: 0.9, detail: null },
      { kind: "c", label: "C", value: "3", impact: -0.2, detail: null },
      { kind: "d", label: "D", value: "4", impact: 0.1, detail: null },
    ];
    const top = topWhyRows(rows, 2).map((r) => r.kind);
    expect(top).toEqual(["c", "d"]);
  });
});

describe("forecastStageText", () => {
  it("names the latest session the model used", () => {
    expect(forecastStageText("post-practice", ["FP1"]).label).toBe("Updated after FP1");
    expect(forecastStageText("post-practice", ["FP1", "FP2"]).label).toBe("Updated after FP2");
    expect(forecastStageText("post-practice", ["FP1", "SQ"]).label).toBe("Updated after Sprint Qualifying");
    expect(forecastStageText("post-practice", ["FP1", "SQ", "S"]).label).toBe("Updated after Sprint");
    expect(forecastStageText("post-qualifying", ["FP1", "FP2", "FP3", "Q"]).label).toBe("Updated after Qualifying");
  });

  it("falls back to the pre-weekend label when nothing fed the forecast", () => {
    expect(forecastStageText("pre-weekend", []).label).toBe("Pre-weekend forecast");
    expect(forecastStageText("post-practice", []).label).toBe("Pre-weekend forecast");
  });
});

describe("sortable forecast factors", () => {
  it("sorts by raw values and preserves missing data", () => {
    const driver = { keyFactors: KEY_FACTORS } as DriverForecast;
    expect(factorCell(driver, "qualiGap", 90000)).toMatchObject({ value: 0.4178, text: "+0.421 s" });
    expect(factorCell(driver, "teamGap", 90000).value).toBeNull();
    expect(factorCell(driver, "recentFinish", null).value).toBe(3.27);
  });
});
