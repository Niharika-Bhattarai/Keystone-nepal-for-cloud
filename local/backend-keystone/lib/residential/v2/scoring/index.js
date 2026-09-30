'use strict';

const { COMPOSITE_MODEL_ID, scoreCompositeV2 } = require('./compositeScoreV2');

const BASIC_MODEL_ID = 'architect_v2_basic_v0';

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(num(value))));
}

function isCompositeScoringEnabled() {
  return String(process.env.V2_COMPOSITE_SCORING || '').trim().toLowerCase() === 'true';
}

function buildBasicScoreBreakdown(totalScore) {
  return {
    modelId: BASIC_MODEL_ID,
    total: clampScore(totalScore),
    components: {
      roomTargetFidelity: null,
      adjacencySatisfaction: null,
      daylightOrientation: null,
      circulationEfficiency: null,
    },
    componentWeights: null,
    issues: [],
    warnings: [],
  };
}

function scoreArchitectV2Candidate(candidate, brief, options = {}) {
  const compositeEnabled = Boolean(options?.compositeEnabled);
  const baseScore = clampScore(num(candidate?.baseScore, candidate?.score));
  const basicBreakdown = buildBasicScoreBreakdown(baseScore);

  if (!compositeEnabled) {
    return {
      ...candidate,
      baseScore,
      score: baseScore,
      scoreBreakdown: basicBreakdown,
    };
  }

  const compositeBreakdown = scoreCompositeV2({
    planSpec: candidate?.planSpec,
    brief,
    graph: candidate?.graph || null,
  });
  const total = clampScore(compositeBreakdown?.total);

  return {
    ...candidate,
    baseScore,
    score: total,
    scoreBreakdown: {
      ...compositeBreakdown,
      total,
    },
  };
}

function scoreArchitectV2Candidates(candidates, brief, options = {}) {
  const compositeEnabled = Boolean(options?.compositeEnabled);
  return (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => scoreArchitectV2Candidate(candidate, brief, { compositeEnabled }));
}

module.exports = {
  BASIC_MODEL_ID,
  COMPOSITE_MODEL_ID,
  buildBasicScoreBreakdown,
  isCompositeScoringEnabled,
  scoreArchitectV2Candidate,
  scoreArchitectV2Candidates,
  scoreCompositeV2,
};

