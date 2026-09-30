'use strict';

const { normalizeRoomType } = require('../../../tile/canonicalRoomTypes');
const { computePlanQualityMetrics } = require('../../../planQualityMetrics');

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function scoreCirculationEfficiency({ planSpec, brief }) {
  const metrics = computePlanQualityMetrics(planSpec, brief);
  const levelMetrics = Array.isArray(metrics?.levels) ? metrics.levels : [];

  let score = 100;
  const issues = [];
  const warnings = [];

  for (const level of levelMetrics) {
    const levelNumber = num(level?.level, 1);
    const hallRatio = Math.max(0, num(level?.hall?.hallRatio, 0));
    const preferredHallRatio = Math.max(0.01, num(level?.hall?.preferredHallRatio, 0.12));
    const hallOverage = hallRatio - preferredHallRatio;

    if (hallOverage > 0) {
      const hallPenalty = Math.min(35, Math.round(hallOverage * 220));
      score -= hallPenalty;
      issues.push(`circulation:hall_overage:L${levelNumber}:${hallRatio.toFixed(3)}>${preferredHallRatio.toFixed(3)}`);
    } else if (hallRatio > 0 && hallRatio <= preferredHallRatio * 0.75) {
      score += 2;
    }

    const disconnected = Array.isArray(level?.entryTravel?.disconnectedRoomIds)
      ? level.entryTravel.disconnectedRoomIds
      : [];
    if (disconnected.length) {
      score -= Math.min(40, 12 + disconnected.length * 9);
      issues.push(`circulation:disconnected:L${levelNumber}:${disconnected.length}`);
    }

    const avgSteps = num(level?.entryTravel?.averageSteps, NaN);
    if (Number.isFinite(avgSteps) && avgSteps > 2.8) {
      const stepPenalty = Math.min(20, Math.round((avgSteps - 2.8) * 10));
      score -= stepPenalty;
      issues.push(`circulation:avg_steps:L${levelNumber}:${avgSteps.toFixed(2)}`);
    }

    const maxSteps = num(level?.entryTravel?.maxSteps, NaN);
    if (Number.isFinite(maxSteps) && maxSteps > 4) {
      const maxPenalty = Math.min(12, Math.round((maxSteps - 4) * 4));
      score -= maxPenalty;
      warnings.push(`circulation:max_steps:L${levelNumber}:${maxSteps}`);
    }
  }

  const loftRooms = (Array.isArray(planSpec?.levels) ? planSpec.levels : [])
    .flatMap((level) => Array.isArray(level?.rooms) ? level.rooms : [])
    .filter((room) => normalizeRoomType(room?.type) === 'loft');
  if (loftRooms.length) {
    score += 2;
  }

  const bounded = Math.max(0, Math.min(100, Math.round(score)));
  return {
    score: bounded,
    issues,
    warnings,
    metrics,
  };
}

module.exports = {
  scoreCirculationEfficiency,
};

