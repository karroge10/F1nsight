import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto("http://localhost:3000/fantasy", { waitUntil: "load", timeout: 60000 });
await page.waitForSelector("text=Expected points", { timeout: 30000 });
await page.waitForTimeout(1500);
const workers = page.workers().map((w) => w.url().slice(-60));
const selects = page.locator("select[aria-label^='Driver']");
for (let i = 0; i < 5; i++) await selects.nth(i).selectOption({ index: i + 1 });
const cons = page.locator("select[aria-label^='Constructor']");
await cons.nth(0).selectOption({ index: 1 });
await cons.nth(1).selectOption({ index: 2 });
await page.waitForTimeout(3000);
const expected = await page.evaluate(() => [...document.querySelectorAll("dl dd")].slice(0, 2).map((d) => d.textContent?.trim()));
await page.getByRole("radio", { name: "Value" }).click();
await page.waitForTimeout(3000);
const after = await page.evaluate(() => ({
  url: location.search,
  stats: [...document.querySelectorAll("dl dd")].slice(0, 2).map((d) => d.textContent?.trim()),
  footer: [...document.querySelectorAll("p")].map((p) => p.textContent).find((t) => t?.includes("objective")),
  chips: [...document.querySelectorAll("li")].map((li) => li.textContent?.trim() ?? "").filter((t) => /^(Limitless|Wildcard|Final Fix|Autopilot|No Negative|x3 Boost)/.test(t)).map((t) => t.slice(0, 110)),
  schedule: [...document.querySelectorAll("p")].map((p) => p.textContent).find((t) => t?.startsWith("Season plan")),
  explanations: [...document.querySelectorAll("li")].map((li) => li.textContent ?? "").filter((t) => / to .* pts/.test(t)).length,
}));
console.log("workers:", workers);
console.log("expected objective:", expected);
console.log(JSON.stringify(after, null, 1));
console.log("errors:", errors.slice(0, 5));
await browser.close();
