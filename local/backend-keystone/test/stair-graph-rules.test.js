'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { analyzeStairGraph } = require('../lib/residential/v2/graph/stairGraphRules');

function makeLevel(level, rooms, doors, stairCore) {
  return {
    level,
    width: 40,
    height: 30,
    rooms,
    doors,
    stairCore,
  };
}

test('analyzeStairGraph recognizes an upper stair that terminates only at a hallway landing', () => {
  const result = analyzeStairGraph(makeLevel(
    2,
    [
      { id: 'stairs_2', type: 'stairs', x: 14, y: 18, w: 6, h: 12 },
      { id: 'landing_2', type: 'hallway', x: 10, y: 12, w: 10, h: 6 },
      { id: 'bed_2', type: 'bedroom', x: 0, y: 18, w: 14, h: 12 },
    ],
    [
      { a: 'stairs_2', b: 'landing_2', x: 16, y: 18, dir: 'horizontal' },
      { a: 'landing_2', b: 'bed_2', x: 10, y: 16, dir: 'vertical' },
    ],
    {
      roomId: 'stairs_2',
      hallRoomId: 'landing_2',
      landingRoomId: 'landing_2',
    }
  ), { stories: 2 });

  assert.equal(result.levelRole, 'upper');
  assert.equal(result.landingType, 'hallway');
  assert.deepEqual(result.directNeighborTypes, ['hallway']);
  assert.deepEqual(result.topologyFailures, []);
});

test('analyzeStairGraph flags a stair that opens directly into a private room', () => {
  const result = analyzeStairGraph(makeLevel(
    2,
    [
      { id: 'stairs_2', type: 'stairs', x: 14, y: 18, w: 6, h: 12 },
      { id: 'study_2', type: 'study', x: 20, y: 18, w: 12, h: 12 },
    ],
    [
      { a: 'stairs_2', b: 'study_2', x: 20, y: 24, dir: 'vertical' },
    ],
    {
      roomId: 'stairs_2',
      hallRoomId: null,
      landingRoomId: null,
    }
  ), { stories: 2 });

  assert.equal(result.directNeighborTypes.includes('study'), true);
  assert.ok(result.topologyFailures.some((failure) => /directly into private rooms/i.test(failure)));
});

test('analyzeStairGraph recognizes a lower stair with an entry-sequence hall', () => {
  const result = analyzeStairGraph(makeLevel(
    1,
    [
      { id: 'stairs_1', type: 'stairs', x: 14, y: 14, w: 6, h: 14 },
      { id: 'hall_1', type: 'hallway', x: 20, y: 14, w: 6, h: 14 },
      { id: 'entry_1', type: 'entry', x: 26, y: 20, w: 8, h: 8 },
      { id: 'living_1', type: 'living_room', x: 26, y: 0, w: 8, h: 14 },
    ],
    [
      { a: 'stairs_1', b: 'hall_1', x: 20, y: 18, dir: 'vertical' },
      { a: 'hall_1', b: 'entry_1', x: 26, y: 22, dir: 'vertical' },
      { a: 'hall_1', b: 'living_1', x: 26, y: 14, dir: 'horizontal' },
    ],
    {
      roomId: 'stairs_1',
      hallRoomId: 'hall_1',
      landingRoomId: 'hall_1',
    }
  ), { stories: 2 });

  assert.equal(result.levelRole, 'lower');
  assert.equal(result.hasEntrySequenceAccess, true);
  assert.deepEqual(result.topologyFailures, []);
});
