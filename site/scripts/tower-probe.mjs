import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto("http://localhost:3000/live", { waitUntil: "networkidle" });
await page.waitForTimeout(6000);
const info = await page.evaluate(() => {
  const table = document.querySelector("table.tower");
  const ths = [...table.querySelectorAll("thead th")].filter((th) => getComputedStyle(th).display !== "none");
  return { tableWidth: table.getBoundingClientRect().width, wrapper: table.parentElement.getBoundingClientRect().width, cols: ths.map((th) => `${th.textContent.trim()}:${Math.round(th.getBoundingClientRect().width)}`), sampleGap: table.querySelector("tbody tr td:nth-child(3)")?.textContent };
});
console.log(JSON.stringify(info));
await browser.close();
