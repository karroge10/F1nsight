// Renders the favicon at tab sizes on dark and light backgrounds, plus the header wordmark crops.
import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 420, height: 160 }, deviceScaleFactor: 2 });
await page.setContent(`
  <style>body{margin:0;display:grid;grid-template-columns:1fr 1fr;height:160px;font-family:sans-serif}
  .d{background:#121214;color:#ddd}.l{background:#fafaf9;color:#333}
  .cell{display:flex;align-items:center;gap:18px;padding:16px}
  img{image-rendering:auto}</style>
  <div class="cell d"><img src="http://localhost:3000/icon.svg" width="16" height="16"><img src="http://localhost:3000/icon.svg" width="32" height="32"><img src="http://localhost:3000/icon.svg" width="64" height="64"><span style="font-size:12px">dark tab</span></div>
  <div class="cell l"><img src="http://localhost:3000/icon.svg" width="16" height="16"><img src="http://localhost:3000/icon.svg" width="32" height="32"><img src="http://localhost:3000/icon.svg" width="64" height="64"><span style="font-size:12px">light tab</span></div>
`);
await page.waitForTimeout(800);
await page.screenshot({ path: ".qa/icon-sizes.png" });
const header = await browser.newPage({ viewport: { width: 1440, height: 120 }, deviceScaleFactor: 2 });
for (const theme of ["dark", "light"]) {
  await header.addInitScript((t) => { try { localStorage.setItem("f1nsight-theme", t); } catch {} }, theme);
  await header.goto("http://localhost:3000/", { waitUntil: "load" });
  await header.waitForTimeout(1200);
  await header.screenshot({ path: `.qa/header-${theme}.png`, clip: { x: 0, y: 0, width: 720, height: 60 } });
}
await browser.close();
console.log("icon and header crops written");
