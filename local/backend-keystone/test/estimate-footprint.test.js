'use strict';
// C7 (found by the export check): room coordinates are in feet, so the foundation
// footprint is the ground floor's room area in square feet. It was multiplied by
// tileSizeFt squared as if the rooms were in tiles, pricing foundation and site
// preparation at four times the house's footprint.
const test = require('node:test'), assert = require('node:assert/strict');
const { computeTakeoff } = require('../lib/estimate/computeTakeoff');
const { computeMaterialEstimate } = require('../lib/estimate/materialCostEngine');
const fixture = require('./fixtures/model3d-plan.json');

const groundArea = (plan) => plan.levels.find(l => Number(l.level) === 1).rooms
  .reduce((s, r) => s + (Array.isArray(r.parts) ? r.parts : [r]).reduce((a, p) => a + p.w * p.h, 0), 0);

test('the foundation footprint equals the ground floor area in square feet', () => {
  const plan = structuredClone(fixture);
  assert.equal(groundArea(plan), 1320); // 44 x 30 ft
  for (const tileSizeFt of [undefined, 1, 2, 4]) {
    const takeoff = computeTakeoff({ ...plan, tileSizeFt }, {});
    assert.equal(takeoff.raw.footprintAreaSqFt, 1320, `tileSizeFt ${tileSizeFt}`);
  }
});

test('foundation and site preparation are priced on that footprint', () => {
  const takeoff = computeTakeoff(structuredClone(fixture), {});
  const estimate = computeMaterialEstimate(takeoff, structuredClone(fixture.finishSpec || {}), null);
  const items = Array.isArray(estimate) ? estimate : (estimate.lineItems || estimate.detailLineItems || []);
  assert.ok(items.length > 5, `estimate has line items (${Object.keys(estimate).join(',')})`);
  const line = key => items.find(l => l.key === key);
  assert.equal(line('foundation_system').quantity ?? line('foundation_system').quantityValue, 1320);
  assert.equal(line('site_prep_grading').quantity ?? line('site_prep_grading').quantityValue, 1320);
});
