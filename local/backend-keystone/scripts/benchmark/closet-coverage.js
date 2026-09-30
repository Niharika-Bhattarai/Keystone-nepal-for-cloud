'use strict';
// Local production-handler audit; no network, deployment or legacy fallback.
process.env.V2_DISABLE_LEGACY_FALLBACK = 'true';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { base } = require('./generation-coverage');
const api = require('../../api/plan');
const { validateEditedPlan } = require('../../lib/validateEditedPlan');
const { compareMetrics } = require('../../lib/residential/v2/diversityMetricV2');
const { renderPlanSvg } = require('../../lib/renderPlanSvg');
const { measureBedroomClosets } = require('../../lib/closetGeometry');
const backend = path.resolve(__dirname, '../..');
const out = process.argv[2] || path.resolve(backend, '../tmp/universal-coverage', `${new Date().toISOString().replace(/[:.]/g, '-')}-closet-api-audit`);
const config = (mask, count = 3, privateIndex = null) => Array.from({ length: count }, (_, i) => ({
  privateBath: i === 0 || i === privateIndex ? 'Yes' : 'No', closet: mask & (1 << i) ? 'Walk-in' : 'Standard',
}));
const cases = [
  ...Array.from({ length: 8 }, (_, mask) => ({ name: `closet-combination-${mask}`, survey: { ...base, bedroomConfigs: config(mask) } })),
  ...['North', 'East', 'West'].map(frontFacing => ({ name: `all-walk-in-${frontFacing}`, survey: { ...base, frontFacing, bedroomConfigs: config(7) } })),
  ...[1, 2].map(index => ({ name: `bedroom-${index + 1}-ensuite`, survey: { ...base, privateBaths: '2', bedroomConfigs: config(1, 3, index) } })),
  { name: 'wide-doorways', survey: { ...base, accessibilityNeeds: 'Wide doorways', bedroomConfigs: config(1) } },
  { name: 'single-storey', survey: { ...base, stories: '1 Story', garage: 'None', masterLocation: 'Level 1 (Main)', bedroomConfigs: config(1) } },
  { name: 't-garage-study', survey: { ...base, totalArea: '3000', shape: 'T-Shape', features: '1 Study', bedroomConfigs: config(1) } },
  { name: 'four-bedroom', survey: { ...base, totalArea: '3000', bedrooms: '4 Bed', bedroomConfigs: config(1, 4) } },
  { name: 'compact-all-walk-in', survey: { ...base, totalArea: '1600', bedroomConfigs: config(7) } },
];
function invoke(survey) {
  return new Promise((resolve, reject) => {
    const res = { code: 200, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { resolve({ status: this.code, body }); } };
    Promise.resolve(api({ method: 'POST', body: { surveyData: survey }, headers: {} }, res)).catch(reject);
  });
}
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const sources = execFileSync('git', ['status', '--short'], { cwd: backend, encoding: 'utf8' });
  const report = { startedAt: new Date().toISOString(), backendHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: backend, encoding: 'utf8' }).trim(),
    sourceStatus: sources, legacyFallback: false, results: [], sourceHashes: {} };
  for (const rel of ['lib/closetGeometry.js', 'lib/placeBedroomClosets.js', 'lib/furnitureGeometry.js', 'lib/placeOpenings.js',
    'lib/planFurniture.js', 'lib/renderPlanSvg.js', 'lib/residential/v2/candidateGeneration.js', 'lib/surveyRequirements.js', 'lib/surveyFulfillment.js']) {
    report.sourceHashes[rel] = crypto.createHash('sha256').update(fs.readFileSync(path.join(backend, rel))).digest('hex');
  }
  for (const { name, survey } of cases) {
    const started = Date.now(), response = await invoke(survey);
    const plans = response.body.planSpec ? [response.body.planSpec, ...(response.body.alternatives || []).map(a => a.planSpec)] : [];
    fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(response, null, 2));
    plans.forEach((p, i) => {
      fs.writeFileSync(path.join(out, `${name}-${i + 1}.svg`), renderPlanSvg(p));
      fs.writeFileSync(path.join(out, `${name}-${i + 1}-rendered.svg`), renderPlanSvg(p, { style: 'rendered' }));
    });
    const result = { name, survey, status: response.status, code: response.body.code || null, message: response.body.message || null,
      durationMs: Date.now() - started, options: plans.length, errors: plans.map(p => validateEditedPlan(p, survey)),
      closets: plans.map(p => measureBedroomClosets(p, survey)), diversity: compareMetrics(plans) };
    report.results.push(result);
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ name, status: result.status, options: plans.length, errors: result.errors.flat().length,
      v2DiversePairs: result.diversity.v2ValidPairs, pairs: result.diversity.pairCount }));
  }
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(out);
})().catch(error => { console.error(error); process.exitCode = 1; });
