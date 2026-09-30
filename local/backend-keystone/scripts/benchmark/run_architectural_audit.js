'use strict';

// Exercise the same handler used by the website, without writing test plans to
// the production gallery. Saves every survey, response and SVG for review.
delete process.env.GCS_BUCKET_NAME;
const fs = require('node:fs');
const path = require('node:path');
const { SIZE_BAND_MATRIX } = require('./sizeBandMatrix');
const handler = require('../../api/plan');
const { normalizeBrief } = require('../../lib/tile/normalizeBrief');
const { validateOpeningGeometry } = require('../../lib/openingGeometry');
const { validateStairGeometry } = require('../../lib/residential/v2/validators/stairGeometryValidator');
const { validatePlanSpec } = require('../../lib/validatePlan');
const { validateConnectivity } = require('../../lib/validateConnectivity');

const base = { ...SIZE_BAND_MATRIX.find(b => b.areaSqFt === 2400).scenarios[0].surveyData, features: '1 Study' };
const variants = [
  ['default', {}], ['north', { frontFacing: 'North' }], ['east', { frontFacing: 'East' }], ['west', { frontFacing: 'West' }],
  ['l-shape', { shape: 'L-Shaped', totalArea: '3000' }], ['t-shape', { shape: 'T-Shaped', totalArea: '3000' }],
  ['closed', { openConcept: 'Traditional (Separate Rooms)' }], ['central-kitchen', { kitchenPlacement: 'Central Kitchen' }],
  ['main-primary', { masterLocation: 'Level 1 (Main)' }], ['upper-laundry', { laundryLocation: 'Level 2 (near bedrooms)' }],
  ['wide', { accessibilityNeeds: 'Wide doorways' }], ['tall', { ceilingHeight: 'High (10 ft)' }],
  ['privacy', { naturalLight: 'Privacy first (fewer windows)' }], ['maximum-glazing', { naturalLight: 'Maximum glazing' }],
  ['outdoor', { indoorOutdoor: 'Maximum (open to outdoors)' }],
  ['wide-two-bed-study', { bedrooms: '2 Bed', bathrooms: '2 Bath', accessibilityNeeds: 'Wide doorways' }],
  ['wide-west-glazing', { features: '', frontFacing: 'West', naturalLight: 'Maximum glazing', indoorOutdoor: 'Maximum (open to outdoors)', accessibilityNeeds: 'Wide doorways' }],
  ['compact-gym', { totalArea: '1800', bedrooms: '2 Bed', bathrooms: '2 Bath', features: '1 Gym' }],
  ['compact-three-bed', { totalArea: '1800', bedrooms: '3 Bed', bathrooms: '3 Bath', features: '' }],
  ['compact-study', { totalArea: '1800', bedrooms: '2 Bed', bathrooms: '3 Bath', features: '1 Study' }],
  ['compact-library', { totalArea: '1800', bedrooms: '3 Bed', bathrooms: '3 Bath', features: '1 Library' }],
  ['four-bed', { totalArea: '3200', bedrooms: '4 Bed', bathrooms: '3 Bath', features: '' }],
  ['four-bed-compact', { totalArea: '2600', bedrooms: '4 Bed', bathrooms: '3 Bath', garage: 'No Garage', features: '' }],
  ['one-story-four-bed', { totalArea: '2400', stories: '1 Story', bedrooms: '4 Bed', bathrooms: '3 Bath', garage: 'No Garage', masterLocation: 'Level 1 (Main)', features: '' }],
  ['one-story-five-bed', { totalArea: '3000', stories: '1 Story', bedrooms: '5 Bed', bathrooms: '3 Bath', masterLocation: 'Level 1 (Main)', features: '' }],
  ['two-car', { totalArea: '3200', garage: '2 Car Garage', features: '' }],
  ['freeform-resize', { freeformWishes: 'resize kitchen to 14x16' }],
  ['impossible-freeform', { freeformWishes: 'resize kitchen to 40x40' }],
];

function invoke(surveyData) {
  return new Promise((resolve, reject) => {
    const res = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ status: this.statusCode, body }); return this; },
      send(body) { resolve({ status: this.statusCode, body }); return this; } };
    Promise.resolve(handler({ method: 'POST', headers: {}, body: { surveyData, chatHistory: [] } }, res)).catch(reject);
  });
}

function auditPlan(plan, surveyData) {
  const brief = normalizeBrief(surveyData);
  return [...new Set([
    ...validatePlanSpec(plan, surveyData, brief),
    ...validateConnectivity(plan, surveyData),
    ...plan.levels.flatMap(validateOpeningGeometry),
    ...validateStairGeometry(plan),
  ])];
}

async function main() {
  const output = path.resolve(process.argv[2] || '../tmp/architectural-audit');
  fs.mkdirSync(output, { recursive: true });
  const cases = [...SIZE_BAND_MATRIX.flatMap(b => b.scenarios.map(s => [`${b.areaSqFt}-${s.id}`, s.surveyData])),
    ...variants.map(([id, overrides]) => [id, { ...base, ...overrides }])];
  const results = [];
  for (const [id, surveyData] of cases) {
    const start = Date.now();
    const response = await invoke(surveyData);
    const { body } = response;
    const options = body.success ? [body, ...(body.alternatives || [])] : [];
    const auditErrors = options.flatMap((option, index) => auditPlan(option.planSpec, surveyData).map(error => `option ${index + 1}: ${error}`));
    for (const [index, option] of options.entries()) if (option.svg) fs.writeFileSync(path.join(output, `${id}-${index + 1}.svg`), option.svg);
    fs.writeFileSync(path.join(output, `${id}.json`), JSON.stringify({ surveyData, ...response, auditErrors }, null, 2));
    const item = { id, status: response.status, success: body.success, engine: body.engine?.generatorId,
      options: options.length, auditErrors, milliseconds: Date.now() - start,
      message: body.message, surveyFulfillment: body.planSpec?.surveyFulfillment };
    results.push(item);
    console.log(JSON.stringify(item));
    fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(results, null, 2));
  }
  const escape = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rows = results.map(r => `<tr><td><a href="${r.id}.json">${escape(r.id)}</a></td><td>${r.status}</td><td>${escape(r.engine)}</td><td>${r.auditErrors.length}</td><td>${Array.from({ length: r.options }, (_, i) => `<a href="${r.id}-${i+1}.svg">Option ${i+1}</a>`).join(' · ') || escape(r.message)}</td></tr>`).join('\n');
  fs.writeFileSync(path.join(output, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><title>Keystone architectural audit</title><style>body{font:16px system-ui;margin:3rem;max-width:1400px;background:#faf9f6;color:#222}table{border-collapse:collapse;width:100%}th,td{padding:12px;border-bottom:1px solid #ccc;text-align:left}a{color:#164b74}p{max-width:900px;line-height:1.6}</style><h1>Keystone survey and geometry audit</h1><p>${results.length} surveys; ${results.filter(r=>r.success).length} generated; ${results.reduce((n,r)=>n+r.options,0)} options checked. Each link opens the exact returned geometry. Rejected cases are recorded explicitly. Passing these software checks is not a construction or code certification.</p><table><thead><tr><th>Survey</th><th>HTTP</th><th>Engine</th><th>Audit errors</th><th>Plans / rejection</th></tr></thead><tbody>${rows}</tbody></table></html>`);
  if (results.some(r => r.auditErrors.length)) process.exitCode = 1;
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { auditPlan, invoke };
