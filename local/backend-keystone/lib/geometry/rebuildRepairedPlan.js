'use strict';

const { isDeepStrictEqual } = require('node:util');
const { buildBuildingModel, applyBuildingModel } = require('../buildingModel');
const { normalizeBrief } = require('../tile/normalizeBrief');
const { validateEditedPlan } = require('../validateEditedPlan');
const { computePlanQualityMetrics } = require('../planQualityMetrics');
const { checkSurveyRequirements } = require('../surveyRequirements');
const { buildSurveyFulfillment } = require('../surveyFulfillment');
const { renderPlanSvg } = require('../renderPlanSvg');
const { renderElevations } = require('../renderElevationSvg');
const { buildEstimate } = require('../estimate/buildEstimate');
const { resolveBedroomMeasurements } = require('./bedroomMeasurements');
const { createBedroomArchitecturalCheck } = require('./bedroomArchitecture');
const { checkBedroomApproach } = require('./bedroomApproach');
const { buildFloorPassageModel } = require('./floorPassageModel');

// Only these derived fields may change. Compare everything else, including all
// stair layouts/assemblies, openings, furniture and measurement books, exactly.
const ROOT_DERIVED = ['archetype','buildingModel','zones','facade','verticalModel','qualityMetrics',
  'elevations','surveyCompliance','surveyFulfillment','estimate'];
const LEVEL_DERIVED = ['zones','facade','verticalProfile'];
const ROOM_DERIVED = ['zone','openingIntent','adjacencyIntent','heightMeta'];
function preservedState(plan) {
  const copy = structuredClone(plan);
  for (const key of ROOT_DERIVED) delete copy[key];
  for (const level of copy.levels || []) {
    for (const key of LEVEL_DERIVED) delete level[key];
    for (const room of level.rooms || []) for (const key of ROOM_DERIVED) delete room[key];
  }
  return copy;
}

// Opt-in post-repair review artifact. Does not call enrichment, furniture/stair
// placement, opening placement, gallery persistence or a production API.
function rebuildRepairedPlan(plan, survey, options = {}) {
  const result = { status: 'not_checked', constructionVerified: false, productionReady: false,
    requiresProductionIntegration: true };
  const fail = (reason, errors) => ({ ...result, reason, ...(errors ? { errors } : {}) });
  if (options.enabled !== true) return { ...fail('Explicit metadata rebuild opt-in is required.'), status: 'disabled' };
  const { levelNumber, request } = options;
  if (!plan || !Array.isArray(plan.levels) || !survey || typeof survey !== 'object' || !Object.keys(survey).length ||
      !Number.isInteger(levelNumber) || !request || !['either','both'].includes(request.sidePolicy) ||
      !Number.isFinite(request.clearWidthFt) || request.clearWidthFt <= 0 ||
      (request.maxNodes !== undefined && (!Number.isInteger(request.maxNodes) || request.maxNodes < 1 || request.maxNodes > 40000))) return fail('Original survey and explicit bounded approach request are required.');
  try {
    const sourceLevels = plan.levels.filter(l => l.level === levelNumber);
    if (sourceLevels.length !== 1) return fail('A unique target floor is required.');
    const records = resolveBedroomMeasurements(sourceLevels[0]);
    if (records.errors.length) return fail('Persisted measurements are invalid.', records.errors);
    if (!records.records.some(r => r.bedId === request.bedId)) return fail('Persist the target bedroom measurements before rebuilding.');
    const initialErrors = validateEditedPlan(plan,survey);
    if (initialErrors.length) return fail('Input proposal fails original-survey validation.',initialErrors);
    if (plan.furniture !== undefined && (!Array.isArray(plan.furniture) || plan.levels.some(l => {
      const mirrors = plan.furniture.filter(f => f.level === l.level);
      return mirrors.length !== 1 || !isDeepStrictEqual(mirrors[0].items,l.furniture);
    }))) return fail('Aggregate furniture differs from floor furniture.');
    const before = preservedState(plan), proposed = structuredClone(plan), brief = normalizeBrief(survey);
    const model = buildBuildingModel(proposed, { brief, footprint: plan.buildingModel?.footprint || {}, archetype: plan.archetype || undefined });
    for (const modelLevel of model.levels) {
      const original = plan.levels.find(l => l.level === modelLevel.level);
      if (!original.verticalProfile) return fail('Existing vertical profiles are required; this rebuild cannot invent structural datums.');
      for (const key of ['floorZFt','ceilingZFt','clearHeightFt','nextFloorZFt','topOfStructureZFt','floorToFloorFt','structureThicknessFt']) {
        if (!isDeepStrictEqual(original.verticalProfile[key],modelLevel.verticalProfile[key])) return fail(`Survey changes vertical datum ${key} on floor ${original.level}; a structural migration is required.`);
      }
      modelLevel.verticalProfile = structuredClone(original.verticalProfile);
      modelLevel.stairCore = structuredClone(original.stairCore);
    }
    if (!plan.verticalModel) return fail('An existing vertical model is required.');
    model.verticalModel = structuredClone(plan.verticalModel);
    applyBuildingModel(proposed, model);
    // Protection is an edit constraint, not a classification to reset. The
    // generic building-model applicator derives it from zone; retain user locks.
    for (const level of proposed.levels) for (const room of level.rooms) {
      const original = plan.levels.find(l => l.level === level.level).rooms.find(r => r.id === room.id);
      if (Object.hasOwn(original,'protected')) room.protected = original.protected;
      else delete room.protected;
      const roomModel = proposed.buildingModel.levels.find(l => l.level === level.level).rooms.find(r => r.id === room.id);
      roomModel.protected = room.protected === true;
    }
    proposed.buildingModel.protectedRoomIds = proposed.levels.flatMap(l => l.rooms.filter(r => r.protected).map(r => r.id));
    if (!isDeepStrictEqual(before,preservedState(proposed))) return fail('Metadata rebuild altered protected plan state (including stair core geometry); no rebuilt plan is returned.');
    const assessments = [];
    for (const level of proposed.levels) {
      const resolved = resolveBedroomMeasurements(level);
      if (resolved.errors.length) return fail('Rebuilt geometry invalidates a persisted measurement.',resolved.errors);
      const physical = buildFloorPassageModel(level);
      if (physical.errors.length || Math.abs(physical.partition.residualSqFt) > 1e-7) return fail('Physical partition or opening validation failed.',physical.errors);
      for (const record of resolved.records) {
        const compiled = createBedroomArchitecturalCheck(level,record.bedroomId,record.bedId,record.policy);
        if (compiled.status !== 'ready') return fail(compiled.reason);
        const assessment = compiled.check(level.furniture.filter(f => f.roomId === record.bedroomId));
        if (assessment.status !== 'clear') return fail('A measured bedroom does not pass its architectural policy.',assessment.issues);
        assessments.push({ levelNumber:level.level,bedroomId:record.bedroomId,source:record.source,assessment });
      }
    }
    const approach = checkBedroomApproach(proposed.levels.find(l => l.level === levelNumber),request);
    if (approach.status !== 'clear') return fail('Rebuilt proposal fails the original approach request.',[approach]);
    proposed.qualityMetrics = computePlanQualityMetrics(proposed,brief);
    proposed.surveyCompliance = checkSurveyRequirements(proposed,brief);
    proposed.surveyFulfillment = buildSurveyFulfillment(proposed,survey);
    proposed.elevations = renderElevations(structuredClone(proposed),survey);
    proposed.estimate = buildEstimate(structuredClone(proposed),{ brief,surveyData:survey,finishSpec:proposed.finishSpec });
    const sheets = { normalSvg:renderPlanSvg(structuredClone(proposed),{style:'normal'}),
      renderedSvg:renderPlanSvg(structuredClone(proposed),{style:'rendered'}) };
    const errors = validateEditedPlan(proposed,survey);
    if (errors.length || !isDeepStrictEqual(before,preservedState(proposed))) return fail('Final rebuild validation or preservation check failed.',errors);
    return { ...result,status:'rebuilt',proposedPlan:proposed,sheets,assessments,approach,
      rebuiltFields:ROOT_DERIVED,
      retainedGenerationHistory:['furnitureDiagnostics','closetPlacementDiagnostics','openingDiagnostics'],
      limitations:['Original generation diagnostics are historical, not recomputed placement certifications.',
        'Only persisted bedroom policies and the explicitly requested local route are assessed.',
        'Sheets retain the existing concept renderer; measurement policies do not migrate its geometry or window heights.',
        'Concept estimates use repository rates; no current-price verification was performed.'],
      reason:'Derived building metadata, concept quality, survey evidence, elevations, estimate and sheets rebuilt without geometry changes.' };
  } catch (error) { return fail(`Rebuild rejected: ${error.message}`); }
}

module.exports = { rebuildRepairedPlan };
