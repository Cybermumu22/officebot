'use strict';
// On-demand snapshotter: renders the live dashboard's first office to
// public/snapshot.png every ~40s, for home-screen widgets that can display
// an auto-refreshing image (Android widgets can't run live web content).
// Spawned lazily by server.js on the first /snapshot.png request, and exits
// on its own once the keepalive file goes stale (~25 min with no requests),
// so Chromium is NOT running 24/7 — only while a widget is actually pulling.
const fs = require('fs');
const path = require('path');

const PORT = process.env.AGENT_VIZ_PORT || 4317;
const PNG = path.join(__dirname, 'public', 'snapshot.png');
// must END in .png — Playwright infers the image format from the extension
// (a ".tmp" suffix fails with: path: unsupported mime type "null")
const TMP = path.join(__dirname, 'public', 'snapshot.tmp.png');
const KEEPALIVE = path.join(__dirname, 'public', '.snapshot-keepalive');
const IDLE_MS = 25 * 60 * 1000;
const SHOT_MS = 40 * 1000;

// OPTIONAL feature: the PNG snapshot (for home-screen IMAGE widgets that can't
// run live web content). agent-viz stays zero-dependency — this only works if
// Playwright is available. Most people don't need it: the dashboard is a PWA,
// so a phone can just open the live page directly. To enable snapshots:
//   npm i -g playwright && npx playwright install chromium
// Resolution order: a globally/locally installed `playwright`, else an
// AGENT_VIZ_PLAYWRIGHT env var pointing at a playwright install.
let chromium;
try {
  chromium = require('playwright').chromium;
} catch (e1) {
  try { chromium = require(process.env.AGENT_VIZ_PLAYWRIGHT || 'playwright-core').chromium; }
  catch (e2) {
    console.error('snapshot.js: Playwright not installed — snapshot image widget disabled.\n'
      + '  This is optional; the live dashboard works fine without it.\n'
      + '  To enable: npm i -g playwright && npx playwright install chromium');
    process.exit(1);
  }
}

(async () => {
  const browser = await chromium.launch();
  // 540px viewport = the dashboard's own mobile layout: single column,
  // compact office — a good aspect for a home-screen widget tile.
  const page = await browser.newPage({ viewport: { width: 540, height: 900 } });
  await page.goto('http://localhost:' + PORT, { waitUntil: 'load' });
  await new Promise(function (r) { setTimeout(r, 3000); }); // snapshot replay + first render

  async function shot() {
    try {
      const office = await page.$('.office');
      if (office) {
        await office.screenshot({ path: TMP });
        fs.renameSync(TMP, PNG); // atomic-ish swap so a reader never sees a half-written file
      }
    } catch (e) { /* transient — next tick retries */ }
  }

  await shot();
  const loop = setInterval(async function () {
    let ka = 0;
    try { ka = Number(fs.readFileSync(KEEPALIVE, 'utf8')) || 0; } catch (e) { }
    if (Date.now() - ka > IDLE_MS) {
      clearInterval(loop);
      await browser.close();
      process.exit(0);
    }
    await shot();
  }, SHOT_MS);
})().catch(function (e) { console.error('snapshot.js: ' + e.message); process.exit(1); });
