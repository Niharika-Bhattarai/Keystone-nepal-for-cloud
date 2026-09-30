'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validateVariationDiversity } = require('../lib/residential/v2/variationDiversityValidator');

function makePlan(roomOverrides = [], footprintOverrides = {}, meta = {}) {
  const defaultRooms = [
    { type: 'living_room', x: 0, y: 0, widthFt: 20, heightFt: 14, level: 1 },
    { type: 'kitchen', x: 20, y: 0, widthFt: 14, heightFt: 12, level: 1 },
    { type: 'dining_room', x: 20, y: 12, widthFt: 14, heightFt: 10, level: 1 },
    { type: 'primary_bedroom', x: 0, y: 16, widthFt: 16, heightFt: 14, level: 2 },
    { type: 'stairs', x: 16, y: 16, widthFt: 8, heightFt: 10, level: 1 },
  ];
  return {
    rooms: roomOverrides.length ? roomOverrides : defaultRooms,
    footprint: { widthFt: 40, heightFt: 30, aspectRatio: 1.33, ...footprintOverrides },
    metadata: { variationId: 'variant_a', ...meta },
  };
}

describe('variationDiversityValidator', () => {
  it('two genuinely different planSpecs pass', () => {
    const planA = makePlan();
    const planB = makePlan([
      { type: 'living_room', x: 14, y: 0, widthFt: 20, heightFt: 14, level: 1 },
      { type: 'kitchen', x: 0, y: 0, widthFt: 14, heightFt: 12, level: 1 },
      { type: 'dining_room', x: 0, y: 12, widthFt: 14, heightFt: 10, level: 1 },
      { type: 'primary_bedroom', x: 18, y: 16, widthFt: 16, heightFt: 14, level: 2 },
      { type: 'stairs', x: 8, y: 16, widthFt: 8, heightFt: 10, level: 1 },
    ], { widthFt: 44, aspectRatio: 1.47 }, { variationId: 'variant_b' });

    const result = validateVariationDiversity([planA, planB]);
    assert.equal(result.valid, true);
    assert.ok(result.diversityScore >= 2);
  });

  it('identical planSpecs fail', () => {
    const planA = makePlan();
    const planB = makePlan(); // exact same rooms and footprint
    const result = validateVariationDiversity([planA, planB]);
    assert.equal(result.valid, false);
    assert.ok(result.failedPairs.length > 0);
  });

  it('metadata-only difference fails (same rooms, different variationId)', () => {
    const planA = makePlan([], {}, { variationId: 'variant_a' });
    const planB = makePlan([], {}, { variationId: 'variant_b' });
    const result = validateVariationDiversity([planA, planB]);
    assert.equal(result.valid, false);
  });

  it('three diverse plans pass with diversityScore >= 2', () => {
    const planA = makePlan();
    const planB = makePlan([
      { type: 'living_room', x: 14, y: 0, widthFt: 22, heightFt: 14, level: 1 },
      { type: 'kitchen', x: 0, y: 0, widthFt: 14, heightFt: 12, level: 1 },
      { type: 'dining_room', x: 0, y: 12, widthFt: 14, heightFt: 10, level: 1 },
      { type: 'primary_bedroom', x: 20, y: 16, widthFt: 16, heightFt: 14, level: 2 },
      { type: 'stairs', x: 10, y: 16, widthFt: 8, heightFt: 10, level: 1 },
    ], { widthFt: 46, aspectRatio: 1.53 });
    const planC = makePlan([
      { type: 'living_room', x: 6, y: 8, widthFt: 18, heightFt: 14, level: 1 },
      { type: 'kitchen', x: 24, y: 0, widthFt: 12, heightFt: 14, level: 1 },
      { type: 'dining_room', x: 24, y: 14, widthFt: 12, heightFt: 10, level: 1 },
      { type: 'primary_bedroom', x: 0, y: 0, widthFt: 18, heightFt: 16, level: 2 },
      { type: 'stairs', x: 18, y: 0, widthFt: 6, heightFt: 10, level: 1 },
    ], { widthFt: 36, heightFt: 32, aspectRatio: 1.125 });

    const result = validateVariationDiversity([planA, planB, planC]);
    assert.equal(result.valid, true);
    assert.ok(result.diversityScore >= 2);
  });

  it('single plan returns valid', () => {
    const result = validateVariationDiversity([makePlan()]);
    assert.equal(result.valid, true);
  });

  it('empty array returns valid', () => {
    const result = validateVariationDiversity([]);
    assert.equal(result.valid, true);
  });

  it('result includes all 4 dimensionResults', () => {
    const result = validateVariationDiversity([makePlan(), makePlan()]);
    assert.equal(result.dimensionResults.length, 4);
    const names = result.dimensionResults.map(d => d.name);
    assert.ok(names.includes('room_centroid'));
    assert.ok(names.includes('adjacency_graph'));
    assert.ok(names.includes('circulation_topology'));
    assert.ok(names.includes('envelope_class'));
  });

  it('supports planSpec-style levels[] input (not only flat rooms[])', () => {
    const planA = {
      levels: [
        {
          level: 1,
          rooms: [
            { type: 'living_room', x: 0, y: 0, w: 20, h: 14 },
            { type: 'kitchen', x: 20, y: 0, w: 14, h: 12 },
            { type: 'stairs', x: 14, y: 14, w: 8, h: 10 },
          ],
        },
        {
          level: 2,
          rooms: [
            { type: 'primary_bedroom', x: 0, y: 0, w: 18, h: 14 },
            { type: 'bedroom', x: 20, y: 0, w: 14, h: 12 },
            { type: 'hallway', x: 14, y: 12, w: 8, h: 4 },
          ],
        },
      ],
      footprint: { widthFt: 40, heightFt: 28, aspectRatio: 1.43 },
    };

    const planB = {
      levels: [
        {
          level: 1,
          rooms: [
            { type: 'living_room', x: 14, y: 0, w: 20, h: 14 },
            { type: 'kitchen', x: 0, y: 0, w: 14, h: 12 },
            { type: 'stairs', x: 24, y: 14, w: 8, h: 10 },
          ],
        },
        {
          level: 2,
          rooms: [
            { type: 'primary_bedroom', x: 18, y: 0, w: 18, h: 14 },
            { type: 'bedroom', x: 0, y: 0, w: 14, h: 12 },
            { type: 'hallway', x: 12, y: 12, w: 12, h: 4 },
          ],
        },
      ],
      footprint: { widthFt: 46, heightFt: 28, aspectRatio: 1.64 },
    };

    const result = validateVariationDiversity([planA, planB]);
    assert.equal(result.valid, true);
    assert.ok(result.diversityScore >= 2);
  });
});
