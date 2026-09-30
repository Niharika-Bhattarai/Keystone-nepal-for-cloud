'use strict';

const { STAGE_ORDER } = require('./graph/graphNodeTypes');

function buildAssemblyOrderV2(graph) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const stageIndex = new Map(STAGE_ORDER.map((stage, index) => [stage, index]));
  return [...nodes].sort((a, b) => {
    const stageDelta = (stageIndex.get(a.stage) ?? 999) - (stageIndex.get(b.stage) ?? 999);
    if (stageDelta !== 0) return stageDelta;
    const levelDelta = Number(a.level || 0) - Number(b.level || 0);
    if (levelDelta !== 0) return levelDelta;
    const depthDelta = Number(a.privacyDepth || 0) - Number(b.privacyDepth || 0);
    if (depthDelta !== 0) return depthDelta;
    return String(a.key || '').localeCompare(String(b.key || ''));
  });
}

module.exports = {
  buildAssemblyOrderV2,
};
