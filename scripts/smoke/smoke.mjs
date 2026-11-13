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

// ---- behaviour: the sim runs, and the controls act on the LIVE sim -------
const simTime = () => page.locator('.sim-time').innerText();
await page.selectOption('header select', exampleIds[1] ?? exampleIds[0]);
await page.waitForTimeout(400);
await page.getByRole('button', { name: /Run/ }).click();
await page.waitForTimeout(1500);
const tRunning = await simTime();
check(`Run advances sim time (${tRunning.trim()})`, /t = [\d.]+ (s|min|h|d)/.test(tRunning) && !/t = 0\.0 s/.test(tRunning));

// a drag-zoom on the strip chart must survive the 10 Hz data refresh
const plotHost = page.locator('.tabpanel div').filter({ has: page.locator('.uplot') }).last();
const xRange = () => plotHost.evaluate((el) => {
  const u = el.uplot;
  return u ? [u.scales.x.min, u.scales.x.max] : null;
});
const over = page.locator('.u-over');
const box = await over.boundingBox();
if (box) {
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  const zoomed = await xRange();
  await page.waitForTimeout(600);
  const later = await xRange();
  check('chart zoom survives new samples', !!zoomed && !!later && zoomed[1] === later[1] && zoomed[0] === later[0]);
  await over.dblclick();
  await page.waitForTimeout(400);
  const reset = await xRange();
  check('double-click restores the full range', !!reset && !!zoomed && reset[1] > zoomed[1]);
} else {
  check('strip chart present', false);
}

// New while running: the old simulation must stop, not keep plotting
await page.getByRole('button', { name: 'New', exact: true }).click();
await page.waitForTimeout(500);
check('New stops the running sim', (await simTime()).includes('—') && (await page.locator('svg.canvas g.part').count()) === 0);

// redo with Ctrl+Shift+Z (arrives as key "Z", not "z")
await page.selectOption('header select', exampleIds[0]);
await page.waitForTimeout(400);
const redoBtn = page.locator('header button[title="Ctrl+Shift+Z"]');
await page.locator('svg.canvas').click({ position: { x: 5, y: 5 } });
await page.keyboard.press('Control+a');
await page.keyboard.press('r');
await page.keyboard.press('Control+z');
const redoArmed = await redoBtn.isEnabled();
await page.keyboard.press('Control+Shift+Z');
check('Ctrl+Shift+Z redoes', redoArmed && !(await redoBtn.isEnabled()));

// ---- hostile inputs: a stale autosave and a truncated share link ---------
await page.waitForTimeout(1000); // let the debounced autosave settle, or its unload flush overwrites the fixture
const firstDef = await page.evaluate(() => JSON.parse(localStorage.getItem('conductvac.autosave.v1') ?? '{}').parts?.[0]?.def);
await page.evaluate((def) => {
  localStorage.setItem('conductvac.autosave.v1', JSON.stringify({
    version: 1, name: 'from an older build', humidityRH: 50, script: [],
    parts: [
      { id: 'a', def, x: 2, y: 2, rot: 0, params: {} },
      { id: 'b', def: 'part-that-was-renamed', x: 8, y: 2, rot: 0, params: {} },
    ],
    connections: [
      { id: 'c1', a: { part: 'a', port: 0 }, b: { part: 'b', port: 0 } },
      { id: 'c2', a: { part: 'a', port: 99 }, b: { part: 'a', port: 0 } },
    ],
  }));
}, firstDef);
await page.goto('http://localhost:4174/');
await page.waitForTimeout(700);
check('a stale autosave loads with the unusable part dropped',
  (await page.locator('svg.canvas g.part').count()) === 1 && (await page.locator('.status-chip.warn').count()) === 1);

const b64 = Buffer.from(JSON.stringify({ version: 1, parts: [] })).toString('base64url');
await page.goto(`http://localhost:4174/#sj=${b64}`);
await page.reload();
await page.waitForTimeout(700);
check('a share link with missing fields still boots the app', (await page.locator('header .brand').count()) === 1);

check('console free of errors', consoleErrors.length === 0);
if (consoleErrors.length) console.error(consoleErrors.slice(0, 10).join('\n'));

await browser.close();
server.close();
console.log(fails === 0 ? 'ALL PASS' : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
