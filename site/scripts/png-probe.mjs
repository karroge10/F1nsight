import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
await page.goto("http://localhost:3000/teams");
const info = await page.evaluate(async () => {
  const out = {};
  for (const id of ["mercedes", "ferrari", "mclaren", "red_bull", "rb", "haas", "williams", "alpine"]) {
    const img = new Image(); img.src = `/teams/${id}.png?t=${Date.now()}`; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let opaque = 0, lightGrey = 0; const total = c.width * c.height;
    for (let i = 0; i < d.length; i += 4) { if (d[i + 3] > 40) { opaque++; const mx = Math.max(d[i], d[i+1], d[i+2]), mn = Math.min(d[i], d[i+1], d[i+2]); if (mx > 200 && mx - mn < 20) lightGrey++; } }
    const px = (x, y) => { const k = (Math.floor(y * c.height) * c.width + Math.floor(x * c.width)) * 4; return d[k + 3]; };
    out[id] = { opaquePct: Math.round(100 * opaque / total), lightGreyPct: Math.round(100 * lightGrey / total), cornerAlpha: [px(0.08, 0.08), px(0.92, 0.08), px(0.08, 0.92)] };
  }
  return out;
});
console.log(JSON.stringify(info));
await browser.close();
