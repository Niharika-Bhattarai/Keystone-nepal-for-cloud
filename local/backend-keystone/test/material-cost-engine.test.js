'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { computeMaterialEstimate } = require('../lib/estimate/materialCostEngine');
const { getMaterialSpec } = require('../lib/estimate/materialSpecLibrary');
const { getRegionalMultiplier } = require('../lib/estimate/regionalMultipliers');

function sampleTakeoff() {
  return {
    rooms: [
      { canonicalType: 'living_room', finishClass: 'public', areaSqFt: 420 },
      { canonicalType: 'dining_room', finishClass: 'public', areaSqFt: 170 },
      { canonicalType: 'kitchen', finishClass: 'public', areaSqFt: 180 },
      { canonicalType: 'primary_bedroom', finishClass: 'sleep', areaSqFt: 240 },
      { canonicalType: 'bedroom', finishClass: 'sleep', areaSqFt: 180 },
      { canonicalType: 'bedroom', finishClass: 'sleep', areaSqFt: 160 },
      { canonicalType: 'bathroom', finishClass: 'wet', areaSqFt: 70 },
      { canonicalType: 'primary_bathroom', finishClass: 'wet', areaSqFt: 95 },
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

function sumTotals(lineItems) {
  return lineItems.reduce((sum, item) => sum + Number(item.total || 0), 0);
}

test('computeMaterialEstimate returns 28 line items with expected shape', () => {
  const lines = computeMaterialEstimate(
    sampleTakeoff(),
    getMaterialSpec('Craftsman (Wood & Stone)'),
    {
      location: 'Austin, TX',
      foundationType: 'SLAB',
      hvacType: 'FORCED_AIR',
      outdoorType: 'NONE',
      outdoorArea: 0,
      budgetTier: 'MID',
    }
  );

  assert.equal(lines.length, 28, 'Expected 28 material estimate line items');

  for (const line of lines) {
    assert.equal(typeof line.lineItem, 'string');
    assert.equal(typeof line.category, 'string');
    assert.equal(typeof line.quantity, 'number');
    assert.equal(typeof line.materialCost, 'number');
    assert.equal(typeof line.laborCost, 'number');
    assert.equal(typeof line.total, 'number');
    assert.ok(line.total >= 0, `Line item total should be non-negative for ${line.lineItem}`);
  }
});

test('material selections change estimate outputs', () => {
  const takeoff = sampleTakeoff();
  const craftsman = computeMaterialEstimate(takeoff, getMaterialSpec('craftsman'), { location: 'Atlanta, GA' });
  const contemporary = computeMaterialEstimate(takeoff, getMaterialSpec('contemporary'), { location: 'Atlanta, GA' });

  const craftsmanPrimary = craftsman.find((line) => line.key === 'exterior_cladding_primary');
  const contemporaryPrimary = contemporary.find((line) => line.key === 'exterior_cladding_primary');
  assert.ok(craftsmanPrimary && contemporaryPrimary, 'Expected cladding line items in both estimates');
  assert.notEqual(
    craftsmanPrimary.materialCost,
    contemporaryPrimary.materialCost,
    'Primary cladding cost should change by style material selection'
  );
});

test('regional multipliers scale the estimate', () => {
  const takeoff = sampleTakeoff();
  const spec = getMaterialSpec('modern_farmhouse');

  const atlanta = computeMaterialEstimate(takeoff, spec, { location: 'Atlanta, GA' });
  const sanFrancisco = computeMaterialEstimate(takeoff, spec, { location: 'San Francisco, CA' });

  const atlantaTotal = sumTotals(atlanta);
  const sanFranciscoTotal = sumTotals(sanFrancisco);
  assert.ok(sanFranciscoTotal > atlantaTotal, 'High-cost region should increase total estimate');

  const atlMultiplier = getRegionalMultiplier('Atlanta, GA');
  const sfMultiplier = getRegionalMultiplier('San Francisco, CA');
  assert.ok(sfMultiplier > atlMultiplier, 'San Francisco multiplier should exceed Atlanta multiplier');
});

