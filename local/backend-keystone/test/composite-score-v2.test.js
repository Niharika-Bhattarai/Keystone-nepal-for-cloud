'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { scoreRoomTargetFidelity } = require('../lib/residential/v2/scoring/roomTargetFidelityScore');
const { scoreAdjacencySatisfaction } = require('../lib/residential/v2/scoring/adjacencySatisfactionScore');
const { scoreDaylightOrientation } = require('../lib/residential/v2/scoring/daylightOrientationScore');
const { scoreCirculationEfficiency } = require('../lib/residential/v2/scoring/circulationEfficiencyScore');
const {
  COMPOSITE_MODEL_ID,
  COMPONENT_WEIGHTS,
  scoreCompositeV2,
} = require('../lib/residential/v2/scoring/compositeScoreV2');

function makePlanAndGraph() {
  const planSpec = {
    levels: [
      {
        level: 1,
        width: 24,
        height: 20,
        rooms: [
          { id: 'entry_1', type: 'entry', x: 0, y: 12, w: 8, h: 8 },
          { id: 'living_1', type: 'living_room', x: 0, y: 0, w: 12, h: 12 },
          { id: 'kitchen_1', type: 'kitchen', x: 12, y: 0, w: 12, h: 12 },
          { id: 'bedroom_1', type: 'bedroom', x: 8, y: 12, w: 8, h: 8 },
          { id: 'bath_1', type: 'bathroom', x: 16, y: 12, w: 8, h: 8 },
          { id: 'hall_1', type: 'hallway', x: 8, y: 10, w: 4, h: 2 },
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
  const graph = {
    nodes: [
      { key: 'entrance_room', roomId: 'entry_1', level: 1, type: 'entry', targetAreaSqFt: 64, exteriorEdgesRequired: 1 },
      { key: 'common_area', roomId: 'living_1', level: 1, type: 'living_room', targetAreaSqFt: 144, exteriorEdgesRequired: 2, resolvedPreferredSide: 'west' },
      { key: 'farmhouse_kitchen', roomId: 'kitchen_1', level: 1, type: 'kitchen', targetAreaSqFt: 144, exteriorEdgesRequired: 1, resolvedPreferredSide: 'east' },
      { key: 'secondary_bedroom_1', roomId: 'bedroom_1', level: 1, type: 'bedroom', targetAreaSqFt: 64, exteriorEdgesRequired: 1, resolvedPreferredSide: 'south' },
      { key: 'shared_bath', roomId: 'bath_1', level: 1, type: 'bathroom', targetAreaSqFt: 64, exteriorEdgesRequired: 0 },
    ],
    edges: [
      { from: 'entrance_room', to: 'common_area', kind: 'required_adjacency' },
      { from: 'common_area', to: 'farmhouse_kitchen', kind: 'required_adjacency' },
      { from: 'common_area', to: 'secondary_bedroom_1', kind: 'required_adjacency' },
    ],
  };
  return { planSpec, graph };
}

test('composite scorer uses locked model id and weighted total', () => {
  const { planSpec, graph } = makePlanAndGraph();
  const brief = { openConcept: true, stories: 1 };

  const roomTarget = scoreRoomTargetFidelity({ planSpec, graph });
  const adjacency = scoreAdjacencySatisfaction({ planSpec, brief, graph });
  const daylight = scoreDaylightOrientation({ planSpec, graph });
  const circulation = scoreCirculationEfficiency({ planSpec, brief });
  const composite = scoreCompositeV2({ planSpec, brief, graph });

  const expectedTotal = Math.round(
    (roomTarget.score * COMPONENT_WEIGHTS.roomTargetFidelity) +
    (adjacency.score * COMPONENT_WEIGHTS.adjacencySatisfaction) +
    (daylight.score * COMPONENT_WEIGHTS.daylightOrientation) +
    (circulation.score * COMPONENT_WEIGHTS.circulationEfficiency)
  );

  assert.equal(composite.modelId, COMPOSITE_MODEL_ID);
  assert.equal(composite.total, expectedTotal);
  assert.deepEqual(Object.keys(composite.components).sort(), [
    'adjacencySatisfaction',
    'circulationEfficiency',
    'daylightOrientation',
    'roomTargetFidelity',
  ]);
});

