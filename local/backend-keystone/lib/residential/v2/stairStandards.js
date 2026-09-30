'use strict';

// Template packing preferences, NOT code maxima or measured clear dimensions.
// Safety limits live in stairs/codeProfiles.js. Keep this API for existing
// cluster producers until physical core reservations replace their templates.
const RESIDENTIAL_STAIR_PLANNING_PREFERENCES = Object.freeze({
  minWidthFt: 4,
  maxWidthFt: 8,
  preferredWidthFt: 6,
  minRunFt: 10,
  maxRunFt: 16,
  preferredRunFt: 12,
  minLandingDepthFt: 6,
  maxLandingDepthFt: 8,
  maxLandingAreaSqFt: 72,
  maxLandingAspectRatio: 2.5,
  minLowerHallClearWidthFt: 4,
  allowedUpperLandingTypes: ['hallway', 'loft'],
  allowedLowerLandingTypes: ['entry', 'hallway'],
  compactUpperMaxConnectorCount: 1,
});
const RESIDENTIAL_STAIR_STANDARDS=RESIDENTIAL_STAIR_PLANNING_PREFERENCES;

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getResidentialStairStandards(options = {}) {
  // A wider doorway needs a longer landing edge, including its jambs.
  // This is a planning allowance, not a relaxation of stair clearances.
  return options.wideDoorways
    ? { ...RESIDENTIAL_STAIR_STANDARDS, maxLandingAreaSqFt: 80 }
    : RESIDENTIAL_STAIR_STANDARDS;
}

function bottomAlignedStairRect(container, overrides = {}) {
  const widthFt = Math.min(num(overrides.widthFt, RESIDENTIAL_STAIR_STANDARDS.preferredWidthFt), num(container?.w));
  const runFt = Math.min(num(overrides.runFt, RESIDENTIAL_STAIR_STANDARDS.preferredRunFt), num(container?.h));
  return {
    x: num(container?.x),
    y: num(container?.y) + Math.max(0, num(container?.h) - runFt),
    w: widthFt,
    h: runFt,
  };
}

function landingAboveStairRect(stairRect, overrides = {}) {
  const depthFt = num(overrides.depthFt, RESIDENTIAL_STAIR_STANDARDS.minLandingDepthFt);
  return {
    x: num(stairRect?.x),
    y: num(stairRect?.y) - depthFt,
    w: num(stairRect?.w),
    h: depthFt,
  };
}

module.exports = {
  RESIDENTIAL_STAIR_PLANNING_PREFERENCES,
  getResidentialStairStandards,
  bottomAlignedStairRect,
  landingAboveStairRect,
};
