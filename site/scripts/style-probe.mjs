import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => { try { localStorage.setItem("f1nsight-theme", "dark"); } catch {} });
await page.goto("http://localhost:3000/standings", { waitUntil: "load" });
await page.waitForTimeout(1500);
const info = await page.evaluate(async () => {
  const logos = [...document.querySelectorAll(".team-logo")].slice(0, 3);
  const out = [];
  for (const logo of logos) {
    const imgs = [...logo.querySelectorAll("img")];
    const row = { title: logo.getAttribute("title"), imgs: [] };
    for (const img of imgs) {
      const cs = getComputedStyle(img);
      let avg = null;
      try {
        const c = document.createElement("canvas"); c.width = 32; c.height = 32;
        const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0, 32, 32);
        const d = ctx.getImageData(0, 0, 32, 32).data; let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) { if (d[i + 3] > 40) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; } }
        avg = n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n), n] : null;
      } catch (e) { avg = String(e); }
      row.imgs.push({ src: img.currentSrc.replace(location.origin, ""), display: cs.display, filter: cs.filter, avg });
    }
    out.push(row);
  }
  return { theme: document.documentElement.dataset.theme, out };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
