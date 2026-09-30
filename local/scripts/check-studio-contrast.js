/* Contrast gate for the STUDIO.
 *
 *   node scripts/check-studio-contrast.js
 *   (needs the dev server on :5173 and the backend on :8080)
 *
 * scripts/check-contrast.js gates the token SYSTEM; axe-core in
 * scripts/a11y-scan.js gates the marketing routes. Neither reaches the
 * studio, because it is a modal behind a button and its panels are dark
 * surfaces built from light-mode Tailwind utilities and legacy colour
 * aliases. That gap hid seven real failures, including the value you type
 * into "Total Floor Area" rendering at 1.15:1.
 *
 * Backgrounds are read from actual painted pixels, because walking
 * computed styles through translucent glass mis-attributes them. Where an
 * element paints its own opaque background, that wins - a pixel ring
 * around a short label inside a pill samples the rounded edge and blends
 * the control with the page behind it.
 */
const { chromium } = require('playwright');
const testOrigin = process.env.KEYSTONE_TEST_ORIGIN || 'http://localhost:5173';
const apiOrigin = process.env.KEYSTONE_TEST_API_ORIGIN || process.env.KEYSTONE_TEST_ORIGIN || 'http://localhost:8080';
function lum(c) { const s = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2]; }
function ratio(a, b) { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); }
const parse = (s) => (s.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number);

const surveyData = { totalArea: '2400', stories: '2 Stories', bedrooms: '3 Bed', bathrooms: '3 Bath', privateBaths: '1',
  shape: 'Rectangular', garage: '1 Car Garage', materials: 'Modern Farmhouse (Board & Batten)',
  openConcept: 'Open Concept (Combined)', masterLocation: 'Level 2 (Upper)', kitchenPlacement: 'Rear of House',
  features: '1 Study', frontFacing: 'South', lotContext: 'Rural acreage', laundryLocation: 'Level 1 (near garage/mud)',
  ceilingHeight: 'Standard (9 ft)', indoorOutdoor: 'Moderate (some connection)', naturalLight: 'Balanced windows',
  accessibilityNeeds: 'None', budgetTier: 'Mid ($200-300/sqft)', freeformWishes: '', finishOverrides: { exteriorSiding: 'Stone' } };

(async () => {
  const body = await fetch(`${apiOrigin}/api/plan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ surveyData }) }).then((r) => r.json());
  const b = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  await p.addInitScript(({ body, surveyData }) => {
    localStorage.setItem('keystone_studio_session', JSON.stringify({ version: 1, status: 'plan-ready',
      formData: surveyData, planSpec: body.planSpec, planSvg: body.svg, footprintInfo: body.footprintInfo }));
  }, { body, surveyData });
  await p.goto(testOrigin, { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  await p.getByRole('button', { name: /Open Live Studio|Start a plan/ }).first().click();
  await p.waitForTimeout(12000);
  // Open every drawer, so panels that are collapsed by default are still
  // measured rather than skipped.
  await p.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
  await p.waitForTimeout(600);

  const nodes = await p.evaluate(() => {
    const out = [];
    const root = document.querySelector('.studio-modal-window');
    if (!root) return out;
    root.querySelectorAll('*').forEach((el, i) => {
      if (el.children.length) return;
      const t = (el.textContent || '').trim();
      if (!t || t.length > 46) return;
      if (el.closest('.canvas-sheet, svg, .option-dialog-sheet')) return;
      const r = el.getBoundingClientRect();
      // Measure the WHOLE studio, not just what happens to be in the
      // first viewport. Limiting it to the visible window let a light
      // grey panel sit below the fold with unreadable text on it.
      if (r.width < 6 || r.height < 6) return;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.opacity === '0') return;
      el.setAttribute('data-probe', String(i));
      const chain = [];
      let q = el;
      for (let d = 0; d < 4 && q; d++, q = q.parentElement) {
        chain.push(q.className ? String(q.className).split(/\s+/).slice(0,2).join('.') : q.tagName.toLowerCase());
      }
      // Resolve the background from the DOM rather than from pixels: a ring
      // sampled around a short label lands on the glyphs themselves or on
      // the rounded edge of its control, and reports a blend. That produced
      // a false 3.97:1 for a button whose real pair is 7.36:1, and a false
      // 2.30:1 for a subtitle sitting on a panel that is plainly 13.94:1.
      //
      // The walk composites every translucent layer it passes over the
      // first opaque one, and it walks the WHOLE chain. Stopping after
      // three levels was what caused the second false reading: the studio's
      // panel background lives on .cad-panel-brief, six levels above the
      // text, so the walk gave up and fell through to pixel sampling.
      const readBg = (node) => {
        const stack = [];
        let a = node;
        while (a && a !== document.documentElement) {
          const m = getComputedStyle(a).backgroundColor.match(/[\d.]+/g);
          if (m) {
            const al = m.length > 3 ? Number(m[3]) : 1;
            if (al > 0) { stack.push([Number(m[0]), Number(m[1]), Number(m[2]), al]); if (al >= 0.999) break; }
          }
          a = a.parentElement;
        }
        if (!stack.length || stack[stack.length - 1][3] < 0.999) return null;
        let out = stack.pop().slice(0, 3);
        while (stack.length) {
          const [r2, g2, b2, al] = stack.pop();
          out = [r2 * al + out[0] * (1 - al), g2 * al + out[1] * (1 - al), b2 * al + out[2] * (1 - al)];
        }
        return out.map(Math.round).join(',');
      };
      const solid = readBg(el);
      out.push({ id: String(i), solid, where: chain.join(' < '), text: t.slice(0, 40), color: cs.color,
        fs: parseFloat(cs.fontSize), fw: cs.fontWeight,
        x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
    });
    return out;
  });

  const shot = await p.screenshot();
  const bg = await p.evaluate(async ({ data, pts }) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + data; await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    return pts.map(({ id, x, y }) => {
      // Sample a ring around the glyph centre and take the most common value.
      const counts = {};
      for (const [dx, dy] of [[-14, 0], [14, 0], [0, -9], [0, 9], [-14, -9], [14, 9]]) {
        const px = Math.max(0, Math.min(c.width - 1, x + dx));
        const py = Math.max(0, Math.min(c.height - 1, y + dy));
        const d = ctx.getImageData(px, py, 1, 1).data;
        const k = `${d[0]},${d[1]},${d[2]}`;
        counts[k] = (counts[k] || 0) + 1;
      }
      const best = Object.entries(counts).sort((a, z) => z[1] - a[1])[0][0];
      return { id, bg: best };
    });
  }, { data: shot.toString('base64'), pts: nodes });

  const map = Object.fromEntries(bg.map((x) => [x.id, x.bg]));
  const fails = [];
  for (const n of nodes) {
    const bgc = (n.solid || map[n.id] || '255,255,255').split(',').map(Number);
    const cr = ratio(parse(n.color), bgc);
    const large = n.fs >= 24 || (n.fs >= 18.66 && parseInt(n.fw) >= 700);
    const need = large ? 3 : 4.5;
    if (cr < need) fails.push({ ...n, cr, need, bg: bgc.join(',') });
  }
  fails.sort((a, z) => a.cr - z.cr);
  console.log(`text nodes measured: ${nodes.length}   failing: ${fails.length}`);
  process.exitCode = fails.length ? 1 : 0;
  const seen = new Set();
  for (const f of fails) {
    const k = f.color + '|' + f.bg;
    if (seen.has(k)) continue; seen.add(k);
    console.log(`  ${f.cr.toFixed(2)}:1 (need ${f.need})  ${f.color} on rgb(${f.bg})  ${JSON.stringify(f.text)}`);
    console.log(`        ${f.where}`);
  }
  await b.close();
  if (!fails.length) console.log('ALL STUDIO TEXT PASSES');
})();
