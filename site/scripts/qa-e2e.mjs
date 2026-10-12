// End-to-end QA against a running site (production build recommended), text checks only.
//
//   node scripts/qa-e2e.mjs [baseUrl]        default http://localhost:3100
//
// 1. HTTP sweep: every route and a sample of dynamic routes across eras must return the expected
//    status with real content and no error markup.
// 2. Browser (headless Chrome via Playwright): console and page errors on key pages; the forecast
//    shows the model version from data/predictions/next.json; no probability renders as 100% or
//    0%; the fantasy planner answers through its web worker for an empty and a realistic team with
//    chips; the live page plays 2026 R16 over the live service WebSocket with moving cars and a
//    filled tower; the track record renders from data/predictions/history.
// Writes ../logs/qa/qa-results.json and prints a table. Exit code 1 if any check failed.

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:3100";
const DATA_DIR = path.resolve("../data");
const OUT_DIR = path.resolve("../logs/qa");
const LIVE_CORS_BASE = "http://localhost:3000";
const ERROR_MARKERS = ["Internal Server Error", "Application error", "Unhandled Runtime Error", "NEXT_NOT_FOUND"];

const ROUTES = [
  ["/", 200, "Singapore"],
  ["/races", 200, "Singapore"],
  ["/races/2026", 200, "Singapore"],
  ["/races/1994", 200, "San Marino"],
  ["/races/1950", 200, "British"],
  ["/races/2026/16", 200, "Bahrain"],
  ["/races/2026/17", 200, "Singapore"],
  ["/races/2026/23", 200, "Abu Dhabi"],
  ["/races/2025/6", 200, "Miami"],
  ["/races/2024/22", 200, "Las Vegas"],
  ["/races/1994/3", 200, "San Marino"],
  ["/races/1950/1", 200, "British"],
  ["/standings", 200, "Antonelli"],
  ["/standings/2026", 200, "Antonelli"],
  ["/standings/1994", 200, "Schumacher"],
  ["/standings/1950", 200, "Farina"],
  ["/drivers", 200, "Hamilton"],
  ["/drivers/hamilton", 200, "Hamilton"],
  ["/drivers/antonelli", 200, "Antonelli"],
  ["/drivers/arvid_lindblad", 200, "Lindblad"],
  ["/drivers/senna", 200, "Senna"],
  ["/drivers/michael_schumacher", 200, "Schumacher"],
  ["/drivers/farina", 200, "Farina"],
  ["/drivers/fangio", 200, "Fangio"],
  ["/teams", 200, "Ferrari"],
  ["/teams/ferrari", 200, "Ferrari"],
  ["/teams/cadillac", 200, "Cadillac"],
  ["/teams/audi", 200, "Audi"],
  ["/teams/benetton", 200, "Benetton"],
  ["/teams/alfa", 200, "Alfa"],
  ["/circuits", 200, "Monza"],
  ["/circuits/monza", 200, "Monza"],
  ["/circuits/marina_bay", 200, "Marina Bay"],
  ["/circuits/madring", 200, "Mad"],
  ["/circuits/silverstone", 200, "Silverstone"],
  ["/circuits/indianapolis", 200, "Indianapolis"],
  ["/fantasy", 200, "Fantasy"],
  ["/history", 200, "Most Grand Prix wins"],
  ["/live", 200, "Live"],
  ["/live?season=2026&round=16&session=R", 200, "Bahrain"],
  ["/api/fantasy.json", 200, "assets"],
  ["/api/replay/2025/16.json", 200, "drivers"],
  ["/api/replay/2026/16.json", 404, ""],
  ["/drivers/no_such_driver", 404, ""],
  ["/races/2026/99", 404, ""],
];

const results = [];

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await sweepRoutes();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    await checkConsoleErrors(browser);
    await checkForecast(browser);
    await checkPlanner(browser, "empty team", "/fantasy");
    await checkPlanner(browser, "realistic team + wildcard", "/fantasy?d=antonelli,hadjar,gasly,lawson,albon&c=alpine,haas&bank=1.5&ft=2&chips=wildcard.limitless.finalFix&play=wildcard");
    await checkTrackRecord(browser);
  } finally {
    await browser.close();
  }
  // The live service only allows CORS from the site's real port (3000). On another port the
  // production page is checked in a Chrome without web security; the real CORS path is checked
  // against LIVE_CORS_BASE (the site on 3000) when that answers.
  const relaxed = await chromium.launch({ channel: "chrome", headless: true, args: ["--disable-web-security"] });
  try {
    await checkLive(relaxed, BASE, "production build");
  } finally {
    await relaxed.close();
  }
  if (BASE !== LIVE_CORS_BASE) {
    const strict = await chromium.launch({ channel: "chrome", headless: true });
    try {
      await checkLive(strict, LIVE_CORS_BASE, "dev server + live service on 8765");
    } finally {
      await strict.close();
    }
  }
  report();
}

async function sweepRoutes() {
  for (const [route, expectedStatus, needle] of ROUTES) {
    const started = Date.now();
    let status = 0;
    let body = "";
    try {
      const response = await fetch(BASE + route, { redirect: "follow" });
      status = response.status;
      body = await response.text();
    } catch (error) {
      body = String(error);
    }
    const ms = Date.now() - started;
    const marker = expectedStatus === 200 ? ERROR_MARKERS.find((m) => body.includes(m)) : undefined;
    const hasContent = !needle || body.includes(needle);
    // A segment with loading.tsx streams, so notFound() can no longer change the status: Next
    // sends 200 with a noindex robots tag and the not-found page. Accepted, but reported.
    const streamedNotFound = expectedStatus === 404 && status === 200 && body.includes("noindex");
    const statusOk = status === expectedStatus || streamedNotFound;
    const ok = statusOk && !marker && hasContent && (expectedStatus !== 200 || body.length > 2000 || route.startsWith("/api"));
    const detail = [`${status}`, `${Math.round(body.length / 1024)} KB`, `${ms} ms`];
    if (streamedNotFound) detail.push("not-found page streamed with HTTP 200 + noindex (loading.tsx)");
    if (marker) detail.push(`error marker "${marker}"`);
    if (!hasContent) detail.push(`missing "${needle}"`);
    record("route", route, ok, detail.join(", "));
  }
}

async function checkConsoleErrors(browser) {
  const pages = ["/", "/fantasy", "/history", "/standings/2026", "/races/2026/16", "/drivers/hamilton", "/teams/ferrari", "/circuits/marina_bay", "/live"];
  for (const route of pages) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = collectErrors(page);
    await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 90000 }).catch((e) => errors.push(String(e)));
    await page.waitForTimeout(1500);
    record("console", route, errors.length === 0, errors.length ? errors.slice(0, 3).join(" | ").slice(0, 400) : "no console or page errors");
    await page.close();
  }
}

async function checkForecast(browser) {
  const next = readJson(path.join(DATA_DIR, "predictions/next.json"));
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(BASE + "/", { waitUntil: "networkidle", timeout: 90000 });
  const text = await page.evaluate(() => document.body.innerText);
  const version = next.model.version;
  record("forecast", "model version shown", text.includes(version), `next.json ${version} generated ${next.generatedAt}, stage ${next.race.stage}`);
  const raceShown = text.includes(next.race.raceName);
  record("forecast", "race from next.json shown", raceShown, next.race.raceName);
  for (const route of ["/", "/history", "/fantasy"]) {
    if (route !== "/") await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 90000 });
    const pageText = await page.evaluate(() => document.body.innerText);
    const bad = extremePercentages(pageText);
    record("forecast", `no 100% / 0% on ${route}`, bad.length === 0, bad.length ? bad.slice(0, 5).join(" | ") : `${countClamped(pageText)} clamped values (">99%" / "<1%") rendered`);
  }
  const extremes = next.drivers.filter((d) => d.pWin > 0.99 || d.pWin < 0.01).length;
  const titleMax = Math.max(...next.championship.drivers.map((d) => d.pTitle));
  record("forecast", "next.json sanity", true, `${extremes} drivers with pWin outside 1-99%, max pTitle ${titleMax.toFixed(3)}`);
  await page.close();
}

async function checkPlanner(browser, label, route) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = collectErrors(page);
  await page.goto(BASE + route, { waitUntil: "load", timeout: 90000 });
  let found = true;
  await page.waitForSelector("text=Expected points", { timeout: 60000 }).catch(() => { found = false; });
  await page.waitForTimeout(2500);
  const workers = page.workers().map((w) => w.url());
  const info = await page.evaluate(() => {
    const stats = [...document.querySelectorAll("dl dt, dl dd")].map((n) => n.textContent?.trim()).slice(0, 8);
    const warning = [...document.querySelectorAll("p")].map((p) => p.textContent ?? "").find((t) => t.includes("Could not load") || t.includes("No legal team"));
    const selected = [...document.querySelectorAll("select")].map((s) => s.value).filter(Boolean).length;
    const playing = [...document.querySelectorAll("button[aria-pressed='true']")].map((b) => b.textContent?.trim());
    return { stats, warning, selected, playing };
  });
  const ok = found && workers.length > 0 && !info.warning && errors.length === 0;
  const detail = `worker ${workers.length ? "yes" : "no"}; ${info.stats.join(" ")}; slots filled ${info.selected}; chip buttons pressed ${JSON.stringify(info.playing)}${info.warning ? "; warning " + info.warning : ""}${errors.length ? "; errors " + errors[0] : ""}`;
  record("fantasy", label, ok, detail.slice(0, 500));
  await page.close();
}

async function checkLive(browser, base, mode) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = collectErrors(page);
  const sockets = [];
  let messages = 0;
  page.on("websocket", (ws) => {
    sockets.push(ws.url());
    ws.on("framereceived", () => { messages += 1; });
  });
  await page.goto(base + "/live?season=2026&round=16&session=R", { waitUntil: "networkidle", timeout: 90000 });
  const play = page.getByRole("button", { name: /play replay/i });
  const hadPlay = (await play.count()) > 0;
  if (hadPlay) {
    await play.first().click();
    // The replay starts two minutes before the green light, with the cars on the grid: play at
    // 16x so the race is under way before the cars are sampled.
    await page.waitForTimeout(3000);
    const fastest = page.locator('[aria-label^="Playback speed"] button', { hasText: "16x" });
    if (await fastest.count()) await fastest.first().click();
  }
  await page.waitForTimeout(15000);
  const first = await carTransforms(page);
  await page.waitForTimeout(4000);
  const second = await carTransforms(page);
  const moved = Object.keys(second).filter((n) => first[n] && first[n] !== second[n]).length;
  const tower = await page.evaluate(() => ({
    rows: document.querySelectorAll("table tbody tr").length,
    sample: document.querySelector("table tbody tr")?.textContent?.trim().slice(0, 60),
    status: document.body.innerText.match(/Lap \d+\s*\/\s*\d+/)?.[0] ?? null,
  }));
  const ok = sockets.length > 0 && messages > 20 && moved > 5 && tower.rows >= 20 && errors.length === 0;
  const detail = `ws ${sockets.join(", ")}; ${messages} messages; play button ${hadPlay}; ${Object.keys(second).length} cars visible, ${moved} moved in 4 s; tower rows ${tower.rows} (${tower.sample}); ${tower.status ?? "no lap counter"}${errors.length ? "; errors " + errors[0] : ""}`;
  record("live", `2026 R16 replay, ${base} (${mode})`, ok, detail.slice(0, 600));
  await page.close();
}

async function checkTrackRecord(browser) {
  const historyDir = path.join(DATA_DIR, "predictions/history");
  const files = fs.readdirSync(historyDir).filter((f) => f.endsWith(".json")).sort();
  const latest = readJson(path.join(historyDir, files[files.length - 1]));
  const label = `${latest.race.season} R${latest.race.round}`;
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(BASE + "/", { waitUntil: "networkidle", timeout: 90000 });
  const text = await page.evaluate(() => document.body.innerText);
  const shown = text.includes(label);
  const lines = text.split("\n");
  const rows = lines.filter((line) => /^20\d\d R\d+/.test(line.trim())).length;
  record("history", "track record on / from predictions/history", shown, `${files.length} history files, latest ${files[files.length - 1]} (${label}) ${shown ? "shown" : "not found in page text"}; ${rows} race rows`);
  await page.close();
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function collectErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  return errors;
}

async function carTransforms(page) {
  return page.evaluate(() => {
    const out = {};
    const groups = [...document.querySelectorAll('[aria-label="Track map with car positions"] g[style]')];
    groups.forEach((g, i) => {
      if (g.style.visibility === "visible") out[i] = g.getAttribute("transform");
    });
    return out;
  });
}

function extremePercentages(text) {
  const hits = [];
  const pattern = /(^|[^\d.<>])(100(?:\.0+)?|0(?:\.0+)?)\s?%/g;
  let match;
  while ((match = pattern.exec(text))) {
    const start = Math.max(0, match.index - 40);
    const context = text.slice(start, match.index + match[0].length + 10).replace(/\s+/g, " ");
    hits.push(context.trim());
  }
  return hits;
}

function countClamped(text) {
  const matches = text.match(/[<>]\s?(1|99)(\.\d)?%/g);
  return matches ? matches.length : 0;
}

function record(area, check, ok, detail) {
  results.push({ area, check, ok, detail });
  const mark = ok ? "PASS" : "FAIL";
  console.log(`${mark}  ${area.padEnd(9)} ${check.padEnd(42)} ${detail}`);
}

function readJson(file) {
  const text = fs.readFileSync(file, "utf8");
  return JSON.parse(text);
}

function report() {
  const failed = results.filter((r) => !r.ok);
  const payload = { base: BASE, at: new Date().toISOString(), passed: results.length - failed.length, failed: failed.length, results };
  const text = JSON.stringify(payload, null, 1);
  fs.writeFileSync(path.join(OUT_DIR, "qa-results.json"), text);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1;
}

await main();
