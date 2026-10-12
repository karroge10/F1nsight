import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The refresh rewrites f1.sqlite and data/predictions/*.json while the site runs. These tests
// point the data layer at a temporary data folder and check that a second read sees the new
// files without a restart.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "f1nsight-data-"));
const previousDataDir = process.env.F1_DATA_DIR;
const previousSource = process.env.F1_DATA_SOURCE;

beforeAll(() => {
  process.env.F1_DATA_DIR = dataDir;
  delete process.env.F1_DATA_SOURCE;
  vi.resetModules();
});

afterAll(() => {
  process.env.F1_DATA_DIR = previousDataDir;
  process.env.F1_DATA_SOURCE = previousSource;
  vi.resetModules();
});

describe("published data is picked up without a restart", () => {
  it("re-reads f1.sqlite after the pipeline swaps in a new file", async () => {
    const serveDir = path.join(dataDir, "serve");
    fs.mkdirSync(serveDir, { recursive: true });
    const target = path.join(serveDir, "f1.sqlite");
    writeTinyDb(target, 2026);
    const sqlite = await import("./sqlite-source");
    expect(sqlite.readIndex().currentSeason).toBe(2026);

    // Wait for the idle close (so the rename is allowed on Windows) and the freshness interval.
    await sleep(2300);
    const next = path.join(serveDir, "f1.sqlite.tmp");
    writeTinyDb(next, 2027);
    fs.renameSync(next, target);
    expect(sqlite.readIndex().currentSeason).toBe(2027);
  });

  it("re-reads next.json when it is rewritten", async () => {
    const predictionsDir = path.join(dataDir, "predictions");
    fs.mkdirSync(predictionsDir, { recursive: true });
    const file = path.join(predictionsDir, "next.json");
    const fixtures = await import("./fixtures-source");
    const base = fixtures.readPrediction();
    writeJson(file, { ...base, generatedAt: "2026-10-09T10:00:00Z" });
    expect(fixtures.readPrediction().generatedAt).toBe("2026-10-09T10:00:00Z");
    writeJson(file, { ...base, generatedAt: "2026-10-09T15:00:00Z" });
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(file, later, later);
    expect(fixtures.readPrediction().generatedAt).toBe("2026-10-09T15:00:00Z");
  });
});

function writeTinyDb(file: string, season: number): void {
  if (fs.existsSync(file)) fs.rmSync(file);
  const db = new DatabaseSync(file);
  db.exec("create table seasons (season integer, completedRounds integer)");
  db.exec("create table lap_times (season integer, round integer)");
  const insert = db.prepare("insert into seasons values (?, ?)");
  insert.run(season, 3);
  db.close();
}

function writeJson(file: string, value: unknown): void {
  const text = JSON.stringify(value);
  fs.writeFileSync(file, text);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
