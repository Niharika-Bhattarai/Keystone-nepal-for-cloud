'use strict';

/* Candidate generation and ranking (execution plan P05, item 1).
 *
 * These functions used to live in api/plan.js, where they made up roughly half
 * the request handler and were reachable only through a `__ml` export added
 * for benchmarks. A search stage that needs to call them cannot sit behind an
 * HTTP handler's private escape hatch, and a benchmark importing `__ml` pins
 * the internal shape of that handler.
 *
 * Consumers import this module directly; the handler no longer exports __ml.
 */

const { validatePlanSpecSchema } = require('../../validateSchema');
const { validatePlanSpec } = require('../../validatePlan');
const { boundingRectOf, pointOnBoundaryOfRoom: pointOnBoundary, roomArea, shareWall: shareWallParts } = require('../../planGeometry');
const { scoreArchitectV2Candidates } = require('./scoring');
const { normalizeBrief } = require('../../tile/normalizeBrief');
const { resizeCandidates } = require('../../refinementResize');
const { validateConnectivity } = require('../../validateConnectivity');
const { buildHallwayAnalysis, computePlanQualityMetrics } = require('../../planQualityMetrics');
const { enrichPlanSpec } = require('../../buildingModel');
const { placeBedroomClosets } = require('../../placeBedroomClosets');
const { assessStrictConnectivityFeasibility, scoreCandidate } = require('../../tile/scoreFootprint');
const { placeOpenings } = require('../../placeOpenings');
const { refineOrthogonalRooms } = require('../../orthogonalRoomRefinement');
const { renderElevations } = require('../../renderElevationSvg');
const { buildProgramFromBrief } = require('../../tile/buildProgramFromBrief');
const { generateTilePlan } = require('../../tile/generateTilePlan');
const { mergeFillerRooms } = require('../../tile/mergeFillerRooms');
const { tilesToPlanSpec } = require('../../tile/tilesToPlanSpec');
const { validateSurveyRequirements, checkSurveyRequirements } = require('../../surveyRequirements');
const { buildProgramV2 } = require('./programBuilderV2');
const { planRealmsV2 } = require('./realmPlannerV2');
const { assemblePlanSpecV2 } = require('./assemblePlanSpecV2');
const { validateArchitectPlanV2 } = require('./validateArchitectPlanV2');

function tryApplyFreeformWishes(planSpec, surveyData) {
  const wishes = String(surveyData?.freeformWishes || '').trim();
  if (!wishes) return planSpec;
  try {
    const match = refineParseExact(wishes, planSpec);
    if (!match) return { ...planSpec, surveyFulfillment: { ...planSpec.surveyFulfillment, freeformWishes: { status: 'not_applied', reason: 'No supported deterministic resize instruction was recognized.' } } };
    const brief = normalizeBrief(surveyData || {});
    for (const rawChanges of resizeCandidates(planSpec, match.room.id, match.newW, match.newH)) {
      const sanitized = refineSanitizeDetailed(planSpec, rawChanges);
      if (sanitized.rejectedChanges.length || !sanitized.changes.length) continue;
      const updated = refineApplyDiff(planSpec, sanitized.changes);
      for (const level of updated.levels || []) { level.doors = []; level.windows = []; }
      const options = { brief, surveyData };
      const checked = enrichPlanSpec(placeOpenings(enrichPlanSpec(updated, options), surveyData || {}), options);
      const errors = collectStructuralErrors(checked, surveyData, { brief });
      if (checked.generatorId === 'architect_v2') errors.push(...validateArchitectPlanV2(checked, brief).errors);
      errors.push(...validateSurveyRequirements(checked, brief));
      if (errors.length) continue;
      checked.surveyFulfillment = { ...checked.surveyFulfillment, freeformWishes: { status: 'applied' } };
      return checked;
    }
    return { ...planSpec, surveyFulfillment: { ...planSpec.surveyFulfillment, freeformWishes: { status: 'not_applied', reason: 'The requested resize cannot fit while preserving room access, furnishings, and survey requirements.' } } };
  } catch (err) {
    console.warn('[plan] freeformWishes auto-refinement rejected:', err?.message);
    return { ...planSpec, surveyFulfillment: { ...planSpec.surveyFulfillment, freeformWishes: { status: 'not_applied', reason: String(err?.message || 'Resize failed validation') } } };
  }
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeType(value) {
  return String(value || '').trim().toLowerCase();
}

function isStrictDimensionRoomType(type) {
  const t = normalizeType(type);
  return t === 'hallway' || t === 'stairs';
}

function roomDisplayName(room) {
  return String(room?.label || room?.name || room?.type || room?.id || 'room');
}

function planAreaStats(planSpec, brief = null, footprint = null) {
  const levels = Array.isArray(planSpec?.levels) ? planSpec.levels : [];
  let deliveredAreaSqFt = 0;
  let deliveredNonGarageAreaSqFt = 0;

  for (const level of levels) {
    for (const room of Array.isArray(level?.rooms) ? level.rooms : []) {
      const area = roomArea(room);
      deliveredAreaSqFt += area;
      if (normalizeType(room?.type) !== 'garage') deliveredNonGarageAreaSqFt += area;
    }
  }

  const requestedConditionedAreaSqFt = num(
    brief?.conditionedAreaSqFt || brief?.totalAreaSqFt || planSpec?.totalAreaSqFt || footprint?.totalAreaSqFt
  );
  const requestedGrossAreaSqFt = num(
    brief?.footprintAreaSqFtTarget || requestedConditionedAreaSqFt
  );
  const effectiveRequestedAreaSqFt = requestedGrossAreaSqFt;
  const effectiveDeliveredAreaSqFt = deliveredAreaSqFt;

  return {
    requestedAreaSqFt: requestedConditionedAreaSqFt,
    requestedConditionedAreaSqFt,
    requestedGrossAreaSqFt,
    areaSemantics: brief?.hasGarage ? 'garage_adjusted_total_target' : 'gross_area_target',
    deliveredAreaSqFt,
    deliveredNonGarageAreaSqFt,
    effectiveRequestedAreaSqFt,
    effectiveDeliveredAreaSqFt,
    deliveredAreaDeltaSqFt: deliveredAreaSqFt - requestedGrossAreaSqFt,
    conditionedAreaDeltaSqFt: deliveredNonGarageAreaSqFt - requestedConditionedAreaSqFt,
    effectiveAreaDeltaSqFt: effectiveDeliveredAreaSqFt - effectiveRequestedAreaSqFt,
  };
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '')).filter(Boolean))];
}

function isArchitectTopologyFailure(errorText) {
  const text = String(errorText || '').toLowerCase();
  return (
    text.includes('topology') ||
    text.includes('hallway shape invalid') ||
    text.includes('stair privacy invalid') ||
    text.includes('entry/core invalid') ||
    text.includes('shared bath circulation') ||
    text.includes('private circulation')
  );
}

function splitArchitectV2Failures(errors) {
  const topologyFailures = [];
  const geometryFailures = [];

  for (const error of Array.isArray(errors) ? errors : []) {
    if (isArchitectTopologyFailure(error)) topologyFailures.push(String(error));
    else geometryFailures.push(String(error));
  }

  return {
    topologyFailures: uniqueStrings(topologyFailures),
    geometryFailures: uniqueStrings(geometryFailures),
  };
}

function buildArchitectV2Diagnostic(footprint, errors, stage, meta = {}) {
  const split = splitArchitectV2Failures(errors);
  return {
    ...buildCandidateDiagnostic(footprint, errors, stage),
    graphBuildStatus: meta.graphBuildStatus || null,
    assemblyStatus: meta.assemblyStatus || null,
    topologyFailures: split.topologyFailures,
    geometryFailures: split.geometryFailures,
  };
}

function getHardAreaDeltaLimitSqFt(areaStats) {
  const requested = Math.max(0, num(areaStats?.effectiveRequestedAreaSqFt));
  return Math.max(120, Math.round(requested * 0.08));
}

function getAreaDeltaHardGateError(areaStats) {
  const deltaSqFt = num(areaStats?.effectiveAreaDeltaSqFt);
  const limitSqFt = getHardAreaDeltaLimitSqFt(areaStats);
  if (Math.abs(deltaSqFt) <= limitSqFt) return null;
  return `Area delta invalid: delivered ${num(areaStats?.effectiveDeliveredAreaSqFt)} sqft vs target ${num(areaStats?.effectiveRequestedAreaSqFt)} sqft (limit ${limitSqFt} sqft)`;
}

function calibrateCandidateScore(rawScore, issues, warnings, areaStats) {
  let score = Math.max(0, Math.min(100, Number(rawScore) || 0));
  const issueList = Array.isArray(issues) ? issues : [];
  const warningList = Array.isArray(warnings) ? warnings : [];

  for (const issue of issueList) {
    if (String(issue).startsWith('hallway_absolute_overage:')) score -= 8;
    else if (String(issue).startsWith('hallway_bloat:')) score -= 10;
    else if (String(issue).startsWith('hallway_full_width_band:')) score -= 14;
    else if (String(issue).startsWith('bath_oversized:')) score -= 5;
    else if (String(issue).startsWith('bath_extreme_aspect:')) score -= 6;
    else if (String(issue).startsWith('room_extreme_ratio:')) score -= 4;
    else if (String(issue).startsWith('room_undersized:')) score -= 4;
    else if (String(issue).startsWith('stairs_')) score -= 6;
    else score -= 2;
  }

  if (warningList.length) {
    score -= Math.min(6, warningList.length);
  }

  const effectiveDelta = Math.abs(num(areaStats?.effectiveAreaDeltaSqFt));
  if (effectiveDelta > 40) {
    score -= Math.min(20, Math.round((effectiveDelta - 40) / 20));
  }

  if (issueList.length > 0) {
    score = Math.min(score, 96 - Math.min(10, issueList.length * 2));
  } else if (warningList.length > 0) {
    score = Math.min(score, 98);
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

function pointOnBoundaryOfRoom(room, x, y) {
  return pointOnBoundary(room, x, y);
}

function rectOf(room) {
  return boundingRectOf(room);
}

function shareWall(a, b, minSeg = 1) {
  return Boolean(shareWallParts(a, b, minSeg));
}

function isBathroomType(type, label) {
  const t = normalizeType(type);
  const l = normalizeType(label);
  return t.includes('bath') || t.includes('powder') || l.includes('bath') || l.includes('powder');
}

function isRelaxedHallConnector(room, level) {
  if (normalizeType(room?.type) !== 'hallway') return false;
  const id = String(room?.id || '');
  const bounds = rectOf(room);
  const area = roomArea(room);
  const shortSide = Math.min(bounds.w, bounds.h);
  if (id && id === String(level?.stairCore?.hallRoomId || '')) return true;
  if (id.includes('landing') || id.includes('connector')) return true;
  return shortSide <= 2 && area <= 16;
}

function isHabitableRoom(room) {
  const type = normalizeType(room?.type);
  if (!type) return true;

  const nonHabitable = new Set([
    'hallway',
    'stairs',
    'garage',
    'storage',
    'entry',
    'laundry',
    'mudroom',
    'closet',
    'pantry',
  ]);

  if (nonHabitable.has(type)) return false;
  if (isBathroomType(room?.type, room?.label)) return false;
  return true;
}

function getMinRulesForRoom(room, totalSqFt = 2000) {
  const label = normalizeType(room?.label || room?.name);
  const type  = normalizeType(room?.type);

  let minShortSide = 3;
  let minLongSide  = 0;
  let minArea      = 18;

  if (type === 'hallway' || label.includes('hall')) {
    minShortSide = 4;
    minArea = 24;
  }

  if (type === 'stairs' || label.includes('stair')) {
    minShortSide = 4;
    minLongSide = 8;
    minArea = 28;
  }

  if (type === 'kitchen' || label.includes('kitchen')) {
    minShortSide = 8;
    minArea = 80;
  }

  if (type === 'dining_room' || label.includes('dining')) {
    minShortSide = 7;
    minArea = 70;
  }

  if (type === 'living_room' || label.includes('living')) {
    minShortSide = 10;
    minArea = 120;
  }

  if (type === 'primary_bedroom') {
    minShortSide = 10;
    minArea = 140;
  } else if (
    type === 'bedroom' ||
    type === 'guest_bedroom' ||
    label.includes('bedroom')
  ) {
    minShortSide = 9;
    minArea = 90;
  }

  if (type === 'primary_bathroom') {
    minShortSide = 5;
    minArea = 45;
  } else if (type === 'bathroom' || label.includes('bath')) {
    minShortSide = 5;
    minArea = 35;
  }

  if (type === 'powder_room' || label.includes('powder')) {
    minShortSide = 4;
    minArea = 24;
  }

  if (label.includes('study') || label.includes('office') || type === 'study_room') {
    minShortSide = 7;
    minArea = 70;
  }

  if (label.includes('gaming') || type === 'gaming_room') {
    minShortSide = 7;
    minArea = 80;
  }

  if (label.includes('movie') || type === 'movie_room' || type === 'media_room') {
    minShortSide = 8;
    minArea = 100;
  }

  if (label.includes('library') || type === 'library') {
    minShortSide = 7;
    minArea = 80;
  }

  if (label.includes('gym') || type === 'gym') {
    minShortSide = 8;
    minArea = 80;
  }

  if (type === 'garage' || label.includes('garage')) {
    minShortSide = 14;
    minArea = 240;
  }
  
  if (totalSqFt < 1400) {
    minShortSide = Math.max(2, Math.floor(minShortSide * 0.7));
    minLongSide = Math.max(0, Math.floor(minLongSide * 0.7));
    minArea = Math.max(12, Math.floor(minArea * 0.7));
  } else if (totalSqFt < 2000) {
    minShortSide = Math.max(2, Math.floor(minShortSide * 0.85));
    minLongSide = Math.max(0, Math.floor(minLongSide * 0.85));
    minArea = Math.max(16, Math.floor(minArea * 0.85));
  }

  return { minShortSide, minLongSide, minArea };
}

function stripPlanSpecForValidation(planSpec) {
  return {
    ...(Object.hasOwn(planSpec || {}, 'stairAssemblies') ? {stairAssemblies:planSpec.stairAssemblies} : {}),
    stories: num(planSpec?.stories),
    totalAreaSqFt: num(planSpec?.totalAreaSqFt),
    levels: (Array.isArray(planSpec?.levels) ? planSpec.levels : []).map((lvl) => ({
      ...(Object.hasOwn(lvl, 'stairAssemblyIds') ? {stairAssemblyIds:lvl.stairAssemblyIds} : {}),
      ...(Object.hasOwn(lvl, 'openingScheduleBook') ? { openingScheduleBook: lvl.openingScheduleBook } : {}),
      ...(Object.hasOwn(lvl, 'bedroomMeasurementBook') ? { bedroomMeasurementBook: lvl.bedroomMeasurementBook } : {}),
      level: num(lvl?.level),
      width: num(lvl?.width),
      height: num(lvl?.height),
      protrusionFt: num(lvl?.protrusionFt),
      rooms: (Array.isArray(lvl?.rooms) ? lvl.rooms : []).map((room) => {
        const out = {
          id: String(room?.id || ''),
          type: room?.type,
          x: num(room?.x),
          y: num(room?.y),
          w: num(room?.w),
          h: num(room?.h),
          level: num(room?.level, num(lvl?.level)),
        };
        if (room?.label) out.label = room.label;
        if (room?.openConcept) out.openConcept = true;
        if (room?.bathroomUse) out.bathroomUse = room.bathroomUse;
        if (room?.attachedTo) out.attachedTo = room.attachedTo;
        if (room?.programId) out.programId = room.programId;
        return out;
      }),
      doors: (Array.isArray(lvl?.doors) ? lvl.doors : []).map((door) => {
        const out = {
          ...(door.id ? { id: door.id } : {}),
          x: num(door?.x),
          y: num(door?.y),
          dir: door?.dir === 'horizontal' ? 'horizontal' : 'vertical',
          a: String(door?.a || ''),
          b: String(door?.b || ''),
        };
        if (door?.isMainEntry) out.isMainEntry = true;
        if (door?.garageDoor) out.garageDoor = true;
        for (const flag of ['openThreshold', 'sliding', 'slidingDoor', 'cased']) {
          if (door?.[flag]) out[flag] = true;
        }
        if (Number.isFinite(Number(door?.width))) out.width = num(door.width);
        return out;
      }),
      windows: (Array.isArray(lvl?.windows) ? lvl.windows : []).map((window) => ({
        x: num(window?.x),
        y: num(window?.y),
        dir: window?.dir === 'horizontal' ? 'horizontal' : 'vertical',
      })),
    })),
  };
}

function collectStructuralErrors(planSpec, surveyData, opts = {}) {
  const { enforceConnectivity = true } = opts;
  const errors = [];
  errors.push(...require('../../stairs/validatePlanStairAssemblies').validatePlanStairAssemblies(planSpec));
  errors.push(...require('../../surveyCapabilities').surveyCapabilityGaps(surveyData).map(gap=>`Survey capability (${gap.field}): ${gap.message}`));
  const validationPlanSpec = stripPlanSpecForValidation(planSpec);

  const schema = validatePlanSpecSchema(validationPlanSpec);
  if (!schema.valid) {
    errors.push(...schema.errors.map(err => `Schema: ${err}`));
  }

  const domain = validatePlanSpec(planSpec, surveyData, opts.brief || null);
  if (Array.isArray(domain) && domain.length) {
    errors.push(...domain.map(err => `Logic: ${err}`));
  }

  const levels = Array.isArray(planSpec?.levels) ? planSpec.levels : [];
  for (const lvl of levels) {
    const rooms = Array.isArray(lvl?.rooms) ? lvl.rooms : [];
    const doors = Array.isArray(lvl?.doors) ? lvl.doors : [];
    const windows = Array.isArray(lvl?.windows) ? lvl.windows : [];
    const sumRooms = rooms.reduce((sum, room) => sum + roomArea(room), 0);
    const footprintArea = num(lvl?.envelopeAreaSqFt, num(lvl?.width) * num(lvl?.height));
    const byId = new Map(rooms.map((r) => [String(r.id), r]));

    if (Number.isFinite(sumRooms) && Number.isFinite(footprintArea)) {
      const areaDelta = Math.abs(sumRooms - footprintArea);
      if (areaDelta > 24) {
        errors.push(`Logic: Level ${lvl.level} area mismatch: sumRooms=${sumRooms}, footprint=${footprintArea}`);
      }
    }

    // Entry requirement: level 1 must have at least one non-garage exterior entry.
    if (num(lvl?.level, 1) === 1) {
      const hasMainEntry = doors.some((d) => {
        if (String(d?.b) !== '__exterior__') return false;
        if (d?.garageDoor) return false;
        if (d?.isMainEntry) return true;
        const roomA = byId.get(String(d?.a || ''));
        const t = normalizeType(roomA?.type);
        return t !== 'garage';
      });
      if (!hasMainEntry) {
        errors.push('Logic: Level 1 is missing a main exterior entry door');
      }
    }

    // Door geometry sanity and door-window collision checks.
    for (const d of doors) {
      const a = byId.get(String(d?.a || ''));
      const b = byId.get(String(d?.b || ''));
      if (String(d?.b) !== '__exterior__') {
        if (!a || !b) {
          errors.push(`Logic: Door references missing room: ${String(d?.a || '')} / ${String(d?.b || '')}`);
          continue;
        }
        const onA = pointOnBoundaryOfRoom(a, d?.x, d?.y);
        const onB = pointOnBoundaryOfRoom(b, d?.x, d?.y);
        if (!onA || !onB) {
          errors.push(`Logic: Door ${String(d?.a)}<->${String(d?.b)} at (${num(d?.x)},${num(d?.y)}) is not on both room boundaries`);
        }
      }

      const overlapsWindow = windows.some((w) =>
        String(w?.dir || '') === String(d?.dir || '') &&
        Math.abs(num(w?.x) - num(d?.x)) < 1e-6 &&
        Math.abs(num(w?.y) - num(d?.y)) < 1e-6
      );
      if (overlapsWindow) {
        errors.push(`Logic: Door-window collision at (${num(d?.x)},${num(d?.y)}) on level ${lvl.level}`);
      }
    }
  }

  if (enforceConnectivity) {
    const connectivity = validateConnectivity(planSpec, surveyData);
    if (Array.isArray(connectivity) && connectivity.length) {
      errors.push(...connectivity.map(err => `Logic: ${err}`));
    }
  }

  return errors;
}

function getFootprintAspectRatio(footprint) {
  const widthFt = num(footprint?.widthFt);
  const heightFt = num(footprint?.heightFt);
  if (widthFt <= 0 || heightFt <= 0) return 0;
  return widthFt >= heightFt ? widthFt / heightFt : heightFt / widthFt;
}

function getStrictFootprintAspectBounds(brief, footprint) {
  const stories = Math.max(1, num(brief?.stories || brief?.floors || footprint?.stories || 1));
  const totalAreaSqFt = num(footprint?.totalAreaSqFt || brief?.targetSqft || brief?.totalAreaSqFt);
  const hasGarage = Boolean(brief?.hasGarage) || ['ONE_CAR', 'TWO_CAR'].includes(String(brief?.garageType || '').toUpperCase());
  const lotContext = String(brief?.lotContext || '').toUpperCase();
  const compactUrbanishSingleStory = !hasGarage && (lotContext === 'URBAN' || totalAreaSqFt < 1800);

  if (stories <= 1) {
    if (totalAreaSqFt >= 2200 && hasGarage) {
      if (lotContext === 'VIEW' || lotContext === 'WATERFRONT' || lotContext === 'CORNER') {
        return { min: 1.25, max: 3.25 };
      }
      return { min: 1.25, max: 3.10 };
    }
    if (totalAreaSqFt >= 1800) return { min: 1.35, max: 2.35 };
    if (totalAreaSqFt >= 1200 && compactUrbanishSingleStory) return { min: 1.05, max: 2.55 };
    if (totalAreaSqFt >= 1200) return { min: 1.20, max: 2.50 };
    return { min: 1.05, max: 2.75 };
  }

  if (totalAreaSqFt >= 1800) return { min: 1.20, max: 2.60 };
  return { min: 1.05, max: 2.80 };
}

function hasUpperHallGalleryPattern(level, hallAnalysis) {
  const hallRooms = Array.isArray(hallAnalysis?.effectiveHallRooms) ? hallAnalysis.effectiveHallRooms : [];
  const allHallRooms = Array.isArray(hallAnalysis?.hallRooms) ? hallAnalysis.hallRooms : [];
  const levelWidth = Math.max(1, num(level?.width));
  const levelHeight = Math.max(1, num(level?.height));
  const wideBands = hallRooms.filter((room) => num(room?.w) >= levelWidth * 0.7 && num(room?.h) <= 6);
  const coreSegments = allHallRooms.filter((room) => num(room?.w) <= 6 && num(room?.h) >= levelHeight * 0.2);
  return Boolean(level?.stairCore?.hallRoomId) && (wideBands.length >= 2 || (wideBands.length >= 1 && coreSegments.length >= 2));
}

function collectArchitecturalHardErrors(planSpec, footprint, brief) {
  const errors = [];
  const levels = Array.isArray(planSpec?.levels) ? planSpec.levels : [];
  const openConceptWanted =
    brief?.openConcept === true ||
    String(brief?.openConcept || '').toUpperCase() === 'OPEN';
  const stories = Math.max(1, num(brief?.stories || footprint?.stories || levels.length || 1));
  const totalAreaSqFt = num(footprint?.totalAreaSqFt || brief?.totalAreaSqFt);

  const footprintAspectRatio = getFootprintAspectRatio(footprint);
  const aspectBounds = getStrictFootprintAspectBounds(brief, footprint);

  if (
    footprintAspectRatio > 0 &&
    (footprintAspectRatio < aspectBounds.min || footprintAspectRatio > aspectBounds.max)
  ) {
    errors.push(
      `Architecture: footprint aspect ratio ${footprintAspectRatio.toFixed(2)} is outside strict bounds ` +
      `[${aspectBounds.min.toFixed(2)}, ${aspectBounds.max.toFixed(2)}]`
    );
  }

  for (const lvl of levels) {
    const rooms = Array.isArray(lvl?.rooms) ? lvl.rooms : [];
    const doors = Array.isArray(lvl?.doors) ? lvl.doors : [];
    const levelWidth = num(lvl?.width, num(footprint?.widthFt));
    const levelArea = Math.max(1, num(lvl?.width) * num(lvl?.height));
    const hallAnalysis = buildHallwayAnalysis(lvl, rooms, doors);
    const hallRooms = hallAnalysis.hallRooms;
    const effectiveHallRooms = hallAnalysis.effectiveHallRooms;
    const storageRooms = rooms.filter((r) => normalizeType(r?.type) === 'storage');
    const bedroomRooms = rooms.filter((r) => {
      const t = normalizeType(r?.type);
      return t === 'bedroom' || t === 'primary_bedroom' || t === 'guest_bedroom';
    });

    // Hallway bloat / fragmentation guards.
    const hallArea = hallAnalysis.hallArea;
    const stairAnchoredHall = Boolean(lvl?.stairCore?.hallRoomId);
    const galleryHall = hasUpperHallGalleryPattern(lvl, hallAnalysis);
    const maxHallRatio = galleryHall
      ? 0.30
      : hallAnalysis.intentionalConnected
        ? (stairAnchoredHall ? 0.22 : 0.20)
        : (stairAnchoredHall ? 0.18 : 0.16);
    if (hallArea / levelArea > maxHallRatio) {
      errors.push(`Architecture: Level ${lvl.level} hallway area is oversized (${hallArea} sqft > ${(maxHallRatio * 100).toFixed(0)}% of level)`);
    }
    const fragmentedHallway =
      effectiveHallRooms.length > (stairAnchoredHall ? 4 : 3) ||
      hallAnalysis.components.length > (stairAnchoredHall ? 2 : 1) ||
      (!hallAnalysis.intentionalConnected && !stairAnchoredHall && effectiveHallRooms.length > 2);
    if (fragmentedHallway) {
      errors.push(`Architecture: Level ${lvl.level} has fragmented hallway layout (${effectiveHallRooms.length} hallway rooms)`);
    }

    // Storage should not crowd out core bedrooms.
    const storageArea = storageRooms.reduce((s, r) => s + roomArea(r), 0);
    const undersizedBedroomExists = bedroomRooms.some((r) => {
      const bounds = rectOf(r);
      const w = bounds.w;
      const h = bounds.h;
      const area = roomArea(r);
      const short = Math.min(w, h);
      const t = normalizeType(r?.type);
      if (t === 'primary_bedroom') return short < 10 || area < 140;
      return short < 9 || area < 90;
    });
    if (undersizedBedroomExists && (storageRooms.length > 1 || storageArea > 120)) {
      errors.push(`Architecture: Level ${lvl.level} storage is over-prioritized while bedroom minimums are violated`);
    }

    // Open concept should avoid public-public interior doors.
    if (openConceptWanted) {
      const byId = new Map(rooms.map((r) => [String(r.id), r]));
      for (const d of doors) {
        if (String(d?.b) === '__exterior__') continue;
        const a = byId.get(String(d?.a || ''));
        const b = byId.get(String(d?.b || ''));
        const ta = normalizeType(a?.type);
        const tb = normalizeType(b?.type);
        const aPublic = ta === 'living_room' || ta === 'dining_room' || ta === 'kitchen';
        const bPublic = tb === 'living_room' || tb === 'dining_room' || tb === 'kitchen';
        if (aPublic && bPublic) {
          errors.push(`Architecture: Open concept requested, but public-room door exists (${String(d?.a)}<->${String(d?.b)})`);
          break;
        }
      }
    }

    // Stair endpoint logic:
    // On each level, stairs should be accessed from the hallway landing side only.
    // Multiple or non-hall stair doors are treated as unusable/dead-end access.
    const byId = new Map(rooms.map((r) => [String(r.id), r]));
    const stairRooms = rooms.filter((r) => normalizeType(r?.type) === 'stairs');
    const hallRoomsById = new Set(
      rooms.filter((r) => normalizeType(r?.type) === 'hallway').map((r) => String(r.id))
    );
    for (const stair of stairRooms) {
      const stairId = String(stair.id);
      const stairDoorNeighbors = [];
      for (const d of doors) {
        if (String(d?.b) === '__exterior__') continue;
        const a = String(d?.a || '');
        const b = String(d?.b || '');
        if (a === stairId) stairDoorNeighbors.push(b);
        else if (b === stairId) stairDoorNeighbors.push(a);
      }

      const uniqueNeighbors = [...new Set(stairDoorNeighbors)];
      const landingRoomId = String(lvl?.stairCore?.landingRoomId || lvl?.stairCore?.hallRoomId || '');
      const landingOpen = Boolean(lvl?.stairCore?.landingOpen);
      const allowedLandingIds = new Set(hallRoomsById);
      if (landingOpen && landingRoomId) allowedLandingIds.add(landingRoomId);
      if (!uniqueNeighbors.length) {
        errors.push(`Architecture: Level ${lvl.level} stairs have no interior access door`);
        continue;
      }

      if (allowedLandingIds.size > 0) {
        const allFromLanding = uniqueNeighbors.every((id) => allowedLandingIds.has(String(id)));
        if (!allFromLanding) {
          errors.push(`Architecture: Level ${lvl.level} stairs must connect only to hallway landing`);
        }
        const landingHallId = landingRoomId;
        const allowedMultiHall =
          allFromLanding &&
          uniqueNeighbors.length <= 3 &&
          (!landingHallId || uniqueNeighbors.includes(landingHallId));
        if (uniqueNeighbors.length > 1 && !allowedMultiHall) {
          errors.push(`Architecture: Level ${lvl.level} stairs have multiple access doors; expected single landing access`);
        }
      }
    }

    for (const room of rooms) {
      const bounds = rectOf(room);
      const width = bounds.w;
      const height = bounds.h;
      if (width <= 0 || height <= 0) continue;

      const name = roomDisplayName(room);
      const shortSide = Math.min(width, height);
      const longSide = Math.max(width, height);
      const area = roomArea(room);
      const ratio = shortSide > 0 ? longSide / shortSide : Infinity;
      const rules = getMinRulesForRoom(room, footprint?.totalAreaSqFt);
      const strictDims = isStrictDimensionRoomType(room?.type);
      const relaxedHallConnector = isRelaxedHallConnector(room, lvl);

      // Hard gate policy:
      // - circulation geometry (hallways/stairs) remains strict.
      // - other rooms are allowed a bounded tolerance and treated as hard-fail
      //   only when materially undersized.
      const hardShortMin = relaxedHallConnector
        ? 2
        : strictDims
          ? rules.minShortSide
          : Math.max(2, Math.floor(rules.minShortSide * 0.75));
      const hardLongMin = relaxedHallConnector
        ? 0
        : strictDims
          ? rules.minLongSide
          : Math.max(0, Math.floor(rules.minLongSide * 0.75));
      const hardAreaMin = relaxedHallConnector
        ? 8
        : strictDims
          ? rules.minArea
          : Math.max(12, Math.floor(rules.minArea * 0.70));

      if (shortSide < hardShortMin) {
        errors.push(
          `Architecture: Level ${lvl.level} room "${name}" short side ${shortSide}ft is below minimum ${rules.minShortSide}ft`
        );
      }

      if (hardLongMin && longSide < hardLongMin) {
        errors.push(
          `Architecture: Level ${lvl.level} room "${name}" long side ${longSide}ft is below minimum ${rules.minLongSide}ft`
        );
      }

      if (area < hardAreaMin) {
        errors.push(
          `Architecture: Level ${lvl.level} room "${name}" area ${area} sqft is below minimum ${rules.minArea} sqft`
        );
      }

      if (isBathroomType(room?.type, room?.label)) {
        if (ratio > 5) {
          errors.push(
            `Architecture: Level ${lvl.level} bathroom "${name}" has extreme aspect ratio ${ratio.toFixed(2)}:1 (${width}x${height})`
          );
        }

        if (levelWidth > 0 && longSide > levelWidth * 0.60) {
          errors.push(
            `Architecture: Level ${lvl.level} bathroom "${name}" spans ${longSide}ft which exceeds 60% of level width ${levelWidth}ft`
          );
        }
      } else if (isHabitableRoom(room)) {
        const type = normalizeType(room?.type);
        const maxHabitableRatio =
          type === 'primary_bedroom' && stories === 1 && totalAreaSqFt >= 2200
            ? 4.75
            : 4;
        if (ratio <= maxHabitableRatio) continue;
        errors.push(
          `Architecture: Level ${lvl.level} habitable room "${name}" has extreme aspect ratio ${ratio.toFixed(2)}:1 (${width}x${height})`
        );
      }
    }
  }

  // Program priority guard: laundry should exist in every home.
  const allRooms = levels.flatMap((l) => Array.isArray(l?.rooms) ? l.rooms : []);
  const hasLaundry = allRooms.some((r) => normalizeType(r?.type) === 'laundry');
  if (!hasLaundry) {
    errors.push('Architecture: Missing required laundry room');
  }

  return errors;
}

function collectWarnings(planSpec, footprint, brief) {
  const warnings = [];

  const levels = Array.isArray(planSpec?.levels) ? planSpec.levels : [];
  for (const lvl of levels) {
    const rooms = Array.isArray(lvl?.rooms) ? lvl.rooms : [];
    for (const room of rooms) {
      const bounds = rectOf(room);
      const width = bounds.w;
      const height = bounds.h;
      if (width <= 0 || height <= 0) continue;

      const rules = getMinRulesForRoom(room, footprint?.totalAreaSqFt);
      const shortSide = Math.min(width, height);
      const longSide = Math.max(width, height);
      const area = roomArea(room);
      const name = roomDisplayName(room);

      if (shortSide === rules.minShortSide || area === rules.minArea || (rules.minLongSide && longSide === rules.minLongSide)) {
        warnings.push(`Architecture warning: Level ${lvl.level} room "${name}" is exactly at a minimum threshold`);
      }
    }
  }

  const ar = getFootprintAspectRatio(footprint);
  const bounds = getStrictFootprintAspectBounds(brief, footprint);
  if (ar > 0) {
    const nearLower = Math.abs(ar - bounds.min) <= 0.05;
    const nearUpper = Math.abs(ar - bounds.max) <= 0.05;
    if (nearLower || nearUpper) {
      warnings.push(`Architecture warning: footprint aspect ratio ${ar.toFixed(2)} is near strict limit`);
    }
  }

  return warnings;
}

function summarizeCandidateFailure(errors) {
  const summary = {
    structural: 0,
    architectural: 0,
    schema: 0,
    logic: 0,
    other: 0,
  };

  for (const error of errors) {
    const text = String(error || '');
    if (text.startsWith('Schema:')) summary.schema += 1;
    else if (text.startsWith('Logic:')) summary.logic += 1;
    else if (text.startsWith('Architecture:')) summary.architectural += 1;
    else summary.other += 1;
  }

  summary.structural = summary.schema + summary.logic;
  return summary;
}

function buildCandidateDiagnostic(footprint, errors, stage) {
  return {
    stage,
    footprint: {
      widthFt: num(footprint?.widthFt),
      heightFt: num(footprint?.heightFt),
      aspectRatio: num(footprint?.aspectRatio || getFootprintAspectRatio(footprint)),
      totalAreaSqFt: num(footprint?.totalAreaSqFt),
      variationId: String(footprint?.variationId || 'variant_a_compact_core'),
      variationLabel: String(footprint?.variationLabel || 'Compact Core'),
      variationTheme: String(footprint?.variationTheme || 'balanced_compact'),
    },
    errorCount: errors.length,
    errorSummary: summarizeCandidateFailure(errors),
    errors,
  };
}

function postProcessPlanSpec(planSpec, brief, footprint, surveyData, opts = {}) {
  const skipElevation = Boolean(opts?.skipElevation);
  const skipRefine = Boolean(opts?.skipRefine);

  let processed = enrichPlanSpec(planSpec, {
    brief,
    footprint,
    archetype: brief.archetype,
    surveyData,
  });

  const strictConnectivity = assessStrictConnectivityFeasibility(processed);

  processed = placeOpenings(processed, surveyData);
  processed = enrichPlanSpec(processed, {
    brief,
    footprint,
    archetype: brief.archetype,
    surveyData,
  });

  if (!skipRefine) {
    processed = refineOrthogonalRooms(processed, {
      brief,
      footprint,
      surveyData,
    });
    processed = placeOpenings(processed, surveyData);
    processed = enrichPlanSpec(processed, {
      brief,
      footprint,
      archetype: brief.archetype,
      surveyData,
    });
  }

  processed = tryApplyFreeformWishes(processed, surveyData);
  processed = placeBedroomClosets(processed, brief);
  if (processed.closetPlacementDiagnostics.length) {
    processed = enrichPlanSpec(processed, { brief, footprint, archetype: brief.archetype, surveyData });
  }
  processed = require('./outdoorLiving').attachOutdoorLiving(processed, brief);
  processed.qualityMetrics = computePlanQualityMetrics(processed, brief);
  if (brief.openConcept) processed.openConcept = true;
  if (!skipElevation) {
    processed.elevations = renderElevations(processed, surveyData);
  }

  return {
    planSpec: processed,
    strictConnectivity,
  };
}

function tryGenerateCandidate(brief, footprint, surveyData, opts = {}) {
  const diagnostics = [];

  try {
    const skipElevation = Boolean(opts?.skipElevation);
    const program = buildProgramFromBrief(brief, footprint);
    const tilePlan = generateTilePlan(program, footprint, brief);
    const mergedTilePlan = mergeFillerRooms(tilePlan);
    const rawPlanSpec = tilesToPlanSpec(mergedTilePlan, footprint, brief);
    const {
      planSpec,
      strictConnectivity,
    } = postProcessPlanSpec(rawPlanSpec, brief, footprint, surveyData, {
      skipElevation,
      skipRefine: false,
    });

    const structuralErrors = collectStructuralErrors(planSpec, surveyData, {
      enforceConnectivity: true,
      brief,
    });
    structuralErrors.push(...validateSurveyRequirements(planSpec, brief));
    planSpec.surveyCompliance = checkSurveyRequirements(planSpec, brief);
    planSpec.designSurvey = JSON.parse(JSON.stringify(surveyData));
    planSpec.surveyFulfillment = require('../../surveyFulfillment').buildSurveyFulfillment(planSpec,surveyData,brief);
    if (structuralErrors.length) {
      return {
        ok: false,
        diagnostics: [buildCandidateDiagnostic(footprint, structuralErrors, 'structural_validation')],
      };
    }

    const architecturalErrors = collectArchitecturalHardErrors(planSpec, footprint, brief);
    const areaStats = planAreaStats(planSpec, brief, footprint);
    const areaDeltaHardGate = getAreaDeltaHardGateError(areaStats);
    if (areaDeltaHardGate) {
      return {
        ok: false,
        diagnostics: [buildCandidateDiagnostic(footprint, [areaDeltaHardGate], 'legacy_area_delta_gate')],
      };
    }

    if (architecturalErrors.length) {
      const { score, issues, warnings: qualityWarnings = [] } = scoreCandidate(planSpec, footprint, brief);
      const candidateWarnings = [
        ...collectWarnings(planSpec, footprint, brief),
        ...qualityWarnings,
      ];
      const boundedScore = calibrateCandidateScore(
        score,
        issues,
        candidateWarnings,
        areaStats
      );
      const hardGatePenalty = Math.min(45, architecturalErrors.length * 12);
      const fallbackScore = Math.max(0, boundedScore - hardGatePenalty);
      const fallbackScoreIssues = [
        ...(Array.isArray(issues) ? issues : []),
        `architectural_quality_gate_rejection:${architecturalErrors.length}`,
      ];
      return {
        ok: false,
        diagnostics: [buildCandidateDiagnostic(footprint, architecturalErrors, 'architectural_quality_gate')],
        fallbackResult: {
          planSpec,
          footprint,
          score: fallbackScore,
          scoreIssues: fallbackScoreIssues,
          warnings: candidateWarnings,
          areaStats,
          fallbackReason: 'architectural_quality_gate',
          hardErrors: architecturalErrors,
        },
      };
    }

    const { score, issues, warnings: qualityWarnings = [] } = scoreCandidate(planSpec, footprint, brief);
    const warnings = [
      ...collectWarnings(planSpec, footprint, brief),
      ...qualityWarnings,
    ];
    const calibratedScore = calibrateCandidateScore(score, issues, warnings, areaStats);
    const areaIssue =
      Math.abs(areaStats.effectiveAreaDeltaSqFt) > 80
        ? [
            `${
              brief.hasGarage ? 'garage_adjusted_area_delta' : 'gross_area_delta'
            }:${areaStats.effectiveAreaDeltaSqFt > 0 ? '+' : ''}${areaStats.effectiveAreaDeltaSqFt}sqft`,
          ]
        : [];
    return {
      ok: true,
      result: {
        planSpec,
        footprint,
        score: calibratedScore,
        scoreIssues: [
          ...(Array.isArray(issues) ? issues : []),
          ...areaIssue,
          ...(strictConnectivity.infeasible ? ['pre_door_connectivity_repaired_or_penalized'] : []),
        ],
        warnings,
        areaStats,
      },
    };
  } catch (err) {
    diagnostics.push(buildCandidateDiagnostic(
      footprint,
      [`Runtime: ${String(err?.message || err || 'unknown generation error')}`],
      'generation_exception'
    ));

    return {
      ok: false,
      diagnostics,
    };
  }
}

function tryGenerateArchitectV2Candidate(brief, interpretation, footprint, surveyData, opts = {}) {
  const diagnostics = [];
  let graphBuildStatus = 'not_started';
  let assemblyStatus = 'not_started';

  try {
    graphBuildStatus = 'building';
    const program = buildProgramV2(brief, interpretation, footprint);
    graphBuildStatus = 'ok';
    assemblyStatus = 'assembling';
    const layout = planRealmsV2({
      brief,
      interpretation,
      footprint,
      program,
    });
    assemblyStatus = 'ok';
    const rawPlanSpec = assemblePlanSpecV2(layout, brief, footprint, interpretation);
    const {
      planSpec,
      strictConnectivity,
    } = postProcessPlanSpec(rawPlanSpec, brief, footprint, surveyData, {
      skipElevation: Boolean(opts?.skipElevation),
      skipRefine: true,
    });

    const structuralErrors = collectStructuralErrors(planSpec, surveyData, {
      enforceConnectivity: true,
      brief,
    });
    if (structuralErrors.length) {
      return {
        ok: false,
        diagnostics: [buildArchitectV2Diagnostic(footprint, structuralErrors, 'architect_v2_structural_validation', {
          graphBuildStatus,
          assemblyStatus,
        })],
        ...(opts.captureRejectedPlan ? { rejectedPlan: planSpec } : {}),
      };
    }

    const architectural = validateArchitectPlanV2(planSpec, brief);
    architectural.errors.push(...validateSurveyRequirements(planSpec, brief));
    planSpec.surveyCompliance = checkSurveyRequirements(planSpec, brief);
    planSpec.designSurvey = JSON.parse(JSON.stringify(surveyData));
    planSpec.surveyFulfillment = require('../../surveyFulfillment').buildSurveyFulfillment(planSpec,surveyData,brief);
    if (architectural.errors.length) {
      return {
        ok: false,
        diagnostics: [buildArchitectV2Diagnostic(footprint, architectural.errors, 'architect_v2_quality_gate', {
          graphBuildStatus,
          assemblyStatus,
        })],
        ...(opts.captureRejectedPlan ? { rejectedPlan: planSpec } : {}),
      };
    }

    const areaStats = planAreaStats(planSpec, brief, footprint);
    return {
      ok: true,
      result: {
        planSpec,
        footprint,
        graph: program?.graph || null,
        baseScore: architectural.score.score,
        score: architectural.score.score,
        scoreIssues: [
          ...(architectural.score.issues || []),
          ...(strictConnectivity.infeasible ? ['pre_door_connectivity_repaired_or_penalized'] : []),
        ],
        warnings: architectural.score.warnings || [],
        areaStats,
        graphDiagnostics: {
          graphBuildStatus,
          assemblyStatus,
          topologyFailures: [],
          geometryFailures: [],
        },
      },
    };
  } catch (err) {
    if (graphBuildStatus !== 'ok') graphBuildStatus = 'failed';
    if (assemblyStatus !== 'ok') assemblyStatus = 'failed';
    diagnostics.push(buildArchitectV2Diagnostic(
      footprint,
      [`Runtime: ${String(err?.message || err || 'unknown architect_v2 generation error')}`],
      'architect_v2_generation_exception',
      {
        graphBuildStatus,
        assemblyStatus,
      }
    ));

    return {
      ok: false,
      diagnostics,
    };
  }
}

function rankAcceptedCandidates(results, options = {}) {
  const scoringMode = String(options?.scoringMode || 'basic');

  function deliveredAreaDelta(result) {
    if (Number.isFinite(num(result?.areaStats?.effectiveAreaDeltaSqFt, NaN))) {
      return Math.abs(num(result.areaStats.effectiveAreaDeltaSqFt));
    }
    const areaStats = planAreaStats(result?.planSpec, null, result?.footprint);
    return Math.abs(num(areaStats.effectiveAreaDeltaSqFt));
  }

  return [...results].sort((a, b) => {
    const aHardErrors = Array.isArray(a?.hardErrors) ? a.hardErrors.length : 0;
    const bHardErrors = Array.isArray(b?.hardErrors) ? b.hardErrors.length : 0;
    if (aHardErrors !== bHardErrors) return aHardErrors - bHardErrors;

    const aScore = num(
      scoringMode === 'composite' ? a?.scoreBreakdown?.total : a?.score,
      a?.score
    );
    const bScore = num(
      scoringMode === 'composite' ? b?.scoreBreakdown?.total : b?.score,
      b?.score
    );
    if (bScore !== aScore) return bScore - aScore;

    if (scoringMode === 'composite') {
      const aAdjacency = num(a?.scoreBreakdown?.components?.adjacencySatisfaction, -1);
      const bAdjacency = num(b?.scoreBreakdown?.components?.adjacencySatisfaction, -1);
      if (bAdjacency !== aAdjacency) return bAdjacency - aAdjacency;

      const aRoomTarget = num(a?.scoreBreakdown?.components?.roomTargetFidelity, -1);
      const bRoomTarget = num(b?.scoreBreakdown?.components?.roomTargetFidelity, -1);
      if (bRoomTarget !== aRoomTarget) return bRoomTarget - aRoomTarget;
    }

    const aAreaDelta = deliveredAreaDelta(a);
    const bAreaDelta = deliveredAreaDelta(b);
    if (aAreaDelta !== bAreaDelta) return aAreaDelta - bAreaDelta;

    const aWarnings = Array.isArray(a.warnings) ? a.warnings.length : 0;
    const bWarnings = Array.isArray(b.warnings) ? b.warnings.length : 0;
    if (aWarnings !== bWarnings) return aWarnings - bWarnings;

    if (scoringMode === 'composite') {
      const aVariationId = candidateVariationId(a);
      const bVariationId = candidateVariationId(b);
      if (aVariationId !== bVariationId) return aVariationId.localeCompare(bVariationId);

      const aWidth = num(a?.footprint?.widthFt);
      const bWidth = num(b?.footprint?.widthFt);
      if (aWidth !== bWidth) return aWidth - bWidth;

      const aHeight = num(a?.footprint?.heightFt);
      const bHeight = num(b?.footprint?.heightFt);
      if (aHeight !== bHeight) return aHeight - bHeight;

      return 0;
    }

    const aAspect = Math.abs(getFootprintAspectRatio(a.footprint) - 1.7);
    const bAspect = Math.abs(getFootprintAspectRatio(b.footprint) - 1.7);
    return aAspect - bAspect;
  });
}

function candidateVariationId(candidate) {
  return String(
    candidate?.footprint?.variationId ||
    candidate?.planSpec?.variationId ||
    'variant_a_compact_core'
  );
}

module.exports = {
  stripPlanSpecForValidation,
  collectStructuralErrors,
  collectArchitecturalHardErrors,
  collectWarnings,
  buildCandidateDiagnostic,
  tryGenerateCandidate,
  tryGenerateArchitectV2Candidate,
  rankAcceptedCandidates,
  getFootprintAspectRatio,
  num,
  normalizeType,
  isStrictDimensionRoomType,
  roomDisplayName,
  planAreaStats,
  buildArchitectV2Diagnostic,
  getAreaDeltaHardGateError,
  calibrateCandidateScore,
  pointOnBoundaryOfRoom,
  rectOf,
  isBathroomType,
  isRelaxedHallConnector,
  isHabitableRoom,
  getMinRulesForRoom,
  candidateVariationId,
  splitArchitectV2Failures,
  getHardAreaDeltaLimitSqFt,
  getStrictFootprintAspectBounds,
  hasUpperHallGalleryPattern,
  summarizeCandidateFailure,
  postProcessPlanSpec,
  isArchitectTopologyFailure,
  uniqueStrings,
  tryApplyFreeformWishes,
  shareWall,
};
