'use strict';

const { isDeepStrictEqual } = require('node:util');
const { partListOf, boundingRectOf } = require('../planGeometry');
const { closetLayout, closetDoorSwing } = require('../closetGeometry');
const { union, subtract, unionArea, containsRect } = require('./rectBoolean');
const { bindOpeningSchedule } = require('./openingIdentity');
const { buildFloorPassageModel } = require('./floorPassageModel');
const { buildWallModel } = require('./wallModel');
const { hostWallFor } = require('./clearanceGeometry');
const { checkBedroomApproach } = require('./bedroomApproach');
const { proposeBedroomApproachRepair } = require('./repairBedroomApproach');
const { placeFurnitureWithoutCollisions, bedClearanceEnvelope, doorClearances, intersects } = require('../furnitureGeometry');
const { validateEditedPlan } = require('../validateEditedPlan');
const { createBedroomArchitecturalCheck } = require('./bedroomArchitecture');
const { selectBedroomArchitecturePolicy } = require('./bedroomMeasurements');

function finishedClosetAccess(closet, level) {
  const layout = closetLayout(closet), access = { ...layout.access };
  if (closet.closetType !== 'reach_in') return access;
  const host = hostWallFor(layout.door, buildWallModel(level).walls);
  if (!host) return null;
  const half = host.assembly.thicknessFt / 2;
  if (closet.closetFront === 'top') access.y -= half;
  if (closet.closetFront === 'bottom') access.y += half;
  if (closet.closetFront === 'left') access.x -= half;
  if (closet.closetFront === 'right') access.x += half;
  return access;
}

function connected(parts) {
  if (!parts.length) return false;
  const seen = new Set([0]);
  for (let size = -1; size !== seen.size;) {
    size = seen.size;
    parts.forEach((a, i) => {
      if ([...seen].some(j => {
        const b = parts[j];
        const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        return (overlapX > 1e-7 && Math.min(Math.abs(a.y + a.h - b.y), Math.abs(b.y + b.h - a.y)) < 1e-7) ||
          (overlapY > 1e-7 && Math.min(Math.abs(a.x + a.w - b.x), Math.abs(b.x + b.w - a.x)) < 1e-7);
      })) seen.add(i);
    });
  }
  return seen.size === parts.length;
}

// Proposal only: a reviewed replacement schedule is mandatory when its host
// moves. No old hardware schedule is silently transferred to a new partition.
function proposeBedroomClosetRepair(plan, survey, options = {}) {
  const { enabled = false, levelNumber, request, replacementClosetSchedule, architecturePolicy: suppliedArchitecturePolicy, coordinateDresser = false,
    maxReservations = 128, maxFurnitureCandidates = 2000, maxRouteChecks = 64, maxDresserSlots = 20000 } = options;
  const result = { status: 'not_checked', strategy: 'coordinated_bedroom_closet',
    constructionVerified: false, doorSwingVerified: false, requiresDerivedModelRebuild: true,
    reservationCount: 0, furnitureCandidateCount: 0, routeCheckCount: 0, dresserSlotCount: 0, rejections: {},
    search: { maxReservations, maxFurnitureCandidates, maxRouteChecks, coordinateDresser, maxDresserSlots } };
  const fail = reason => ({ ...result, reason });
  const reject = (code, errors) => {
    result.rejections[code] = (result.rejections[code] || 0) + 1;
    if (errors && !result.firstRejection) result.firstRejection = { code, errors };
  };
  if (!enabled) return { ...fail('Explicit opt-in is required.'), status: 'disabled' };
  if (enabled !== true || typeof coordinateDresser !== 'boolean' || !plan || !Array.isArray(plan.levels) || !survey || typeof survey !== 'object' || !Object.keys(survey).length ||
    !Number.isFinite(levelNumber) || !request || !Number.isFinite(request.clearWidthFt) || request.clearWidthFt <= 0 ||
    !['either', 'both'].includes(request.sidePolicy) ||
    (request.maxNodes !== undefined && (!Number.isInteger(request.maxNodes) || request.maxNodes < 1 || request.maxNodes > 40000)) ||
    !Number.isInteger(maxReservations) || maxReservations < 1 || maxReservations > 256 ||
    !Number.isInteger(maxFurnitureCandidates) || maxFurnitureCandidates < 1 || maxFurnitureCandidates > 10000 ||
    !Number.isInteger(maxDresserSlots) || maxDresserSlots < 1 || maxDresserSlots > 100000 ||
    !Number.isInteger(maxRouteChecks) || maxRouteChecks < 1 || maxRouteChecks > 1000) {
    return fail('Original survey, explicit approach policy and bounded search settings are required.');
  }
  const floors = plan.levels.filter(l => l?.level === levelNumber), level = floors[0];
  if (floors.length !== 1 || !Array.isArray(level.rooms) || !Array.isArray(level.furniture) || !Array.isArray(level.doors)) return fail('A unique furnished floor is required.');
  const beds = level.furniture.filter(f => f.id === request.bedId), bed = beds[0];
  const room = level.rooms.find(r => r.id === bed?.roomId);
  const closets = level.rooms.filter(r => r.type === 'closet' && r.ownerBedroomId === room?.id), closet = closets[0];
  const layout = closetLayout(closet);
  if (beds.length !== 1 || !String(bed.kind).startsWith('bed_') || !['bedroom', 'primary_bedroom'].includes(room?.type) ||
      closets.length !== 1 || !layout) return fail('One bed, bedroom and rectangular owned closet are required.');
  if (room.protected || closet.protected) return fail('Protected bedroom or closet reservations cannot be relocated.');
  const selection = selectBedroomArchitecturePolicy(level,room.id,bed.id,suppliedArchitecturePolicy);
  if (selection.errors.length) return {...fail('Persisted bedroom measurements cannot be used.'),errors:selection.errors};
  const architecturePolicy = selection.policy;
  if (coordinateDresser && architecturePolicy === undefined) return fail('Coordinated dresser packing requires explicit or persisted architectural measurements.');
  result.measurementSource = selection.source;
  const pairIds = new Set([room.id, closet.id]);
  const furnishings = level.furniture.filter(f => f.roomId === room.id);
  if (coordinateDresser && furnishings.filter(f => f.kind === 'dresser').length !== 1) return fail('Coordinated packing requires one existing dresser.');
  const storage = level.furniture.filter(f => f.roomId === closet.id);
  const doors = level.doors.filter(d => d.a === closet.id || d.b === closet.id), door = doors[0];
  if (doors.length !== 1 || storage.length !== 1 || storage[0].kind !== 'closet_storage' ||
      furnishings.filter(f => String(f.kind).startsWith('bed_')).length !== 1 ||
      furnishings.filter(f => f.kind === 'nightstand').length !== 2 ||
      furnishings.some(f => ![0, 90, 180, 270].includes(f.rotation ?? 0)) ||
      ![0, 90, 180, 270].includes(bed.rotation) ||
      new Set(level.furniture.map(f => f.id)).size !== level.furniture.length) return fail('Unambiguous closet door/storage and bedroom inventory with two nightstands are required.');
  if (plan.furniture !== undefined && (!Array.isArray(plan.furniture) || plan.levels.some(l => {
    const copies = plan.furniture.filter(f => f?.level === l.level);
    return copies.length !== 1 || !isDeepStrictEqual(copies[0].items, l.furniture);
  }))) return fail('Aggregate furniture must match floor furniture before repair.');
  if (!replacementClosetSchedule || replacementClosetSchedule.openingId !== door.id ||
      replacementClosetSchedule.reviewedForRelocation !== true || !replacementClosetSchedule.dimensions) {
    return fail('Supply an explicit replacement closet schedule reviewed for relocation, bound to this opening identity.');
  }
  let originalModel, errors;
  try { originalModel = buildFloorPassageModel(level); errors = validateEditedPlan(plan, survey); }
  catch (error) { return fail(`Invalid source plan: ${error.message}`); }
  if (errors.length || originalModel.errors.length) return { ...fail('Source plan fails validation; repair does not hide unrelated errors.'), errors: [...errors, ...originalModel.errors] };
  const architecture = architecturePolicy === undefined ? null : createBedroomArchitecturalCheck(level, room.id, bed.id, architecturePolicy);
  if (architecture && architecture.status !== 'ready') return fail(architecture.reason);
  result.architecturalValidation = architecture ? architecture.check(furnishings) : { status: 'not_requested' };
  try {
    const rebound = bindOpeningSchedule(level, door.id, replacementClosetSchedule.dimensions);
    if (!isDeepStrictEqual(rebound.doors, level.doors)) return fail('Opening identities must already be canonical before relocation.');
    const scheduleErrors = buildFloorPassageModel(rebound).errors;
    if (scheduleErrors.length) return { ...fail('Replacement schedule dimensions are invalid on the source opening.'), errors: scheduleErrors };
  } catch (error) { return fail(`Invalid replacement schedule: ${error.message}`); }
  const entry = originalModel.openings.find(o => o.openingId === request.entryOpeningId);
  if (!entry || entry.status !== 'scheduled_geometry' || !entry.rooms.includes(room.id) || !entry.rooms.includes(request.fromRoomId) ||
      level.rooms.find(r => r.id === request.fromRoomId)?.type !== 'hallway') return fail('A scheduled direct hallway-to-bedroom entry is required.');
  if (entry.clearWidthFt < request.clearWidthFt) return { ...fail('Closet relocation cannot widen the unchanged entry.'), status: 'blocked' };
  const combined = union([...partListOf(room), ...partListOf(closet)]);
  const bounds = boundingRectOf({ parts: combined });
  const horizontal = ['top', 'bottom'].includes(closet.closetFront);
  const along = horizontal ? closet.w : closet.h, depth = horizontal ? closet.h : closet.w;
  const before = checkBedroomApproach(level, request);
  const existingAccess = finishedClosetAccess(closet, level);
  const existingBedroomClear = originalModel.roomClear.find(r => r.roomId === room.id).parts;
  const existingClosetClear = originalModel.roomClear.find(r => r.roomId === closet.id).parts;
  if ((!architecture || result.architecturalValidation.status === 'clear') && before.status === 'clear' && existingAccess &&
      containsRect(existingClosetClear, layout.storage) &&
      containsRect(closet.closetType === 'walk_in' ? existingClosetClear : existingBedroomClear, existingAccess) &&
      containsRect(existingBedroomClear, bedClearanceEnvelope(bed, room)) &&
      furnishings.every(f => containsRect(existingBedroomClear, f)) &&
      (closet.closetType === 'walk_in' ? storage : furnishings).every(f => !intersects(f, existingAccess))) {
    return { ...result, status: 'unchanged', before, after: before,
      reason: 'Existing pair already satisfies the physical closet, bedroom and requested approach checks.' };
  }
  // Perimeter reservations preserve the full selected closet dimensions. Critical
  // ends/centre precede a finite half-foot sampling, interleaved across four faces.
  const candidates = ['top', 'bottom', 'left', 'right'].map(front => {
    const flat = ['top', 'bottom'].includes(front), w = flat ? along : depth, h = flat ? depth : along;
    const span = (flat ? bounds.w - w : bounds.h - h);
    if (span < 0) return [];
    const offsets = new Set([0, span, span / 2]);
    for (let n = 0; n <= Math.min(120, Math.floor(span * 2)); n++) offsets.add(n / 2);
    return [...offsets].map(offset => ({ front, w, h,
      x: flat ? bounds.x + offset : front === 'left' ? bounds.x + bounds.w - w : bounds.x,
      y: flat ? front === 'top' ? bounds.y + bounds.h - h : bounds.y : bounds.y + offset }));
  });
  function* ordered() {
    for (let i = 0; i < Math.max(...candidates.map(c => c.length)); i++) for (const list of candidates) if (list[i]) yield list[i];
  }
  const limit = reason => ({ ...result, status: 'search_limit', before, reason });
  for (const position of ordered()) {
    if (result.reservationCount >= maxReservations) return limit('Reservation budget reached; no infeasibility conclusion.');
    result.reservationCount++;
    if (!containsRect(combined, position)) { reject('outside_combined_footprint'); continue; }
    const parts = subtract(combined, [position]);
    if (!connected(parts)) { reject('disconnected_bedroom'); continue; }
    const newRoom = { ...structuredClone(room), ...boundingRectOf({ parts }), parts };
    const newCloset = { ...structuredClone(closet), x: position.x, y: position.y, w: position.w, h: position.h, closetFront: position.front };
    if (Object.hasOwn(newCloset, 'x2')) newCloset.x2 = newCloset.x + newCloset.w;
    if (Object.hasOwn(newCloset, 'y2')) newCloset.y2 = newCloset.y + newCloset.h;
    const nextLayout = closetLayout(newCloset);
    if (!containsRect(parts, closetDoorSwing(newCloset)) ||
        !containsRect(newCloset.closetType === 'walk_in' ? [newCloset] : parts, nextLayout.access)) {
      reject('closet_access_or_swing'); continue;
    }
    const proposed = structuredClone(plan);
    let target = proposed.levels.find(l => l.level === levelNumber);
    target.rooms = target.rooms.map(r => r.id === room.id ? newRoom : r.id === closet.id ? newCloset : r);
    target.doors = target.doors.map(d => d.id === door.id ? { ...d, ...nextLayout.door, width: door.width } : d);
    try { target = bindOpeningSchedule(target, door.id, replacementClosetSchedule.dimensions); }
    catch (error) { return fail(`Replacement schedule cannot bind: ${error.message}`); }
    proposed.levels[proposed.levels.findIndex(l => l.level === levelNumber)] = target;
    const model = buildFloorPassageModel(target);
    if (model.errors.length) { reject('opening_or_wall_geometry', model.errors); continue; }
    const bedroomClear = model.roomClear.find(r => r.roomId === room.id)?.parts || [];
    const closetClear = model.roomClear.find(r => r.roomId === closet.id)?.parts || [];
    // Reach-in access starts at the BEDROOM finished face, not the nominal
    // wall centreline. Translate the whole reservation; never trim its depth.
    const physicalAccess = finishedClosetAccess(newCloset, target);
    if (!physicalAccess) { reject('missing_closet_front_host'); continue; }
    // Do not count nominal storage embedded in a finished wall as a repair.
    if (!containsRect(closetClear, nextLayout.storage) || !containsRect(newCloset.closetType === 'walk_in' ? closetClear : bedroomClear, physicalAccess)) {
      reject('finished_closet_storage_or_access'); continue;
    }
    // Use finished faces for this local seed only; never enable a production
    // geometry version globally or regenerate a different furniture inventory.
    const packed = placeFurnitureWithoutCollisions(newRoom, { ...target, finishedFaceGeometryVersion: 1 }, structuredClone(furnishings));
    if (packed.omitted.length || packed.items.length !== furnishings.length) { reject('furniture_omission'); continue; }
    target.furniture = target.furniture.map(f => f.roomId === room.id ? packed.items.find(p => p.id === f.id) :
      f.id === storage[0].id ? { ...f, ...nextLayout.storage, rotation: ['top', 'bottom'].includes(position.front) ? 0 : 90 } : f);
    if (proposed.furniture) proposed.furniture.find(f => f.level === levelNumber).items = structuredClone(target.furniture);
    errors = validateEditedPlan(proposed, survey);
    if (errors.length) { reject('original_survey_validation', errors); continue; }
    if (result.furnitureCandidateCount >= maxFurnitureCandidates || maxRouteChecks - result.routeCheckCount < 2) return limit('Shared furniture/route budget reached; no infeasibility conclusion.');
    if (coordinateDresser && result.dresserSlotCount >= maxDresserSlots) return limit('Shared dresser slot budget reached; no infeasibility conclusion.');
    const repair = proposeBedroomApproachRepair(proposed, survey, { enabled: true, levelNumber, request,
      architecturePolicy, coordinateDresser, maxDresserSlots: maxDresserSlots - result.dresserSlotCount,
      allowQuarterTurns: true, nightstandPlacement: 'head_sides',
      maxCandidates: Math.min(256, maxFurnitureCandidates - result.furnitureCandidateCount),
      maxRouteChecks: Math.min(8, maxRouteChecks - result.routeCheckCount - 1) });
    result.furnitureCandidateCount += repair.candidateCount;
    result.dresserSlotCount += repair.dresserSlotCount;
    // The inner repair also checks the seed route once before its search.
    result.routeCheckCount += repair.routeCheckCount + 1;
    if (!['repaired', 'unchanged'].includes(repair.status)) {
      reject(`bedroom_${repair.status}`);
      result.bedroomRejections ||= {};
      for (const [code, count] of Object.entries(repair.rejections)) result.bedroomRejections[code] = (result.bedroomRejections[code] || 0) + count;
      continue;
    }
    const accepted = repair.proposedPlan || proposed, acceptedLevel = accepted.levels.find(l => l.level === levelNumber);
    const actual = acceptedLevel.furniture.filter(f => pairIds.has(f.roomId));
    const zones = doorClearances(newRoom, acceptedLevel);
    if (actual.some(f => !containsRect(f.roomId === room.id ? bedroomClear : closetClear, f)) ||
        actual.filter(f => f.roomId === (newCloset.closetType === 'walk_in' ? closet.id : room.id)).some(f => intersects(f, physicalAccess)) ||
        actual.filter(f => f.roomId === room.id).some(f => zones.some(z => intersects(f, z))) ||
        !containsRect(bedroomClear, bedClearanceEnvelope(actual.find(f => f.id === bed.id), newRoom))) {
      reject('final_physical_fit'); continue;
    }
    return { ...result, status: 'repaired', before, after: repair.after, proposedPlan: accepted,
      architecturalValidation: repair.architecturalValidation,
      reason: 'Coordinated closet reservation and unchanged furniture inventory pass the original survey and requested bedroom approach.',
      bedroomId: room.id, closetId: closet.id, openingId: door.id,
      closetBefore: structuredClone(closet), closetAfter: newCloset,
      physicalClosetAccess: physicalAccess,
      scheduleReplacement: structuredClone(replacementClosetSchedule),
      nominalPairAreaSqFt: unionArea(combined),
      validations: { originalSurvey: true, finishedBedroomFurniture: true, finishedClosetStorageAndAccess: true,
        unchangedEntry: true, sameApproachPolicy: true, unchangedClosetDimensions: true } };
  }
  if (result.rejections.bedroom_search_limit) return limit('Perimeter reservations exhausted with bounded bedroom searches still unresolved; no infeasibility conclusion.');
  return { ...result, status: 'search_exhausted', before, reason: 'Finite perimeter reservation search exhausted; no infeasibility conclusion.' };
}

module.exports = { proposeBedroomClosetRepair };
