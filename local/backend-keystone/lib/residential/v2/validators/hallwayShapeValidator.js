'use strict';

const { buildHallwayAnalysis } = require('../../../planQualityMetrics');
const { analyzeHallGraph } = require('../graph/hallGraphRules');

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function validateHallwayShape(level, brief) {
  const analysis = buildHallwayAnalysis(level, level?.rooms, level?.doors);
  const graphAnalysis = analyzeHallGraph(level, brief);
  const stories = Math.max(1, num(brief?.stories, 1));
  const levelNumber = num(level?.level, 1);
  const levelArea = Math.max(1, num(level?.width) * num(level?.height));
  const compactUpper = stories === 2 && levelNumber === 2 && levelArea <= 1200;
  const maxRatio = compactUpper ? 0.14 : (stories === 2 && levelNumber === 2 ? 0.16 : 0.16);

  if (graphAnalysis.failures.length) {
    return graphAnalysis.failures[0];
  }

  if (analysis.hallRatio > maxRatio) {
    return `Hallway shape invalid: level ${levelNumber} hall ratio ${analysis.hallRatio.toFixed(2)} exceeds ${maxRatio.toFixed(2)}`;
  }

  const hallRooms = analysis.effectiveHallRooms;
  const spanningHall = hallRooms.find((room) => {
    const width = num(room?.w);
    const height = num(room?.h);
    const levelWidth = num(level?.width);
    return width >= levelWidth * 0.7 && height <= 6;
  });
  if (spanningHall) {
    return `Hallway shape invalid: level ${levelNumber} has a wide hall spine (${spanningHall?.label || spanningHall?.id})`;
  }

  if (stories === 2 && levelNumber === 2 && hallRooms.length > 2) {
    return `Hallway shape invalid: level ${levelNumber} has fragmented upper circulation (${hallRooms.length} hall rooms)`;
  }

  return null;
}

module.exports = {
  validateHallwayShape,
};
