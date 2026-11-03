import { chromium } from '../../site/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';

const out = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname).replace(/^\/([A-Z]:)/, '$1'));
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 2, colorScheme: 'dark' });
const page = await context.newPage();
const captures = [];
for (const [name, route] of [
  ['forecast', '/'],
  ['telemetry', '/telemetry?s=2026-17-Q&a=NOR&b=VER'],
  ['fantasy', '/fantasy'],
  ['history', '/history']
]) {
  await page.goto(`https://f1nsight.pages.dev${route}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  if (name === 'telemetry') await page.getByRole('heading', { name: 'Singapore Grand Prix, Qualifying', exact: true }).waitFor();
  const file = `${name}.png`;
  await page.screenshot({ path: path.join(out, file), animations: 'disabled' });
  captures.push({ name, url: page.url(), file, width: 3200, height: 2200, capturedAt: new Date().toISOString() });
  console.log(JSON.stringify({ name, heading: await page.locator('h1').innerText(), file }));
}
await page.setViewportSize({ width: 430, height: 932 });
await page.goto('https://f1nsight.pages.dev/', { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: path.join(out, 'forecast-mobile.png'), animations: 'disabled' });
captures.push({ name: 'forecast-mobile', url: page.url(), file: 'forecast-mobile.png', width: 860, height: 1864, capturedAt: new Date().toISOString() });
await fs.writeFile(path.join(out, 'screenshots.json'), JSON.stringify(captures, null, 2));
await browser.close();

