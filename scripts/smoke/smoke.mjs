#!/usr/bin/env node
/**
 * Headless smoke: serve dist/ and check every bundled example renders parts
 * with a console free of errors. Screenshots land in scripts/smoke/out/.
 *
 *   npm run build && node scripts/smoke/smoke.mjs
 *
 * Chromium comes from the local playwright install; point CHROMIUM_PATH at a
 * system browser if playwright has not downloaded one (CI containers often
 * pre-install it, e.g. /opt/pw-browsers/chromium).
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, extname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist');
const out = join(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(out, { recursive: true });
if (!existsSync(join(root, 'index.html'))) {
  console.error('dist/ missing — run `npm run build` first');
  process.exit(2);
}

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  let p = join(root, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!existsSync(p)) p = join(root, 'index.html');
  res.setHeader('content-type', mime[extname(p)] ?? 'application/octet-stream');
  res.end(readFileSync(p));
});
await new Promise((r) => server.listen(4174, r));

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const page = await browser.newPage({ viewport: { width: 1480, height: 950 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

let fails = 0;
const check = (name, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) fails++; };

await page.goto('http://localhost:4174/');
await page.waitForTimeout(700);

// first header select = the examples picker (the second is the unit selector)
const exampleIds = await page.evaluate(() =>
  [...document.querySelector('header select').options]
    .map((o) => o.value)
    .filter((v) => v !== ''),
);
check(`found bundled examples (${exampleIds.length})`, exampleIds.length >= 5);

for (const ex of exampleIds) {
  await page.selectOption('header select', ex);
  await page.waitForTimeout(600);
  const parts = await page.locator('svg.canvas g.part').count();
  check(`${ex}: renders parts (${parts})`, parts > 0);
  await page.screenshot({ path: join(out, `${ex}.png`) });
}

check('console free of errors', consoleErrors.length === 0);
if (consoleErrors.length) console.error(consoleErrors.slice(0, 10).join('\n'));

await browser.close();
server.close();
console.log(fails === 0 ? 'ALL PASS' : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
