'use strict';
/* C7 site audit: every public route plus the account, sign-in and studio states, at
   phone, tablet and desktop widths, measured against DESIGN.md's own floor.

   Per state it records:
   - axe-core WCAG 2.1 A/AA violations;
   - horizontal overflow;
   - page and console errors;
   - keyboard focus: the first 40 Tab stops, and any that show no focus indicator
     (DESIGN.md: 2px Keystone Blue outline) or land on something invisible;
   - touch targets under 44 px on the phone width (inline text links excluded,
     per WCAG 2.5.8);
   - a viewport screenshot;
   - the motion still running under prefers-reduced-motion.

   Needs the local conversion stack: backend on 127.0.0.1:8198 (KEYSTONE_RUNTIME=local)
   and Vite on 127.0.0.1:5198 (KEYSTONE_RUNTIME=local VITE_DEV_AUTH=1).

     node scripts/site-audit.cjs --out <dir> [--only home,pricing] [--widths 390,1440]
*/
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const OUT = path.resolve(arg('--out', 'site-audit'));
const BASE = arg('--base', 'http://127.0.0.1:5198');
const WIDTHS = arg('--widths', '390,768,1440').split(',').map(Number);
const ONLY = arg('--only', '') ? new Set(arg('--only', '').split(',')) : null;
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js', { paths: [path.join(__dirname, '..')] }), 'utf8');
fs.mkdirSync(OUT, { recursive: true });

const ROUTES = [['home', '/'], ['how', '/how-floor-plans-work'], ['case', '/case-study'], ['b2b', '/b2b-workflow'], ['roadmap', '/roadmap'],
  ['pricing', '/pricing'], ['faq', '/faq'], ['privacy', '/privacy'], ['terms', '/terms'], ['signin', '/signin'], ['account-anon', '/account']];

const settle = (page, ms = 1200) => page.waitForTimeout(ms);

async function openStudio(page) {
  await page.goto(BASE + '/#generator'); await settle(page, 1800);
}
async function generatePlan(page) {
  await openStudio(page);
  for (let i = 0; i < 8; i++) { const c = page.locator('.studio-modal-window button').filter({ hasText: /^Continue/ }); if (await c.count()) { await c.first().click(); await page.waitForTimeout(150); } }
  await page.locator('.studio-modal-window button').filter({ hasText: 'Generate floor plan' }).click();
  await page.waitForSelector('.presentation-plan-svg svg', { timeout: 90000 });
  await page.waitForFunction(() => !document.querySelector('.seq-dark'), null, { timeout: 60000 }); await settle(page, 1000);
}
async function signIn(page) {
  await page.evaluate(() => { localStorage.setItem('keystone:devUser', JSON.stringify({ uid: 'audit-user', email: 'audit@example.test', name: 'Audit' })); });
  await page.reload(); await settle(page, 1500);
}

// Named interactive states beyond plain routes.
const STATES = [
  ['studio-survey', async (page) => { await openStudio(page); }],
  ['studio-plan', async (page) => { await generatePlan(page); }],
  ['studio-3d-locked', async (page) => { await generatePlan(page); await page.click('.studio-seg button:has-text("3D")'); await settle(page); }],
  ['signin-dialog', async (page) => { await generatePlan(page); await page.click('.studio-seg button:has-text("3D")'); await page.click('.studio-locked button'); await settle(page, 600); }],
  ['nav-menu-open', async (page) => { await page.goto(BASE + '/'); await settle(page); const b = page.locator('button[aria-label*="menu" i]').first(); if (await b.count() && await b.isVisible()) { await b.click(); await settle(page, 600); } }],
  ['account-signed-in', async (page) => { await page.goto(BASE + '/account'); await signIn(page); }],
  ['account-downloads', async (page) => { await page.goto(BASE + '/account?tab=downloads'); await signIn(page); }],
  ['account-billing', async (page) => { await page.goto(BASE + '/account?tab=billing'); await signIn(page); }],
  ['account-profile', async (page) => { await page.goto(BASE + '/account?tab=profile'); await signIn(page); }],
  ['studio-3d-signed-in', async (page) => { await page.goto(BASE + '/'); await signIn(page); await generatePlan(page); await page.click('.studio-seg button:has-text("3D")');
    await page.waitForFunction(() => window.__keystoneModel?.scene.getFrameId() > 5, null, { timeout: 90000 }).catch(() => {}); await settle(page, 1500); }],
];

async function measure(page, name, width) {
  const report = { name, width };
  await page.addScriptTag({ content: AXE });
  const axe = await page.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] });
    return r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, count: v.nodes.length, targets: v.nodes.slice(0, 4).map(n => n.target.join(' ')), summary: v.nodes[0]?.failureSummary?.slice(0, 240) }));
  });
  report.axe = axe;
  report.overflow = await page.evaluate(() => {
    const w = document.documentElement.clientWidth, over = document.documentElement.scrollWidth - w;
    if (over <= 1) return null;
    const culprits = [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.right > w + 1 && getComputedStyle(e).position !== 'fixed'; })
      .slice(0, 5).map(e => `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]} → ${Math.round(e.getBoundingClientRect().right)}`);
    return { by: over, culprits };
  });
  if (width <= 400) {
    report.smallTargets = await page.evaluate(() => {
      const out = [];
      for (const e of document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=tab]')) {
        // A checkbox or radio inside its <label> is tapped through the whole label.
        const hit = (e.type === 'checkbox' || e.type === 'radio') && e.closest('label') ? e.closest('label') : e;
        const r = hit.getBoundingClientRect(), cs = getComputedStyle(e);
        if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none' || e.closest('[aria-hidden=true],[inert]')) continue;
        if (r.bottom < 0 || r.top > innerHeight * 3) continue;
        // WCAG 2.5.8 exempts a link inside running text: its parent holds a sentence
        // longer than the link itself.
        const parentText = (e.parentElement?.textContent || '').trim().length, ownText = (e.textContent || '').trim().length;
        const inline = e.tagName === 'A' && e.parentElement && /^(P|LI|SPAN|SMALL|TD)$/.test(e.parentElement.tagName) && parentText > ownText * 2 + 10;
        if (inline) continue;
        if (r.height < 43.5 || r.width < 43.5) out.push({ el: `${e.tagName.toLowerCase()}${e.className ? '.' + String(e.className).split(' ').slice(0, 2).join('.') : ''}`, text: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) });
      }
      return out;
    });
    // WCAG 2.2 AA (2.5.8) minimum is 24 x 24; under that is a failure, 24-44 is below
    // the comfort floor (DESIGN.md allows 36 px small buttons deliberately).
    report.tinyTargets = report.smallTargets.filter(t => t.w < 24 || t.h < 24);
  }
  // Keyboard: Tab from the top of the page and inspect each stop. A stop "shows
  // focus" only if its focused style differs from its resting style (outline, ring
  // shadow or border); glass controls always carry a shadow, so its mere presence
  // proves nothing.
  await page.evaluate(() => {
    document.activeElement?.blur?.(); window.scrollTo(0, 0);
    const look = e => { const cs = getComputedStyle(e); return [cs.outlineStyle, cs.outlineWidth, cs.outlineColor, cs.boxShadow, cs.borderColor, cs.backgroundColor].join('|'); };
    window.__restLook = new WeakMap();
    for (const e of document.querySelectorAll('a[href], button, input, select, textarea, [tabindex], summary, canvas')) window.__restLook.set(e, look(e));
    window.__look = look;
  });
  await page.mouse.click(1, 1).catch(() => {});
  const stops = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    const s = await page.evaluate(() => {
      const e = document.activeElement;
      const dialog = [...document.querySelectorAll('[role=dialog][aria-modal=true]')].find(d => d.getBoundingClientRect().width && !d.classList.contains('studio-modal-window'));
      if (!e || e === document.body) return null;
      const cs = getComputedStyle(e), r = e.getBoundingClientRect();
      const rest = window.__restLook.get(e), now = window.__look(e);
      const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
      const ring = rest ? (now !== rest && (outline || now.split('|')[3] !== rest.split('|')[3] || now.split('|')[4] !== rest.split('|')[4])) : outline;
      const visible = r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.opacity !== '0';
      return { el: `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${e.className ? '.' + String(e.className).split(' ')[0] : ''}`,
        text: (e.getAttribute('aria-label') || e.textContent || e.value || '').trim().slice(0, 30), ring, visible,
        outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`, outsideDialog: Boolean(dialog && !dialog.contains(e)) };
    });
    if (!s) break;
    if (stops.length && stops[0].el === s.el && stops[0].text === s.text && i > 2) break; // wrapped
    stops.push(s);
  }
  report.tabStops = stops.length;
  report.focusProblems = stops.filter(s => !s.ring || !s.visible);
  report.dialogEscapes = stops.filter(s => s.outsideDialog).length;
  const file = `${name}-${width}.png`;
  await page.screenshot({ path: path.join(OUT, file) });
  report.screenshot = file;
  return report;
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const results = [];
  const run = async (name, width, go) => {
    if (ONLY && !ONLY.has(name)) return;
    const context = await browser.newContext({ viewport: { width, height: width < 500 ? 860 : width < 1000 ? 1024 : 950 } });
    const page = await context.newPage();
    const errors = [], failed = [];
    page.on('response', r => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url().replace(BASE, '')}`); });
    page.on('pageerror', e => errors.push(e.message.slice(0, 200)));
    page.on('console', m => { if (m.type() === 'error' && !/favicon|fonts\.g/.test(m.text())) errors.push(m.text().slice(0, 200)); });
    try {
      await go(page);
      const r = await measure(page, name, width);
      r.errors = errors; r.failedRequests = failed;
      results.push(r);
      console.log(`${name} @${width}: axe ${r.axe.reduce((n, v) => n + v.count, 0)} (${r.axe.map(v => v.id).join(',') || '-'}) overflow ${r.overflow ? r.overflow.by : 0} focus-problems ${r.focusProblems.length}/${r.tabStops}${r.dialogEscapes ? ` dialog-escapes ${r.dialogEscapes}` : ''}` +
        `${r.smallTargets ? ` targets<44 ${r.smallTargets.length} <24 ${r.tinyTargets.length}` : ''} errors ${errors.length} failed ${failed.join(' ') || 0} `);
    } catch (e) {
      results.push({ name, width, failed: e.message.slice(0, 300), errors });
      console.log(`${name} @${width}: FAILED ${e.message.slice(0, 160)}`);
      await page.screenshot({ path: path.join(OUT, `${name}-${width}-failed.png`) }).catch(() => {});
    } finally { await context.close(); }
  };
  // Reduced motion, set before the page loads (as a visitor would have it): any
  // animation longer than 50 ms still running, or a looping one, is a finding.
  const motion = async (name, width, go) => {
    if (ONLY && !ONLY.has(name)) return;
    const context = await browser.newContext({ viewport: { width, height: 860 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    try {
      await go(page); await settle(page, 1500);
      const running = await page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running' && ((a.effect?.getComputedTiming?.().duration || 0) > 50 || a.effect?.getComputedTiming?.().iterations === Infinity))
        .map(a => `${a.animationName || a.constructor.name} on ${a.effect?.target?.tagName?.toLowerCase() || '?'}.${String(a.effect?.target?.className || '').split(' ')[0]}`));
      results.push({ name, width, reducedMotion: true, running });
      console.log(`${name} @${width} reduced-motion: ${running.length ? running.join('; ') : 'still'}`);
    } catch (e) { results.push({ name, width, reducedMotion: true, failed: e.message.slice(0, 200) }); }
    finally { await context.close(); }
  };
  for (const [name, route] of ROUTES) await motion(name, 390, async page => { await page.goto(BASE + route); });
  for (const [name, go] of STATES.filter(([n]) => ['studio-plan', 'nav-menu-open', 'studio-3d-signed-in'].includes(n))) await motion(name, 390, go);
  for (const width of WIDTHS) {
    for (const [name, route] of ROUTES) await run(name, width, async page => { await page.goto(BASE + route); await settle(page, 1500); });
    for (const [name, go] of STATES) await run(name, width, go);
  }
  fs.writeFileSync(path.join(OUT, 'site-audit.json'), JSON.stringify(results, null, 2));
  await browser.close();
})().catch(e => { console.error(e); process.exitCode = 1; });
