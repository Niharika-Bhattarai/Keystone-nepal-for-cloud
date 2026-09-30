'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { base } = require('../scripts/benchmark/generation-coverage');
const { normalizeBrief } = require('../lib/tile/normalizeBrief');
const { resolveArchitectV2Support } = require('../lib/residential/v2/supportMatrix');
const { compileSurveyIntent } = require('../lib/residential/v2/surveyIntentCompiler');
const { classifyInputFamily } = require('../lib/residential/v2/inputFamilyClassifier');
const { interpretBriefV2 } = require('../lib/residential/v2/interpretBriefV2');
const { buildCandidateFootprintsV2 } = require('../lib/residential/v2/candidateFootprintsV2');
const { tryGenerateArchitectV2Candidate } = require('../lib/residential/v2/candidateGeneration');
const { validateEditedPlan } = require('../lib/validateEditedPlan');
const { buildSurveyFulfillment } = require('../lib/surveyFulfillment');
const { preflightSurvey } = require('../lib/surveyPreflight');
const { compareMetrics, METRIC_VERSION } = require('../lib/residential/v2/diversityMetricV2');

const survey = { ...base, totalArea: '3200', features: '1 Gaming Room, 1 Playroom', bedroomConfigs: [
  { privateBath: 'Yes', closet: 'Walk-in' },
  { privateBath: 'No', closet: 'Standard' }, { privateBath: 'No', closet: 'Standard' },
] };
function generate(input) {
  const brief = normalizeBrief(input), support = resolveArchitectV2Support(brief);
  assert.equal(support.supported, true, JSON.stringify(support.reasons));
  const interpretation = interpretBriefV2(brief, support);
  for (const footprint of buildCandidateFootprintsV2(brief, interpretation)) {
    const candidate = tryGenerateArchitectV2Candidate(brief, interpretation, footprint, input);
    if (candidate.ok) return candidate.result.planSpec;
  }
  assert.fail('No independently validated social feature pair candidate');
}

test('social pair support agrees across routing and preflight without widening unrelated combinations', () => {
  for (const features of [survey.features, '1 Playroom, 1 Gaming Room']) {
    const input = { ...survey, features }, brief = normalizeBrief(input);
    assert.equal(resolveArchitectV2Support(brief).supported, true);
    assert.equal(classifyInputFamily(compileSurveyIntent(brief)).housePattern, 'two_story_upper_primary_with_garage_three_bed');
    assert.equal(preflightSurvey(input).supported, true);
  }
  for (const patch of [{ totalArea: '3000' }, { garage: 'None' }, { garage: '2 Car Garage' },
    { shape: 'T-shape' }, { stories: '1 Story' }, { bedrooms: '4 Bed' }, { bathrooms: '2 Bath' },
    { masterLocation: 'Level 1 (Main)' }, { features: '2 Gaming Rooms, 1 Playroom' }]) {
    assert.equal(resolveArchitectV2Support(normalizeBrief({ ...survey, ...patch })).supported, false, JSON.stringify(patch));
  }
});

test('social pair retains rooms, public furnishings, closets and aligned stairs in every orientation', () => {
  for (const frontFacing of ['South', 'North', 'East', 'West']) {
    const input = { ...survey, frontFacing }, plan = generate(input);
    assert.deepEqual(validateEditedPlan(plan, input), []);
    const ground = plan.levels.find(level => Number(level.level) === 1);
    for (const programId of ['feature_gaming_room_1', 'feature_playroom_1']) {
      assert.equal(ground.rooms.filter(room => room.programId === programId).length, 1);
    }
    const dining = ground.rooms.find(room => room.type === 'dining_room');
    const items = ground.furniture.filter(item => item.roomId === dining.id);
    assert.equal(items.filter(item => /^chair_\d+$/.test(item.kind)).length, 8);
    assert.equal(new Set(items.map(item => item.assemblyId)).size, 1);
    assert.equal(plan.levels.flatMap(level => level.rooms).filter(room => room.type === 'closet').length, 3);
    assert.equal(buildSurveyFulfillment(plan, input).items.find(item => item.field === 'features').status, 'satisfied');
  }
});

test('wide openings and reverse feature order preserve the original survey', () => {
  const input = { ...survey, totalArea: '3400', features: '1 Playroom, 1 Gaming Room', accessibilityNeeds: 'Wide doorways' };
  const plan = generate(input);
  assert.deepEqual(validateEditedPlan(plan, input), []);
  for (const door of plan.levels.flatMap(level => level.doors).filter(door => !door.garageDoor)) {
    assert.ok(door.width >= 3.5, JSON.stringify(door));
  }
});

test('edits cannot hide missing furnishings, blocked chairs, windows or independent access', () => {
  const original = generate(survey);
  for (const [label, mutate, expected] of [
    ['sofa', level => { level.furniture = level.furniture.filter(item => item.kind !== 'sofa'); }, 'needs sofa'],
    ['chair', level => { level.furniture = level.furniture.filter(item => item.kind !== 'chair_8'); }, 'needs 8 chairs'],
    ['detached chair', level => { level.furniture.find(item => item.kind === 'chair_8').y += 0.5; }, 'remain arranged'],
    ['collision', level => {
      const chair = level.furniture.find(item => item.kind === 'chair_8');
      const table = level.furniture.find(item => item.kind === 'dining_table');
      chair.x = table.x; chair.y = table.y;
    }, 'Furniture overlaps'],
    ['window', level => {
      const room = level.rooms.find(room => room.type === 'playroom');
      level.windows = level.windows.filter(window => window.roomId !== room.id);
    }, 'needs exterior window'],
    ['private-only access', level => {
      const room = level.rooms.find(room => room.type === 'playroom');
      const other = level.rooms.find(room => room.type === 'gaming_room');
      level.doors = level.doors.filter(door => door.a !== room.id && door.b !== room.id);
      level.doors.push({ a: room.id, b: other.id, x: room.x, y: room.y + 4, dir: 'vertical', width: 3 });
    }, 'needs independent public access'],
  ]) {
    const plan = structuredClone(original);
    delete plan.furnitureDiagnostics;
    for (const level of plan.levels) for (const room of level.rooms) delete room.publicSpaceForFeaturePair;
    mutate(plan.levels.find(level => Number(level.level) === 1));
    assert.ok(validateEditedPlan(plan, survey).some(error => error.includes(expected)), label);
    assert.equal(buildSurveyFulfillment(plan, survey).items.find(item => item.field === 'features').status, 'conflict', label);
  }
});

test('production selection delivers corrected-diversity triples for wide doors and all walk-ins', async () => {
  const api = require('../api/plan');
  for (const patch of [{ accessibilityNeeds: 'Wide doorways' },
    { bedroomConfigs: survey.bedroomConfigs.map(config => ({ ...config, closet: 'Walk-in' })) }]) {
    const input = { ...survey, ...patch };
    const response = await new Promise((resolve, reject) => {
      const res = { code: 200, setHeader() {}, status(code) { this.code = code; return this; },
        json(body) { resolve({ status: this.code, body }); } };
      Promise.resolve(api({ method: 'POST', headers: {}, body: { surveyData: input } }, res)).catch(reject);
    });
    assert.equal(response.status, 200);
    const plans = [response.body.planSpec, ...response.body.alternatives.map(alt => alt.planSpec)];
    assert.ok(plans.length >= 3, JSON.stringify(patch));
    for (const plan of plans) assert.deepEqual(validateEditedPlan(plan, input), []);
    const measured = compareMetrics(plans);
    assert.equal(measured.v2ValidPairs, measured.pairCount);
    assert.equal(response.body.diversityMetrics.metricVersion, METRIC_VERSION);
    assert.equal(response.body.diversityMetrics.valid, true);
    assert.equal(response.body.diversityMetrics.targetMet, true);
    assert.equal(response.body.diversityMetrics.validPairCount, measured.v2ValidPairs);
    const eastBedroomOption = plans.find(plan => {
      const level = plan.levels.find(level => level.level === 2);
      const bedroom = level.rooms.find(room => room.programId === 'bedroom_2');
      return bedroom.x >= level.stairCore.x + level.stairCore.w;
    });
    assert.ok(eastBedroomOption, 'Must deliver the genuinely different east bedroom arrangement');
    const upper = eastBedroomOption.levels.find(level => level.level === 2);
    const bedroom = upper.rooms.find(room => room.programId === 'bedroom_2');
    assert.ok(upper.doors.some(door => {
      const other = door.a === bedroom.id ? door.b : door.b === bedroom.id ? door.a : null;
      return upper.rooms.some(room => room.id === other && room.type === 'hallway');
    }), 'East bedroom must open independently onto the hall');
  }
});
