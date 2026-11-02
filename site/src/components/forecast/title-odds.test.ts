import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getEntryList, getNextRacePrediction, getStandings } from "@/lib/data";
import { TitleOdds } from "./title-odds";

describe("championship display", () => {
  it("replaces stale simulated odds with a champion while leaving an open constructors title", async () => {
    const prediction = await getNextRacePrediction();
    const standings = await getStandings(2026);
    const entries = await getEntryList(2026);
    const html = renderToStaticMarkup(createElement(TitleOdds, { prediction, standings, entries, totalRounds: 23 }));
    const [drivers, constructors] = html.split("Constructors");
    expect(drivers).toContain("title secured");
    expect(drivers).toContain("2026 world champion");
    expect(drivers).toContain("antonelli");
    expect(drivers).not.toContain("russell");
    expect(drivers).not.toContain("99.9");
    expect(constructors).not.toContain("title secured");
    expect(constructors).toContain("mercedes");
  });
});
