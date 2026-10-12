import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { randomFantasyFile } from "./__fixtures__/randomMarket";
import { recommend } from "./index";
import { handleEngineRequest } from "./worker";
import type { FantasyFile, UserState } from "./types";

// The engine on the published files: data/predictions/fantasy.json (ML export) and
// fantasy.synthetic.json (ml/scripts/synthetic_fantasy.py), skipped when absent.

const folder = path.resolve(process.cwd(), "../data/predictions");
const files = ["fantasy.json", "fantasy.synthetic.json"].map((name) => path.join(folder, name));

describe("recommend on the published fantasy files", () => {
  for (const file of files) {
    it.skipIf(!existsSync(file))(path.basename(file), () => {
      const text = readFileSync(file, "utf8");
      const data = JSON.parse(text) as FantasyFile;
      const drivers = data.assets.filter((a) => a.kind === "driver").slice(0, 5).map((a) => a.id);
      const constructors = data.assets.filter((a) => a.kind === "constructor").slice(-2).map((a) => a.id);
      const state: UserState = { team: { drivers, constructors }, bank: 0.5, freeTransfers: 2 };
      const result = recommend(data, state);
      checkRecommendation(result, data);
    }, 60000);
  }

  it("works on a random file through the worker protocol", () => {
    const data = randomFantasyFile({ seed: 4, scenarios: 400 });
    const response = handleEngineRequest({ id: 7, type: "recommend", file: data, state: { team: null } });
    expect(response.ok).toBe(true);
    const again = handleEngineRequest({ id: 8, type: "optimise", state: { team: null, risk: "safe" } });
    expect(again.ok).toBe(true);
  });
});

function checkRecommendation(result: ReturnType<typeof recommend>, data: FantasyFile): void {
  expect(result.round).toBe(data.round);
  expect(result.team.best).not.toBeNull();
  expect(result.recommended?.drivers).toHaveLength(5);
  expect(result.recommended?.constructors).toHaveLength(2);
  expect(result.recommended?.cost ?? 0).toBeLessThanOrEqual((result.recommended?.budget ?? 0) + 1e-9);
  expect(result.chips.advice).toHaveLength(6);
  expect(result.plan.stages.length).toBeGreaterThanOrEqual(1);
  const text = [...result.notes, ...result.explanations.map((e) => e.text), ...result.chips.advice.map((a) => a.reason)].join(" ");
  expect(text).not.toMatch(/\u2014/);
}
