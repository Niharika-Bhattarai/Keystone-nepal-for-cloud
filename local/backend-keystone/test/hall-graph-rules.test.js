'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { analyzeHallGraph } = require('../lib/residential/v2/graph/hallGraphRules');

test('analyzeHallGraph classifies a single compact landing', () => {
  const result = analyzeHallGraph({
    level: 2,
    width: 40,
    height: 30,
    stairCore: {
      hallRoomId: 'landing_hall',
    },
    rooms: [
      { id: 'landing_hall', type: 'hallway', x: 10, y: 12, w: 10, h: 6 },
      { id: 'stairs_2', type: 'stairs', x: 14, y: 18, w: 6, h: 12 },
    ],
  }, { stories: 2 });

  assert.equal(result.topology, 'single_landing');
  assert.equal(result.isLoftCandidate, false);
  assert.deepEqual(result.failures, []);
});

test('analyzeHallGraph flags a two-sided upper hall bar', () => {
  const result = analyzeHallGraph({
    level: 2,
    width: 42,
    height: 26,
    stairCore: {
      hallRoomId: 'landing_hall',
    },
    rooms: [
      { id: 'landing_hall', type: 'hallway', x: 12, y: 6, w: 6, h: 8 },
      { id: 'left_hall', type: 'hallway', x: 0, y: 8, w: 12, h: 4 },
      { id: 'right_hall', type: 'hallway', x: 18, y: 8, w: 12, h: 4 },
    ],
  }, { stories: 2 });

  assert.equal(result.topology, 'two_sided_bar');
  assert.ok(result.failures.some((failure) => /two-sided hall bars/i.test(failure)));
});

test('analyzeHallGraph identifies a daylit oversized upper hall as a loft candidate', () => {
  const result = analyzeHallGraph({
    level: 2,
    width: 40,
    height: 30,
    stairCore: {
      hallRoomId: 'landing_hall',
    },
    rooms: [
      { id: 'landing_hall', type: 'hallway', x: 0, y: 8, w: 16, h: 8 },
      { id: 'stairs_2', type: 'stairs', x: 10, y: 16, w: 6, h: 12 },
    ],
  }, { stories: 2 });

  assert.equal(result.topology, 'loft_candidate');
  assert.equal(result.isLoftCandidate, true);
});

test('analyzeHallGraph accepts a loft as the upper landing anchor', () => {
  const result = analyzeHallGraph({
    level: 2,
    width: 40,
    height: 30,
    stairCore: {
      hallRoomId: 'upper_loft',
      landingRoomId: 'upper_loft',
    },
    rooms: [
      { id: 'upper_loft', type: 'loft', x: 0, y: 8, w: 12, h: 8 },
      { id: 'stairs_2', type: 'stairs', x: 12, y: 16, w: 6, h: 12 },
    ],
  }, { stories: 2 });

  assert.equal(result.topology, 'loft_landing');
  assert.equal(result.isLoftCandidate, false);
  assert.equal(result.landingHall?.id, 'upper_loft');
  assert.deepEqual(result.failures, []);
});
