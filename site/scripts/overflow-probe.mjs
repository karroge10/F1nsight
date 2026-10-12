import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await context.newPage();
await page.goto(process.argv[2] ?? "http://localhost:3000/standings", { waitUntil: "networkidle" });
const wide = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll("body *")) {
    if (el.closest(".scroll-x") && !el.classList.contains("scroll-x")) continue;
    const r = el.getBoundingClientRect();
    if (r.right > 392 && r.width > 0) out.push(`${el.tagName.toLowerCase()}.${(typeof el.className === "string" ? el.className : "").slice(0, 70)} right=${Math.round(r.right)} w=${Math.round(r.width)} text=${(el.textContent || "").trim().slice(0, 40)}`);
  }
  return { scrollWidth: document.documentElement.scrollWidth, wide: out.slice(0, 12) };
});
console.log(JSON.stringify(wide, null, 1));
await browser.close();
