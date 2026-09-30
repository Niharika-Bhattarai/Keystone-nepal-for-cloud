'use strict';

const { scoreRoomTargetFidelity } = require('./roomTargetFidelityScore');
const { scoreAdjacencySatisfaction } = require('./adjacencySatisfactionScore');
const { scoreDaylightOrientation } = require('./daylightOrientationScore');
const { scoreCirculationEfficiency } = require('./circulationEfficiencyScore');

const COMPOSITE_MODEL_ID = 'architect_v2_composite_v1';

const COMPONENT_WEIGHTS = Object.freeze({
  roomTargetFidelity: 0.35,
  adjacencySatisfaction: 0.30,
  daylightOrientation: 0.20,
  circulationEfficiency: 0.15,
});

function clampScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function withPrefix(prefix, values) {
  return (Array.isArray(values) ? values : []).map((value) => `${prefix}:${value}`);
}

function scoreCompositeV2({ planSpec, brief, graph }) {
  const roomTarget = scoreRoomTargetFidelity({ planSpec, graph });
  const adjacency = scoreAdjacencySatisfaction({ planSpec, brief, graph });
  const daylight = scoreDaylightOrientation({ planSpec, graph });
  const circulation = scoreCirculationEfficiency({ planSpec, brief });

  const totalRaw =
    (roomTarget.score * COMPONENT_WEIGHTS.roomTargetFidelity) +
    (adjacency.score * COMPONENT_WEIGHTS.adjacencySatisfaction) +
    (daylight.score * COMPONENT_WEIGHTS.daylightOrientation) +
    (circulation.score * COMPONENT_WEIGHTS.circulationEfficiency);

  return {
    modelId: COMPOSITE_MODEL_ID,
    total: clampScore(totalRaw),
    components: {
      roomTargetFidelity: clampScore(roomTarget.score),
      adjacencySatisfaction: clampScore(adjacency.score),
      daylightOrientation: clampScore(daylight.score),
      circulationEfficiency: clampScore(circulation.score),
    },
    componentWeights: COMPONENT_WEIGHTS,
    issues: [
      ...withPrefix('roomTargetFidelity', roomTarget.issues),
      ...withPrefix('adjacencySatisfaction', adjacency.issues),
      ...withPrefix('daylightOrientation', daylight.issues),
      ...withPrefix('circulationEfficiency', circulation.issues),
    ],
    warnings: [
      ...withPrefix('roomTargetFidelity', roomTarget.warnings),
      ...withPrefix('adjacencySatisfaction', adjacency.warnings),
      ...withPrefix('daylightOrientation', daylight.warnings),
      ...withPrefix('circulationEfficiency', circulation.warnings),
    ],
    metrics: {
      circulation: circulation.metrics || null,
    },
  };
}

module.exports = {
  COMPOSITE_MODEL_ID,
  COMPONENT_WEIGHTS,
  scoreCompositeV2,
};

