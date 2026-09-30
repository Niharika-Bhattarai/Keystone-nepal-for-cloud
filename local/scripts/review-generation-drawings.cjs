'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../frontend/node_modules/playwright');
const { base } = require('../backend/scripts/benchmark/generation-coverage');
const { invoke } = require('../backend/scripts/benchmark/survey-delivery-audit');

async function main() {
  process.env.V2_DISABLE_LEGACY_FALLBACK = 'true';
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-drawing-review`;
  const out = path.resolve(process.argv[2] || path.join(__dirname, '../tmp/universal-coverage', runId));
  fs.mkdirSync(out, { recursive: true });
  const cases = [
    ['default', {}], ['front-kitchen', { kitchenPlacement:'Front of House' }],
    ['north', { frontFacing:'North' }], ['east', { frontFacing:'East' }],
    ['west', { frontFacing:'West' }], ['sliding-opening', { indoorOutdoor:'Maximum (open to outdoors)' }],
    ['wide-doors', { accessibilityNeeds:'Wide doorways' }],
    ['compact-four-bedroom', { totalArea:'1800', stories:'1 Story', bedrooms:'4 Bed', garage:'None', masterLocation:'Level 1 (Main)' }],
    ['study-and-gym', { totalArea:'3200', features:'1 Study, 1 Gym' }],
    ['l-shape', { totalArea:'3200', shape:'L-Shaped' }],
    ['t-shape', { totalArea:'3200', shape:'T-Shaped' }],
    ['closed-rooms', { openConcept:'Traditional (Separate Rooms)' }],
  ];
  const browser = await chromium.launch({ channel:'msedge', headless:true });
  const page = await browser.newPage({ viewport:{ width:1600, height:1200 } });
  const results = [];
  try {
    for (const [id, patch] of cases) {
      const surveyData = { ...base, ...patch };
      const { status, body } = await invoke(surveyData);
      if (status !== 200) throw new Error(`${id}: HTTP ${status}`);
      fs.writeFileSync(path.join(out, `${id}.json`), JSON.stringify({ surveyData, planSpec:body.planSpec }, null, 2));
      const elevations = ['front','rear','left','right'].map(view => `<figure><figcaption>${view}</figcaption>${body.elevations[`${view}Svg`]}</figure>`).join('');
      const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{font:16px system-ui;margin:24px;color:#242424;background:#f5f2ec}main{display:grid;grid-template-columns:2fr 1fr;gap:24px}svg{width:100%;height:auto;background:white}figure{margin:0 0 16px}h1{font-size:22px}</style></head><body><h1>${id}</h1><main><div>${body.svg}</div><aside>${elevations}</aside></main></body></html>`;
      fs.writeFileSync(path.join(out, `${id}.html`), html);
      await page.setContent(html);
      await page.screenshot({ path:path.join(out, `${id}.png`), fullPage:true });
      results.push({ id, options:1 + body.alternatives.length, diversityValid:body.diversityMetrics.valid });
      console.log(`${id}: saved plan and four elevations`);
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ date:new Date().toISOString(), scope:'Review artifacts; creating screenshots does not approve their architecture', results }, null, 2));
  fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><title>Drawing review</title></head><body><h1>Drawing review</h1>${results.map(row => `<section><h2><a href="${row.id}.html">${row.id}</a></h2><img src="${row.id}.png" style="width:100%" alt="${row.id}"></section>`).join('')}</body></html>`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
