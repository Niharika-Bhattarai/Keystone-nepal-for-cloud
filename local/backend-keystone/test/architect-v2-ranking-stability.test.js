'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const planHandler = require('../api/plan');

const { rankAcceptedCandidates } = require('../lib/residential/v2/candidateGeneration');

function makeCandidate({
  id,
  total,
  adjacency,
  roomTarget,
  areaDelta,
  warningCount = 0,
  variationId = 'variant_a_compact_core',
  widthFt = 40,
  heightFt = 30,
}) {
  return {
    score: total,
    scoreBreakdown: {
      modelId: 'architect_v2_composite_v1',
      total,
      components: {
        roomTargetFidelity: roomTarget,
        adjacencySatisfaction: adjacency,
        daylightOrientation: 80,
        circulationEfficiency: 80,
      },
    },
    areaStats: {
      effectiveAreaDeltaSqFt: areaDelta,
    },
    warnings: Array.from({ length: warningCount }, (_, i) => `warning_${i}`),
    footprint: {
      variationId,
      widthFt,
      heightFt,
    },
    planSpec: {
      variationId,
    },
    _id: id,
  };
}

test('composite ranking tie-break prioritizes adjacency then room-target', () => {
  const candidates = [
    makeCandidate({ id: 'a', total: 90, adjacency: 82, roomTarget: 92, areaDelta: 5 }),
    makeCandidate({ id: 'b', total: 90, adjacency: 88, roomTarget: 70, areaDelta: 50 }),
    makeCandidate({ id: 'c', total: 90, adjacency: 88, roomTarget: 83, areaDelta: 50 }),
  ];

  const ranked = rankAcceptedCandidates(candidates, { scoringMode: 'composite' });
  assert.equal(ranked[0]._id, 'c'); // adjacency tie -> higher room-target wins
  assert.equal(ranked[1]._id, 'b');
  assert.equal(ranked[2]._id, 'a');
});

test('composite ranking tie-break continues through area delta and warnings', () => {
  const candidates = [
    makeCandidate({ id: 'a', total: 91, adjacency: 85, roomTarget: 84, areaDelta: 40, warningCount: 0 }),
    makeCandidate({ id: 'b', total: 91, adjacency: 85, roomTarget: 84, areaDelta: 15, warningCount: 3 }),
    makeCandidate({ id: 'c', total: 91, adjacency: 85, roomTarget: 84, areaDelta: 15, warningCount: 1 }),
  ];

  const ranked = rankAcceptedCandidates(candidates, { scoringMode: 'composite' });
  assert.equal(ranked[0]._id, 'c');
  assert.equal(ranked[1]._id, 'b');
  assert.equal(ranked[2]._id, 'a');
});

test('composite ranking tie-break is deterministic through variationId then width/height', () => {
  const candidates = [
    makeCandidate({
      id: 'a',
      total: 90,
      adjacency: 80,
      roomTarget: 80,
      areaDelta: 10,
      warningCount: 1,
      variationId: 'variant_b_light_edge',
      widthFt: 42,
      heightFt: 30,
    }),
    makeCandidate({
      id: 'b',
      total: 90,
      adjacency: 80,
      roomTarget: 80,
      areaDelta: 10,
      warningCount: 1,
      variationId: 'variant_a_compact_core',
      widthFt: 44,
      heightFt: 31,
    }),
    makeCandidate({
      id: 'c',
      total: 90,
      adjacency: 80,
      roomTarget: 80,
      areaDelta: 10,
      warningCount: 1,
      variationId: 'variant_a_compact_core',
      widthFt: 40,
      heightFt: 29,
    }),
  ];

  const ranked = rankAcceptedCandidates(candidates, { scoringMode: 'composite' });
  assert.equal(ranked[0]._id, 'c');
  assert.equal(ranked[1]._id, 'b');
  assert.equal(ranked[2]._id, 'a');
});

