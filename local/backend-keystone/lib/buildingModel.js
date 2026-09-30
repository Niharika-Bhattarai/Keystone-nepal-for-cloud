'use strict';

const { normalizeRoomType } = require('./tile/canonicalRoomTypes');
const { selectArchetype } = require('./tile/selectArchetype');
const { applyFurnitureLayout } = require('./planFurniture');

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rectOf(room) {
  return {
    x: num(room?.x),
    y: num(room?.y),
    w: num(room?.w),
    h: num(room?.h),
    x2: num(room?.x) + num(room?.w),
    y2: num(room?.y) + num(room?.h),
  };
}

function edgeForFacing(frontFacing) {
  const f = String(frontFacing || 'South').toLowerCase();
  if (f.includes('north')) return 'top';
  if (f.includes('south')) return 'bottom';
  if (f.includes('east')) return 'right';
  if (f.includes('west')) return 'left';
  return 'bottom';
}

function oppositeEdge(edge) {
  if (edge === 'top') return 'bottom';
  if (edge === 'bottom') return 'top';
  if (edge === 'left') return 'right';
  return 'left';
}

function doorEdge(door, level) {
  if (!door || !level) return null;
  if (String(door?.dir) === 'horizontal') {
    if (num(door?.y) === 0) return 'top';
    if (num(door?.y) === num(level?.height)) return 'bottom';
  } else if (String(door?.dir) === 'vertical') {
    if (num(door?.x) === 0) return 'left';
    if (num(door?.x) === num(level?.width)) return 'right';
  }
  return null;
}

function inferFrontEdgeFromPlan(planSpec, brief) {
  const fallback = edgeForFacing(brief?.frontFacing);
  const levels = Array.isArray(planSpec?.levels) ? planSpec.levels : [];
  const level1 = levels.find((level) => num(level?.level, 1) === 1) || levels[0] || null;
  if (!level1) return fallback;

  const scores = new Map();
  const extDoors = (Array.isArray(level1?.doors) ? level1.doors : [])
    .filter((door) => String(door?.b) === '__exterior__');

  for (const door of extDoors) {
    const edge = doorEdge(door, level1);
    if (!edge) continue;
    let weight = 2;
    if (door?.isMainEntry) weight += 12;
    if (door?.garageDoor) weight += 9;
    scores.set(edge, (scores.get(edge) || 0) + weight);
  }

  if (!scores.size) return fallback;

  let bestEdge = fallback;
  let bestScore = -Infinity;
  for (const [edge, score] of scores.entries()) {
    if (score > bestScore || (score === bestScore && edge === fallback)) {
      bestEdge = edge;
      bestScore = score;
    }
  }
  return bestEdge;
}

function overlapLen(a1, a2, b1, b2) {
  const lo = Math.max(a1, b1);
  const hi = Math.min(a2, b2);
  return Math.max(0, hi - lo);
}

function sharedWall(a, b, minSeg = 2) {
  const A = rectOf(a);
  const B = rectOf(b);

  if (A.x2 === B.x || B.x2 === A.x) {
    const seg = overlapLen(A.y, A.y2, B.y, B.y2);
    if (seg >= minSeg) {
      const side = A.x2 === B.x ? 'right' : 'left';
      return { kind: 'vertical', seg, side };
    }
  }

  if (A.y2 === B.y || B.y2 === A.y) {
    const seg = overlapLen(A.x, A.x2, B.x, B.x2);
    if (seg >= minSeg) {
      const side = A.y2 === B.y ? 'bottom' : 'top';
      return { kind: 'horizontal', seg, side };
    }
  }
  return null;
}

function classifyZone(type) {
  const t = normalizeRoomType(type);
  if (t === 'hallway' || t === 'entry' || t === 'stairs') return 'circulation';
  if (t === 'primary_bedroom' || t === 'bedroom' || t === 'guest_bedroom') return 'private';
  if (t === 'primary_bathroom' || t === 'bathroom' || t === 'powder_room') return 'service';
  if (t === 'laundry' || t === 'mudroom' || t === 'garage' || t === 'storage' || t === 'closet' || t === 'pantry') return 'service';
  if (t === 'living_room' || t === 'dining_room' || t === 'kitchen' || t === 'loft') return 'public';
  if (t === 'study' || t === 'gaming_room' || t === 'gym' || t === 'library' || t === 'movie_room' || t === 'wine_cellar' || t === 'music_room') return 'public';
  return 'service';
}

function touchingEdges(room, level) {
  const R = rectOf(room);
  const width = num(level?.width);
  const height = num(level?.height);
  const edges = [];
  if (R.x === 0) edges.push('left');
  if (R.x2 === width) edges.push('right');
  if (R.y === 0) edges.push('top');
  if (R.y2 === height) edges.push('bottom');
  return edges;
}

function unionRects(rooms) {
  if (!rooms.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const room of rooms) {
    const R = rectOf(room);
    minX = Math.min(minX, R.x);
    minY = Math.min(minY, R.y);
    maxX = Math.max(maxX, R.x2);
    maxY = Math.max(maxY, R.y2);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }

  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function roomArea(room) {
  if (Array.isArray(room?.parts) && room.parts.length > 0) {
    return room.parts.reduce((sum, part) => sum + (num(part?.w) * num(part?.h)), 0);
  }
  return num(room?.w) * num(room?.h);
}

function defaultClearHeightFt(brief) {
  const ceiling = String(brief?.ceilingHeight || '').toUpperCase();
  if (ceiling === 'CATHEDRAL') return 12;
  if (ceiling === 'TALL') return 10;
  return 9;
}

function defaultFloorStructureFt(brief) {
  return (num(brief?.stories, 1) || 1) > 1 ? 1 : 0.75;
}

function defaultRoofBuildUpFt(brief) {
  const ceiling = String(brief?.ceilingHeight || '').toUpperCase();
  if (ceiling === 'CATHEDRAL') return 1.5;
  return 1.0;
}

function buildVerticalLevels(planSpec, brief) {
  const levels = (Array.isArray(planSpec?.levels) ? planSpec.levels : [])
    .map((level) => ({ level: num(level?.level, 1) }))
    .sort((a, b) => a.level - b.level);

  if (!levels.length) return [];

  const clearHeightFt = defaultClearHeightFt(brief);
  const structureThicknessFt = defaultFloorStructureFt(brief);
  const roofBuildUpFt = defaultRoofBuildUpFt(brief);
  const {ruleFeet}=require('./stairs/codeProfiles');
  const maximumRiserFt = ruleFeet('maxRiser');
  const treadFt = ruleFeet('minGoing');

  let floorZFt = 0;

  return levels.map((level, index) => {
    const isTopLevel = index === levels.length - 1;
    const ceilingZFt = floorZFt + clearHeightFt;
    const nextFloorZFt = isTopLevel ? null : floorZFt + clearHeightFt + structureThicknessFt;
    const topOfStructureZFt = isTopLevel ? ceilingZFt + roofBuildUpFt : nextFloorZFt;
    const verticalRiseFt = nextFloorZFt === null ? 0 : nextFloorZFt - floorZFt;
    const stairSteps = verticalRiseFt > 0 ? Math.max(1, Math.ceil(verticalRiseFt / maximumRiserFt)) : 0;
    const riserFt = stairSteps ? verticalRiseFt / stairSteps : 0;
    const stairRunFt = stairSteps > 0 ? Math.max(0, (stairSteps - 1) * treadFt) : 0;

    const verticalLevel = {
      level: level.level,
      isTopLevel,
      floorZFt,
      ceilingZFt,
      clearHeightFt,
      structureThicknessFt: isTopLevel ? roofBuildUpFt : structureThicknessFt,
      roofBuildUpFt: isTopLevel ? roofBuildUpFt : 0,
      nextFloorZFt,
      topOfStructureZFt,
      floorToFloorFt: verticalRiseFt > 0 ? verticalRiseFt : clearHeightFt + roofBuildUpFt,
      stairRiseFt: verticalRiseFt,
      stairSteps,
      stairRunFt,
      stairRiserFt: riserFt,
      stairTreadFt: treadFt,
    };

    floorZFt += clearHeightFt + structureThicknessFt;
    return verticalLevel;
  });
}

function openingHeights(type, zone, clearHeightFt) {
  const normalizedType = normalizeRoomType(type);
  const serviceRoom = zone === 'service';
  const publicRoom = zone === 'public' || normalizedType === 'entry';
  const garageRoom = normalizedType === 'garage';

  if (garageRoom) {
    return {
      doorHeadHeightFt: 8,
      windowSillHeightFt: null,
      windowHeadHeightFt: null,
    };
  }

  const doorHeadHeightFt = clamp(
    publicRoom ? 8 : 7,
    6.67,
    Math.max(6.67, clearHeightFt - 0.5)
  );
  const windowSillHeightFt = serviceRoom ? 4 : (zone === 'private' ? 3 : 2.25);
  const windowHeadHeightFt = clamp(
    serviceRoom ? clearHeightFt - 1.5 : clearHeightFt - 0.75,
    windowSillHeightFt + 1.5,
    Math.max(windowSillHeightFt + 1.5, clearHeightFt - 0.5)
  );

  return {
    doorHeadHeightFt,
    windowSillHeightFt,
    windowHeadHeightFt,
  };
}

function buildRoomHeightMeta(room, zone, verticalLevel) {
  if (!verticalLevel) return null;

  const areaSqFt = roomArea(room);
  const clearHeightFt = num(verticalLevel.clearHeightFt, 9);
  const {
    doorHeadHeightFt,
    windowSillHeightFt,
    windowHeadHeightFt,
  } = openingHeights(room?.type, zone, clearHeightFt);

  return {
    floorZFt: num(verticalLevel.floorZFt),
    ceilingZFt: num(verticalLevel.ceilingZFt),
    wallTopZFt: num(verticalLevel.ceilingZFt),
    clearHeightFt,
    topOfStructureZFt: num(verticalLevel.topOfStructureZFt),
    areaSqFt,
    volumeCuFt: Math.round(areaSqFt * clearHeightFt),
    doorHeadHeightFt,
    doorHeadZFt: num(verticalLevel.floorZFt) + doorHeadHeightFt,
    windowSillHeightFt,
    windowHeadHeightFt,
    windowSillZFt: windowSillHeightFt === null ? null : num(verticalLevel.floorZFt) + windowSillHeightFt,
    windowHeadZFt: windowHeadHeightFt === null ? null : num(verticalLevel.floorZFt) + windowHeadHeightFt,
    isTopLevel: Boolean(verticalLevel.isTopLevel),
  };
}

function pickLandingSide(stairsRoom, hallRoom) {
  if (!stairsRoom || !hallRoom) return 'hall';
  const stair = rectOf(stairsRoom);
  const hall = rectOf(hallRoom);
  if (stair.x + stair.w === hall.x) return 'right';
  if (hall.x + hall.w === stair.x) return 'left';
  if (stair.y + stair.h === hall.y) return 'bottom';
  if (hall.y + hall.h === stair.y) return 'top';
  return 'hall';
}

function stairDirection(stairsRoom) {
  const R = rectOf(stairsRoom);
  return R.h >= R.w ? 'north-south' : 'east-west';
}

function buildAdjacencyMap(level) {
  const rooms = Array.isArray(level?.rooms) ? level.rooms : [];
  const pairs = [];
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const wall = sharedWall(rooms[i], rooms[j], 1);
      if (wall) {
        pairs.push({
          a: String(rooms[i].id),
          b: String(rooms[j].id),
          wall,
        });
      }
    }
  }
  return pairs;
}

function buildOpeningIntent(room, level, brief, facade) {
  const type = normalizeRoomType(room?.type);
  const zone = classifyZone(type);
  const edges = touchingEdges(room, level);
  const preferredEdges = [];
  const frontEdge = facade.frontEdge;
  const viewEdge = facade.viewEdge;
  const naturalLight = String(brief?.naturalLight || '').toUpperCase();
  const privacyMode = naturalLight === 'MINIMAL';
  const maximumMode = naturalLight === 'MAXIMUM';
  const frontSensitiveTypes = new Set([
    'primary_bedroom',
    'bedroom',
    'guest_bedroom',
    'study',
    'library',
    'bathroom',
    'primary_bathroom',
    'powder_room',
  ]);
  const quietFeatureTypes = new Set(['study', 'library', 'movie_room', 'music_room']);
  const frontSensitive = frontSensitiveTypes.has(type);
  const quietFeature = quietFeatureTypes.has(type);

  if (zone === 'public' && viewEdge && edges.includes(viewEdge)) preferredEdges.push(viewEdge);
  if ((zone === 'circulation' || type === 'entry') && edges.includes(frontEdge)) preferredEdges.push(frontEdge);
  if (maximumMode && zone === 'public' && edges.includes(frontEdge) && !preferredEdges.includes(frontEdge)) {
    preferredEdges.push(frontEdge);
  }
  if (privacyMode && frontSensitive) {
    for (const edge of edges) {
      if (edge === frontEdge) continue;
      if (!preferredEdges.includes(edge)) preferredEdges.push(edge);
    }
    if (edges.includes(frontEdge) && !preferredEdges.includes(frontEdge)) preferredEdges.push(frontEdge);
  }
  for (const edge of edges) {
    if (!preferredEdges.includes(edge)) preferredEdges.push(edge);
  }

  const privacy =
    zone === 'service' ? 'high' :
    zone === 'private' ? 'medium' :
    'low';

  const glazing =
    zone === 'service' ? 'restricted' :
    zone === 'public' && (maximumMode || facade.viewLot) ? 'large' :
    (zone === 'private' || quietFeature) && privacyMode ? 'restricted' :
    zone === 'private' || quietFeature ? 'medium' :
    'balanced';

  const desiredWindowCount =
    privacyMode
      ? (
        zone === 'public'
          ? Math.min(1, edges.length)
          : (type === 'primary_bedroom' || quietFeature)
            ? Math.min(1, edges.length)
            : 0
      )
      : glazing === 'large'
        ? Math.min(4, Math.max(2, edges.length + (zone === 'public' ? 1 : 0)))
        : glazing === 'restricted'
          ? Math.min(1, edges.length)
          : Math.min(2, Math.max(1, edges.length));

  return {
    zone,
    exteriorEdges: edges,
    preferredEdges,
    privacy,
    glazing,
    desiredWindowCount,
    avoidFrontEdge: privacyMode && frontSensitive,
    frontEdgePenalty: privacyMode && frontSensitive ? 12 : 0,
    entryEligible: zone === 'circulation' || type === 'living_room',
  };
}

function buildRoomAdjacencyIntent(room, level) {
  const type = normalizeRoomType(room?.type);
  const intents = [];

  if (type === 'stairs') intents.push({ targetZone: 'circulation', required: true, reason: 'stair_landing' });
  if (type === 'primary_bathroom') intents.push({ targetType: 'primary_bedroom', required: true, reason: 'ensuite' });
  if (type === 'bathroom' && room?.bathroomUse === 'private' && room?.attachedTo) {
    intents.push({ targetId: String(room.attachedTo), required: true, reason: 'private_ensuite' });
  }
  if (type === 'bedroom' || type === 'guest_bedroom' || type === 'primary_bedroom') {
    intents.push({ targetZone: 'circulation', preferred: true, reason: 'bedroom_access' });
  }
  if (type === 'living_room' || type === 'dining_room' || type === 'kitchen') {
    intents.push({ targetZone: 'circulation', preferred: true, reason: 'public_access' });
  }
  if (type === 'entry') {
    intents.push({ targetZone: 'circulation', required: true, reason: 'entry_to_hall' });
    intents.push({ targetZone: 'public', preferred: true, reason: 'entry_to_public' });
  }

  const adjacency = buildAdjacencyMap(level)
    .filter((pair) => pair.a === String(room.id) || pair.b === String(room.id))
    .map((pair) => ({
      roomId: pair.a === String(room.id) ? pair.b : pair.a,
      wallKind: pair.wall.kind,
      segment: pair.wall.seg,
    }));

  return { intents, adjacency };
}

function buildLevelModel(level, brief, archetype, verticalLevel = null, resolvedFacade = null) {
  const rooms = Array.isArray(level?.rooms) ? level.rooms : [];
  const hallRoom = rooms.find((room) => normalizeRoomType(room.type) === 'hallway') || null;
  const stairsRoom = rooms.find((room) => normalizeRoomType(room.type) === 'stairs') || null;
  const facade = resolvedFacade || {
    frontEdge: edgeForFacing(brief?.frontFacing),
    viewEdge: oppositeEdge(edgeForFacing(brief?.frontFacing)),
    viewLot: ['VIEW', 'WATERFRONT'].includes(String(brief?.lotContext || '').toUpperCase()),
  };

  const zones = Array.isArray(level?.zones) && level.zones.length
    ? level.zones.map((zone) => ({
        zone: zone.zone,
        envelope: { x: num(zone.x), y: num(zone.y), w: num(zone.w), h: num(zone.h) },
        roomIds: rooms.filter((room) => (room.zone || classifyZone(room.type)) === zone.zone).map((room) => String(room.id)),
      }))
    : ['public', 'private', 'service', 'circulation']
        .map((zone) => {
          const zoneRooms = rooms.filter((room) => (room.zone || classifyZone(room.type)) === zone);
          return {
            zone,
            envelope: unionRects(zoneRooms),
            roomIds: zoneRooms.map((room) => String(room.id)),
          };
        })
        .filter((zone) => zone.roomIds.length > 0);

  const stairCore = level?.stairCore
    ? {
        roomId: stairsRoom ? String(stairsRoom.id) : null,
        x: num(level.stairCore.x),
        y: num(level.stairCore.y),
        w: num(level.stairCore.w),
        h: num(level.stairCore.h),
        direction: stairsRoom ? stairDirection(stairsRoom) : 'north-south',
        landingSide: level.stairCore.landingSide || pickLandingSide(stairsRoom, hallRoom),
        alignedKey: `${num(level.stairCore.x)}:${num(level.stairCore.w)}`,
        hallRoomId: level.stairCore.hallRoomId || (hallRoom ? String(hallRoom.id) : null),
        landingRoomId: level.stairCore.landingRoomId || level.stairCore.hallRoomId || (hallRoom ? String(hallRoom.id) : null),
        landingOpen: Boolean(level.stairCore.landingOpen),
        wideDoorways: Boolean(level.stairCore.wideDoorways),
        branchRoomIds: Array.isArray(level.stairCore.branchRoomIds) ? level.stairCore.branchRoomIds.map((id) => String(id)) : [],
        protected: true,
        presetWidthFt: archetype?.stair?.coreWidthFt || 0,
        vertical:
          verticalLevel && verticalLevel.nextFloorZFt !== null
            ? {
                fromZFt: num(verticalLevel.floorZFt),
                toZFt: num(verticalLevel.nextFloorZFt),
                riseFt: num(verticalLevel.stairRiseFt),
                runFt: num(verticalLevel.stairRunFt),
                riserFt: num(verticalLevel.stairRiserFt),
                treadFt: num(verticalLevel.stairTreadFt),
                stepCount: num(verticalLevel.stairSteps),
              }
            : null,
      }
    : stairsRoom ? {
        roomId: String(stairsRoom.id),
        x: num(stairsRoom.x),
        y: num(stairsRoom.y),
        w: num(stairsRoom.w),
        h: num(stairsRoom.h),
        direction: stairDirection(stairsRoom),
        landingSide: pickLandingSide(stairsRoom, hallRoom),
        alignedKey: `${num(stairsRoom.x)}:${num(stairsRoom.w)}`,
        hallRoomId: hallRoom ? String(hallRoom.id) : null,
        landingRoomId: hallRoom ? String(hallRoom.id) : null,
        landingOpen: false,
        branchRoomIds: [],
        protected: true,
        presetWidthFt: archetype?.stair?.coreWidthFt || 0,
        vertical:
          verticalLevel && verticalLevel.nextFloorZFt !== null
            ? {
                fromZFt: num(verticalLevel.floorZFt),
                toZFt: num(verticalLevel.nextFloorZFt),
                riseFt: num(verticalLevel.stairRiseFt),
                runFt: num(verticalLevel.stairRunFt),
                riserFt: num(verticalLevel.stairRiserFt),
                treadFt: num(verticalLevel.stairTreadFt),
                stepCount: num(verticalLevel.stairSteps),
              }
            : null,
      } : null;

  const roomModels = rooms.map((room) => {
    const zone = classifyZone(room.type);
    const openingIntent = buildOpeningIntent(room, level, brief, facade);
    const adjacencyIntent = buildRoomAdjacencyIntent(room, level);
    const heightMeta = buildRoomHeightMeta(room, zone, verticalLevel);
    return {
      id: String(room.id),
      type: normalizeRoomType(room.type),
      zone,
      protected: zone === 'circulation',
      openingIntent,
      adjacencyIntent,
      heightMeta,
    };
  });

  return {
    level: num(level.level, 1),
    width: num(level.width),
    height: num(level.height),
    protrusionFt: num(level.protrusionFt),
    facade,
    stairCore,
    verticalProfile: verticalLevel,
    zones,
    rooms: roomModels,
  };
}

function buildBuildingModel(planSpec, options = {}) {
  const brief = options.brief || {};
  const footprint = options.footprint || {};
  const archetype = options.archetype || selectArchetype(brief);
  const resolvedFrontEdge = inferFrontEdgeFromPlan(planSpec, brief);
  const facade = {
    frontFacing: brief.frontFacing || 'South',
    frontEdge: resolvedFrontEdge,
    viewEdge: oppositeEdge(resolvedFrontEdge),
    viewLot: ['VIEW', 'WATERFRONT'].includes(String(brief?.lotContext || '').toUpperCase()),
    lotContext: brief.lotContext || 'SUBURBAN',
  };
  const verticalLevels = buildVerticalLevels(planSpec, brief);
  const verticalByLevel = new Map(verticalLevels.map((level) => [String(level.level), level]));
  const levels = (Array.isArray(planSpec?.levels) ? planSpec.levels : []).map((level) =>
    buildLevelModel(level, brief, archetype, verticalByLevel.get(String(level.level)) || null, facade)
  );

  const protectedRoomIds = levels
    .flatMap((level) => level.rooms.filter((room) => room.protected).map((room) => room.id));

  return {
    archetype,
    footprint: {
      widthFt: num(footprint.widthFt),
      heightFt: num(footprint.heightFt),
      aspectRatio: num(footprint.aspectRatio),
      totalAreaSqFt: num(footprint.totalAreaSqFt || planSpec?.totalAreaSqFt),
    },
    facade,
    verticalModel: {
      ceilingHeightType: brief.ceilingHeight || 'STANDARD',
      defaultClearHeightFt: defaultClearHeightFt(brief),
      floorStructureFt: defaultFloorStructureFt(brief),
      roofBuildUpFt: defaultRoofBuildUpFt(brief),
      levels: verticalLevels,
    },
    levels,
    protectedRoomIds,
  };
}

function applyBuildingModel(planSpec, buildingModel) {
  if (!planSpec || typeof planSpec !== 'object') return planSpec;
  const byLevel = new Map((buildingModel?.levels || []).map((level) => [String(level.level), level]));

  planSpec.archetype = buildingModel?.archetype || null;
  planSpec.buildingModel = buildingModel;
  planSpec.stairCore = (buildingModel?.levels || []).map((level) => ({
    level: level.level,
    ...level.stairCore,
  })).filter((item) => item.roomId);
  planSpec.zones = (buildingModel?.levels || []).map((level) => ({
    level: level.level,
    zones: level.zones,
  }));
  planSpec.facade = buildingModel?.facade || null;
  planSpec.verticalModel = buildingModel?.verticalModel || null;

  for (const level of Array.isArray(planSpec.levels) ? planSpec.levels : []) {
    const modelLevel = byLevel.get(String(level.level));
    if (!modelLevel) continue;
    level.stairCore = modelLevel.stairCore;
    level.zones = modelLevel.zones;
    level.facade = modelLevel.facade;
    level.verticalProfile = modelLevel.verticalProfile;

    const roomModelById = new Map((modelLevel.rooms || []).map((room) => [room.id, room]));
    for (const room of Array.isArray(level.rooms) ? level.rooms : []) {
      const roomModel = roomModelById.get(String(room.id));
      if (!roomModel) continue;
      room.zone = roomModel.zone;
      room.protected = roomModel.protected;
      room.openingIntent = roomModel.openingIntent;
      room.adjacencyIntent = roomModel.adjacencyIntent;
      room.heightMeta = roomModel.heightMeta;
    }
  }

  return planSpec;
}

function enrichPlanSpec(planSpec, options = {}) {
  const buildingModel = buildBuildingModel(planSpec, options);
  return applyFurnitureLayout(require('./stairLayout').applyStairLayouts(applyBuildingModel(planSpec, buildingModel)));
}

module.exports = {
  applyBuildingModel,
  buildBuildingModel,
  classifyZone,
  edgeForFacing,
  enrichPlanSpec,
  oppositeEdge,
  sharedWall,
};
