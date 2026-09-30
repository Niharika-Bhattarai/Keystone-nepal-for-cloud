'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { base } = require('../scripts/benchmark/generation-coverage');
const { normalizeBrief } = require('../lib/tile/normalizeBrief');
const { validateSurveyInput } = require('../lib/briefContract');
const { resolveArchitectV2Support } = require('../lib/residential/v2/supportMatrix');
const { interpretBriefV2 } = require('../lib/residential/v2/interpretBriefV2');
const { buildProgramV2 } = require('../lib/residential/v2/programBuilderV2');
const { buildProgramFromBrief } = require('../lib/tile/buildProgramFromBrief');
const { buildCandidateFootprintsV2 } = require('../lib/residential/v2/candidateFootprintsV2');
const { tryGenerateArchitectV2Candidate } = require('../lib/residential/v2/candidateGeneration');
const { validateSurveyRequirements, validateOriginalSurveyCounts, validateBedroomBathroomAccess } = require('../lib/surveyRequirements');
const { validateEditedPlan } = require('../lib/validateEditedPlan');
const { buildSurveyFulfillment } = require('../lib/surveyFulfillment');
const { preflightSurvey } = require('../lib/surveyPreflight');
const planHandler = require('../api/plan');

const configs = choices => choices.map(privateBath => ({ privateBath: privateBath ? 'Yes' : 'No', closet: 'Standard' }));
const selected = choices => ({ ...base, privateBaths: String(choices.filter(Boolean).length), bedroomConfigs: configs(choices) });
const allRooms = plan => plan.levels.flatMap(l => l.rooms);

function generateProfiles(survey) {
  assert.equal(validateSurveyInput(survey).valid, true);
  const brief = normalizeBrief(survey), support = resolveArchitectV2Support(brief);
  assert.equal(support.supported, true, support.reasons.join(', '));
  const interpretation = interpretBriefV2(brief, support);
  const profiles = new Map();
  const failures = [];
  for (const footprint of buildCandidateFootprintsV2(brief, interpretation)) {
    if (profiles.has(footprint.variationId)) continue;
    const candidate = tryGenerateArchitectV2Candidate(brief, interpretation, footprint, survey, { skipElevation: true });
    if (candidate.ok) profiles.set(footprint.variationId, candidate.result.planSpec);
    else failures.push(candidate.diagnostics);
  }
  assert.ok(profiles.size >= 3, JSON.stringify(failures).slice(0, 2000));
  return [...profiles.values()];
}

test('explicit ensuite counts survive small-area normalization and both program builders', () => {
  const survey = { ...selected([true, true, true]), totalArea: '1200', garage: 'None' };
  const brief = normalizeBrief(survey);
  assert.equal(brief.privateBathsRequested, 2);
  assert.equal(brief.privateBathCount, 3);
  const interpretation = interpretBriefV2(brief, {});
  for (const program of [buildProgramV2(brief, interpretation), buildProgramFromBrief(brief, { widthFt: 30, heightFt: 20 })]) {
    const rooms = program.levels.flatMap(l => l.rooms);
    const attachments = rooms.filter(r => r.attachedTo).map(r => rooms.find(b => b.id === r.attachedTo)?.programId).sort();
    assert.deepEqual(attachments, ['bedroom_2', 'bedroom_3', 'primary']);
  }
  assert.equal(resolveArchitectV2Support(brief).supported, false, 'A program that templates cannot fit must not lose an ensuite to gain support');
});

test('single-level preference never erases an explicitly selected second storey', () => {
  const survey = { ...base, accessibilityNeeds: 'Single-level preferred' };
  const brief = normalizeBrief(survey);
  assert.equal(brief.stories, 2);
  assert.equal(interpretBriefV2(brief, {}).intent.accessibilityIntent.preferSingleStory, true);
  for (const plan of generateProfiles(survey)) {
    assert.equal(plan.levels.length, 2);
    const evidence = buildSurveyFulfillment(plan, survey).items.find(i => i.field === 'accessibilityNeeds');
    assert.equal(evidence.strength, 'preference');
    assert.equal(evidence.resolved.score, 0);
  }
});

for (const choices of [[true, true, false], [true, false, true]]) {
  test(`ensuite selections ${choices.join('/')} drive real bedroom doors in three layout profiles`, () => {
    const survey = selected(choices);
    for (const plan of generateProfiles(survey)) {
      assert.deepEqual(validateOriginalSurveyCounts(plan, survey), []);
      assert.deepEqual(validateBedroomBathroomAccess(plan), []);
      assert.deepEqual(validateEditedPlan(plan, survey), []);
      for (const [index, expected] of choices.entries()) {
        const programId = index === 0 ? 'primary' : `bedroom_${index + 1}`;
        const bedroom = allRooms(plan).find(r => r.programId === programId);
        if (index > 0) assert.equal(bedroom.label, `Bedroom ${index + 1}`, 'Drawing labels must match the survey bedroom identity');
        const baths = allRooms(plan).filter(r => r.attachedTo === bedroom.id);
        assert.equal(baths.length, Number(expected));
        for (const bath of baths) assert.ok(plan.levels.flatMap(l => l.doors).some(d => [d.a, d.b].includes(bath.id) && [d.a, d.b].includes(bedroom.id)));
      }
      const evidence = plan.surveyFulfillment.items.find(i => i.field === 'bedroomConfigs');
      assert.ok(evidence.resolved.every(r => r.privateBath.status === 'satisfied'));
      assert.equal(evidence.status, 'satisfied', 'Both bathroom attachments and physical closets must be verified');
      assert.ok(evidence.resolved.every(r => r.closet.status === 'satisfied'));
    }
  });
}

test('primary No and zero private bathrooms produce actual shared bathrooms in three profiles', () => {
  const survey = { ...selected([false, false, false]), stories: '1 Story', garage: 'None', masterLocation: 'Level 1 (Main)', sharedBathroomCount: '3' };
  for (const plan of generateProfiles(survey)) {
    assert.deepEqual(validateEditedPlan(plan, survey), []);
    assert.equal(allRooms(plan).filter(r => r.type === 'primary_bathroom').length, 0);
    const baths = allRooms(plan).filter(r => r.type === 'bathroom');
    assert.equal(baths.length, 3);
    assert.ok(baths.every(b => !b.attachedTo));
    for (const bath of baths) {
      const neighbors = plan.levels.flatMap(l => l.doors).filter(d => d.a === bath.id || d.b === bath.id)
        .map(d => allRooms(plan).find(r => r.id === (d.a === bath.id ? d.b : d.a)));
      assert.ok(neighbors.some(r => r && !['bedroom', 'primary_bedroom'].includes(r.type)), 'Shared bathroom needs access without crossing a bedroom');
    }
  }
});

test('unsupported primary-No topology reports the gap without restoring an ensuite', () => {
  const survey = selected([false, true, false]);
  const brief = normalizeBrief(survey);
  assert.equal(interpretBriefV2(brief, {}).bathPlan.primaryEnsuiteCount, 0);
  assert.ok(preflightSurvey(survey).blockers.some(b => b.code === 'primary_without_ensuite_topology_not_supported'));
});

test('contradictory explicit shared and private bathroom budgets fail before search', () => {
  const result = validateSurveyInput({ ...selected([true, true, false]), sharedBathroomCount: '2' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.field === 'sharedBathroomCount' && e.code === 'PROGRAM_CONFLICT'));
});

test('changing attachment labels or removing ensuite doors cannot fool validation or evidence', () => {
  const survey = selected([true, true, false]);
  const plan = generateProfiles(survey)[0];
  const changed = structuredClone(plan);
  const rooms = allRooms(changed), bath = rooms.find(r => r.type === 'bathroom' && r.attachedTo);
  bath.attachedTo = rooms.find(r => r.programId === 'bedroom_3').id;
  assert.ok(validateEditedPlan(changed, survey).some(e => /bedroomConfigs/.test(e)));
  assert.ok(validateBedroomBathroomAccess(changed).length);
  const noDoor = structuredClone(plan);
  for (const level of noDoor.levels) level.doors = level.doors.filter(d => d.a !== bath.id && d.b !== bath.id);
  assert.ok(validateSurveyRequirements(noDoor, normalizeBrief(survey)).some(e => /bathroom access/.test(e)));
  assert.equal(buildSurveyFulfillment(noDoor, survey).items.find(i => i.field === 'privateBaths').status, 'conflict');
});

test('API alternatives preserve exact bedroom selections on the production route', async () => {
  const survey = selected([true, true, false]);
  const response = await new Promise((resolve, reject) => {
    const res = { code: 200, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { resolve({ code: this.code, body }); } };
    Promise.resolve(planHandler({ method: 'POST', body: { surveyData: survey }, headers: {} }, res)).catch(reject);
  });
  assert.equal(response.code, 200, response.body.message);
  const plans = [response.body.planSpec, ...response.body.alternatives.map(a => a.planSpec)];
  assert.ok(plans.length >= 3);
  for (const plan of plans) assert.deepEqual(validateOriginalSurveyCounts(plan, survey), []);
});
