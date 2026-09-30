'use strict';
process.env.V2_DISABLE_LEGACY_FALLBACK = 'true';
const test = require('node:test');
const assert = require('node:assert/strict');
const { base, geometry } = require('../scripts/benchmark/studio-full-coverage.cjs');
const { invoke } = require('../scripts/benchmark/survey-delivery-audit');
const { validateEditedPlan } = require('../lib/validateEditedPlan');
const { buildSharedUpperGarageCirculationCore } = require('../lib/residential/v2/clusterBuilders');
const { fitStairLayout } = require('../lib/stairLayout');
const { validateVariationDiversityV2 } = require('../lib/residential/v2/diversityMetricV2');

test('deep shared stair reservations keep aligned geometry and fit a real flight', () => {
  const anchor = { x: 14, y: 16, w: 7, h: 20 };
  const upper = buildSharedUpperGarageCirculationCore({ width: 44, height: 36, stairAnchor: anchor });
  assert.deepEqual(upper.stairsRect, anchor);
  const fitted = fitStairLayout({ core: anchor, upperHall: upper.landingRect,
    lowerHall: { x: 21, y: 16, w: 5, h: 20 }, riseFt: 10 });
  assert.equal(fitted.valid, true, fitted.reason);
  assert.throws(() => buildSharedUpperGarageCirculationCore({ width: 44, height: 30, stairAnchor: anchor }), /both floor envelopes/);
});

for (const [name, overrides] of [
  ['square two-storey house', { shape: 'Square' }],
  ['front kitchen', { kitchenPlacement: 'Front of House' }],
  ['large main-floor primary suite', { masterLocation: 'Level 1 (Main)', totalArea: '5000' }],
  // From 3,200 sq ft: with the Studio's closets the family did not fit below.
  ['main-floor primary suite', { masterLocation: 'Level 1 (Main)', totalArea: '3200' }],
  ['main-floor primary suite with upstairs laundry', { masterLocation: 'Level 1 (Main)', totalArea: '3200', laundryLocation: 'Level 2 (near bedrooms)' }],
  ['large house with a secondary walk-in closet', { totalArea: '5000', bathrooms: '2 Bath', bedroomConfigs: [
    { privateBath: 'Yes', closet: 'Standard' }, { privateBath: 'No', closet: 'Walk-in' }, { privateBath: 'No', closet: 'Standard' },
  ] }],
]) test(`${name} supplies three independently valid and distinct plans`, async () => {
  const survey = { ...base, ...overrides };
  const { body } = await invoke(survey);
  assert.equal(body.success, true, JSON.stringify(body.diagnostics));
  const plans = [body.planSpec, ...(body.alternatives || []).map(a => a.planSpec)];
  assert.ok(plans.length >= 3);
  assert.ok(new Set(plans.map(geometry)).size >= 3);
  assert.equal(validateVariationDiversityV2(plans).valid, true, 'Every delivered pair must differ architecturally');
  for (const plan of plans) {
    assert.deepEqual(validateEditedPlan(plan, survey), []);
    if (survey.shape === 'Square') for (const level of plan.levels) assert.equal(level.width, level.height);
    if (survey.masterLocation === 'Level 1 (Main)') assert.equal(plan.levels[0].rooms.filter(r => r.type === 'primary_bedroom').length, 1);
    if (survey.laundryLocation === 'Level 2 (near bedrooms)') {
      assert.equal(plan.levels[0].rooms.filter(r => r.type === 'laundry').length, 0);
      assert.equal(plan.levels[1].rooms.filter(r => r.type === 'laundry').length, 1);
    }
    if (survey.bedroomConfigs) for (const room of plan.levels[0].rooms.filter(r => ['laundry', 'mudroom'].includes(r.type))) assert.ok(room.w <= 12);
  }
});
