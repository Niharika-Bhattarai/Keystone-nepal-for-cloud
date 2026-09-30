'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { scoreRoomTargetFidelity } = require('../lib/residential/v2/scoring/roomTargetFidelityScore');

function makePlanSpec() {
  return {
    levels: [
      {
        level: 1,
        width: 30,
        height: 20,
        rooms: [
          { id: 'living_1', type: 'living_room', x: 0, y: 0, w: 10, h: 12 },
          { id: 'bedroom_1', type: 'bedroom', x: 10, y: 0, w: 10, h: 10 },
          { id: 'hall_1', type: 'hallway', x: 20, y: 0, w: 4, h: 10 },
          { id: 'garage_1', type: 'garage', x: 0, y: 12, w: 10, h: 8 },
        ],
      },
    ],
  };
}

test('room target fidelity gives perfect score when all tracked targets match', () => {
  const planSpec = makePlanSpec();
  const graph = {
    nodes: [
      { roomId: 'living_1', targetAreaSqFt: 120 },
      { roomId: 'bedroom_1', targetAreaSqFt: 100 },
      { roomId: 'hall_1', targetAreaSqFt: 40 },
      { roomId: 'garage_1', targetAreaSqFt: 80 },
    ],
  };

  const result = scoreRoomTargetFidelity({ planSpec, graph });
  assert.equal(result.score, 100);
  assert.equal(result.issues.length, 0);
});

test('room target fidelity penalizes weighted habitable room misses and ignores circulation/garage', () => {
  const planSpec = makePlanSpec();
  const graph = {
    nodes: [
      { roomId: 'living_1', targetAreaSqFt: 120 },
      { roomId: 'bedroom_1', targetAreaSqFt: 140 }, // 100 vs 140 mismatch
      { roomId: 'hall_1', targetAreaSqFt: 10 },     // should be ignored
      { roomId: 'garage_1', targetAreaSqFt: 200 },  // should be ignored
    ],
  };

  const result = scoreRoomTargetFidelity({ planSpec, graph });
  assert.ok(result.score < 100);
  assert.ok(result.score > 60);
  assert.ok(result.issues.some((issue) => String(issue).includes('room_target:bedroom_1')));
  assert.ok(!result.issues.some((issue) => String(issue).includes('hall_1')));
  assert.ok(!result.issues.some((issue) => String(issue).includes('garage_1')));
});

