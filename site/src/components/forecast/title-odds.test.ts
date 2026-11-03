import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getCalendar, getEntryList, getNextRacePrediction, getStandings } from "@/lib/data";
import type { SeasonStandings } from "@/lib/data";
import { TitleOdds } from "./title-odds";

describe("championship display", () => {
  it("replaces stale simulated odds with a champion while leaving an open constructors title", async () => {
    const prediction = await getNextRacePrediction();
    const standings = await getStandings(2026);
    const entries = await getEntryList(2026);
    const calendar = await getCalendar(2026);
    const html = renderToStaticMarkup(createElement(TitleOdds, { prediction, standings, entries, calendar }));
    const [drivers, constructors] = html.split("Constructors");
    expect(drivers).toContain("Fight for P2");
    expect(drivers).toContain("after the next forecast refresh");
    expect(drivers).toContain("2026 world champion");
    expect(drivers).toContain("antonelli");
    expect(drivers).not.toContain("russell");
    expect(drivers).not.toContain("99.9");
    expect(constructors).not.toContain("title secured");
    expect(constructors).toContain("mercedes");
  });

  it("uses genuine P3 and P2 odds for independent driver and constructor fights", async () => {
    const props = await battleProps();
    const html = renderToStaticMarkup(createElement(TitleOdds, props));
    const [drivers, constructors] = html.split("Constructors");
    expect(drivers).toContain("Fight for P3");
    expect(drivers).toContain("P2 secured");
    expect(drivers).toContain('aria-label="P3 70%"');
    expect(constructors).toContain("Fight for P2");
    expect(constructors).toContain('aria-label="P2 60%"');
    expect(html).not.toContain("after the next forecast refresh");
  });

  it("does not invent position odds from a stale or missing distribution", async () => {
    const props = await battleProps();
    props.prediction.championship.drivers[0].positionDist = [0.5, 0.5, 0, 0];
    const html = renderToStaticMarkup(createElement(TitleOdds, props)).split("Constructors")[0];
    expect(html).toContain("after the next forecast refresh");
    expect(html).not.toContain('aria-label="P3 ');
  });

  it("ends the battles when the final standings are known", async () => {
    const props = await battleProps();
    props.standings.drivers.rounds = 23;
    props.standings.constructors.rounds = 23;
    const html = renderToStaticMarkup(createElement(TitleOdds, props));
    expect(html.match(/All positions decided/g)).toHaveLength(2);
    expect(html).not.toContain("Fight for P");
  });
});

async function battleProps() {
  const prediction = structuredClone(await getNextRacePrediction());
  prediction.race.season = 2027;
  const entries = { ...await getEntryList(2026), season: 2027 };
  const calendar = (await getCalendar(2026)).map(race => ({ ...race, season: 2027, hasSprint: false }));
  const ids = ["antonelli", "russell", "hamilton", "max_verstappen"];
  const teams = ["mercedes", "ferrari", "mclaren"];
  const dist = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 0.7, 0.3], [0, 0, 0.3, 0.7]];
  const teamDist = [[1, 0, 0], [0, 0.6, 0.4], [0, 0.4, 0.6]];
  prediction.championship.drivers = ids.map((driverId, i) => ({ driverId, pTitle: dist[i][0], expectedFinalPoints: 200 - i * 20, positionDist: dist[i] }));
  prediction.championship.constructors = teams.map((constructorId, i) => ({ constructorId, pTitle: teamDist[i][0], positionDist: teamDist[i] }));
  const row = (id: string, points: number, i: number) => ({ id, points, wins: 0, position: i + 1, pointsByRound: [], positionByRound: [] });
  const standings: SeasonStandings = {
    season: 2027, championship: { driverId: "antonelli", constructorId: null },
    drivers: { rounds: 22, list: ids.map((id, i) => row(id, [200, 100, 60, 50][i], i)) },
    constructors: { rounds: 22, list: teams.map((id, i) => row(id, [200, 100, 90][i], i)) },
  };
  return { prediction, standings, entries, calendar };
}
