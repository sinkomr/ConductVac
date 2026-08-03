#!/usr/bin/env node
/**
 * Regenerate the README screenshots in docs/ from the built app — reproducible
 * instead of hand-taken. Run `npm run build` first, then:
 *
 *   node scripts/smoke/screenshots.mjs
 *
 * Uses the same serve-dist pattern as smoke.mjs (CHROMIUM_PATH to point at a
 * system chromium).
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, extname, join } from 'path';
import { fileURLToPath } from 'url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const root = join(repo, 'dist');
const out = join(repo, 'docs');
mkdirSync(out, { recursive: true });
if (!existsSync(join(root, 'index.html'))) {
  console.error('dist/ missing — run `npm run build` first');
  process.exit(2);
}

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
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
const shoot = (name) => page.screenshot({ path: join(out, name) });
const waitFFDone = () => page.waitForFunction(
  () => !(document.body.textContent ?? '').includes('⏩ running…'),
  { timeout: 180000 },
);

await page.goto('http://localhost:4174/');
await page.waitForTimeout(800);

// 1. builder + colormap: ex2 just after crossover, pressure labels on
await page.selectOption('header select', 'ex2');
await page.waitForTimeout(800);
await page.click('.values-toggle input');
await page.click('button:has-text("Run")');
await page.click('.speed-btn:has-text("10×")');
await page.waitForTimeout(4000); // t ≈ 40 s: mid rough-down gradient
await page.click('.speed-btn:has-text("100×")');
await page.waitForTimeout(4500); // past the t=420 s crossover
await page.click('button:has-text("Pause")');
await page.waitForTimeout(400);
await shoot('screenshot-builder.png');
console.log('wrote screenshot-builder.png');

// 2. diagnosis: ex5 at steady state, Gas flow tab, culprit highlighted
await page.selectOption('header select', 'ex5');
await page.waitForTimeout(800);
await page.click('button:has-text("Run")');
await page.waitForTimeout(1000);
await page.click('button:has-text("⏩ to steady state")');
await waitFFDone();
await page.click('.tab:has-text("Gas flow")');
await page.waitForTimeout(1500); // flows poll
await page.click('text=highlight culprits').catch(() => {});
await page.waitForTimeout(400);
await shoot('screenshot-sankey.png');
console.log('wrote screenshot-sankey.png');

// 3. RGA: ex4 mid-bake — the water ladder at 150 °C
await page.selectOption('header select', 'ex4');
await page.waitForTimeout(800);
await page.click('button:has-text("Run")');
await page.click('.speed-btn:has-text("10000×")');
await page.waitForTimeout(2200); // t ≈ 22000 s: hours into the bake
await page.click('button:has-text("Pause")');
await page.click('.tab:has-text("RGA")');
await page.waitForTimeout(600);
await shoot('screenshot-rga.png');
console.log('wrote screenshot-rga.png');

// 4. power-fail drill: ex2 flooding after the site goes dark
await page.selectOption('header select', 'ex2');
await page.waitForTimeout(800);
await page.click('button:has-text("Run")');
await page.waitForTimeout(800);
await page.click('button:has-text("⏩ to steady state")');
await waitFFDone();
await page.click('button:has-text("⚡ Power fail")');
await page.click('.speed-btn:has-text("1000×")');
await page.waitForTimeout(2500); // tens of sim-minutes of coasting flood
await page.click('button:has-text("Pause")');
await page.click('.tab:has-text("Event log")');
await page.waitForTimeout(400);
await shoot('screenshot-powerfail.png');
console.log('wrote screenshot-powerfail.png');

await browser.close();
server.close();
console.log('done — images in docs/');
