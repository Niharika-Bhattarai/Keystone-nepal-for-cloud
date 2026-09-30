'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { scoreCirculationEfficiency } = require('../lib/residential/v2/scoring/circulationEfficiencyScore');

function makeCompactPlan() {
  return {
    levels: [
      {
        level: 1,
        width: 20,
        height: 20,
        rooms: [
          { id: 'entry_1', type: 'entry', x: 0, y: 12, w: 6, h: 8 },
          { id: 'living_1', type: 'living_room', x: 0, y: 0, w: 12, h: 12 },
          { id: 'kitchen_1', type: 'kitchen', x: 12, y: 0, w: 8, h: 12 },
          { id: 'bedroom_1', type: 'bedroom', x: 6, y: 12, w: 8, h: 8 },
          { id: 'bath_1', type: 'bathroom', x: 14, y: 12, w: 6, h: 8 },
          { id: 'hall_1', type: 'hallway', x: 6, y: 10, w: 4, h: 2 },
        ],
        doors: [
          { a: 'entry_1', b: 'hall_1' },
          { a: 'hall_1', b: 'living_1' },
          { a: 'living_1', b: 'kitchen_1' },
          { a: 'hall_1', b: 'bedroom_1' },
          { a: 'hall_1', b: 'bath_1' },
        ],
      },
    ],
  };
}

function makeInefficientPlan() {
  return {
    levels: [
      {
        level: 1,
        width: 30,
        height: 20,
        rooms: [
          { id: 'entry_1', type: 'entry', x: 0, y: 14, w: 6, h: 6 },
          { id: 'living_1', type: 'living_room', x: 0, y: 0, w: 12, h: 8 },
          { id: 'kitchen_1', type: 'kitchen', x: 12, y: 0, w: 10, h: 8 },
          { id: 'bedroom_1', type: 'bedroom', x: 22, y: 0, w: 8, h: 8 },
          { id: 'bath_1', type: 'bathroom', x: 22, y: 8, w: 8, h: 6 },
          { id: 'hall_1', type: 'hallway', x: 0, y: 8, w: 30, h: 6 },
        ],
        doors: [
          { a: 'entry_1', b: 'hall_1' },
          { a: 'hall_1', b: 'living_1' },
        ],
      },
    ],
  };
}

test('circulation efficiency scorer rewards compact connected circulation', () => {
  const compact = scoreCirculationEfficiency({ planSpec: makeCompactPlan(), brief: { stories: 1 } });
  assert.ok(compact.score >= 85);
  assert.equal(compact.issues.length, 0);
});

test('circulation efficiency scorer penalizes hall overage and disconnected travel', () => {
  const inefficient = scoreCirculationEfficiency({ planSpec: makeInefficientPlan(), brief: { stories: 1 } });
  assert.ok(inefficient.score < 75);
  assert.ok(inefficient.issues.some((issue) => String(issue).includes('circulation:hall_overage')));
  assert.ok(inefficient.issues.some((issue) => String(issue).includes('circulation:disconnected')));
});

