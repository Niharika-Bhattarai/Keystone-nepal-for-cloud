'use strict';
/**
 * Frontend migration gate.
 *
 * Captures a reproducible fingerprint of the rendered site: full-page
 * screenshots plus, for every element that carries a class, the computed value
 * of the CSS properties Tailwind actually drives. Run it once against the
 * current CDN build, then again after the Vite/Tailwind migration and diff.
 *
 *   node scripts/frontend-baseline.js --out tmp/frontend-baseline/before
 *   node scripts/frontend-baseline.js --out tmp/frontend-baseline/after
 *   node scripts/frontend-baseline.js --compare tmp/frontend-baseline/before tmp/frontend-baseline/after
 *
 * Canvases are hidden during capture: the page runs 13 unthrottled rAF loops
 * whose output is non-deterministic frame to frame. Everything else is stable.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');

const ROUTES = ['/', '/case-study', '/how-floor-plans-work', '/b2b-workflow', '/roadmap', '/pricing', '/faq', '/privacy', '/terms'];
const WIDTHS = [390, 768, 1600];

// The properties Tailwind drives, and that the v3 -> v4 renames silently change.
const PROPS = [
  'display', 'position', 'color', 'background-color', 'opacity',
  'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-transform',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-color', 'border-top-style', 'border-radius',
  'box-shadow', 'backdrop-filter', 'filter',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'gap', 'flex-direction', 'align-items', 'justify-content', 'grid-template-columns',
  'width', 'height', 'max-width', 'min-height', 'overflow',
];

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1];
}

// Runs in the page. Identity is an element's position in the tree, so it stays
// stable across a rebuild that changes nothing but the stylesheet.
function fingerprint(props) {
  const out = [];
  const classSet = new Set();
  const walk = (el, pathStr) => {
    const cls = typeof el.className === 'string' ? el.className.trim() : '';
    if (cls) {
      cls.split(/\s+/).forEach((c) => classSet.add(c));
      const cs = getComputedStyle(el);
      const styles = {};
      for (const p of props) styles[p] = cs.getPropertyValue(p);
      out.push({ path: pathStr, tag: el.tagName.toLowerCase(), classes: cls.split(/\s+/).sort().join(' '), styles });
    }
    let i = 0;
    for (const child of el.children) {
      walk(child, pathStr + '/' + child.tagName.toLowerCase() + '[' + i + ']');
      i++;
    }
  };
  walk(document.body, 'body');
  return { elements: out, classes: [...classSet].sort() };
}

const FREEZE_CSS = [
  'canvas { visibility: hidden !important; }',
  '*, *::before, *::after { animation-play-state: paused !important; }',
].join('\n');

async function capture(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const port = 8095;
  const base = 'http://localhost:' + port;
  const server = spawn(process.execPath, ['backend/server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), VALID_PASSKEYS: 'local-baseline', UNLOCK_TOKEN_SECRET: 'local-baseline' },
    windowsHide: true,
    stdio: 'ignore',
  });

  let browser;
  const summary = { capturedAt: new Date().toISOString(), routes: {}, allClasses: [] };
  const allClasses = new Set();

  try {
    for (let i = 0; i < 80; i++) {
      if (await fetch(base + '/health').then((r) => r.ok).catch(() => false)) break;
      await new Promise((r) => setTimeout(r, 250));
    }

    // Matches scripts/test-render-experience.js: use installed Edge rather than
    // a downloaded Playwright browser, so this needs no extra install step.
    browser = await chromium.launch({ channel: 'msedge', headless: true });

    for (const width of WIDTHS) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        deviceScaleFactor: 1,
        reducedMotion: 'reduce',
      });
      for (const route of ROUTES) {
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(String((e && e.message) || e)));

        await page.goto(base + route, { waitUntil: 'networkidle' });
        await page.addStyleTag({ content: FREEZE_CSS });
        await page.waitForTimeout(1200);

        const slug = (route === '/' ? 'home' : route.replace(/\//g, '')) + '-' + width;
        await page.screenshot({ path: path.join(outDir, slug + '.png'), fullPage: true });

        const fp = await page.evaluate(fingerprint, PROPS);
        fp.classes.forEach((c) => allClasses.add(c));
        fs.writeFileSync(path.join(outDir, slug + '.json'), JSON.stringify(fp));

        summary.routes[slug] = { route, width, elements: fp.elements.length, classes: fp.classes.length, pageErrors: errors };
        console.log(
          slug.padEnd(30) +
            String(fp.elements.length).padStart(5) + ' elements  ' +
            String(fp.classes.length).padStart(4) + ' classes  ' +
            errors.length + ' pageerrors'
        );
        await page.close();
      }
      await context.close();
    }

    summary.allClasses = [...allClasses].sort();
    fs.writeFileSync(path.join(outDir, '_summary.json'), JSON.stringify(summary, null, 2));
    console.log('\nunique classes across the whole site: ' + summary.allClasses.length);
    console.log('written to ' + outDir);
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}

function compare(beforeDir, afterDir) {
  const load = (d) => JSON.parse(fs.readFileSync(path.join(d, '_summary.json'), 'utf8'));
  const a = load(beforeDir);
  const b = load(afterDir);

  const lost = a.allClasses.filter((c) => !b.allClasses.includes(c));
  const added = b.allClasses.filter((c) => !a.allClasses.includes(c));
  console.log('classes: ' + a.allClasses.length + ' -> ' + b.allClasses.length + '   lost ' + lost.length + '   added ' + added.length);
  if (lost.length) console.log('  LOST: ' + lost.join(' '));

  let drifted = 0;
  let checked = 0;
  let missing = 0;
  for (const slug of Object.keys(a.routes)) {
    const fb = path.join(afterDir, slug + '.json');
    if (!fs.existsSync(fb)) {
      console.log('  MISSING capture: ' + slug);
      missing++;
      continue;
    }
    const ea = JSON.parse(fs.readFileSync(path.join(beforeDir, slug + '.json'), 'utf8')).elements;
    const eb = JSON.parse(fs.readFileSync(fb, 'utf8')).elements;
    const mb = new Map(eb.map((e) => [e.path, e]));
    for (const el of ea) {
      const other = mb.get(el.path);
      if (!other) continue;
      checked++;
      for (const p of PROPS) {
        if (el.styles[p] !== other.styles[p]) {
          if (drifted < 60) {
            console.log('  DRIFT ' + slug + ' ' + el.path + ' [' + el.classes + '] ' + p + ': "' + el.styles[p] + '" -> "' + other.styles[p] + '"');
          }
          drifted++;
          break;
        }
      }
    }
  }
  console.log('\nelements compared: ' + checked + '   drifted: ' + drifted + '   missing captures: ' + missing);
  process.exitCode = lost.length || drifted || missing ? 1 : 0;
}

const cmp = process.argv.indexOf('--compare');
if (cmp !== -1) {
  compare(process.argv[cmp + 1], process.argv[cmp + 2]);
} else {
  capture(path.resolve(root, arg('--out') || 'tmp/frontend-baseline/before')).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
