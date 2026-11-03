import { chromium } from '../../site/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';

const root = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(new URL('./report.html', import.meta.url).href, { waitUntil: 'load' });
await page.evaluate(async () => { document.querySelectorAll('img').forEach(i => i.loading = 'eager'); await Promise.all([...document.images].map(i => i.decode())); });
const desktop = await page.evaluate(() => ({ images: document.images.length, broken: [...document.images].filter(i => !i.naturalWidth).length, horizontalOverflow: document.documentElement.scrollWidth > innerWidth, height: document.documentElement.scrollHeight, badNumbers: /\b(?:NaN|undefined)\b/.test(document.body.innerText) }));
await page.screenshot({ path: path.join(root, 'report-preview.png'), fullPage: true });
await page.setViewportSize({ width: 390, height: 844 });
const mobile = await page.evaluate(() => ({ horizontalOverflow: document.documentElement.scrollWidth > innerWidth, width: innerWidth }));
await page.screenshot({ path: path.join(root, 'report-mobile-preview.png') });
const result = { desktop, mobile, errors };
await fs.writeFile(path.join(root, 'verification.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
await browser.close();
if (desktop.broken || desktop.horizontalOverflow || desktop.badNumbers || mobile.horizontalOverflow || errors.length) process.exit(1);

