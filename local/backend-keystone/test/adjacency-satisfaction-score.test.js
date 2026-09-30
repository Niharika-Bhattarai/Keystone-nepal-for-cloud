'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { scoreAdjacencySatisfaction } = require('../lib/residential/v2/scoring/adjacencySatisfactionScore');

test('adjacency scorer satisfies same-level required edges via access graph (including open concept)', () => {
  const planSpec = {
    levels: [
      {
        level: 1,
        width: 24,
        height: 20,
        rooms: [
          { id: 'entry_1', type: 'entry', x: 0, y: 0, w: 8, h: 8 },
          { id: 'living_1', type: 'living_room', x: 8, y: 0, w: 8, h: 8 },
          { id: 'kitchen_1', type: 'kitchen', x: 16, y: 0, w: 8, h: 8 },
        ],
        // entry<->living door; living<->kitchen should connect via open concept shared wall
        doors: [
          { a: 'entry_1', b: 'living_1', x: 8, y: 4, dir: 'vertical' },
        ],
      },
    ],
  };
  const brief = { openConcept: true };
  const graph = {
    nodes: [
      { key: 'entrance_room', roomId: 'entry_1', level: 1, type: 'entry' },
      { key: 'common_area', roomId: 'living_1', level: 1, type: 'living_room' },
      { key: 'farmhouse_kitchen', roomId: 'kitchen_1', level: 1, type: 'kitchen' },
    ],
    edges: [
      { from: 'entrance_room', to: 'common_area', kind: 'required_adjacency' },
      { from: 'common_area', to: 'farmhouse_kitchen', kind: 'required_adjacency' },
    ],
  };

  const result = scoreAdjacencySatisfaction({ planSpec, brief, graph });
  assert.equal(result.score, 100);
  assert.equal(result.issues.length, 0);
});

test('adjacency scorer enforces stacked stairs for cross-level required adjacency', () => {
  const alignedPlan = {
    levels: [
      {
        level: 1,
        width: 20,
        height: 20,
        rooms: [{ id: 'stairs_l1', type: 'stairs', x: 8, y: 4, w: 4, h: 10 }],
        doors: [],
      },
      {
        level: 2,
        width: 20,
        height: 20,
        rooms: [{ id: 'stairs_l2', type: 'stairs', x: 8, y: 4, w: 4, h: 10 }],
        doors: [],
      },
    ],
  };
  const misalignedPlan = {
    levels: [
      {
        level: 1,
        width: 20,
        height: 20,
        rooms: [{ id: 'stairs_l1', type: 'stairs', x: 8, y: 4, w: 4, h: 10 }],
        doors: [],
      },
      {
        level: 2,
        width: 20,
        height: 20,
        rooms: [{ id: 'stairs_l2', type: 'stairs', x: 9, y: 4, w: 4, h: 10 }],
        doors: [],
      },
    ],
  };
  const graph = {
    nodes: [
      { key: 'stair_core_lower', roomId: 'stairs_l1', level: 1, type: 'stairs' },
      { key: 'stair_core_upper', roomId: 'stairs_l2', level: 2, type: 'stairs' },
    ],
    edges: [
      { from: 'stair_core_lower', to: 'stair_core_upper', kind: 'required_adjacency' },
    ],
  };

  const aligned = scoreAdjacencySatisfaction({ planSpec: alignedPlan, graph, brief: {} });
  const misaligned = scoreAdjacencySatisfaction({ planSpec: misalignedPlan, graph, brief: {} });

  assert.equal(aligned.score, 100);
  assert.ok(misaligned.score < 100);
  assert.ok(misaligned.issues.some((issue) => String(issue).includes('adjacency:missing')));
});

