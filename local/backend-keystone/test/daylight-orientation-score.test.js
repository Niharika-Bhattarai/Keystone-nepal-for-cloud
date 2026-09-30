'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { scoreDaylightOrientation } = require('../lib/residential/v2/scoring/daylightOrientationScore');

test('daylight/orientation scorer rewards rooms with required exposures and preferred-side alignment', () => {
  const planSpec = {
    levels: [
      {
        level: 1,
        width: 20,
        height: 20,
        rooms: [
          { id: 'living_1', type: 'living_room', x: 0, y: 0, w: 10, h: 10 },
          { id: 'bedroom_1', type: 'bedroom', x: 10, y: 0, w: 10, h: 10 },
        ],
      },
    ],
  };
  const graph = {
    nodes: [
      { roomId: 'living_1', level: 1, type: 'living_room', exteriorEdgesRequired: 2, resolvedPreferredSide: 'west' },
      { roomId: 'bedroom_1', level: 1, type: 'bedroom', exteriorEdgesRequired: 2, resolvedPreferredSide: 'east' },
    ],
  };

  const result = scoreDaylightOrientation({ planSpec, graph });
  assert.equal(result.score, 100);
  assert.equal(result.issues.length, 0);
  assert.equal(result.warnings.length, 0);
});

test('daylight/orientation scorer penalizes underexposed and wrong-side habitable rooms', () => {
  const planSpec = {
    levels: [
      {
        level: 1,
        width: 20,
        height: 20,
        rooms: [
          { id: 'living_1', type: 'living_room', x: 4, y: 0, w: 12, h: 10 }, // only north exposure
          { id: 'bedroom_1', type: 'bedroom', x: 10, y: 0, w: 10, h: 10 },    // north + east
        ],
      },
    ],
  };
  const graph = {
    nodes: [
      { roomId: 'living_1', level: 1, type: 'living_room', exteriorEdgesRequired: 2, resolvedPreferredSide: 'west' },
      { roomId: 'bedroom_1', level: 1, type: 'bedroom', exteriorEdgesRequired: 2, resolvedPreferredSide: 'west' },
    ],
  };

  const result = scoreDaylightOrientation({ planSpec, graph });
  assert.ok(result.score < 90);
  assert.ok(result.issues.some((issue) => String(issue).includes('daylight:exposure_missing:living_1')));
  assert.ok(result.warnings.some((warning) => String(warning).includes('daylight:orientation_miss')));
});

