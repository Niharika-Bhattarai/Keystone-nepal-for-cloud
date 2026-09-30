'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MATERIAL_STYLE_IDS,
  getMaterialSpec,
  getDefaultSpec,
  resolveStyleId,
  normalizeBudgetTier,
} = require('../lib/estimate/materialSpecLibrary');

function assertPositiveNumber(value, label) {
  assert.equal(typeof value, 'number', `${label} should be a number`);
  assert.ok(Number.isFinite(value), `${label} should be finite`);
  assert.ok(value > 0, `${label} should be > 0`);
}

function assertSpecShape(spec) {
  assert.ok(spec && typeof spec === 'object');
  assert.ok(spec.styleId);
  assert.ok(spec.styleLabel);

  assert.ok(spec.exterior?.primaryCladding);
  assertPositiveNumber(spec.exterior.primaryCladding.costPerSqft, `${spec.styleId}.exterior.primaryCladding.costPerSqft`);
  assertPositiveNumber(spec.exterior.primaryCladding.laborPerSqft, `${spec.styleId}.exterior.primaryCladding.laborPerSqft`);

  assert.ok(spec.exterior?.accentCladding);
  assertPositiveNumber(spec.exterior.accentCladding.costPerSqft, `${spec.styleId}.exterior.accentCladding.costPerSqft`);
  assertPositiveNumber(spec.exterior.accentCladding.laborPerSqft, `${spec.styleId}.exterior.accentCladding.laborPerSqft`);

  assert.ok(spec.exterior?.trim);
  assertPositiveNumber(spec.exterior.trim.costPerLinFt, `${spec.styleId}.exterior.trim.costPerLinFt`);
  assertPositiveNumber(spec.exterior.trim.laborPerLinFt, `${spec.styleId}.exterior.trim.laborPerLinFt`);

  assert.ok(spec.roofing);
  assertPositiveNumber(spec.roofing.costPerSqft, `${spec.styleId}.roofing.costPerSqft`);
  assertPositiveNumber(spec.roofing.laborPerSqft, `${spec.styleId}.roofing.laborPerSqft`);

  assert.ok(spec.windows);
  assertPositiveNumber(spec.windows.costPerUnit, `${spec.styleId}.windows.costPerUnit`);

  assert.ok(spec.interiorFinishes?.flooring?.public);
  assert.ok(spec.interiorFinishes?.flooring?.wet);
  assert.ok(spec.interiorFinishes?.flooring?.bedroom);
  assert.ok(spec.interiorFinishes?.flooring?.garage);
  assertPositiveNumber(spec.interiorFinishes.flooring.public.costPerSqft, `${spec.styleId}.flooring.public.costPerSqft`);
  assertPositiveNumber(spec.interiorFinishes.flooring.wet.costPerSqft, `${spec.styleId}.flooring.wet.costPerSqft`);
  assertPositiveNumber(spec.interiorFinishes.flooring.bedroom.costPerSqft, `${spec.styleId}.flooring.bedroom.costPerSqft`);
  assertPositiveNumber(spec.interiorFinishes.flooring.garage.costPerSqft, `${spec.styleId}.flooring.garage.costPerSqft`);

  assert.ok(spec.interiorFinishes?.countertops);
  assertPositiveNumber(spec.interiorFinishes.countertops.costPerSqft, `${spec.styleId}.countertops.costPerSqft`);

  assert.ok(spec.interiorFinishes?.cabinets);
  assertPositiveNumber(spec.interiorFinishes.cabinets.costPerLinFt, `${spec.styleId}.cabinets.costPerLinFt`);

  assert.ok(spec.interiorFinishes?.fixtures);
  assertPositiveNumber(spec.interiorFinishes.fixtures.costMultiplier, `${spec.styleId}.fixtures.costMultiplier`);
}

test('material specs expose complete shape for all five styles', () => {
  assert.equal(MATERIAL_STYLE_IDS.length, 5);
  MATERIAL_STYLE_IDS.forEach((styleId) => {
    const spec = getMaterialSpec(styleId);
    assertSpecShape(spec);
  });
});

test('style labels resolve to expected canonical style ids', () => {
  assert.equal(resolveStyleId('Craftsman (Wood & Stone)'), 'craftsman');
  assert.equal(resolveStyleId('Modern Farmhouse (Board & Batten)'), 'modern_farmhouse');
  assert.equal(resolveStyleId('Traditional Colonial (Brick)'), 'colonial');
  assert.equal(resolveStyleId('Contemporary Modern (Concrete)'), 'contemporary');
  assert.equal(resolveStyleId('Mediterranean (Stucco & Tile)'), 'mediterranean');
});

test('default material specs resolve for all budget tiers', () => {
  ['Entry ($120-180/sqft)', 'Mid ($200-300/sqft)', 'Luxury ($350+/sqft)'].forEach((budgetLabel) => {
    const budgetTier = normalizeBudgetTier(budgetLabel);
    const spec = getDefaultSpec(budgetTier);
    assertSpecShape(spec);
  });
});

