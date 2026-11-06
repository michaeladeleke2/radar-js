// Run the benchmark page's offline tests in headless Chromium (Playwright)
// and check the results.
//
//   npx vite preview --port 4173 &         (serves dist/ after npm run build)
//   node tools/bench_headless.mjs [url] [--autorun replay] [--quick] [--out file.json]
//
// Playwright is not a dependency of radar-js: set PLAYWRIGHT to its package
// folder (e.g. ~/.npm/_npx/<hash>/node_modules/playwright) if
// `import('playwright')` does not find it, and CHROMIUM to a Chromium binary
// if Playwright's expected browser build is not installed.

import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const flag = n => args.includes(n);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const url = args.find(a => /^https?:/.test(a)) ?? 'http://localhost:4173/bench.html';
const autorun = opt('--autorun', 'replay');
const out = opt('--out', null);

let pw;
try { pw = await import('playwright'); }
catch { pw = await import(pathToFileURL(`${process.env.PLAYWRIGHT}/index.mjs`).href); }

// CHROMIUM: a Chromium binary, when Playwright's own browser download is not the one installed
const browser = await pw.chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const t0 = Date.now();
await page.goto(`${url}?autorun=${autorun}${flag('--quick') ? '&quick=1' : ''}`);
await page.waitForFunction(() => window.__benchDone === true, null, { timeout: 30 * 60 * 1000 });
const results = await page.evaluate(() => window.__benchResults);
const shown = await page.evaluate(() => ({ error: document.getElementById('error').hidden ? '' : document.getElementById('error').textContent, status: document.getElementById('offlineStatus').textContent, text: document.getElementById('offlineResult').textContent }));
await browser.close();
console.log(shown.text);
console.log(`\nstatus: ${shown.status}; ${((Date.now() - t0) / 1000).toFixed(1)} s; browser ${await (async () => results.system?.browser_version)()}`);
if (out) writeFileSync(out, JSON.stringify(results, null, 1));
const problems = [...errors];
if (shown.error) problems.push(`page error box: ${shown.error}`);
if (shown.status !== 'Done.') problems.push(`status: ${shown.status}`);
for (const part of autorun.split(',')) if (!results[part]) problems.push(`no ${part} results`);
if (results.replay) {
  const st = results.replay.stages;
  for (const [name, s] of Object.entries(st)) {
    if (!(s.stats.n >= (flag('--quick') ? 20 : 100))) problems.push(`${name}: n = ${s.stats.n}`);
    if (!(s.stats.mean > 0)) problems.push(`${name}: mean ${s.stats.mean}`);
  }
  if (!(results.replay.real_time_margin > 0)) problems.push('no real-time margin');
}
console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : 'OK: no errors, every stage timed');
process.exit(problems.length ? 1 : 0);
