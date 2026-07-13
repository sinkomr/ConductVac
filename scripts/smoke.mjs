import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';

const root = '/home/user/ConductVac/dist';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  let p = join(root, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!existsSync(p)) p = join(root, 'index.html');
  res.setHeader('content-type', mime[extname(p)] ?? 'application/octet-stream');
  res.end(readFileSync(p));
});
await new Promise((r) => server.listen(4173, r));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1480, height: 950 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto('http://localhost:4173/');
await page.waitForTimeout(800);

// load example 2 from the dropdown
await page.selectOption('header select', 'ex2');
await page.waitForTimeout(800);

// run
await page.click('button:has-text("Run")');
await page.waitForTimeout(500);
// speed 100x
await page.click('.speed-btn:has-text("100×")');
await page.waitForTimeout(6000);

const timeText = await page.textContent('.sim-time');
console.log('sim time display:', timeText?.trim());

await page.screenshot({ path: '/tmp/claude-0/-home-user-ConductVac/9b846888-a5d3-5776-9295-17db4edcde3f/scratchpad/app-running.png' });

// open charts tab content is default; check chart canvas exists
const hasChart = await page.locator('.chart-host canvas').count();
console.log('chart canvases:', hasChart);

// check colormap painted something non-gray on the chamber
const fill = await page.evaluate(() => {
  const rects = [...document.querySelectorAll('svg.canvas rect')];
  const painted = rects.filter((r) => {
    const f = r.getAttribute('fill') ?? '';
    return f.startsWith('rgb(') && f !== 'rgb(40,40,48)';
  });
  return painted.length;
});
console.log('colormap-painted rects:', fill);

// event log tab
await page.click('button.tab:has-text("Event log")');
await page.waitForTimeout(300);
const logText = await page.textContent('.tabpanel');
console.log('log sample:', logText?.slice(0, 220).replace(/\n/g, ' | '));

// gas flow tab
await page.click('button.tab:has-text("Gas flow")');
await page.waitForTimeout(800);
const sankeyLabels = await page.locator('.sankey text').count();
console.log('sankey labels:', sankeyLabels);

await page.screenshot({ path: '/tmp/claude-0/-home-user-ConductVac/9b846888-a5d3-5776-9295-17db4edcde3f/scratchpad/app-sankey.png' });

console.log('CONSOLE ERRORS:', errors.length ? errors.join('\n---\n') : 'none');
await browser.close();
server.close();
process.exit(errors.length ? 1 : 0);
