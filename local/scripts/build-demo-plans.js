'use strict';
/**
 * Build the landing-page demo plans from the real engine.
 *
 *   node scripts/build-demo-plans.js            # spawns its own backend
 *   node scripts/build-demo-plans.js --port 8080  # use a running one
 *
 * Writes frontend/public/demo/plan-N.svg plus manifest.json.
 *
 * Why this exists: the hero animation needs real generated plans, not
 * mock-ups. Baking them by hand once means they silently rot into an old
 * version of the product the first time the renderer improves. Running
 * this rebuilds them from whatever the engine currently produces.
 *
 * The one piece of real work here is zoning. The renderer emits every
 * piece of furniture as <g class="rendered-furniture"> with no room
 * identity at all - only a shadow filter - so there is nothing to key a
 * staged reveal off. Room names exist only as label text. So each
 * furniture group is assigned to its nearest room label, measured with
 * getBBox() in a real browser rather than by parsing path data, and
 * stamped with data-zone="common|bed|bath". The animation then reveals
 * three groups instead of forty.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'frontend/public/demo');

const BASE_SURVEY = {
  shape: 'Rectangular', materials: 'Modern Farmhouse (Board & Batten)',
  openConcept: 'Open Concept (Combined)', kitchenPlacement: 'Rear of House',
  frontFacing: 'South', lotContext: 'Suburban lot',
  laundryLocation: 'Level 1 (near garage/mud)', ceilingHeight: 'Standard (9 ft)',
  indoorOutdoor: 'Moderate (some connection)', naturalLight: 'Balanced windows',
  accessibilityNeeds: 'None', budgetTier: 'Mid ($200-300/sqft)',
  freeformWishes: '', finishOverrides: { exteriorSiding: 'Stone' },
};

/* Chosen for FOOTPRINT contrast, not spec contrast. Alternating storey
   count is the strongest signal available: a two-storey draws two sheets
   and a bungalow draws one, which reads instantly even at hero scale. */
const BRIEFS = [
  { id: 1, brief: '2 bed, 1 story, 1,100 sq ft',
    survey: { totalArea: '1100', stories: '1 Story', bedrooms: '2 Bed', bathrooms: '1 Bath',
              privateBaths: '0', garage: 'No Garage', masterLocation: 'Level 1 (Main)', features: 'None' } },
  { id: 2, brief: '3 bed, 2 story, 2,400 sq ft, 1-car garage',
    survey: { totalArea: '2400', stories: '2 Stories', bedrooms: '3 Bed', bathrooms: '3 Bath',
              privateBaths: '1', garage: '1 Car Garage', masterLocation: 'Level 2 (Upper)', features: '1 Study' } },
  { id: 3, brief: '4 bed, 1 story, 2,200 sq ft, 2-car garage',
    survey: { totalArea: '2200', stories: '1 Story', bedrooms: '4 Bed', bathrooms: '2 Bath',
              privateBaths: '1', garage: '2 Car Garage', masterLocation: 'Level 1 (Main)', features: 'None' } },
  /* 5 bed / 3,200 sq ft was the first choice here and the engine returned
     NO_VALID_LAYOUT for it - a real limit, not a bug in this script. A
     4-bed two-storey with a double garage is inside the supported v2
     family and still gives the "big and busy" end of the range. */
  { id: 4, brief: '4 bed, 2 story, 2,800 sq ft, 2-car garage',
    survey: { totalArea: '2800', stories: '2 Stories', bedrooms: '4 Bed', bathrooms: '3 Bath',
              privateBaths: '1', garage: '2 Car Garage', masterLocation: 'Level 2 (Upper)', features: '1 Study' } },
  { id: 5, brief: '3 bed and a study, 1 story, 1,700 sq ft',
    survey: { totalArea: '1700', stories: '1 Story', bedrooms: '3 Bed', bathrooms: '2 Bath',
              privateBaths: '1', garage: 'No Garage', masterLocation: 'Level 1 (Main)', features: '1 Study' } },

  /* ---- portrait footprints, for tall screens ------------------------
     The hero picks whichever plan is closest in proportion to the space
     it has, and on a phone that space is portrait. Only one of the five
     above lands there, so every phone visit showed the same house.

     The lever is lotContext. computeFootprint.js resolves an "Urban
     tight lot" to the DEEP shape profile and clamps the width:depth band
     to <= 1.0 with targets at 0.66 and 0.78, which is a narrow, deep
     house - portrait once drawn. It has to be paired with a single
     storey: two storeys render as two sheets side by side, which doubles
     the sheet ratio back into landscape however deep the footprint is. */
  { id: 6, brief: '2 bed, 1 story, 1,250 sq ft',
    survey: { totalArea: '1250', stories: '1 Story', bedrooms: '2 Bed', bathrooms: '2 Bath',
              privateBaths: '1', garage: 'No Garage', masterLocation: 'Level 1 (Main)',
              features: 'None', lotContext: 'Urban tight lot' } },
  { id: 7, brief: '3 bed, 1 story, 1,500 sq ft, 1-car garage',
    survey: { totalArea: '1500', stories: '1 Story', bedrooms: '3 Bed', bathrooms: '2 Bath',
              privateBaths: '1', garage: '1 Car Garage', masterLocation: 'Level 1 (Main)',
              features: 'None', lotContext: 'Urban tight lot' } },
  { id: 8, brief: '4 bed, 1 story, 1,900 sq ft',
    survey: { totalArea: '1900', stories: '1 Story', bedrooms: '4 Bed', bathrooms: '3 Bath',
              privateBaths: '1', garage: 'No Garage', masterLocation: 'Level 1 (Main)',
              features: 'None', lotContext: 'Urban tight lot' } },
  { id: 9, brief: '3 bed and a study, 1 story, 2,000 sq ft, 1-car garage',
    survey: { totalArea: '2000', stories: '1 Story', bedrooms: '3 Bed', bathrooms: '3 Bath',
              privateBaths: '1', garage: '1 Car Garage', masterLocation: 'Level 1 (Main)',
              features: '1 Study', lotContext: 'Urban tight lot' } },
  { id: 10, brief: '3 bed, 1 story, 1,800 sq ft',
    survey: { totalArea: '1800', stories: '1 Story', bedrooms: '3 Bed', bathrooms: '3 Bath',
              privateBaths: '1', garage: 'No Garage', masterLocation: 'Level 1 (Main)',
              features: 'None', lotContext: 'Urban tight lot' } },
  { id: 11, brief: '4 bed, 1 story, 2,100 sq ft, 1-car garage',
    survey: { totalArea: '2100', stories: '1 Story', bedrooms: '4 Bed', bathrooms: '3 Bath',
              privateBaths: '1', garage: '1 Car Garage', masterLocation: 'Level 1 (Main)',
              features: 'None', lotContext: 'Urban tight lot' } },
  { id: 12, brief: '2 bed and a study, 1 story, 1,400 sq ft',
    survey: { totalArea: '1400', stories: '1 Story', bedrooms: '2 Bed', bathrooms: '2 Bath',
              privateBaths: '1', garage: 'No Garage', masterLocation: 'Level 1 (Main)',
              features: '1 Study', lotContext: 'Urban tight lot' } },
  { id: 13, brief: '5 bed, 1 story, 2,400 sq ft',
    survey: { totalArea: '2400', stories: '1 Story', bedrooms: '5 Bed', bathrooms: '3 Bath',
              privateBaths: '1', garage: 'No Garage', masterLocation: 'Level 1 (Main)',
              features: 'None', lotContext: 'Urban tight lot' } },
];

const BATH = /BATH|POWDER|\bWC\b|ENSUITE|EN-SUITE/i;
const BED = /BEDROOM|NURSERY/i;

const argPort = process.argv.indexOf('--port');
const PORT = argPort > -1 ? Number(process.argv[argPort + 1]) : 8097;
const OWN_SERVER = argPort === -1;
const BASE = `http://localhost:${PORT}`;

async function waitForHealth() {
  for (let i = 0; i < 80; i++) {
    if (await fetch(`${BASE}/health`).then((r) => r.ok).catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

(async () => {
  let server = null;
  if (OWN_SERVER) {
    server = spawn(process.execPath, ['backend/server.js'], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT), VALID_PASSKEYS: 'demo-build', UNLOCK_TOKEN_SECRET: 'demo-build' },
      windowsHide: true, stdio: 'ignore',
    });
  }
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const manifest = [];

  try {
    if (!(await waitForHealth())) throw new Error(`no backend on ${BASE}`);
    fs.mkdirSync(OUT, { recursive: true });

    for (const item of BRIEFS) {
      const surveyData = { ...BASE_SURVEY, ...item.survey };
      const plan = await fetch(`${BASE}/api/plan`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ surveyData }),
      }).then((r) => r.json());

      if (!plan.success) {
        console.log(`  SKIP ${item.id}  ${item.brief}\n       ${plan.message || plan.error}`);
        continue;
      }

      const pres = await fetch(`${BASE}/api/plan/presentation`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planSpec: plan.planSpec, surveyData }),
      }).then((r) => r.json());

      if (!pres.success || !pres.svg) {
        console.log(`  SKIP ${item.id}  presentation failed`);
        continue;
      }

      // The renderer bakes a #535f64 slate margin into every export,
      // because the studio is a dark table. These plans are shown on
      // white paper, so that margin has to go - it is one background
      // rect, not part of the drawing.
      const onPaper = pres.svg.replace(
        /<rect width="100%" height="100%" fill="#535f64"\s*\/>/i,
        '<rect width="100%" height="100%" fill="#FFFFFF"/>');

      // Zone the furniture in a real browser: getBBox() is exact, and
      // reimplementing it over arbitrary path data would not be.
      const page = await browser.newPage();
      await page.setContent(
        `<!doctype html><meta charset="utf-8"><style>html,body{margin:0}svg{width:1400px;height:auto}</style>${onPaper}`,
        { waitUntil: 'load' });
      const zoned = await page.evaluate(({ bathSrc, bedSrc }) => {
        const bath = new RegExp(bathSrc, 'i');
        const bed = new RegExp(bedSrc, 'i');
        const svg = document.querySelector('svg');
        const centre = (el) => { const b = el.getBBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };

        // Room labels are the only place room identity survives. Their
        // own bbox centre is effectively the room centre.
        const labels = [...svg.querySelectorAll('text')]
          .map((t) => ({ name: (t.textContent || '').trim(), ...centre(t) }))
          .filter((l) => /^[A-Z][A-Z0-9 ]{2,24}$/.test(l.name) && !/^LEVEL|^TO L\d/.test(l.name));

        const counts = { common: 0, bed: 0, bath: 0 };
        for (const g of svg.querySelectorAll('g.rendered-furniture')) {
          let best = null, bestD = Infinity;
          const c = centre(g);
          for (const l of labels) {
            const d = (l.x - c.x) ** 2 + (l.y - c.y) ** 2;
            if (d < bestD) { bestD = d; best = l; }
          }
          const name = best ? best.name : '';
          const zone = bath.test(name) ? 'bath' : bed.test(name) ? 'bed' : 'common';
          g.setAttribute('data-zone', zone);
          counts[zone]++;
        }
        return { svg: svg.outerHTML, counts, labels: labels.length };
      }, { bathSrc: BATH.source, bedSrc: BED.source });
      await page.close();

      const file = `plan-${item.id}.svg`;
      fs.writeFileSync(path.join(OUT, file), zoned.svg, 'utf8');

      // The same presentation call already returns the four elevations.
      // They are deterministic engine output - unlike the Gemini exterior
      // render, which needs an API key - so they can be baked per plan.
      const elevations = [];
      for (const [key, side] of [['frontSvg', 'front'], ['rearSvg', 'rear'],
                                 ['leftSvg', 'left'], ['rightSvg', 'right']]) {
        const svgText = pres.elevations && pres.elevations[key];
        if (!svgText) continue;
        const name = `plan-${item.id}-${side}.svg`;
        fs.writeFileSync(path.join(OUT, name), svgText, 'utf8');
        elevations.push({ side, file: name });
      }

      // Aspect ratio decides which plans a given viewport can show
      // whole. A two-storey is drawn as two sheets side by side and is
      // close to 2.4:1; a bungalow is nearer square. Nothing is ever
      // rotated to fit - rotating a plan rotates its room labels and
      // dimension strings with it, which makes the drawing unreadable
      // and the dimensions wrong.
      const vb = (zoned.svg.match(/viewBox="([^"]+)"/) || [])[1] || '';
      const parts = vb.trim().split(/\s+/).map(Number);
      const ratio = parts.length === 4 && parts[3] ? +(parts[2] / parts[3]).toFixed(3) : null;

      manifest.push({ id: item.id, brief: item.brief, file, ratio, zones: zoned.counts, elevations });
      console.log(`  ok   ${item.id}  ${item.brief}`);
      console.log(`       ${(zoned.svg.length / 1024).toFixed(0)} kB  rooms ${zoned.labels}  ` +
        `common ${zoned.counts.common} / bed ${zoned.counts.bed} / bath ${zoned.counts.bath}` +
        `  elevations ${elevations.length}`);
    }

    fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    console.log(`\n${manifest.length}/${BRIEFS.length} plans written to frontend/public/demo/`);
    process.exitCode = manifest.length ? 0 : 1;
  } finally {
    await browser.close();
    if (server) server.kill();
  }
})().catch((err) => { console.error(err); process.exit(1); });
