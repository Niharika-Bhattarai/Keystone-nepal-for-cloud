'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { tilesToPlanSpec } = require('../lib/tile/tilesToPlanSpec');
const { assemblePlanSpecV2 } = require('../lib/residential/v2/assemblePlanSpecV2');

test('tilesToPlanSpec adds outlineSegments and envelopeAreaSqFt from transformed room geometry', () => {
  const planSpec = tilesToPlanSpec(
    {
      stories: 1,
      levels: [
        {
          level: 1,
          widthTiles: 10,
          heightTiles: 8,
          zones: [],
          rooms: [
            { id: 'living', type: 'living_room', x: 0, y: 0, w: 4, h: 8 },
            { id: 'garage', type: 'garage', x: 4, y: 0, w: 6, h: 4 },
          ],
        },
      ],
    },
    {
      tileSizeFt: 2,
      totalAreaSqFt: 224,
      protrusionFt: 6,
    },
    {
      frontFacing: 'North',
    },
  );

  const level = planSpec.levels[0];
  assert.ok(Array.isArray(level.outlineSegments), 'Expected outline segments on legacy planSpec levels');
  assert.ok(level.outlineSegments.length > 4, 'Expected a notched outline from actual room geometry');
  assert.equal(level.envelopeAreaSqFt, 224);
});

test('assemblePlanSpecV2 adds transformed outlineSegments and envelopeAreaSqFt', () => {
  const planSpec = assemblePlanSpecV2(
    {
      levels: [
        {
          level: 2,
          width: 20,
          height: 16,
          rooms: [
            { id: 'living', type: 'living_room', x: 0, y: 0, w: 8, h: 16 },
            { id: 'garage', type: 'garage', x: 8, y: 0, w: 12, h: 8 },
          ],
          stairCore: null,
        },
      ],
    },
    {
      frontFacing: 'West',
      stories: 2,
      totalAreaSqFt: 224,
      openConcept: true,
    },
    {
      totalAreaSqFt: 224,
    },
    {
      stories: 2,
      supportTier: 'wave1',
      housePattern: 'two_story_upper_primary_with_garage',
    },
  );

  const level = planSpec.levels[0];
  assert.equal(level.width, 16);
  assert.equal(level.height, 20);
  assert.ok(Array.isArray(level.outlineSegments), 'Expected outline segments on v2 planSpec levels');
  assert.ok(level.outlineSegments.length > 4, 'Expected transformed outline segments for non-rectangular geometry');
  assert.equal(level.envelopeAreaSqFt, 224);
});
