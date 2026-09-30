'use strict';

const { wallModelForLevel } = require('../../../geometry/wallModel');
const { deriveStairClearance, findNarrowStairs } = require('../../../geometry/clearanceGeometry');
const {getStairCodeProfile,ruleFeet}=require('../../../stairs/codeProfiles');
const {validateFittedLayout}=require('../../../stairs/validateFittedLayout');

const { normalizeRoomType } = require('../../../tile/canonicalRoomTypes');
const { shareWall } = require('../../../planGeometry');
const { getResidentialStairStandards } = require('../stairStandards');

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function roomById(level) {
  return new Map((Array.isArray(level?.rooms) ? level.rooms : []).map((room) => [String(room.id), room]));
}

function findStairRoom(level) {
  const rooms = Array.isArray(level?.rooms) ? level.rooms : [];
  const stairCore = level?.stairCore || null;
  return stairCore
    ? rooms.find((room) => String(room?.id) === String(stairCore?.roomId || '')) || rooms.find((room) => normalizeRoomType(room?.type) === 'stairs')
    : rooms.find((room) => normalizeRoomType(room?.type) === 'stairs');
}

function levelLabel(level) {
  return `level ${num(level?.level, 0)}`;
}

function stairDimensions(stairRoom) {
  const width = num(stairRoom?.w);
  const height = num(stairRoom?.h);
  return {
    width: Math.min(width, height),
    run: Math.max(width, height),
  };
}

function validateLandingRoom(level, stairRoom, errors) {
  const stairCore = level?.stairCore || null;
  if (!stairCore?.landingRoomId) return;
  const rooms = roomById(level);
  const landingRoom = rooms.get(String(stairCore.landingRoomId));
  if (!landingRoom) return;

  const standards = getResidentialStairStandards({ wideDoorways: level?.stairCore?.wideDoorways });
  const sharedEdge = shareWall(stairRoom, landingRoom, 2);
  if (!sharedEdge) return;

  const landingDepth = sharedEdge.kind === 'vertical' ? num(landingRoom?.w) : num(landingRoom?.h);
  const landingType = normalizeRoomType(landingRoom?.type);
  const lowerCirculationLanding = num(level?.level) === 1 && (landingType === 'entry' || landingType === 'hallway');

  if (lowerCirculationLanding) {
    // Preserve the existing nominal planning allowance. Finished-flight and
    // landing requirements are a separate model, never a smaller replacement.
    const nominalWidth = Math.min(num(landingRoom?.w), num(landingRoom?.h));
    if (nominalWidth < 4) {
      errors.push(`Stair geometry invalid: ${levelLabel(level)} lower circulation landing nominal width ${nominalWidth} ft is below 4 ft`);
    }
    return;
  }

  if (landingDepth < standards.minLandingDepthFt) {
    errors.push(`Stair geometry invalid: ${levelLabel(level)} landing depth ${landingDepth} ft is below ${standards.minLandingDepthFt} ft`);
  }
  // Maximum room depth, area and aspect are packing preferences. A larger
  // landing is not an unsafe stair. Access/clear landing checks remain required.
}

function validateStairGeometry(planSpec) {
  const errors = [];
  const levels = Array.isArray(planSpec?.levels) ? planSpec.levels : [];
  const stairRooms = [];

  for (const level of levels) {
    const stairRoom = findStairRoom(level);
    if (!stairRoom) continue;
    stairRooms.push({ level, stairRoom });

    const { width, run } = stairDimensions(stairRoom);
    let profile;
    try { profile=getStairCodeProfile(level.stairCore?.layout?.codeProfileId); }
    catch(error) {errors.push(`Stair geometry invalid: ${error.message}`);continue;}
    if (width < ruleFeet('minWidthAboveRails',profile)) {
      errors.push(`Stair geometry invalid: ${levelLabel(level)} nominal core cannot contain the profile minimum flight width`);
    }
    /* Existing plans use nominal planning dimensions. Apply the new finished
       flight checks only after explicit geometry migration. Missing or invalid
       measurements on a migrated level are findings, never silent passes. */
    const stairModel = level.finishedFaceGeometryVersion === 1 ? wallModelForLevel(level) : null;
    if (stairModel) {
      const clearance = deriveStairClearance(stairRoom, stairModel, 1, level.stairCore?.layout);
      for (const finding of findNarrowStairs(clearance)) {
        errors.push(`Stair geometry invalid: ${levelLabel(level)} ${finding.message}`);
      }
    }
    if (run <= 0) errors.push(`Stair geometry invalid: ${levelLabel(level)} allocated core must have positive dimensions`);
    validateLandingRoom(level, stairRoom, errors);
    if (level.stairCore?.layout?.valid === false) {
      errors.push(`Stair flight fit invalid: ${level.stairCore.layout.reason}`);
    }
    const layout = level.stairCore?.layout;
    if (layout) errors.push(...validateFittedLayout(layout,{core:stairRoom,profile}).errors.map(message=>`Stair flight fit invalid: ${message}`));
    else errors.push(`Stair flight fit invalid: ${levelLabel(level)} has no fitted flights to verify`);
  }

  if (stairRooms.length >= 2) {
    const [{ stairRoom: lower }, { stairRoom: upper }] = stairRooms;
    if (
      num(lower?.x) !== num(upper?.x) ||
      num(lower?.y) !== num(upper?.y) ||
      num(lower?.w) !== num(upper?.w) ||
      num(lower?.h) !== num(upper?.h)
    ) {
      errors.push('Stair geometry invalid: stacked stairs must keep the same x/y/w/h across levels');
    }
  }

  return errors;
}

module.exports = {
  validateStairGeometry,
};
