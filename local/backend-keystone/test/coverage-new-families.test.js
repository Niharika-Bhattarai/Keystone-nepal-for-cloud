'use strict';
// The split-bedroom ranch (single storey with a garage) and the cottage (one
// bedroom, or two small ones), through the real plan handler with the payload
// the Studio sends: every returned plan passes the independent validators.
process.env.V2_DISABLE_LEGACY_FALLBACK = 'true';
const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/plan');
const { validateEditedPlan } = require('../lib/validateEditedPlan');
const { validateVariationDiversityV2 } = require('../lib/residential/v2/diversityMetricV2');
const { base } = require('../scripts/benchmark/studio-full-coverage.cjs');
const { shareWall } = require('../lib/planGeometry');

const studio = (o) => {
  const s = { ...base, ...o };
  const b = parseInt(s.bedrooms, 10), attached = Number(s.privateBaths);
  return { ...s, bedroomConfigs: Array.from({ length: b }, (_, i) => ({ privateBath: i < attached ? 'Yes' : 'No', closet: i === 0 ? 'Walk-in' : 'Standard' })) };
};
const plan = (survey) => new Promise((resolve, reject) => {
  const res = { statusCode: 200, setHeader() {}, status(n) { this.statusCode = n; return this; }, json(b) { resolve(b); return this; } };
  Promise.resolve(handler({ method: 'POST', body: { surveyData: survey }, headers: {} }, res)).catch(reject);
});
const plansOf = (b) => (b.success ? [b.planSpec, ...(b.alternatives || []).map((a) => a.planSpec)] : []);
const oneStory = { stories: '1 Story', masterLocation: 'Level 1 (Main)' };

test('a 1,800 sq ft three-bedroom ranch with a two-car garage: three distinct valid plans, a walk-in, garage into the mudroom', async () => {
  const survey = studio({ ...oneStory, bedrooms: '3 Bed', bathrooms: '2 Bath', privateBaths: '1', totalArea: '1800', garage: '2 Car Garage' });
  const plans = plansOf(await plan(survey));
  assert.ok(plans.length >= 3, `expected three options, got ${plans.length}`);
  for (const p of plans) assert.deepEqual(validateEditedPlan(p, survey), []);
  assert.ok(validateVariationDiversityV2(plans).valid, 'the options differ architecturally');
  const ranch = plans.find((p) => p.levels[0].rooms.some((r) => r.id === 'architect_v2_bedroom_hall'));
  assert.ok(ranch, 'at least one option is the split ranch');
  const rooms = ranch.levels[0].rooms;
  const closet = rooms.find((r) => r.type === 'closet' && r.closetType === 'walk_in');
  assert.ok(closet && rooms.find((r) => r.id === closet.ownerBedroomId)?.type === 'primary_bedroom', 'the primary has its walk-in');
  const garage = rooms.find((r) => r.type === 'garage'), mudroom = rooms.find((r) => r.type === 'mudroom');
  assert.ok(ranch.levels[0].doors.some((d) => [d.a, d.b].includes(garage.id) && [d.a, d.b].includes(mudroom.id)), 'the garage opens into the mudroom');
});

test('one-bedroom cottages and a small two-bedroom home generate from the cottage family', async () => {
  for (const o of [
    { bedrooms: '1 Bed', bathrooms: '1 Bath', privateBaths: '0', totalArea: '800' },
    { bedrooms: '1 Bed', bathrooms: '2 Bath', privateBaths: '1', totalArea: '1200' },
    { bedrooms: '2 Bed', bathrooms: '1 Bath', privateBaths: '0', totalArea: '1000' },
  ]) {
    const survey = studio({ ...oneStory, garage: 'No Garage', ...o });
    const plans = plansOf(await plan(survey));
    assert.ok(plans.length >= 1, `${JSON.stringify(o)} generates`);
    for (const p of plans) assert.deepEqual(validateEditedPlan(p, survey), [], JSON.stringify(o));
    const rooms = plans[0].levels[0].rooms;
    const hall = rooms.find((r) => r.id === 'architect_v2_cottage_hall');
    const bath = rooms.find((r) => r.type === 'bathroom' && !r.attachedTo);
    assert.ok(hall && bath && shareWall(hall, bath, 3), 'the shared bathroom opens off the cottage hall');
  }
});
