'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { observations, flooringObservation } = require('../lib/estimate/productPrices');
const { computeMaterialEstimate } = require('../lib/estimate/materialCostEngine');

test('product observations retain units and geographic scope without using conflicting prices', () => {
  const today = new Date('2026-09-27T12:00:00Z');
  assert.equal(flooringObservation('porcelain_tile', { zipCode: '50266-1234' }, today).price, 2.99);
  assert.equal(flooringObservation('porcelain_tile', { zipCode: '10001' }, today), null);
  assert.equal(flooringObservation('engineered_hardwood', { zipCode: '50266' }, new Date('2026-11-01')), null);
  assert.equal(flooringObservation('electric_tank_50_gal', { zipCode: '50266' }, today), null);
  assert.equal(observations.find(row => row.material === 'gypsum_board_half_in').price * 32, 13.58);
});

test('default estimates tolerate missing location instead of crashing the generator', () => {
  const { buildEstimate } = require('../lib/estimate/buildEstimate');
  assert.ok(buildEstimate(require('./fixtures/model3d-plan.json')).costRange.total.target > 0);
});

test('local flooring observation changes only matched material; labor stays an allowance', t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-27T12:00:00Z') });
  const takeoff = { raw: {}, rooms: [{ conditioned: true, finishClass: 'public', areaSqFt: 100 }] };
  const finishes = { interiorFinishes: { flooring: { public: { material: 'engineered_hardwood', costPerSqft: 8 } } } };
  const local = computeMaterialEstimate(takeoff, finishes, { location: 'IA', estimateLocation: { zipCode: '50266' } }).find(r => r.key === 'flooring_public');
  const other = computeMaterialEstimate(takeoff, finishes, { location: 'IA', estimateLocation: { zipCode: '50320' } }).find(r => r.key === 'flooring_public');
  assert.equal(local.materialCost, 599);
  assert.equal(local.laborCost, other.laborCost);
  assert.equal(local.productPrice.laborStatus, 'uncalibrated_allowance');
  assert.equal(other.productPrice, undefined);
});
