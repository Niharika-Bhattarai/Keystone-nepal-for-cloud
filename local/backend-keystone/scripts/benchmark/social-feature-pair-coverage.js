'use strict';
// Exercise production handlers with legacy disabled; retain original requests,
// independent validation, source provenance and both drawing styles.
process.env.V2_DISABLE_LEGACY_FALLBACK = 'true';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const api = require('../../api/plan');
const { base } = require('./generation-coverage');
const { validateEditedPlan } = require('../../lib/validateEditedPlan');
const { buildSurveyFulfillment } = require('../../lib/surveyFulfillment');
const { compareMetrics } = require('../../lib/residential/v2/diversityMetricV2');
const { renderPlanSvg } = require('../../lib/renderPlanSvg');
const backend = path.resolve(__dirname, '../..');
const out = path.resolve(process.argv.slice(2).find(arg => !arg.startsWith('--')) || path.join(backend, '../tmp/universal-coverage',
  `${new Date().toISOString().replace(/[:.]/g, '-')}-social-feature-pair-audit`));
const bedroomConfigs = [{ privateBath: 'Yes', closet: 'Walk-in' },
  { privateBath: 'No', closet: 'Standard' }, { privateBath: 'No', closet: 'Standard' }];
const common = { ...base, totalArea: '3200', bedroomConfigs, features: '1 Gaming Room, 1 Playroom' };
const cases = [
  ...['South', 'North', 'East', 'West'].map(frontFacing => ({ name: `pair-3200-${frontFacing}`, survey: { ...common, frontFacing } })),
  ...['3400', '3600', '4000'].map(totalArea => ({ name: `pair-${totalArea}`, survey: { ...common, totalArea } })),
  { name: 'pair-wide-doors', survey: { ...common, accessibilityNeeds: 'Wide doorways' } },
  { name: 'pair-reverse-order', survey: { ...common, features: '1 Playroom, 1 Gaming Room' } },
  { name: 'pair-standard-closets', survey: { ...common, bedroomConfigs: bedroomConfigs.map(c => ({ ...c, closet: 'Standard' })) } },
  { name: 'pair-walk-in-closets', survey: { ...common, bedroomConfigs: bedroomConfigs.map(c => ({ ...c, closet: 'Walk-in' })) } },
  { name: 'pair-3000-gap', survey: { ...common, totalArea: '3000' }, expectGap: true },
  { name: 'pair-no-garage-gap', survey: { ...common, garage: 'None' }, expectGap: true },
  { name: 'pair-T-shape-gap', survey: { ...common, shape: 'T-shape' }, expectGap: true },
  { name: 'three-features-gap', survey: { ...common, features: '1 Gaming Room, 1 Playroom, 1 Study' }, expectGap: true },
];
if (process.argv.includes('--closet-matrix')) {
  for (const frontFacing of ['South', 'North', 'East', 'West']) for (const wide of [false, true]) {
    for (let mask = 0; mask < 8; mask++) cases.push({ name: `matrix-${frontFacing}-${wide ? 'wide' : 'standard'}-${mask}`,
      survey: { ...common, frontFacing, accessibilityNeeds: wide ? 'Wide doorways' : 'None',
        bedroomConfigs: bedroomConfigs.map((config, i) => ({ ...config, closet: mask & (1 << i) ? 'Walk-in' : 'Standard' })) } });
  }
}
function invoke(survey) {
  return new Promise((resolve, reject) => {
    const res = { code: 200, setHeader() {}, status(code) { this.code = code; return this; },
      json(body) { resolve({ status: this.code, body }); } };
    Promise.resolve(api({ method: 'POST', headers: {}, body: { surveyData: survey } }, res)).catch(reject);
  });
}
function diverseTriples(metrics, count) {
  const valid = new Set(metrics.pairs.filter(p => p.v2.valid).map(p => p.pair.join(','))), triples = [];
  for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) for (let k = j + 1; k < count; k++) {
    if (valid.has(`${i},${j}`) && valid.has(`${i},${k}`) && valid.has(`${j},${k}`)) triples.push([i,j,k]);
  }
  return triples;
}
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const report = { startedAt: new Date().toISOString(), legacyFallback: false,
    backendHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: backend, encoding: 'utf8' }).trim(),
    sourceStatus: execFileSync('git', ['status', '--short'], { cwd: backend, encoding: 'utf8' }), sourceHashes: {}, results: [] };
  for (const rel of execFileSync('git', ['ls-files', '-co', '--exclude-standard', 'lib', 'api'], { cwd: backend, encoding: 'utf8' }).trim().split(/\r?\n/)) {
    if (fs.existsSync(path.join(backend, rel))) report.sourceHashes[rel] = crypto.createHash('sha256').update(fs.readFileSync(path.join(backend, rel))).digest('hex');
  }
  for (const { name, survey, expectGap = false } of cases) {
    const started = Date.now(), response = await invoke(survey);
    const plans = response.body.planSpec ? [response.body.planSpec, ...(response.body.alternatives || []).map(a => a.planSpec)] : [];
    fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(response, null, 2));
    for (const [i, plan] of plans.entries()) for (const style of ['normal', 'rendered']) {
      fs.writeFileSync(path.join(out, `${name}-${i + 1}-${style}.svg`), renderPlanSvg(plan, { style }));
    }
    const diversity = compareMetrics(plans);
    const result = { name, survey, expectGap, status: response.status, code: response.body.code || null,
      durationMs: Date.now() - started, options: plans.length, errors: plans.map(p => validateEditedPlan(p, survey)),
      features: plans.map(p => buildSurveyFulfillment(p, survey).items.find(i => i.field === 'features')),
      diversity, diverseTriples: diverseTriples(diversity, plans.length), selectionMetrics: response.body.diversityMetrics || null };
    result.passed = expectGap ? response.status === 422 && response.body.code === 'V2_FALLBACK_DISABLED' && !plans.length :
      response.status === 200 && plans.length > 0 && !result.errors.flat().length && result.features.every(f => f.status === 'satisfied');
    report.results.push(result);
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ name, status: result.status, options: plans.length, passed: result.passed,
      errors: result.errors.flat().length, diversePairs: diversity.v2ValidPairs, triples: result.diverseTriples.length }));
  }
  report.finishedAt = new Date().toISOString();
  report.passed = report.results.every(result => result.passed);
  report.diversityTargetMet = report.results.filter(result => !result.expectGap).every(result => result.diverseTriples.length > 0);
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(out);
  if (!report.passed) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
