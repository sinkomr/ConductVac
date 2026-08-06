#!/usr/bin/env node
/**
 * Build the portable offline bundle: a single self-contained conductvac.html
 * that runs from a double-click (file://) with no server, no install, no
 * network — plus a zip ready to email.
 *
 *   npm run build:portable
 *
 * Output: dist-portable/conductvac.html and dist-portable/conductvac-portable.zip
 *
 * Why a special build: browsers refuse ES-module *files* and worker *files*
 * on file:// pages (opaque-origin CORS). So everything is inlined — CSS in a
 * <style>, the app in an inline <script type="module">, and the engine worker
 * rides inside the bundle as base64, instantiated through a Blob URL (which
 * file:// pages ARE allowed to spawn).
 */
import { execSync } from 'child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(repo, 'dist-portable');

console.log('building (vite.portable.config.ts)…');
execSync('npx vite build --config vite.portable.config.ts', { cwd: repo, stdio: 'inherit' });

const html = readFileSync(join(out, 'index.html'), 'utf8');
const assets = readdirSync(join(out, 'assets'));
const jsFile = assets.find((f) => f.endsWith('.js'));
const cssFile = assets.find((f) => f.endsWith('.css'));
if (!jsFile || !cssFile) throw new Error(`expected one js + one css in assets/, got: ${assets.join(', ')}`);

// "</script" inside JS strings would terminate the inline tag; "<\/script"
// is byte-for-byte the same string value in JS, so the blanket escape is safe
const js = readFileSync(join(out, 'assets', jsFile), 'utf8').replace(/<\/script/gi, '<\\/script');
const css = readFileSync(join(out, 'assets', cssFile), 'utf8');

// replacer FUNCTIONS throughout: bundle text is full of `$` sequences that
// String.replace would otherwise interpret as substitution patterns
let single = html
  .replace(/<script type="module"[^>]*src="[^"]*"[^>]*><\/script>/, '')
  .replace(/<link rel="modulepreload"[^>]*>/g, '')
  .replace(/<link rel="stylesheet"[^>]*>/, () => `<style>\n${css}\n</style>`);
single = single.replace('</body>', () => `<script type="module">\n${js}\n</script>\n</body>`);
if (single.includes(jsFile) || single.includes(cssFile)) {
  throw new Error('asset references survived inlining — template shape changed?');
}

writeFileSync(join(out, 'conductvac.html'), single);
const kb = Math.round(Buffer.byteLength(single) / 1024);
console.log(`wrote dist-portable/conductvac.html (${kb} kB)`);

const readme = `ConductVac — portable offline build
====================================

1. Keep conductvac.html anywhere (Desktop is fine).
2. Double-click it. It opens in your default browser and runs entirely
   locally — no server, no install, no network access at any point.

Notes for file:// use
- Needs a current browser (Chrome/Edge/Firefox/Safari from ~2023 on).
- Your work-in-progress autosaves to the browser's localStorage on that
  machine, and Save/Load JSON works normally for real files.
- The Share button can't reach the clipboard on file:// pages (browsers
  only allow that on https), so it shows the link in a copy-me prompt
  instead. Share links assume the ConductVac website, which may be blocked
  for you — Save JSON is the reliable way to move systems around.

This file was produced by \`npm run build:portable\` from
https://github.com/sinkomr/ConductVac
`;
writeFileSync(join(out, 'README.txt'), readme);

try {
  execSync('zip -j -q conductvac-portable.zip conductvac.html README.txt', { cwd: out });
  console.log('wrote dist-portable/conductvac-portable.zip');
} catch {
  console.log('zip CLI not available — conductvac.html + README.txt are ready to zip by hand');
}
if (existsSync(join(out, 'conductvac-portable.zip'))) {
  const zkb = Math.round(readFileSync(join(out, 'conductvac-portable.zip')).length / 1024);
  console.log(`zip size: ${zkb} kB`);
}
