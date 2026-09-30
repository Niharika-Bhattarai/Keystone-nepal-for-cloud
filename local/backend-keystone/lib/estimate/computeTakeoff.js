'use strict';

const { normalizeRoomType } = require('../tile/canonicalRoomTypes');
const { boundarySegments } = require('../openingGeometry');
const { buildWallModel } = require('../geometry/wallModel');
const { unionArea } = require('../geometry/rectBoolean');
const { windowHeights } = require('../openingPresentation');
const {
  num,
  pointOnBoundaryOfRoom,
  partListOf,
} = require('../planGeometry');
const {
  DOOR_WIDTHS_FT,
  ROOF_AREA_MULTIPLIERS,
  WINDOW_WIDTH_BY_ROOM_TYPE,
} = require('./estimateConfig');

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function finishClassForRoom(type) {
  const t = normalizeRoomType(type);
  if (t === 'garage') return 'garage';
  if (['covered_porch', 'open_deck', 'screened_porch', 'patio'].includes(t)) return 'outdoor';
  if (['bathroom', 'primary_bathroom', 'powder_room', 'laundry'].includes(t)) return 'wet';
  if (['primary_bedroom', 'bedroom', 'guest_bedroom'].includes(t)) return 'sleep';
  if (['study', 'library', 'gym', 'gaming_room', 'movie_room', 'music_room'].includes(t)) return 'flex';
  if (['living_room', 'dining_room', 'kitchen', 'entry'].includes(t)) return 'public';
  if (['mudroom', 'hallway', 'stairs', 'storage', 'closet', 'pantry'].includes(t)) return 'service';
  return 'general';
}

function isConditionedRoom(type) {
  const t = normalizeRoomType(type);
  return t !== 'garage' && !['covered_porch', 'open_deck', 'screened_porch', 'patio'].includes(t);
}

function isWetAreaRoom(type) {
  return ['bathroom', 'primary_bathroom', 'powder_room', 'laundry'].includes(normalizeRoomType(type));
}

function roomPerimeterFt(room, tileSizeFt) {
  return boundarySegments(room).reduce((sum, edge) => sum + edge.end - edge.start, 0);
}

function roofMultiplier(roofKind) {
  const key = String(roofKind || '').toLowerCase();
  return ROOF_AREA_MULTIPLIERS[key] || 1.16;
}

function windowWidthForRoomType(type) {
  return WINDOW_WIDTH_BY_ROOM_TYPE[normalizeRoomType(type)] || 3;
}

function estimateWindowArea(level, windowOpening) {
  const room = (level.rooms || []).find(r => String(r.id) === String(windowOpening.roomId))
    || (level.rooms || []).find(r => pointOnBoundaryOfRoom(r, num(windowOpening.x), num(windowOpening.y), 1e-3));
  const type = normalizeRoomType(room?.type);
  const savedWidth = Number(windowOpening.width ?? windowOpening.windowWidth ?? windowOpening.w);
  const widthFt = Number.isFinite(savedWidth) && savedWidth > 0 ? savedWidth : windowWidthForRoomType(type);
  const { head, sill } = windowHeights(windowOpening, room);
  const heightFt = Math.max(0, head - sill);
  return {
    roomId: room?.id || null,
    roomLabel: room?.label || room?.type || null,
    areaSqFt: round(widthFt * heightFt, 1),
    widthFt: round(widthFt, 1),
    heightFt: round(heightFt, 1),
    dimensionSource: Number.isFinite(savedWidth) && savedWidth > 0 ? 'saved_width' : 'assumed_width',
  };
}

function garageDoorWidthFt(brief, door) {
  if (!door?.garageDoor) return 0;
  const type = String(brief?.garageType || '');
  return type === 'TWO_CAR' ? DOOR_WIDTHS_FT.garageDouble : DOOR_WIDTHS_FT.garageSingle;
}

function doorWidthFt(door) {
  if (!door) return 0;
  if (door?.garageDoor) return null;
  const savedWidth = Number(door.width ?? door.doorWidth ?? door.w);
  if (Number.isFinite(savedWidth) && savedWidth > 0) return savedWidth;
  if (door?.openThreshold) return DOOR_WIDTHS_FT.openThreshold;
  if (door?.isMainEntry) return DOOR_WIDTHS_FT.mainEntry;
  if (String(door?.b) === '__exterior__' || String(door?.a) === '__exterior__') return DOOR_WIDTHS_FT.exterior;
  return DOOR_WIDTHS_FT.interior;
}

function buildRoomSchedule(levels) {
  const rows = [];
  for (const level of levels) {
    const levelClearHeightFt = num(level?.verticalProfile?.clearHeightFt, 9);
    for (const room of Array.isArray(level?.rooms) ? level.rooms : []) {
      const type = normalizeRoomType(room?.type);
      rows.push({
        id: String(room?.id || ''),
        label: String(room?.label || room?.requestedFeatureLabel || room?.type || 'Room'),
        requestedLabel: room?.requestedFeatureLabel ? String(room.requestedFeatureLabel) : '',
        featureSource: room?.featureSource ? String(room.featureSource) : '',
        level: num(level?.level, 1),
        canonicalType: type,
        areaSqFt: round(unionArea(partListOf(room)), 1),
        widthFt: num(room?.w),
        heightFt: num(room?.h),
        x: num(room?.x),
        y: num(room?.y),
        finishClass: finishClassForRoom(type),
        conditioned: isConditionedRoom(type),
        ceilingHeightFt: round(num(room?.heightMeta?.clearHeightFt, levelClearHeightFt), 1),
      });
    }
  }
  return rows.sort((a, b) => a.level - b.level || a.label.localeCompare(b.label));
}

function computeBoundaryMetrics(level, planSpec) {
  // Reuse the continuous wall model: quantities must not depend on tile size.
  const model = buildWallModel({ ...level, rooms: (level.rooms || []).map(room => ({
    ...room, openConcept: room.openConcept ?? planSpec.openConcept,
  })) });
  return {
    roofPlanAreaSqFt: round(model.partition.nominalAreaSqFt, 1),
    exteriorWallLengthFt: round(model.walls.filter(w => w.exterior).reduce((s, w) => s + w.lengthFt, 0), 1),
    interiorWallLengthFt: round(model.walls.filter(w => !w.exterior).reduce((s, w) => s + w.lengthFt, 0), 1),
  };
}

function roomOpeningWidthDeduction(room, level) {
  const id = String(room?.id || '');
  return (Array.isArray(level?.doors) ? level.doors : []).reduce((sum, door) => {
    const a = String(door?.a || '');
    const b = String(door?.b || '');
    if (a !== id && b !== id) return sum;
    if (door?.garageDoor) return sum;
    const width = doorWidthFt(door);
    return sum + (Number.isFinite(width) ? width : 0);
  }, 0);
}

function baseboardLengthForRoom(room, level, tileSizeFt) {
  const type = normalizeRoomType(room?.type);
  if (['garage', 'stairs', 'storage', 'closet', 'pantry'].includes(type)) return 0;
  const perimeter = roomPerimeterFt(room, tileSizeFt);
  const deduction = roomOpeningWidthDeduction(room, level);
  return Math.max(0, perimeter - deduction);
}

function computeTakeoff(planSpec, brief) {
  if (!planSpec || !Array.isArray(planSpec.levels)) return null;

  const tileSizeFt = Math.max(1, num(planSpec?.tileSizeFt, 2));
  const levels = [...planSpec.levels].sort((a, b) => num(a?.level, 1) - num(b?.level, 1));
  const roomSchedule = buildRoomSchedule(levels);
  const roofKind = String(planSpec?.elevations?.meta?.roofKind || 'gabled');
  const roofFactor = roofMultiplier(roofKind);

  const byLevel = [];
  let conditionedAreaSqFt = 0;
  let garageAreaSqFt = 0;
  let totalAreaSqFt = 0;
  let exteriorWallLengthFt = 0;
  let exteriorWallAreaSqFt = 0;
  let interiorWallLengthFt = 0;
  let interiorWallAreaSqFt = 0;
  let roofPlanAreaSqFt = 0;
  let ceilingAreaSqFt = 0;
  let finishedFlooringAreaSqFt = 0;
  let wetAreaFlooringAllowanceSqFt = 0;
  let baseboardLengthFt = 0;
  let windowCount = 0;
  let roughGlazingAreaSqFt = 0;
  let exteriorDoorCount = 0;
  let interiorDoorCount = 0;
  let garageDoorCount = 0;
  let kitchenCount = 0;
  let bathroomCount = 0;
  let primaryBathroomCount = 0;
  let powderRoomCount = 0;
  let stairCount = 0;

  const windowSchedule = [];

  for (const level of levels) {
    const levelRooms = Array.isArray(level?.rooms) ? level.rooms : [];
    const levelConditioned = levelRooms
      .filter((room) => isConditionedRoom(room?.type))
      .reduce((sum, room) => sum + unionArea(partListOf(room)), 0);
    const levelGarage = levelRooms
      .filter((room) => normalizeRoomType(room?.type) === 'garage')
      .reduce((sum, room) => sum + unionArea(partListOf(room)), 0);
    const levelTotal = levelRooms.reduce((sum, room) => sum + unionArea(partListOf(room)), 0);

    const boundaries = computeBoundaryMetrics(level, planSpec, tileSizeFt);
    const clearHeightFt = num(level?.verticalProfile?.clearHeightFt, num(planSpec?.verticalModel?.defaultClearHeightFt, 9));

    conditionedAreaSqFt += levelConditioned;
    garageAreaSqFt += levelGarage;
    totalAreaSqFt += levelTotal;
    exteriorWallLengthFt += boundaries.exteriorWallLengthFt;
    interiorWallLengthFt += boundaries.interiorWallLengthFt;
    exteriorWallAreaSqFt += boundaries.exteriorWallLengthFt * clearHeightFt;
    interiorWallAreaSqFt += boundaries.interiorWallLengthFt * clearHeightFt * 2;
    if (num(level?.level, 1) === 1) roofPlanAreaSqFt += boundaries.roofPlanAreaSqFt;
    ceilingAreaSqFt += levelConditioned;

    for (const room of levelRooms) {
      const type = normalizeRoomType(room?.type);
      if (isConditionedRoom(type)) finishedFlooringAreaSqFt += unionArea(partListOf(room));
      if (isWetAreaRoom(type)) wetAreaFlooringAllowanceSqFt += unionArea(partListOf(room));
      baseboardLengthFt += baseboardLengthForRoom(room, level, tileSizeFt);

      if (type === 'kitchen') kitchenCount += 1;
      if (type === 'bathroom') bathroomCount += 1;
      if (type === 'primary_bathroom') primaryBathroomCount += 1;
      if (type === 'powder_room') powderRoomCount += 1;
      if (type === 'stairs') stairCount += 1;
    }

    for (const windowOpening of Array.isArray(level?.windows) ? level.windows : []) {
      windowCount += 1;
      const estimate = estimateWindowArea(level, windowOpening);
      roughGlazingAreaSqFt += estimate.areaSqFt;
      windowSchedule.push({
        level: num(level?.level, 1),
        roomId: estimate.roomId,
        roomLabel: estimate.roomLabel,
        areaSqFt: estimate.areaSqFt,
        widthFt: estimate.widthFt,
        heightFt: estimate.heightFt,
        dimensionSource: estimate.dimensionSource,
      });
    }

    for (const door of Array.isArray(level?.doors) ? level.doors : []) {
      if (door?.garageDoor) {
        garageDoorCount += 1;
        continue;
      }
      if (door?.openThreshold) continue;
      if (String(door?.b) === '__exterior__' || String(door?.a) === '__exterior__') exteriorDoorCount += 1;
      else interiorDoorCount += 1;
    }

    byLevel.push({
      level: num(level?.level, 1),
      conditionedAreaSqFt: round(levelConditioned, 1),
      garageAreaSqFt: round(levelGarage, 1),
      totalAreaSqFt: round(levelTotal, 1),
      clearHeightFt: round(clearHeightFt, 1),
      exteriorWallLengthFt: boundaries.exteriorWallLengthFt,
      interiorWallLengthFt: boundaries.interiorWallLengthFt,
    });
  }

  const estimatedRoofSurfaceAreaSqFt = roofPlanAreaSqFt * roofFactor;
  const fullBathEquivalentCount = bathroomCount + primaryBathroomCount;

  // Fixture schedule — count wet fixtures by room type
  const fixtureCount = { toilet: 0, sink: 0, shower: 0, tub: 0, total: 0 };
  (takeoffRooms => {
    takeoffRooms.forEach(room => {
      const t = room.canonicalType || room.type || '';
      if (/primary_bathroom/.test(t)) {
        fixtureCount.toilet++;
        fixtureCount.sink += 2;
        fixtureCount.shower++;
        fixtureCount.tub++;
      } else if (/bathroom/.test(t)) {
        fixtureCount.toilet++;
        fixtureCount.sink++;
        fixtureCount.shower++;
      } else if (/powder_room/.test(t)) {
        fixtureCount.toilet++;
        fixtureCount.sink++;
      } else if (/kitchen/.test(t)) {
        fixtureCount.sink++;
      } else if (/laundry/.test(t)) {
        fixtureCount.sink++;
      }
    });
  })(roomSchedule);
  fixtureCount.total = fixtureCount.toilet + fixtureCount.sink + fixtureCount.shower + fixtureCount.tub;

  // Foundation footprint area — sum of L1 room areas. Room coordinates are in
  // feet (roomToCells divides them by tileSizeFt), so w * h is already square
  // feet; multiplying by tileSizeFt squared priced foundations at 4x (C7).
  const level1 = (planSpec.levels || []).find(l => l.level === 1 || l.level === '1');
  const footprintAreaSqFt = level1 ? unionArea((level1.rooms || []).flatMap(partListOf)) : totalAreaSqFt;

  const assemblies = [
    { key: 'conditioned_area', label: 'Conditioned Area', unit: 'sqft', quantity: round(conditionedAreaSqFt, 1) },
    { key: 'garage_area', label: 'Garage Area', unit: 'sqft', quantity: round(garageAreaSqFt, 1) },
    { key: 'exterior_wall_length', label: 'Exterior Wall Length', unit: 'ft', quantity: round(exteriorWallLengthFt, 1) },
    { key: 'exterior_wall_area', label: 'Exterior Wall Area', unit: 'sqft', quantity: round(exteriorWallAreaSqFt, 1) },
    { key: 'interior_wall_length', label: 'Interior Wall Length', unit: 'ft', quantity: round(interiorWallLengthFt, 1) },
    { key: 'interior_wall_area', label: 'Interior Wall Surface Area', unit: 'sqft', quantity: round(interiorWallAreaSqFt, 1), notes: 'Both faces of interior partitions' },
    { key: 'roof_plan_area', label: 'Roof Plan Area', unit: 'sqft', quantity: round(roofPlanAreaSqFt, 1) },
    { key: 'estimated_roof_area', label: 'Estimated Roof Surface Area', unit: 'sqft', quantity: round(estimatedRoofSurfaceAreaSqFt, 1), notes: `Uses ${roofKind} multiplier ${round(roofFactor, 2)}` },
    { key: 'ceiling_area', label: 'Ceiling Area', unit: 'sqft', quantity: round(ceilingAreaSqFt, 1) },
    { key: 'finished_flooring_area', label: 'Finished Flooring Area', unit: 'sqft', quantity: round(finishedFlooringAreaSqFt, 1) },
    { key: 'wet_area_flooring_allowance', label: 'Wet-Area Flooring Allowance', unit: 'sqft', quantity: round(wetAreaFlooringAllowanceSqFt, 1) },
    { key: 'window_glazing', label: 'Window Glazing Area', unit: 'sqft', quantity: round(roughGlazingAreaSqFt, 1) },
    { key: 'window_count', label: 'Window Count', unit: 'count', quantity: windowCount },
    { key: 'exterior_door_count', label: 'Exterior Door Count', unit: 'count', quantity: exteriorDoorCount },
    { key: 'interior_door_count', label: 'Interior Door Count', unit: 'count', quantity: interiorDoorCount },
    { key: 'garage_door_count', label: 'Garage Door Count', unit: 'count', quantity: garageDoorCount },
    { key: 'baseboard_length', label: 'Baseboard Length', unit: 'ft', quantity: round(baseboardLengthFt, 1) },
  ];

  return {
    byLevel,
    rooms: roomSchedule,
    windowSchedule,
    assemblies,
    raw: {
      conditionedAreaSqFt: round(conditionedAreaSqFt, 1),
      garageAreaSqFt: round(garageAreaSqFt, 1),
      totalAreaSqFt: round(totalAreaSqFt, 1),
      exteriorWallLengthFt: round(exteriorWallLengthFt, 1),
      exteriorWallAreaSqFt: round(exteriorWallAreaSqFt, 1),
      interiorWallLengthFt: round(interiorWallLengthFt, 1),
      interiorWallAreaSqFt: round(interiorWallAreaSqFt, 1),
      roofPlanAreaSqFt: round(roofPlanAreaSqFt, 1),
      estimatedRoofSurfaceAreaSqFt: round(estimatedRoofSurfaceAreaSqFt, 1),
      ceilingAreaSqFt: round(ceilingAreaSqFt, 1),
      finishedFlooringAreaSqFt: round(finishedFlooringAreaSqFt, 1),
      wetAreaFlooringAllowanceSqFt: round(wetAreaFlooringAllowanceSqFt, 1),
      baseboardLengthFt: round(baseboardLengthFt, 1),
      windowCount,
      roughGlazingAreaSqFt: round(roughGlazingAreaSqFt, 1),
      exteriorDoorCount,
      interiorDoorCount,
      garageDoorCount,
      kitchenCount,
      bathroomCount,
      primaryBathroomCount,
      powderRoomCount,
      fullBathEquivalentCount,
      stairCount,
      roofKind,
      roofMultiplier: round(roofFactor, 2),
      fixtureCount,
      fixtureTotal: fixtureCount.total,
      footprintAreaSqFt: round(footprintAreaSqFt, 1),
      bathCounts: {
        primary: primaryBathroomCount,
        full: bathroomCount,
        powder: powderRoomCount,
      },
    },
  };
}

module.exports = {
  computeTakeoff,
};
