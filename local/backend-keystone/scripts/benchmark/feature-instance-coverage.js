'use strict';
// Local production handlers, original-survey validation and corrected diversity.
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
const out = path.resolve(process.argv[2] || path.join(backend, '../tmp/universal-coverage',
  `${new Date().toISOString().replace(/[:.]/g, '-')}-feature-instance-audit`));
const bedroomConfigs = [{ privateBath: 'Yes', closet: 'Walk-in' },
  { privateBath: 'No', closet: 'Standard' }, { privateBath: 'No', closet: 'Standard' }];
const common = { ...base, totalArea: '3000', bedroomConfigs };
const cases = [
  ...['South', 'North', 'East', 'West'].map(frontFacing => ({ name: `two-studies-${frontFacing}`, survey: { ...common, features: '2 Studies', frontFacing } })),
  { name: 'two-studies-no-garage', survey: { ...common, features: '2 Studies', garage: 'None' } },
  { name: 'two-studies-wide-doors', survey: { ...common, features: '2 Studies', accessibilityNeeds: 'Wide doorways' } },
  { name: 'study-and-office', survey: { ...common, features: '1 Study, 1 Home Office' } },
  { name: 'old-picker-alias', survey: { ...common, surveyVersion: 1, features: '1 Study, 1 Home Office' } },
  { name: 'two-libraries', survey: { ...common, features: '2 Libraries' } },
  { name: 'playroom', survey: { ...common, features: '1 Playroom' } },
  { name: 'gaming-room', survey: { ...common, features: '1 Gaming Room' } },
  { name: 'three-studies-gap', survey: { ...common, features: '3 Studies' } },
  { name: 'gaming-plus-playroom-gap', survey: { ...common, features: '1 Gaming Room, 1 Playroom' } },
  { name: 'unknown-feature-input', survey: { ...common, features: '1 Study, 1 Observatory' } },
];
function invoke(survey) {
  return new Promise((resolve, reject) => {
    const res = { code: 200, setHeader() {}, status(code) { this.code = code; return this; },
      json(body) { resolve({ status: this.code, body }); } };
    Promise.resolve(api({ method: 'POST', headers: {}, body: { surveyData: survey } }, res)).catch(reject);
  });
}
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const report = { startedAt: new Date().toISOString(), legacyFallback: false,
    backendHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: backend, encoding: 'utf8' }).trim(),
    sourceStatus: execFileSync('git', ['status', '--short'], { cwd: backend, encoding: 'utf8' }), sourceHashes: {}, results: [] };
  for (const rel of execFileSync('git', ['ls-files', '-co', '--exclude-standard', 'lib', 'api'], { cwd: backend, encoding: 'utf8' }).trim().split(/\r?\n/)) {
    if (fs.existsSync(path.join(backend, rel))) report.sourceHashes[rel] = crypto.createHash('sha256').update(fs.readFileSync(path.join(backend, rel))).digest('hex');
  }
  for (const { name, survey } of cases) {
    const started = Date.now(), response = await invoke(survey);
    const plans = response.body.planSpec ? [response.body.planSpec, ...(response.body.alternatives || []).map(a => a.planSpec)] : [];
    fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(response, null, 2));
    for (const [i, plan] of plans.entries()) for (const style of ['normal', 'rendered']) {
      fs.writeFileSync(path.join(out, `${name}-${i + 1}-${style}.svg`), renderPlanSvg(plan, { style }));
    }
    const result = { name, survey, status: response.status, code: response.body.code || null,
      durationMs: Date.now() - started, options: plans.length, errors: plans.map(p => validateEditedPlan(p, survey)),
      features: plans.map(p => buildSurveyFulfillment(p, survey).items.find(i => i.field === 'features')),
      diversity: compareMetrics(plans) };
    report.results.push(result);
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ name, status: result.status, options: plans.length,
      errors: result.errors.flat().length, v2DiversePairs: result.diversity.v2ValidPairs, pairs: result.diversity.pairCount }));
  }
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(out);
})().catch(error => { console.error(error); process.exitCode = 1; });
