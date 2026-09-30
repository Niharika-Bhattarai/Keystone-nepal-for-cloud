'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { base } = require('../scripts/benchmark/generation-coverage');
const { normalizeBrief } = require('../lib/tile/normalizeBrief');
const { resolveArchitectV2Support } = require('../lib/residential/v2/supportMatrix');
const { interpretBriefV2 } = require('../lib/residential/v2/interpretBriefV2');
const { buildCandidateFootprintsV2 } = require('../lib/residential/v2/candidateFootprintsV2');
const { tryGenerateArchitectV2Candidate } = require('../lib/residential/v2/candidateGeneration');
const { placeBedroomClosets } = require('../lib/placeBedroomClosets');
const { closetLayout, closetDoorSwing, validateBedroomClosets } = require('../lib/closetGeometry');
const { subtract } = require('../lib/geometry/rectBoolean');
const { partListOf } = require('../lib/planGeometry');
const { placeOpenings } = require('../lib/placeOpenings');
const { enrichPlanSpec } = require('../lib/buildingModel');
const { validateEditedPlan } = require('../lib/validateEditedPlan');
const { buildSurveyFulfillment } = require('../lib/surveyFulfillment');
const { validateFurnitureGeometry } = require('../lib/furnitureGeometry');
const { renderPlanSvg } = require('../lib/renderPlanSvg');
const { roomArea } = require('../lib/planGeometry');

const selection = (choices, overrides = {}) => ({ ...base, ...overrides,
  bedroomConfigs: choices.map((closet, index) => ({ privateBath: index === 0 ? 'Yes' : 'No', closet })) });
function profiles(survey) {
  const brief = normalizeBrief(survey), support = resolveArchitectV2Support(brief);
  assert.ok(support.supported, JSON.stringify(support.reasons));
  const interpretation = interpretBriefV2(brief, support), plans = new Map(), failures = [];
  for (const footprint of buildCandidateFootprintsV2(brief, interpretation)) {
    if (plans.has(footprint.variationId)) continue;
    const result = tryGenerateArchitectV2Candidate(brief, interpretation, footprint, survey, { skipElevation: true });
    if (result.ok) plans.set(footprint.variationId, result.result.planSpec);
    else failures.push(result.diagnostics);
  }
  assert.equal(plans.size, 3, JSON.stringify(failures).slice(0, 2500));
  return [...plans.values()];
}

for (let mask = 0; mask < 8; mask++) {
  const choices = [0, 1, 2].map(i => mask & (1 << i) ? 'Walk-in' : 'Standard');
  test(`all closet choices ${choices.join('/')} produce three independently validated profiles`, () => {
    const survey = selection(choices);
    for (const plan of profiles(survey)) {
      assert.deepEqual(validateEditedPlan(plan, survey), []);
      assert.deepEqual(validateBedroomClosets(plan, survey), []);
      const ledger = buildSurveyFulfillment(plan, survey).items.find(i => i.field === 'bedroomConfigs');
      assert.equal(ledger.status, 'satisfied');
      for (const level of plan.levels) {
        const closets = level.rooms.filter(r => r.type === 'closet' && r.ownerBedroomId);
        for (const closet of closets) {
          const model = closetLayout(closet);
          assert.ok(model.depth >= 2 && model.along >= 5);
          if (closet.closetType === 'walk_in') assert.ok(model.aisleDepth >= 3);
          assert.equal(level.doors.filter(d => [d.a, d.b].includes(closet.id)).length, 1);
        }
        assert.deepEqual(validateFurnitureGeometry(level, ['bedroom', 'primary_bedroom']), []);
      }
      const before = plan.levels.flatMap(l => l.rooms).reduce((sum, r) => sum + roomArea(r), 0);
      const rerun = placeBedroomClosets(structuredClone(plan), normalizeBrief(survey));
      assert.deepEqual(rerun.levels, plan.levels, 'Placement must not carve the same closet twice');
      assert.equal(rerun.levels.flatMap(l => l.rooms).reduce((sum, r) => sum + roomArea(r), 0), before);
      assert.match(renderPlanSvg(plan), /data-furniture="closet-storage"/);
    }
  });
}

for (const frontFacing of ['North', 'East', 'West']) {
  test(`all walk-ins retain private access and bed clearances facing ${frontFacing}`, () => {
    const survey = selection(['Walk-in', 'Walk-in', 'Walk-in'], { frontFacing });
    for (const plan of profiles(survey)) assert.deepEqual(validateEditedPlan(plan, survey), []);
  });
}

test('wide doorway selection includes real four-foot closet openings', () => {
  const survey = selection(['Walk-in', 'Standard', 'Standard'], { accessibilityNeeds: 'Wide doorways' });
  for (const plan of profiles(survey)) {
    assert.deepEqual(validateEditedPlan(plan, survey), []);
    for (const d of plan.levels.flatMap(l => l.doors).filter(d => d.closetDoor)) assert.equal(d.width, 4);
  }
});

for (const totalArea of ['2400', '3200']) {
  for (const features of ['None', '1 Study', '1 Library', '1 Gym']) {
    test(`west-facing secondary ensuite keeps its closet at ${totalArea} sqft with ${features}`, () => {
      const survey = selection(['Walk-in', 'Standard', 'Standard'], { frontFacing: 'West', totalArea, features, privateBaths: '2' });
      survey.bedroomConfigs[2].privateBath = 'Yes';
      const plans = profiles(survey);
      for (const plan of plans) assert.deepEqual(validateEditedPlan(plan, survey), []);
      assert.ok(plans.some(p => p.levels.some(l => l.furniture.some(f => f.kind.startsWith('bed_') && [180, 270].includes(f.rotation)))),
        'The reflected bedroom must be able to move its headboard to either end');
    });
  }
}

test('closet reservations conserve allocated floor area and protect the original bedroom windows', () => {
  const survey = selection(['Walk-in', 'Standard', 'Standard']);
  const initial = profiles({ ...base, bedroomConfigs: null })[0];
  const before = initial.levels.map(l => l.rooms.reduce((sum, r) => sum + roomArea(r), 0));
  const windows = structuredClone(initial.levels.map(l => l.windows));
  const plan = placeBedroomClosets(structuredClone(initial), normalizeBrief(survey));
  assert.ok(plan.closetPlacementDiagnostics.every(d => d.status === 'placed'));
  assert.deepEqual(plan.levels.map(l => l.rooms.reduce((sum, r) => sum + roomArea(r), 0)), before);
  assert.deepEqual(plan.levels.map(l => l.windows), windows);
});

test('regenerated openings preserve closet ownership and reject destructive saved-plan edits', () => {
  const survey = selection(['Walk-in', 'Standard', 'Standard']);
  const plan = profiles(survey)[0], brief = normalizeBrief(survey);
  const rebuilt = enrichPlanSpec(placeOpenings(structuredClone(plan), survey), { brief, surveyData: survey });
  assert.deepEqual(validateEditedPlan(rebuilt, survey), []);
  const mutations = [
    (l, c) => { l.rooms = l.rooms.filter(r => r.id !== c.id); },
    (l, c) => { c.closetType = c.closetType === 'walk_in' ? 'reach_in' : 'walk_in'; },
    (l, c) => { l.doors = l.doors.filter(d => ![d.a, d.b].includes(c.id)); },
    (l, c) => { l.doors.push({ ...l.doors.find(d => d.a === c.id), b: l.rooms.find(r => r.type === 'hallway').id }); },
    (l, c) => { c.ownerBedroomId = 'wrong_bedroom'; },
    (l, c) => { c.w = 2; },
    (l, c) => { l.furniture = l.furniture.filter(f => f.roomId !== c.id); },
    (l, c) => { l.furniture.find(f => f.roomId === c.id).w = NaN; },
    (l, c) => {
      const owner = l.rooms.find(r => r.id === c.ownerBedroomId), swing = closetDoorSwing(c);
      owner.parts = subtract(partListOf(owner), [{ x: swing.x + .1, y: swing.y + .1, w: .1, h: .1 }]);
    },
    (l, c) => { const access = closetLayout(c).access; l.furniture.push({ ...access, id: 'blocking_desk', kind: 'desk', roomId: c.id }); },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(plan), level = changed.levels.find(l => l.rooms.some(r => r.closetType === 'walk_in'));
    const closet = level.rooms.find(r => r.closetType === 'walk_in');
    mutate(level, closet);
    assert.ok(validateEditedPlan(changed, survey).some(e => /closet/i.test(e)));
    assert.equal(buildSurveyFulfillment(changed, survey).items.find(i => i.field === 'bedroomConfigs').status, 'conflict');
  }
});

test('compact bedroom refuses an unplaceable walk-in without shrinking its bed or silently substituting a reach-in', () => {
  const room = { id: 'b', programId: 'primary', type: 'primary_bedroom', x: 0, y: 0, w: 10, h: 10 };
  const plan = { levels: [{ level: 1, width: 10, height: 10, rooms: [room], doors: [], windows: [], furniture: [] }] };
  const original = structuredClone(plan.levels);
  placeBedroomClosets(plan, { bedroomProgram: [{ programId: 'primary', closet: 'walk_in' }] });
  assert.deepEqual(plan.levels, original);
  assert.equal(plan.closetPlacementDiagnostics[0].status, 'search_exhausted');
  assert.ok(validateBedroomClosets(plan, { bedroomConfigs: [{ closet: 'Walk-in' }] }).length);
});

test('null legacy closet choices remain unspecified rather than claiming an explicit survey selection', () => {
  const survey = selection([null, null, null]);
  const plan = profiles(survey)[0];
  assert.equal(plan.levels.flatMap(l => l.rooms).filter(r => r.ownerBedroomId).length, 0);
  assert.equal(buildSurveyFulfillment(plan, survey).items.find(i => i.field === 'bedroomConfigs').status, 'needs_project_input');
});
