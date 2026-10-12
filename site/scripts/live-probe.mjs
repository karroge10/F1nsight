// Opens the live page, waits for frames, reports frame timing stats and tower state.
import { chromium } from "playwright";
const url = process.argv[2] ?? "http://localhost:3000/live";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(url, { waitUntil: "networkidle" });
const play = page.getByRole("button", { name: /play replay/i });
if (await play.count()) { await play.first().click(); }
await page.waitForTimeout(12000);
const info = await page.evaluate(() => ({
  frames: window.__f1nsightFrames ?? null,
  rows: document.querySelectorAll("table.tower tbody tr").length,
  visibleCars: [...document.querySelectorAll("svg g[style]")].filter((g) => g.style.visibility === "visible").length,
  status: document.querySelector(".track-status")?.textContent?.trim().slice(0, 160),
  towerWidth: document.querySelector("table.tower")?.getBoundingClientRect().width,
  towerParentWidth: document.querySelector("table.tower")?.parentElement?.getBoundingClientRect().width,
  raceControl: document.querySelectorAll('[aria-label="Race control"] li').length,
}));
console.log(JSON.stringify(info, null, 1));
console.log("errors:", errors.slice(0, 5));
await page.screenshot({ path: ".qa/live-running-dark-desktop.png", fullPage: true });
await browser.close();
