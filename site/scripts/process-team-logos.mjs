// Knocks the white tile out of the downloaded team logos (public/teams/*.png) so they sit on
// the page like the headshots. Uses a headless browser canvas, no image library needed.
// Run after fetch-team-logos.mjs: node scripts/process-team-logos.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const dir = path.resolve(import.meta.dirname, process.argv[3] ?? "../public/teams");
const only = process.argv[2];
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".png") && (!only || f === only));
// marks drawn in light colours lose their edges to the softening step; knock out pure white only
const STRICT = new Set(["aston_martin.png"]);
const strictAll = process.argv.includes("--strict");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
await page.goto("http://localhost:3000/teams");
for (const file of files) {
  const strict = strictAll || STRICT.has(file);
  const dataUrl = await page.evaluate(async ({ src, strict }) => {
    const img = new Image();
    img.src = src + "?raw=" + Date.now();
    await img.decode();
    const scale = 2;
    const c = document.createElement("canvas");
    c.width = img.width * scale;
    c.height = img.height * scale;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const image = ctx.getImageData(0, 0, c.width, c.height);
    const d = image.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const sat = max - min;
      if (strict ? max > 248 && sat < 8 : max > 212 && sat < 18) {
        d[i + 3] = 0;
      } else if (!strict && max > 190 && sat < 26) {
        // soften anti-aliased edges toward transparent
        const t = (max - 190) / 22;
        d[i + 3] = Math.round(d[i + 3] * (1 - t));
      }
    }
    ctx.putImageData(image, 0, 0);
    return c.toDataURL("image/png");
  }, { src: `/teams/${file}`, strict });
  const buffer = Buffer.from(dataUrl.split(",")[1], "base64");
  fs.writeFileSync(path.join(dir, file), buffer);
  console.log("processed", file, buffer.length, "bytes");
}
await browser.close();
