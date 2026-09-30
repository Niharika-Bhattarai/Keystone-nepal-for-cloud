'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { computeEstimateRange } = require('../lib/estimate/computeEstimateRange');
const { getMaterialSpec } = require('../lib/estimate/materialSpecLibrary');

function sampleTakeoff() {
  return {
    rooms: [
      { canonicalType: 'living_room', finishClass: 'public', areaSqFt: 420 },
      { canonicalType: 'kitchen', finishClass: 'public', areaSqFt: 180 },
      { canonicalType: 'bedroom', finishClass: 'sleep', areaSqFt: 200 },
      { canonicalType: 'bedroom', finishClass: 'sleep', areaSqFt: 180 },
      { canonicalType: 'bathroom', finishClass: 'wet', areaSqFt: 70 },
      { canonicalType: 'primary_bathroom', finishClass: 'wet', areaSqFt: 90 },
    ],
    raw: {
      conditionedAreaSqFt: 2400,
      footprintAreaSqFt: 1280,
      exteriorWallAreaSqFt: 1720,
      estimatedRoofSurfaceAreaSqFt: 1480,
      roofPlanAreaSqFt: 1280,
      interiorWallAreaSqFt: 5100,
      windowCount: 24,
      exteriorDoorCount: 3,
      garageDoorCount: 1,
      fixtureTotal: 13,
      primaryBathroomCount: 1,
      bathroomCount: 2,
      powderRoomCount: 0,
      kitchenCount: 1,
      baseboardLengthFt: 1120,
    },
  };
}

test('computeEstimateRange uses material engine detail line items and keeps legacy shape', () => {
  const range = computeEstimateRange(
    sampleTakeoff(),
    {
      budgetTier: 'MID',
      location: 'Austin, TX',
      foundationType: 'SLAB',
      hvacType: 'FORCED_AIR',
      outdoorType: 'NONE',
      outdoorArea: 0,
      finishSpec: getMaterialSpec('craftsman'),
    },
    getMaterialSpec('craftsman'),
    'Austin, TX'
  );

  assert.equal(typeof range.currency, 'string');
  assert.equal(range.rateFamily, 'MID');
  assert.ok(Array.isArray(range.lineItems));
  assert.ok(Array.isArray(range.detailLineItems));
  assert.equal(range.detailLineItems.length, 28);
  assert.ok(range.lineItems.length >= 28);
  assert.ok(range.total.target > 0);
  assert.ok(Number.isFinite(range.normalizedCostPerConditionedSqFt.target));
  assert.ok(Object.prototype.hasOwnProperty.call(range.categoryTotals, 'shell'));
});

