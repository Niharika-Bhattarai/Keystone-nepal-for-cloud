'use strict';

const { roomArea } = require('../../../planGeometry');

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function validateAreaDelta(planSpec, brief) {
  const deliveredAreaSqFt = (planSpec?.levels || []).reduce((sum, level) => {
    return sum + (level?.rooms || []).reduce((roomSum, room) => roomSum + roomArea(room), 0);
  }, 0);

  const requestedAreaSqFt = num(brief?.footprintAreaSqFtTarget || brief?.totalAreaSqFt);
  const maxDeltaSqFt = Math.max(120, Math.round(requestedAreaSqFt * 0.08));
  const deltaSqFt = deliveredAreaSqFt - requestedAreaSqFt;

  if (Math.abs(deltaSqFt) > maxDeltaSqFt) {
    return `Area delta invalid: delivered ${deliveredAreaSqFt} sqft vs target ${requestedAreaSqFt} sqft (limit ${maxDeltaSqFt} sqft)`;
  }

  return null;
}

module.exports = {
  validateAreaDelta,
};
