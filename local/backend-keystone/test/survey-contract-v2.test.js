'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateSurveyInput } = require('../lib/briefContract');
const { SURVEY_FIELDS } = require('../lib/surveyFieldRegistry');
const { normalizeBrief } = require('../lib/tile/normalizeBrief');
const { preflightSurvey } = require('../lib/surveyPreflight');
const { base } = require('../scripts/benchmark/generation-coverage');
const { invoke } = require('../scripts/benchmark/survey-delivery-audit');
const baseline = require('./fixtures/coverage/baseline-20260924.json');

test('all retained baseline surveys pass strict numeric input validation', () => {
  for (const row of [...baseline.structure, ...baseline.survey]) assert.equal(validateSurveyInput(row.survey).valid, true, row.id);
});
test('malformed numbers never become different valid briefs in preflight or generation', async () => {
  for (const [field, value] of [
    ['totalArea', '-2400'], ['totalArea', '2400 garbage'], ['totalArea', 'Infinity'],
    ['totalArea', NaN], ['totalArea', null], ['totalArea', ''], ['totalArea', true],
    ['totalArea', 599], ['totalArea', 10001], ['bedrooms', '3.5 Bed'], ['bedrooms', '-3 Bed'],
    ['bathrooms', '3x Bath'], ['stories', '12 Stories'], ['privateBaths', 'one'],
    ['lotWidth', '-60'], ['lotDepth', '60ft'], ['outdoorArea', '801'], ['bedrooms', []],
  ]) {
    const survey = { ...base, [field]: value };
    const preflight = preflightSurvey(survey);
    assert.equal(preflight.supported, false, `${field}:${value}`);
    assert.ok(preflight.blockers.some(b => b.field === field && b.code === 'BRIEF_INVALID'));
    const result = await invoke(survey);
    assert.equal(result.status, 422);
    assert.equal(result.body.code, 'BRIEF_INVALID');
    assert.equal(result.body.planSpec, undefined);
  }
});
test('fractional area and lot dimensions survive normalization without truncation or enlargement', () => {
  const brief = normalizeBrief({ ...base, totalArea: '2400.75', lotWidth: '9.5', lotDepth: '80.25' });
  assert.equal(brief.totalAreaSqFt, 2400.75);
  assert.equal(brief.lotWidth, 9.5);
  assert.equal(brief.lotDepth, 80.25);
  assert.throws(() => normalizeBrief({ ...base, totalArea: '-2400' }), { code: 'BRIEF_INVALID', field: 'totalArea' });
});
test('v2 rejects unknown named choices and impossible bathroom budgets', () => {
  assert.equal(validateSurveyInput({ ...base, surveyVersion: 2, garage: '3 Car Garage' }).valid, false);
  assert.equal(validateSurveyInput({ ...base, privateBaths: '4' }).errors[0].code, 'PROGRAM_CONFLICT');
  assert.equal(validateSurveyInput({ ...base, outdoorLiving: 'Open deck', outdoorArea: '0' }).errors[0].field, 'outdoorArea');
});
test('ambiguous private-bath selections are rejected consistently instead of silently capped', async () => {
  const survey = { ...base, privateBaths: '2', bedroomConfigs: [
    { privateBath: 'Yes', closet: 'Walk-in' },
    { privateBath: 'Yes', closet: 'Standard' },
    { privateBath: 'Yes', closet: 'Standard' },
  ] };
  const preflight = preflightSurvey(survey);
  assert.equal(preflight.code, 'BRIEF_AMBIGUOUS');
  const result = await invoke(survey);
  assert.equal(result.status, 422);
  assert.equal(result.body.code, 'BRIEF_AMBIGUOUS');
  assert.deepEqual(result.body.diagnostics.blockers, preflight.blockers);
});
test('new serialization cannot silently route through the old room-assignment engine', async () => {
  const result = await invoke({ ...base, surveyVersion: 2 });
  assert.equal(result.status, 422);
  assert.equal(result.body.code, 'SURVEY_VERSION_NOT_IMPLEMENTED');
  assert.equal(result.body.diagnostics.classification, 'implementation_gap');
});
test('stable bedroom identities survive the actual assembled and rotated v2 delivery', async () => {
  for (const frontFacing of ['South', 'West']) {
    const result = await invoke({ ...base, frontFacing });
    assert.equal(result.status, 200);
    for (const plan of [result.body.planSpec, ...result.body.alternatives.map(o => o.planSpec)]) {
      const bedrooms = plan.levels.flatMap(l => l.rooms).filter(r => ['bedroom', 'primary_bedroom'].includes(r.type));
      assert.deepEqual(bedrooms.map(r => r.programId).sort(), ['bedroom_2', 'bedroom_3', 'primary']);
      const baths = plan.levels.flatMap(l => l.rooms).filter(r => r.attachedTo);
      assert.ok(baths.every(b => bedrooms.some(r => r.id === b.attachedTo)));
    }
  }
});
test('every current frontend default has a field-to-evidence registry entry', async () => {
  // Read real active Vite source, not the retired frontend/app.js. No React or
  // browser is needed to import this data-only module.
  const modulePath = path.resolve(__dirname, '../../frontend/src/data/survey.js');
  if (!fs.existsSync(modulePath)) return; // Backend-only Cloud Build checkout.
  const { pathToFileURL } = require('node:url');
  const { DEFAULT_FORM_DATA } = await import(pathToFileURL(modulePath).href);
  for (const field of Object.keys(DEFAULT_FORM_DATA)) assert.ok(SURVEY_FIELDS[field]?.evidence, field);
  assert.equal(validateSurveyInput(DEFAULT_FORM_DATA).valid, true);
});
