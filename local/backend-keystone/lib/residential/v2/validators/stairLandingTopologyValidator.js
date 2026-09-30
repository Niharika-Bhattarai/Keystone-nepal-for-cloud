'use strict';

const { analyzeHallGraph } = require('../graph/hallGraphRules');

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function validateStairLandingTopology(level, brief = null) {
  const stories = Math.max(1, num(brief?.stories, 1));
  const levelNumber = num(level?.level, 1);
  if (stories !== 2 || levelNumber !== 2) return [];
  return analyzeHallGraph(level, brief).failures;
}

module.exports = {
  validateStairLandingTopology,
};
