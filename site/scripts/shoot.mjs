// Headless screenshots + console capture with real viewport emulation.
// Usage: node scripts/shoot.mjs <name> <path> [settleMs]
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const [name, urlPath, settleArg, themeArg] = process.argv.slice(2);
const theme = themeArg === "light" ? "light" : "dark";
const settle = Number(settleArg ?? 2500);
const base = process.env.BASE ?? "http://localhost:3000";
const outDir = path.resolve(import.meta.dirname, "../.qa");
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const consoleLines = [];
for (const [suffix, width, height, mobile] of [["desktop", 1440, 900, false], ["mobile", 390, 844, true]]) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, colorScheme: theme });
  const page = await context.newPage();
  await page.addInitScript((t) => { try { localStorage.setItem("f1nsight-theme", t); } catch {} }, theme);
  page.on("console", (msg) => { if (["error", "warning"].includes(msg.type())) consoleLines.push(`[${suffix}] ${msg.type()}: ${msg.text()}`); });
  page.on("pageerror", (err) => consoleLines.push(`[${suffix}] pageerror: ${err.message}`));
  await page.goto(base + urlPath, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(settle);
  const metrics = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, portal: /Unhandled Runtime Error|Build Error|Console Error|Hydration/.test(document.querySelector("nextjs-portal")?.shadowRoot?.textContent ?? "") }));
  await page.screenshot({ path: path.join(outDir, `${name}-${theme}-${suffix}.png`), fullPage: true });
  console.log(`${name} ${theme} ${suffix}: scrollWidth ${metrics.scrollWidth} / viewport ${metrics.clientWidth}${metrics.scrollWidth > metrics.clientWidth ? "  HORIZONTAL OVERFLOW" : ""}, error overlay ${metrics.portal}`);
  await context.close();
}
await browser.close();
fs.writeFileSync(path.join(outDir, `${name}-console.txt`), consoleLines.join("\n"));
console.log(`${name}: ${consoleLines.length} console warnings/errors`);
for (const line of consoleLines.slice(0, 10)) console.log("  " + line);
