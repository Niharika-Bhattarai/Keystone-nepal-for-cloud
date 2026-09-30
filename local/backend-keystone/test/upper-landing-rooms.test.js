'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { classifyUpperCirculationRoom } = require('../lib/residential/v2/patterns/upperLandingRooms');

test('classifyUpperCirculationRoom promotes a large usable upper circulation room to loft', () => {
  const room = classifyUpperCirculationRoom(
    { x: 0, y: 0, w: 10, h: 10 },
    { id: 'upper_space', level: 2 }
  );

  assert.equal(room.type, 'loft');
  assert.equal(room.label, 'Loft');
  assert.equal(room.zone, 'public');
});

test('classifyUpperCirculationRoom keeps a compact landing as hallway circulation', () => {
  const room = classifyUpperCirculationRoom(
    { x: 12, y: 6, w: 6, h: 8 },
    { id: 'landing_hall', level: 2, label: 'Landing Hall' }
  );

  assert.equal(room.type, 'hallway');
  assert.equal(room.label, 'Landing Hall');
  assert.equal(room.zone, 'circulation');
});
