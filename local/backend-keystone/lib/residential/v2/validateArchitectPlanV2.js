'use strict';

const { normalizeRoomType } = require('../../tile/canonicalRoomTypes');
const { roomArea, touchesExterior } = require('../../planGeometry');
const { buildRoomContract } = require('../roomContractBuilder');
const { validateBedroomFit } = require('../validators/bedroomFitValidator');
const { validateDiningFit } = require('../validators/diningFitValidator');
const { validatePrivateCirculation } = require('../validators/privateCirculationValidator');
const { buildHallwayAnalysis } = require('../../planQualityMetrics');
const { validateAreaDelta } = require('./validators/areaDeltaValidator');
const { validateBathFit } = require('./validators/bathFitValidator');
const { validateKitchenWorkflow } = require('./validators/kitchenWorkflowValidator');
const { validateHallwayShape } = require('./validators/hallwayShapeValidator');
const { validateStairLanding } = require('./validators/stairLandingValidator');
const { validateStairGeometry } = require('./validators/stairGeometryValidator');
const { validateStairEndpointPrivacy } = require('./validators/stairEndpointPrivacyValidator');
const { validateStairLandingTopology } = require('./validators/stairLandingTopologyValidator');
const { validateEntryCore } = require('./validators/entryCoreValidator');
const { validateSharedBathCirculation } = require('./validators/sharedBathCirculationValidator');
const { validateStudyBuffer } = require('./validators/studyBufferValidator');
const { validateRequestedFeatureRooms } = require('./validators/featureRoomPlacementValidator');

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function scoreArchitectPlanV2(planSpec, brief) {
  let score = 100;
  const issues = [];
  const warnings = [];

  const level1 = (planSpec?.levels || []).find((level) => num(level?.level, 1) === 1) || planSpec?.levels?.[0] || null;
  const level2 = (planSpec?.levels || []).find((level) => num(level?.level, 1) === 2) || null;

  const areaTarget = num(brief?.footprintAreaSqFtTarget || brief?.totalAreaSqFt);
  const deliveredArea = (planSpec?.levels || []).reduce((sum, level) => {
    return sum + (level?.rooms || []).reduce((roomSum, room) => roomSum + roomArea(room), 0);
  }, 0);
  score -= Math.round(Math.abs(deliveredArea - areaTarget) / 12);

  for (const level of planSpec?.levels || []) {
    const analysis = buildHallwayAnalysis(level, level.rooms, level.doors);
    score -= Math.round(analysis.hallRatio * 100);
  }

  if (level1) {
    const rooms = level1.rooms || [];
    const living = rooms.find((room) => normalizeRoomType(room?.type) === 'living_room');
    const dining = rooms.find((room) => normalizeRoomType(room?.type) === 'dining_room');
    const kitchen = rooms.find((room) => normalizeRoomType(room?.type) === 'kitchen');
    if (living && touchesExterior(living, level1.width, level1.height)) score += 6;
    if (kitchen && dining) score += 4;
    if (living && dining) score += 4;
  }

  if (level2) {
    const upperHallArea = (level2.rooms || [])
      .filter((room) => normalizeRoomType(room?.type) === 'hallway')
      .reduce((sum, room) => sum + roomArea(room), 0);
    if (upperHallArea <= (num(level2.width) * num(level2.height) * 0.12)) score += 6;
  }

  // Area fit is a ranking tradeoff. Preserve room-program targets through
  // assembly so excessive private-room area cannot win a saturated score tie.
  score = Math.min(100, score);
  for (const level of planSpec?.levels || []) {
    for (const room of level.rooms || []) {
      if (!['primary_bedroom', 'bedroom', 'bathroom', 'primary_bathroom'].includes(normalizeRoomType(room.type))) continue;
      const target = num(room.targetAreaSqFt);
      if (target <= 0) continue;
      const excess = roomArea(room) / target - 1.5;
      if (excess > 0) {
        score -= Math.ceil(excess * 40);
        issues.push(`room_target:${room.id}:actual_${roomArea(room)}_target_${target}`);
      }
    }
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    issues,
    warnings,
  };
}

function validateArchitectPlanV2(planSpec, brief) {
  const errors = [];
  const warnings = [];
  const garageType = String(brief?.garageType || '').toUpperCase();
  const maxServiceRatio = garageType === 'TWO_CAR' ? 0.45 : 0.38;

  const areaError = validateAreaDelta(planSpec, brief);
  if (areaError) errors.push(areaError);
  errors.push(...validateStairGeometry(planSpec));

  for (const level of planSpec?.levels || []) {
    const levelEntryCoreError = validateEntryCore(level, brief);
    if (levelEntryCoreError) errors.push(levelEntryCoreError);

    const levelKitchenError = validateKitchenWorkflow(level);
    if (levelKitchenError) errors.push(levelKitchenError);

    const levelHallError = validateHallwayShape(level, brief);
    if (levelHallError) errors.push(levelHallError);

    const levelStairError = validateStairLanding(level);
    if (levelStairError) errors.push(levelStairError);
    errors.push(...validateStairEndpointPrivacy(level, brief));
    errors.push(...validateStairLandingTopology(level, brief));
    errors.push(...validateSharedBathCirculation(level, brief));
    errors.push(...validateStudyBuffer(level));

    errors.push(...validatePrivateCirculation(level, brief));

    const serviceArea = (level.rooms || []).reduce((sum, room) => {
      const type = normalizeRoomType(room?.type);
      if (['laundry', 'mudroom', 'garage', 'storage'].includes(type)) {
        return sum + roomArea(room);
      }
      return sum;
    }, 0);
    const levelArea = Math.max(1, num(level?.width) * num(level?.height));
    if (serviceArea / levelArea > maxServiceRatio) {
      errors.push(`Service dominance invalid: level ${level?.level} service area ratio ${(serviceArea / levelArea).toFixed(2)} exceeds ${maxServiceRatio.toFixed(2)}`);
    }

    for (const room of level.rooms || []) {
      if (!room?.roomContract) {
        room.roomContract = buildRoomContract(room, brief);
      }

      const bedroomFitError = validateBedroomFit(room, brief);
      if (bedroomFitError) errors.push(bedroomFitError);

      const diningFitError = validateDiningFit(room, brief);
      if (diningFitError) errors.push(diningFitError);

      const bathFitError = validateBathFit(room);
      if (bathFitError) errors.push(bathFitError);
    }
  }

  errors.push(...validateRequestedFeatureRooms(planSpec, brief));

  const score = scoreArchitectPlanV2(planSpec, brief);
  return {
    errors,
    warnings,
    score,
  };
}

module.exports = {
  validateArchitectPlanV2,
  scoreArchitectPlanV2,
};
