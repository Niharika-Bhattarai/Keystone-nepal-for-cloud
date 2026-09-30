'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'tmp/render-quality');
fs.mkdirSync(output, { recursive: true });

(async () => {
  const port = 8093;
  const base = `http://localhost:${port}`;
  const server = spawn(process.execPath, ['backend/server.js'], {
    cwd: root, env: { ...process.env, PORT: String(port), VALID_PASSKEYS: 'local-render-test-only', UNLOCK_TOKEN_SECRET: 'local-render-test-only' },
    windowsHide: true, stdio: 'ignore',
  });
  let browser;
  try {
    for (let attempt = 0; attempt < 60; attempt++) {
      if (await fetch(`${base}/health`).then(r => r.ok).catch(() => false)) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    const surveyData = { totalArea: '2400', stories: '2 Stories', bedrooms: '3 Bed', bathrooms: '3 Bath', privateBaths: '1',
      shape: 'Rectangular', garage: '1 Car Garage', materials: 'Modern Farmhouse (Board & Batten)',
      openConcept: 'Open Concept (Combined)', masterLocation: 'Level 2 (Upper)', kitchenPlacement: 'Rear of House',
      features: '1 Study', frontFacing: 'South', lotContext: 'Rural acreage', laundryLocation: 'Level 1 (near garage/mud)',
      ceilingHeight: 'Standard (9 ft)', indoorOutdoor: 'Moderate (some connection)', naturalLight: 'Balanced windows',
      accessibilityNeeds: 'None', budgetTier: 'Mid ($200-300/sqft)', freeformWishes: '', finishOverrides: { exteriorSiding: 'Stone' },
    };
    const body = await fetch(`${base}/api/plan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ surveyData }) }).then(r => r.json());
    assert.ok(body.success, body.message);
    const presentation = await fetch(`${base}/api/plan/presentation`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ planSpec: body.planSpec, surveyData }) });
    assert.equal(presentation.status, 200, 'rendered plan and elevations are available without credentials');
    const result = await presentation.json();
    assert.equal(result.elevations.meta.presentationStyle, 'rendered');
    for (const key of ['frontSvg', 'rearSvg', 'leftSvg', 'rightSvg']) {
      assert.match(result.elevations[key], /rendered-elevation/);
      fs.writeFileSync(path.join(output, `rendered-${key}.svg`), result.elevations[key]);
    }
    const paid = await fetch(`${base}/api/render`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(paid.status, 401, 'AI exterior generation still requires access');
    const unlocked = await fetch(`${base}/api/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passkey: 'local-render-test-only' }) }).then(r => r.json());
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ body, surveyData }) => {
      if (localStorage.getItem('keystone_studio_session')) return;
      localStorage.setItem('keystone_studio_session', JSON.stringify({ version: 1, status: 'plan-ready', formData: surveyData,
        planSpec: body.planSpec, planSvg: body.svg, footprintInfo: body.footprintInfo }));
    }, { body, surveyData });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('keystone:open-studio')));
    await page.locator('.presentation-plan-svg .rendered-plan').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Rendered', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('svg.rendered-elevation').count(), 4);
    // Elevations, the plan summary and the estimate now sit behind
    // collapsed <details> drawers, so the studio opens on the drawing
    // instead of several screens of panels. Open them before asserting on
    // their contents.
    async function openDrawers() {
      await page.evaluate(() => {
        document.querySelectorAll('.studio-drawer').forEach((d) => { d.open = true; });
      });
      await page.waitForTimeout(150);
    }
    await openDrawers();

    const renderedFrontSrc = await page.getByAltText('Front elevation', { exact: true }).getAttribute('src');
    assert.ok(decodeURIComponent(renderedFrontSrc).includes('rendered-elevation'));
    // The five exports moved out of a six-pill bar above the drawing and
    // behind one Download disclosure, so each download opens the menu first.
    async function download(name, filename) {
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      await page.getByRole('menuitem', { name, exact: true }).click();
      const file = await pending; const target = path.join(output, filename);
      await file.saveAs(target);
      const data = fs.readFileSync(target);
      const size = { width: data.readUInt32BE(16), height: data.readUInt32BE(20), bytes: data.length };
      assert.equal(Math.max(size.width, size.height), 6000);
      console.log(`${filename}: ${JSON.stringify(size)}`);
      return size;
    }
    await download('Download elevations PNG', 'rendered-elevations-6k.png');
    await page.getByAltText('Front elevation', { exact: true }).screenshot({ path: path.join(output, 'rendered-front-preview.png') });
    await page.getByRole('button', { name: 'Normal', exact: true }).click();
    const normalSize = await download('Download floor plan PNG', 'normal-6k.png');
    await download('Download elevations PNG', 'elevations-6k.png');
    assert.equal(await page.locator('svg.rendered-elevation').count(), 0);
    assert.notEqual(await page.getByAltText('Front elevation', { exact: true }).getAttribute('src'), renderedFrontSrc);
    await page.getByRole('button', { name: 'Rendered', exact: true }).click();
    await page.locator('.presentation-plan-svg .rendered-plan').waitFor();
    const renderedSize = await download('Download floor plan PNG', 'rendered-6k.png');
    assert.equal(renderedSize.width, normalSize.width); assert.equal(renderedSize.height, normalSize.height);
    await page.getByLabel('Room details', { exact: true }).uncheck();
    assert.equal(await page.locator('.presentation-plan-svg .rendered-labels').first().isVisible(), false);
    await page.locator('.presentation-plan-svg').screenshot({ path: path.join(output, 'rendered-preview.png') });
    await page.getByRole('button', { name: 'Normal', exact: true }).click();
    await page.locator('.presentation-plan-svg .normal-plan').waitFor();
    await page.getByRole('button', { name: 'Rear elevation view', exact: true }).click();
    await page.getByRole('button', { name: 'Rendered', exact: true }).click();
    await page.getByAltText('Rear elevation', { exact: true }).waitFor();
    assert.ok(decodeURIComponent(await page.getByAltText('Rear elevation', { exact: true }).getAttribute('src')).includes('rendered-elevation'));

    await page.evaluate(u => localStorage.setItem('keystone_unlock', JSON.stringify(u)), unlocked);
    await page.reload({ waitUntil: 'networkidle' });
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('keystone:open-studio')));
    await openDrawers();
    await page.locator('.presentation-plan-svg .rendered-plan').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Rendered', exact: true }).getAttribute('aria-pressed'), 'true');

    const renderPayloads = [];
    await page.route('**/api/render', async route => {
      renderPayloads.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true,
        image: `data:image/png;base64,${fs.readFileSync(path.join(output, 'rendered-preview.png')).toString('base64')}` }) });
    });
    await page.getByRole('button', { name: 'Generate Exterior Render', exact: true }).first().click();
    await page.getByText('From your floor-plan survey', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Rural', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.getByRole('button', { name: 'Open rural edge', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.getByLabel('Render exterior siding').inputValue(), 'Stone');
    assert.equal(await page.getByLabel('Render roof finish').inputValue(), 'Standing seam metal');
    await page.getByRole('button', { name: 'Night', exact: true }).click();
    await page.getByRole('button', { name: 'Reset to floor-plan survey', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Midday', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: 'Night', exact: true }).click();
    await page.getByLabel('Render exterior siding').selectOption('Brick');
    await page.getByText('From your floor-plan survey', { exact: true }).screenshot({ path: path.join(output, 'survey-summary.png') });
    // Last matching button belongs to the options modal.
    await page.getByRole('button', { name: 'Generate Exterior Render', exact: true }).last().click();
    await page.getByRole('button', { name: 'Exterior Render Options', exact: true }).waitFor();
    assert.equal(renderPayloads.length, 1);
    assert.deepEqual(renderPayloads[0].renderSurveyData, { version: 2, overrides: { timeOfDay: 'Night', exteriorSiding: 'Brick' } });
    assert.equal(renderPayloads[0].surveyData.finishOverrides.exteriorSiding, 'Stone');
    assert.deepEqual(renderPayloads[0].planSpec.levels, body.planSpec.levels);
    assert.deepEqual(renderPayloads[0].planSpec.elevations, body.planSpec.elevations, '3D input keeps the normal technical reference set');
    await page.getByRole('button', { name: 'Close zoomed plan' }).click();
    await page.getByRole('button', { name: 'Exterior Render Options', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Night', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.getByLabel('Render exterior siding').inputValue(), 'Brick');
    await page.screenshot({ path: path.join(output, 'render-options.png') });
    await page.getByRole('button', { name: 'Close render options' }).click();
    await page.reload({ waitUntil: 'networkidle' });
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('keystone:open-studio')));
    await openDrawers();
    await page.getByRole('button', { name: 'Generate Exterior Render', exact: true }).first().click();
    assert.equal(await page.getByRole('button', { name: 'Night', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.getByLabel('Render exterior siding').inputValue(), 'Brick');
    await page.keyboard.press('Escape');
    await page.getByRole('dialog', { name: '3D Render Options' }).waitFor({ state: 'hidden' });
    await page.route('**/api/plan/presentation', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Test presentation unavailable.' }) }));
    await page.reload({ waitUntil: 'networkidle' });
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('keystone:open-studio')));
    await openDrawers();
    await page.getByRole('alert').filter({ hasText: 'Showing normal views' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Normal', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.unroute('**/api/plan/presentation');
    await page.getByRole('button', { name: 'Rendered', exact: true }).click();
    await page.locator('.presentation-plan-svg .rendered-plan').waitFor();
    // Exercise the generated SVG for every previously audited successful shape/level case.
    const auditDir = path.join(root, 'tmp/architectural-audit-final');
    let cases = 0;
    if (fs.existsSync(auditDir)) {
      for (const file of fs.readdirSync(auditDir).filter(name => name.endsWith('.json'))) {
        const f = JSON.parse(fs.readFileSync(path.join(auditDir, file), 'utf8'));
        if (!f.body?.success || !f.body.planSpec) continue;
        const before = JSON.stringify(f.body.planSpec);
        const svg = require('../backend/lib/renderPlanSvg').renderPlanSvg(f.body.planSpec, { style: 'rendered' });
        const elevations = require('../backend/lib/renderedElevationStyles').renderElevationPresentations(f.body.planSpec, f.surveyData);
        assert.equal(JSON.stringify(f.body.planSpec), before);
        const invalid = await page.evaluate(svgs => svgs.map(svg => new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('parsererror')?.textContent).find(Boolean),
          [svg, elevations.frontSvg, elevations.rearSvg, elevations.leftSvg, elevations.rightSvg]);
        assert.ok(!invalid, `${file}: ${invalid}`); cases++;
      }
    }
    assert.deepEqual(errors, []);
    console.log(`PASS: downloads, rendered-by-default/free views, all four elevations, normal toggle, retained elevation selection, failure/retry, labels, AI access, survey prefill/reset/override persistence, unchanged 3D geometry; ${cases} audited plan/elevation sets rendered without mutation. Exterior generation mocked.`);
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
