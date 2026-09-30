'use strict';
// Closets are requirements, measured separately (a walk-in, standard closets,
// none), and wide doorways need five-foot walls in the compact service rooms.
// Through the real preflight and plan handler; every returned plan passes the
// independent validators.
process.env.V2_DISABLE_LEGACY_FALLBACK = 'true';
const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/plan');
const { preflightSurvey } = require('../lib/surveyPreflight');
const { validateEditedPlan } = require('../lib/validateEditedPlan');
const { base } = require('../scripts/benchmark/studio-full-coverage.cjs');

const closets = (bedrooms, kind) => kind === 'none' ? null : Array.from({ length: bedrooms }, (_, i) =>
  ({ privateBath: i === 0 ? 'Yes' : 'No', closet: i === 0 && kind === 'walk-in' ? 'Walk-in' : 'Standard' }));
const plan = (survey) => new Promise((resolve, reject) => {
  const res = { statusCode: 200, setHeader() {}, status(n) { this.statusCode = n; return this; }, json(b) { resolve(b); return this; } };
  Promise.resolve(handler({ method: 'POST', body: { surveyData: survey }, headers: {} }, res)).catch(reject);
});
const plansOf = (b) => (b.success ? [b.planSpec, ...(b.alternatives || []).map((a) => a.planSpec)] : []);

test('a walk-in that does not fit is named, and standard closets open the same home', () => {
  // One storey, two bedrooms, two bathrooms, two-car garage: measured from
  // 1,800 sq ft with a walk-in and from 1,650 with standard closets.
  const home = { ...base, stories: '1 Story', masterLocation: 'Level 1 (Main)', bedrooms: '2 Bed', bathrooms: '2 Bath',
    privateBaths: '1', garage: '2 Car Garage', totalArea: '1650', features: '' };
  const walkIn = preflightSurvey({ ...home, bedroomConfigs: closets(2, 'walk-in') });
  assert.equal(walkIn.supported, false);
  const advice = walkIn.blockers.find((b) => b.code.startsWith('closet_area_ranges_'));
  assert.ok(advice, JSON.stringify(walkIn.blockers));
  assert.equal(advice.field, 'bedroomConfigs');
  assert.match(advice.message, /standard closets/);
  assert.equal(preflightSurvey({ ...home, bedroomConfigs: closets(2, 'standard') }).supported, true);
  assert.equal(preflightSurvey({ ...home, bedroomConfigs: closets(2, 'none') }).supported, true);
  // No area delivers with a walk-in, but standard closets do: still named.
  const cottage = { ...home, bedrooms: '1 Bed', bathrooms: '1 Bath', privateBaths: '0', garage: '1 Car Garage', totalArea: '1200' };
  const noWalkIn = preflightSurvey({ ...cottage, bedroomConfigs: [{ privateBath: 'No', closet: 'Walk-in' }] });
  assert.ok(noWalkIn.blockers.some((b) => b.code === 'closet_area_ranges_none' && /any size/.test(b.message)), JSON.stringify(noWalkIn.blockers));
  assert.equal(preflightSurvey({ ...cottage, bedroomConfigs: [{ privateBath: 'No', closet: 'Standard' }] }).supported, true);
});

test('main-floor suites: two to five bedrooms, any garage, the Studio walk-in, three distinct options', async () => {
  const { validateVariationDiversityV2 } = require('../lib/residential/v2/diversityMetricV2');
  const mainFloor = { ...base, stories: '2 Stories', masterLocation: 'Level 1 (Main)', privateBaths: '1', features: '' };
  for (const o of [
    { bedrooms: '2 Bed', bathrooms: '2 Bath', garage: 'No Garage', totalArea: '2400' },
    { bedrooms: '3 Bed', bathrooms: '3 Bath', garage: '1 Car Garage', totalArea: '2400' },
    { bedrooms: '4 Bed', bathrooms: '3 Bath', garage: '2 Car Garage', totalArea: '3200' },
    { bedrooms: '5 Bed', bathrooms: '4 Bath', garage: '1 Car Garage', totalArea: '4000' },
  ]) {
    const bedrooms = parseInt(o.bedrooms, 10);
    const survey = { ...mainFloor, ...o, bedroomConfigs: closets(bedrooms, 'walk-in') };
    const label = `${o.bedrooms} / ${o.bathrooms} / ${o.garage} / ${o.totalArea}`;
    assert.equal(preflightSurvey(survey).supported, true, label);
    const plans = plansOf(await plan(survey));
    assert.ok(plans.length >= 3, `${label}: expected three options, got ${plans.length}`);
    for (const p of plans) {
      assert.deepEqual(validateEditedPlan(p, survey), [], label);
      assert.equal(p.levels[0].rooms.filter((r) => r.type === 'primary_bedroom').length, 1, `${label}: the primary suite is on the main floor`);
      assert.equal(p.levels[1].rooms.filter((r) => r.type === 'bedroom').length, bedrooms - 1, `${label}: the other bedrooms are upstairs`);
    }
    assert.ok(validateVariationDiversityV2(plans).valid, `${label}: the options differ architecturally`);
  }
  // Below its measured sizes the preflight names them.
  const small = preflightSurvey({ ...mainFloor, bedrooms: '4 Bed', bathrooms: '3 Bath', garage: '1 Car Garage', totalArea: '2000', bedroomConfigs: closets(4, 'walk-in') });
  assert.equal(small.supported, false);
  assert.ok(small.blockers.some((b) => b.code.startsWith('measured_area_ranges_') && b.field === 'totalArea'), JSON.stringify(small.blockers));
});

test('wide doorways: the compact service rooms open through five-foot walls, never through the bathroom', async () => {
  const home = { ...base, stories: '2 Stories', masterLocation: 'Level 2 (Upper)', bedrooms: '3 Bed', bathrooms: '3 Bath',
    privateBaths: '1', garage: '1 Car Garage', totalArea: '2400', features: '', accessibilityNeeds: 'Wide doorways', bedroomConfigs: null };
  for (const o of [
    // Front kitchen: the laundry sat four feet deep beside the mudroom.
    { shape: 'Rectangular (Deep)', frontFacing: 'East', lotContext: 'Rural acreage', openConcept: 'Traditional (Separate Rooms)', kitchenPlacement: 'Front of House', laundryLocation: 'Level 1 (near garage/mud)' },
    // Upstairs laundry: the mudroom was a four-foot square bay.
    { shape: 'Square', frontFacing: 'East', openConcept: 'Open Concept (Combined)', kitchenPlacement: 'Rear of House', laundryLocation: 'Level 2 (near bedrooms)', ceilingHeight: 'Tall (10 ft)', naturalLight: 'Maximum glazing' },
  ]) {
    const survey = { ...home, ...o };
    const plans = plansOf(await plan(survey));
    assert.ok(plans.length >= 1, `${o.kitchenPlacement} / ${o.laundryLocation}: expected plans`);
    for (const p of plans) {
      assert.deepEqual(validateEditedPlan(p, survey), []);
      for (const level of p.levels) {
        const byId = new Map(level.rooms.map((r) => [String(r.id), r]));
        for (const d of level.doors || []) {
          const types = [byId.get(String(d.a))?.type, byId.get(String(d.b))?.type];
          assert.ok(!(types.includes('bathroom') && types.includes('laundry')), 'no door between the bathroom and the laundry');
        }
      }
    }
  }
});
