'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeBrief, parseFeatureRequests } = require('../lib/tile/normalizeBrief');
const { makeDisplayLabels } = require('../lib/tile/canonicalRoomTypes');
const { buildProgramV2 } = require('../lib/residential/v2/programBuilderV2');
const { resolveArchitectV2Support } = require('../lib/residential/v2/supportMatrix');
const { interpretBriefV2 } = require('../lib/residential/v2/interpretBriefV2');
const { buildCandidateFootprintsV2 } = require('../lib/residential/v2/candidateFootprintsV2');
const { tryGenerateArchitectV2Candidate } = require('../lib/residential/v2/candidateGeneration');
const { validateRequestedFeatureRooms } = require('../lib/residential/v2/validators/featureRoomPlacementValidator');
const { validateEditedPlan } = require('../lib/validateEditedPlan');
const { validateSurveyRequirements } = require('../lib/surveyRequirements');
const { buildSurveyFulfillment } = require('../lib/surveyFulfillment');
const { validateSurveyInput } = require('../lib/briefContract');
const { preflightSurvey } = require('../lib/surveyPreflight');
const { base } = require('../scripts/benchmark/generation-coverage');

function generate(survey) {
  const brief = normalizeBrief(survey);
  const support = resolveArchitectV2Support(brief);
  assert.equal(support.supported, true, JSON.stringify(support.reasons));
  const interpretation = interpretBriefV2(brief, support);
  for (const footprint of buildCandidateFootprintsV2(brief, interpretation)) {
    const candidate = tryGenerateArchitectV2Candidate(brief, interpretation, footprint, survey);
    if (candidate.ok) return candidate.result.planSpec;
  }
  assert.fail(`No validated candidate: ${JSON.stringify(survey)}`);
}

test('feature identities preserve multiplicity and gaming/playroom semantics', () => {
  const requests = parseFeatureRequests('2 Studies, 1 Home Office, 1 Gaming Room, 1 Playroom');
  assert.deepEqual(requests.map(r => r.programId), ['feature_study_1', 'feature_study_2',
    'feature_home_office_1', 'feature_gaming_room_1', 'feature_playroom_1']);
  assert.equal(requests[4].canonicalType, 'playroom');
  assert.deepEqual(parseFeatureRequests('1 Playroom, 2 Studies').slice(1).map(r => r.programId), requests.slice(0, 2).map(r => r.programId));
});

test('only the declared old picker version merges Study/Home Office aliases', () => {
  const survey = { ...base, features: '1 Study, 1 Home Office' };
  assert.equal(normalizeBrief(survey).requestedFeatureItems.length, 2);
  assert.equal(normalizeBrief({ ...survey, surveyVersion: 1 }).requestedFeatureItems.length, 1);
  assert.equal(normalizeBrief({ ...survey, surveyVersion: 1, features: '2 Studies' }).requestedFeatureItems.length, 2);
  assert.equal(validateSurveyInput({ ...survey, features: '1 Study, 1 Observatory' }).valid, false);
  for (const features of ['1.5 Studies', '-1 Study', '0 Studies', '1000000000 Studies', '1 Study and Observatory']) {
    assert.equal(validateSurveyInput({ ...survey, features }).valid, false, features);
  }
  assert.equal(parseFeatureRequests('1 Playroom; 1 Gaming Room').length, 2);
});

test('program and graph bind every repeated type to its own room instance', () => {
  const brief = normalizeBrief({ ...base, totalArea: '3000', features: '2 Studies' });
  const interpretation = interpretBriefV2(brief, resolveArchitectV2Support(brief));
  const program = buildProgramV2(brief, interpretation);
  const rooms = program.levels.flatMap(l => l.rooms).filter(r => r.requestedFeature);
  assert.equal(rooms.length, 2);
  assert.deepEqual(rooms.map(r => r.level).sort(), [1, 2]);
  const nodes = program.graph.nodes.filter(n => rooms.some(r => r.id === n.roomId));
  assert.equal(nodes.length, 2);
  assert.equal(new Set(nodes.map(n => n.roomId)).size, 2);
  for (const room of rooms) assert.equal(nodes.find(n => n.roomId === room.id).programId, room.programId);
  assert.equal(resolveArchitectV2Support(normalizeBrief({ ...base, totalArea: '3000', features: '3 Studies' })).supported, false);
  assert.equal(resolveArchitectV2Support(normalizeBrief({ ...base, totalArea: '3000', features: '1 Gaming Room, 1 Playroom' })).supported, false);
  const choices = preflightSurvey({ ...base, totalArea: '3000', features: '2 Studies' }).featureOptions;
  assert.equal(choices.find(c => c.value === 'Study').selected, true);
});

test('the second feature room and exact composite area are independently validated', () => {
  const brief = normalizeBrief({ features: '2 Studies' });
  const first = { id: 'first', type: 'study', x: 0, y: 0, w: 12, h: 12 };
  const second = { id: 'second', type: 'study', x: 12, y: 0, w: 12, h: 12,
    parts: [{ x: 12, y: 0, w: 12, h: 3 }, { x: 12, y: 3, w: 3, h: 9 }] };
  const plan = { levels: [{ level: 1, width: 24, height: 24, rooms: [first, second] }] };
  assert.ok(validateRequestedFeatureRooms(plan, brief).some(e => e.includes('63 sqft')));
  plan.levels[0].rooms.pop();
  assert.ok(validateRequestedFeatureRooms(plan, brief).some(e => e.includes('requested 2, delivered 1')));
});

test('repeated studies retain labels, access, furnishings, closets and edit protection', () => {
  const survey = { ...base, totalArea: '3000', features: '2 Studies', bedroomConfigs: [
    { privateBath: 'Yes', closet: 'Walk-in' }, { privateBath: 'No', closet: 'Standard' }, { privateBath: 'No', closet: 'Standard' }] };
  const plan = generate(survey);
  assert.deepEqual(validateEditedPlan(plan, survey), []);
  const rooms = plan.levels.flatMap(l => l.rooms);
  const studies = rooms.filter(r => r.type === 'study');
  assert.equal(studies.length, 2);
  for (const level of plan.levels) for (const room of level.rooms.filter(r => r.featureBufferDepthFt)) {
    assert.ok(level.furniture.some(f => f.roomId === room.id && f.kind === 'sofa'));
  }
  makeDisplayLabels(plan);
  for (const study of studies) {
    assert.equal(study.label, `Study ${study.programId.at(-1)}`);
    const level = plan.levels.find(l => l.rooms.includes(study));
    assert.ok(level.doors.some(d => d.a === study.id || d.b === study.id));
    assert.ok(level.furniture.some(f => f.roomId === study.id && f.kind === 'desk'));
  }
  const evidence = buildSurveyFulfillment(plan, survey).items.find(i => i.field === 'features');
  assert.equal(evidence.status, 'satisfied');
  assert.equal(evidence.evidenceRefs.length, 2);
  const altered = structuredClone(plan);
  const wrong = altered.levels.flatMap(l => l.rooms).find(r => r.programId === 'feature_study_2');
  wrong.type = 'storage';
  // A reduced generated brief must not hide the original request.
  const brief = normalizeBrief(survey); brief.requestedFeatureItems.pop();
  assert.ok(validateSurveyRequirements(altered, brief).some(e => e.includes('requested 2, delivered 1')));
  assert.ok(validateEditedPlan(altered, survey).some(e => e.includes('identity mismatch')));
  assert.equal(buildSurveyFulfillment(altered, survey).items.find(i => i.field === 'features').status, 'conflict');
  const stripped = structuredClone(plan);
  stripped.levels.flatMap(l => l.rooms).filter(r => r.requestedFeature).forEach(r => { delete r.programId; });
  assert.ok(validateEditedPlan(stripped, survey).some(e => e.includes('identity mismatch')));
});

test('playrooms have play/storage geometry while gaming rooms retain workstations', () => {
  for (const [features, type, kinds] of [['1 Playroom', 'playroom', ['play_mat', 'toy_storage']],
    ['1 Gaming Room', 'gaming_room', ['desk', 'desk_chair']]]) {
    const survey = { ...base, totalArea: '3000', features };
    const plan = generate(survey);
    assert.deepEqual(validateEditedPlan(plan, survey), []);
    const level = plan.levels.find(l => l.rooms.some(r => r.type === type));
    const room = level.rooms.find(r => r.type === type);
    for (const kind of kinds) assert.ok(level.furniture.some(f => f.roomId === room.id && f.kind === kind));
    level.furniture = level.furniture.filter(f => !(f.roomId === room.id && f.kind === kinds[0]));
    assert.ok(validateEditedPlan(plan, survey).some(e => e.includes(`needs ${kinds[0]}`)));
  }
});
