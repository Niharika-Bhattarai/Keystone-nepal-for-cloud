'use strict';

// One-time historical capture. Never regenerate this baseline from newer results.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const http = read('tmp/stairs-committed-http-20260924.json');
const survey = read('tmp/stairs-committed-survey-20260924/report.json');
const expectedHash = '38cb5ada13d2ed792d7023c789bdbaf161b38d7d1d444a2493f52e137bfe22fb';
const digest = createHash('sha256').update(JSON.stringify(http.results.map(r => r.surveyData))).digest('hex');
if (digest !== expectedHash || http.gridSha256 !== expectedHash) throw new Error('Historical grid changed');
const compact = (r, id, input) => ({ id, survey: input, observed: {
  status: r.status, options: r.options, valid: r.valid ?? (r.options > 0 && r.errors.length === 0),
  threeDistinct: r.threeDistinct ?? (r.options >= 3 && r.diversityValid === true),
  preflight: r.preflight ?? null, blockers: r.blockers, errors: r.errors,
} });
const baseline = {
  schemaVersion: 1, historicalOnly: true,
  provenance: { backendCommit: '9f08f372933d442c2b0aafc0c6776c271522f671',
    frontendCommit: 'e1561cc52af16d9518c93811ed6760ba337d7b1d',
    httpReport: { path: 'tmp/stairs-committed-http-20260924.json', date: http.date, legacyFallbackEnabled: http.legacyFallbackEnabled },
    surveyReport: { path: 'tmp/stairs-committed-survey-20260924/report.json', date: survey.date, legacyFallbackEnabled: false },
    regressionLogSha256: '5db78847b9be585c466749bb8150a7c090f27bfac8a17420d754975983d44023',
    note: 'Historical reports did not record Node version or command; do not infer them from the capture environment.' },
  gridId: http.gridId, gridSha256: digest,
  structure: http.results.map((r, i) => compact(r, `structure-${String(i + 1).padStart(3, '0')}`, r.surveyData)),
  survey: survey.results.map(r => compact(r, r.id, r.survey)),
};
const gapIds = new Set(['front-kitchen', 'l-shape', 't-shape', 'primary-downstairs', 'square', 'deck', 'small-lot']);
const gaps = { schemaVersion: 1, sourceBaseline: 'baseline-20260924.json',
  note: 'Observed outcomes are historical, not assertions that bugs must persist. Track improvement without deleting cases.',
  cases: [
    ...baseline.structure.filter(r => r.survey.totalArea === '1800' && r.survey.stories === '2 Stories' && r.survey.garage === '2 Car Garage' && ['2 Bed', '3 Bed'].includes(r.survey.bedrooms))
      .map(r => ({ ...r, id: `compact-two-car-${r.survey.bedrooms[0]}-bed`, sourceId: r.id })),
    ...baseline.survey.filter(r => gapIds.has(r.id)),
  ] };
if (gaps.cases.length !== 9) throw new Error(`Expected 9 gaps, got ${gaps.cases.length}`);
const destination = path.join(root, 'backend/test/fixtures/coverage');
fs.mkdirSync(destination, { recursive: true });
for (const [name, data] of [['baseline-20260924.json', baseline], ['known-gaps.json', gaps]]) {
  fs.writeFileSync(path.join(destination, name), JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
}
console.log(JSON.stringify({ gridSha256: digest, structure: baseline.structure.length, survey: baseline.survey.length, gaps: gaps.cases.length }));
