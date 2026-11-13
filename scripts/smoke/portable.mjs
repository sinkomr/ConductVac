#!/usr/bin/env node
/**
 * Headless check of the portable build: open dist-portable/conductvac.html
 * straight from disk (file://, no server) and confirm the engine worker
 * actually runs there — the one thing that build exists to guarantee.
 *
 *   npm run build:portable && node scripts/smoke/portable.mjs
 */
import { chromium } from 'playwright';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const file = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist-portable', 'conductvac.html');
if (!existsSync(file)) {
  console.error('dist-portable/conductvac.html missing — run `npm run build:portable` first');
  process.exit(2);
}

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const page = await browser.newPage({ viewport: { width: 1480, height: 950 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const requests = [];
page.on('request', (r) => { if (!r.url().startsWith('file:') && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) requests.push(r.url()); });

let fails = 0;
const check = (name, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) fails++; };

await page.goto(pathToFileURL(file).href);
await page.waitForTimeout(700);
const exampleIds = await page.evaluate(() =>
  [...document.querySelector('header select').options].map((o) => o.value).filter((v) => v !== ''),
);
await page.selectOption('header select', exampleIds[0]);
await page.waitForTimeout(500);
check('renders an example from file://', (await page.locator('svg.canvas g.part').count()) > 0);
await page.getByRole('button', { name: /Run/ }).click();
await page.waitForTimeout(1500);
const t = await page.locator('.sim-time').innerText();
check(`the engine worker runs from file:// (${t.trim()})`, /t = [\d.]+ (s|min|h|d)/.test(t) && !/t = 0\.0 s/.test(t));
check('no network requests', requests.length === 0);
check('console free of errors', errors.length === 0);
if (errors.length) console.error(errors.slice(0, 10).join('\n'));
if (requests.length) console.error(requests.slice(0, 10).join('\n'));

await browser.close();
console.log(fails === 0 ? 'ALL PASS' : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
