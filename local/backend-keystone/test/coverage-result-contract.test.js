'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { structuralCases, pairwiseCases, stressCases } = require('../scripts/benchmark/universal-coverage');
const { classifyGenerationResult, summarizeCoverage } = require('../lib/generationDiagnostics');
const { validateOriginalSurveyCounts } = require('../lib/surveyRequirements');
const { assertExpectedBuild } = require('../scripts/benchmark/coverage-run-context');
test('HTTP benchmark refuses a stale or unidentified server when a build is expected', () => {
  assert.throws(()=>assertExpectedBuild({buildStamp:'old'},'this-run'),/stale/);
  assert.throws(()=>assertExpectedBuild({},'this-run'),/missing/);
  assert.doesNotThrow(()=>assertExpectedBuild({engine:{buildStamp:'this-run'}},'this-run'));
});
test('independent structural inventory includes all 2250 inputs, including unsupported sizes and bedroom counts', () => {
  const cases = structuralCases();
  assert.equal(cases.length, 2250);
  assert.equal(new Set(cases.map(r => JSON.stringify(r.survey))).size, 2250);
  for (const row of cases) {
    assert.equal(row.survey.privateBaths, row.survey.bathrooms === '1 Bath' ? '0' : '1');
    assert.ok(!(row.survey.stories === '1 Story' && row.survey.masterLocation === 'Level 2 (Upper)'));
  }
  assert.ok(cases.some(r => r.survey.totalArea === '600' && r.survey.bedrooms === '1 Bed'));
  assert.ok(cases.some(r => r.survey.totalArea === '10000' && r.survey.bathrooms === '5 Bath'));
});
test('pairwise inventory independently covers every declared categorical pair with real submitted selections', () => {
  const result = pairwiseCases();
  assert.deepEqual(result, pairwiseCases(), 'Deterministic inventory');
  const actualPairs = new Set();
  for (const row of result.cases) {
    for (let i = 0; i < result.axes.length; i++) for (let j = i + 1; j < result.axes.length; j++) {
      const a = result.axes[i], b = result.axes[j];
      actualPairs.add(`${i}:${a.values.indexOf(row.selections[a.field])}|${j}:${b.values.indexOf(row.selections[b.field])}`);
    }
    for (const axis of result.axes) {
      if (axis.field.startsWith('feature:')) assert.equal(row.survey.features.includes(`1 ${axis.field.slice(8)}`), row.selections[axis.field]);
      else assert.equal(row.survey[axis.field], row.selections[axis.field]);
    }
    assert.equal(row.survey.outdoorArea, row.survey.outdoorLiving === 'None' ? '0' : '160');
  }
  assert.equal(actualPairs.size, result.totalPairs);
  assert.ok(result.coveredPairs.every(pair => actualPairs.has(pair)));
  assert.equal(result.uncoveredPairs.length, 0);
  assert.equal(stressCases().length, 8);
});
test('a failed generator or capability limit never proves physical impossibility', () => {
  assert.equal(classifyGenerationResult({status:422,body:{code:'CAPABILITY_NOT_IMPLEMENTED'}}),'implementation_gap');
  assert.equal(classifyGenerationResult({ status: 422, body: { code: 'AREA_TOO_SMALL' } }), 'implementation_gap');
  assert.equal(classifyGenerationResult({ status: 422, body: { code: 'NO_VALID_LAYOUT' } }), 'search_exhausted');
  assert.equal(classifyGenerationResult({ status: 422, body: { code: 'V2_FALLBACK_DISABLED', diagnostics: { triedCandidateCount: 8 } } }), 'search_exhausted');
  assert.equal(classifyGenerationResult({ status: 422, body: { code: 'PROGRAM_CONFLICT' } }), 'program_conflict');
  assert.equal(classifyGenerationResult({ status: 200, options: 3, valid: false, threeDistinct: true }), 'invalid_delivery');
  assert.equal(classifyGenerationResult({ status: 200, options: 3, valid: true, threeDistinct: false }), 'option_shortfall');
});

test('concept validity cannot inflate the complete survey evidence score',()=>{
  const summary=summarizeCoverage([{valid:true,threeDistinct:true,classification:'three_valid_distinct_options',
    fulfillment:[{complete:false}],allFieldsVerified:false}]);
  assert.equal(summary.all.valid,1);
  assert.equal(summary.surveyEvidence.deliveredSetsEvaluated,1);
  assert.equal(summary.surveyEvidence.allFieldsVerified,0);
});
test('support removal does not improve the all-input score and historical witnesses remain feasible', () => {
  const rows = [
    { valid: true, threeDistinct: true, preflight: { supported: true }, classification: 'three_valid_distinct_options' },
    { valid: false, threeDistinct: false, historical: { valid: true }, preflight: { supported: true }, classification: 'search_exhausted' },
    { valid: false, threeDistinct: false, preflight: { supported: false }, classification: 'implementation_gap' },
  ];
  const before = summarizeCoverage(rows);
  rows[1].preflight.supported = false;
  const after = summarizeCoverage(rows);
  assert.deepEqual(after.all, before.all);
  assert.equal(after.all.total, 3);
  assert.equal(after.knownFeasibleByWitness.total, 2);
  assert.equal(after.provenConflict.total, 0);
});
test('independent audit catches silently changed stories and private-bedroom assignments', () => {
  const plan = { levels: [{ level: 1, rooms: [
    { id: 'primary', type: 'primary_bedroom', programId: 'primary' },
    { id: 'second', type: 'bedroom', programId: 'bedroom_2' },
    { id: 'bath', type: 'primary_bathroom', attachedTo: 'primary' },
  ] }] };
  const errors = validateOriginalSurveyCounts(plan, { stories: '2 Stories', bedrooms: '2 Bed', bathrooms: '1 Bath', privateBaths: '1', bedroomConfigs: [{ privateBath: 'No' }, { privateBath: 'Yes' }] });
  assert.ok(errors.some(e => e.includes('(stories)')));
  assert.ok(errors.some(e => e.includes('bedroomConfigs.0')));
  assert.ok(errors.some(e => e.includes('bedroomConfigs.1')));
  assert.ok(!errors.some(e => e.includes('(bedrooms)') || e.includes('(bathrooms)')));
});
