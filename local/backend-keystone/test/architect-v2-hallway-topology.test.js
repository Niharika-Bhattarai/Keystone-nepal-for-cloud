'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { validateStairLandingTopology } = require('../lib/residential/v2/validators/stairLandingTopologyValidator');

test('validateStairLandingTopology rejects two-sided hall bars from the upper stair landing', () => {
  const errors = validateStairLandingTopology({
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

  assert.equal(errors.length, 1);
  assert.match(errors[0], /two-sided hall bars/i);
});

test('validateStairLandingTopology accepts a single compact upper landing hall', () => {
  const errors = validateStairLandingTopology({
    level: 2,
    width: 42,
    height: 26,
    stairCore: {
      hallRoomId: 'landing_hall',
    },
    rooms: [
      { id: 'landing_hall', type: 'hallway', x: 12, y: 6, w: 6, h: 8 },
    ],
  }, { stories: 2 });

  assert.deepEqual(errors, []);
});
