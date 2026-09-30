'use strict';
/* Accessibility gate for the marketing routes.
 *
 * Runs axe-core (WCAG 2.1 A + AA) against every SPA route at six widths.
 * The studio is a modal and is covered by test-render-experience.js; this
 * script covers what that one does not touch at all - the eight public
 * pages and their shared chrome.
 *
 *   node scripts/a11y-scan.js                  # against the dev server
 *   node scripts/a11y-scan.js --base http://localhost:8080
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

// axe-core is a frontend devDependency, so resolve from frontend/, not the
// repo root where this script lives.
const AXE = require.resolve('axe-core/axe.min.js', {
  paths: [path.join(__dirname, '../frontend')],
});
const ROUTES = ['/', '/how-floor-plans-work', '/b2b-workflow', '/roadmap', '/pricing', '/faq', '/privacy', '/terms'];
const WIDTHS = [375, 390, 768, 1024, 1280, 1920];

const argBase = process.argv.indexOf('--base');
const BASE = argBase > -1 ? process.argv[argBase + 1] : 'http://localhost:5173';

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const axeSource = fs.readFileSync(AXE, 'utf8');
  const all = [];
  let pageErrors = 0;

  for (const route of ROUTES) {
    for (const width of WIDTHS) {
      // bypassCSP: the site forbids inline scripts, and axe is injected inline.
      const page = await browser.newPage({ viewport: { width, height: 900 }, bypassCSP: true });
      page.on('pageerror', () => { pageErrors++; });
      await page.goto(BASE + route, { waitUntil: 'networkidle' });
      // Scroll the whole page first. Scroll-revealed sections start at
      // opacity 0, and axe cannot resolve a background through a
      // transparent ancestor, so scanning without this reports contrast
      // failures for text that is mid-animation rather than as shipped.
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 400) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 90));
        }
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(700);
      await page.addScriptTag({ content: axeSource });
      const result = await page.evaluate(async () => await window.axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
      }));
      for (const v of result.violations) {
        all.push({ route, width, id: v.id, impact: v.impact, help: v.help,
          nodes: v.nodes.map(n => n.target.join(' ')).slice(0, 4), count: v.nodes.length });
      }
      await page.close();
    }
  }
  await browser.close();

  // Collapse: the same violation at six widths is one problem, not six.
  const byId = new Map();
  for (const v of all) {
    const key = v.id + '|' + v.route;
    if (!byId.has(key)) byId.set(key, { ...v, widths: new Set() });
    byId.get(key).widths.add(v.width);
  }
  const unique = [...byId.values()].sort((a, b) =>
    ['critical', 'serious', 'moderate', 'minor'].indexOf(a.impact) -
    ['critical', 'serious', 'moderate', 'minor'].indexOf(b.impact));

  console.log(`\naxe-core  -  ${ROUTES.length} routes x ${WIDTHS.length} widths = ${ROUTES.length * WIDTHS.length} scans`);
  console.log(`page errors: ${pageErrors}`);
  if (!unique.length) {
    console.log('\nNO VIOLATIONS\n');
  } else {
    console.log(`\n${unique.length} unique violations (${all.length} total across widths):\n`);
    for (const v of unique) {
      console.log(`  [${(v.impact || 'n/a').toUpperCase()}] ${v.id}  ${v.route}`);
      console.log(`      ${v.help}`);
      console.log(`      widths: ${[...v.widths].join(', ')}   nodes: ${v.count}`);
      for (const t of v.nodes) console.log(`        ${t}`);
      console.log('');
    }
  }
  const out = path.join(__dirname, '../tmp/a11y-report.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(unique.map(v => ({ ...v, widths: [...v.widths] })), null, 2));
  console.log(`report: ${out}`);
  process.exit(unique.some(v => v.impact === 'critical' || v.impact === 'serious') ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
