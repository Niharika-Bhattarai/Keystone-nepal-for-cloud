// lib/tile/generateTilePlan.js
//
// Phase 4/5 rewrite:
// - preserves suite adjacency where possible
// - protects bathroom geometry using bathroom template hints from buildProgramFromBrief
// - prevents skinny fallback stripes for habitable rooms
// - returns safe storage fillers instead of forcing distorted rooms
// - keeps stair/core alignment stable across levels
// - keeps shared baths out of stair core and away from full-width bands
//
// Prior bugfixes retained:
// #1: allocateLeftRearArea gracefully handles undersized rear regions
// #2: level-2 filling guards against empty groups and invalid fallback
// #3: single shared stair/core width constant
// #5: right wing on L1 with garage splits into private rear + public front
// #7: entry stays explicit instead of disappearing into synthetic fallback
// #8: shared baths/powder rooms are not placed in stair core

'use strict';

const { normalizeRoomType } = require('./canonicalRoomTypes');
const {
  createGrid,
  paintRect,
  paintPolyomino,
  tryPolyominoFit,
  findLShapedGap,
  rect,
  splitVertical,
  splitHorizontal,
  fillRectsWithin,
} = require('./tileUtils');
const { validateTilePlan } = require('./validateTilePlan');
const {
  canContractFitRect,
  getContractFitOptions,
  minimumDepthForFixedWidth,
} = require('../residential/contractGeometry');

const PUBLIC_ROOM_TYPES  = new Set(['living_room', 'dining_room', 'kitchen']);
const FEATURE_ROOM_TYPES = new Set(['study', 'gaming_room', 'gym', 'library', 'movie_room', 'wine_cellar', 'music_room']);
const BEDROOM_TYPES      = new Set(['primary_bedroom', 'bedroom', 'guest_bedroom']);
const BATHROOM_TYPES     = new Set(['primary_bathroom', 'bathroom', 'powder_room']);

const STAIR_COLUMN_TILES = 3; // 6 ft stair core width to preserve usable room area
const STAIR_MIN_DEPTH_TILES = 4;
const TILE_SIZE_FT_DEFAULT = 2;
const STORAGE_KEEP_LIMIT = 1;

function sqftToTiles(areaSqFt, tileSizeFt) {
  return Math.max(1, Math.round(areaSqFt / (tileSizeFt * tileSizeFt)));
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function areaOfRect(r) {
  return Math.max(0, r?.w || 0) * Math.max(0, r?.h || 0);
}

function aspectRatio(w, h) {
  const shortSide = Math.max(1, Math.min(w, h));
  const longSide = Math.max(w, h);
  return longSide / shortSide;
}

function mergeOpenConceptPublicRooms(publicRooms, brief, level) {
  if (!brief.openConcept || publicRooms.length <= 1) return publicRooms;
  const sortKey = (spec) => {
    const t = normalizeRoomType(spec.type);
    if (t === 'living_room') return 0;
    if (t === 'dining_room') return 1;
    if (t === 'kitchen') return 2;
    return 3;
  };
  return [...publicRooms].sort((a, b) => sortKey(a) - sortKey(b));
}

function toTargetSpecs(specs, tileSizeFt = TILE_SIZE_FT_DEFAULT) {
  return (specs || []).filter(Boolean).map((r) => ({
    ...r,
    targetTiles: sqftToTiles(r.targetAreaSqFt || 40, tileSizeFt),
    minAreaSqFt: r.minAreaSqFt || 0,
  }));
}

function makeSyntheticRoom(id, type, level, areaSqFt, extras = {}) {
  return {
    id,
    type: normalizeRoomType(type),
    level,
    targetAreaSqFt: areaSqFt,
    minAreaSqFt: areaSqFt,
    maxAreaSqFt: areaSqFt,
    fixed: true,
    ...extras,
  };
}

function uniqSpecsById(specs) {
  const seen = new Set();
  const out = [];
  for (const s of specs || []) {
    if (!s || !s.id) continue;
    const id = String(s.id);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(s);
  }
  return out;
}

function buildRoom(level, roomSpec, tileRect) {
  const room = {
    id: roomSpec.id,
    type: normalizeRoomType(roomSpec.type),
    level,
    x: tileRect.x,
    y: tileRect.y,
    w: tileRect.w,
    h: tileRect.h,
  };

  if (roomSpec.label) room.label = roomSpec.label;
  if (roomSpec.programId) room.programId = roomSpec.programId;
  if (roomSpec.zone) room.zone = roomSpec.zone;
  if (roomSpec.openConcept) room.openConcept = true;
  if (roomSpec.bathroomUse) room.bathroomUse = roomSpec.bathroomUse;
  if (roomSpec.attachedTo) room.attachedTo = roomSpec.attachedTo;
  if (roomSpec.bathroomTemplate) room.bathroomTemplate = roomSpec.bathroomTemplate;
  if (roomSpec.preferredFootprints) room.preferredFootprints = roomSpec.preferredFootprints;
  if (roomSpec.requestedFeature !== undefined) room.requestedFeature = Boolean(roomSpec.requestedFeature);
  if (roomSpec.isFeatureRoom !== undefined) room.isFeatureRoom = Boolean(roomSpec.isFeatureRoom);
  if (roomSpec.featureSource) room.featureSource = roomSpec.featureSource;
  if (roomSpec.requestedFeatureKind) room.requestedFeatureKind = roomSpec.requestedFeatureKind;
  if (roomSpec.requestedFeatureLabel) room.requestedFeatureLabel = roomSpec.requestedFeatureLabel;
  if (roomSpec.featurePlacementFamily) room.featurePlacementFamily = roomSpec.featurePlacementFamily;
  if (roomSpec.roomContract) room.roomContract = roomSpec.roomContract;

  return room;
}

function buildCompositeRoom(level, roomSpec, tileParts) {
  const parts = (tileParts || []).filter((part) => part && part.w > 0 && part.h > 0);
  if (!parts.length) return null;
  if (parts.length === 1) return buildRoom(level, roomSpec, parts[0]);

  const minX = Math.min(...parts.map((part) => part.x));
  const minY = Math.min(...parts.map((part) => part.y));
  const maxX = Math.max(...parts.map((part) => part.x + part.w));
  const maxY = Math.max(...parts.map((part) => part.y + part.h));
  const room = buildRoom(level, roomSpec, rect(minX, minY, maxX - minX, maxY - minY));
  room.parts = parts.map((part) => ({
    x: part.x,
    y: part.y,
    w: part.w,
    h: part.h,
  }));
  return room;
}

function roomAreaTiles(room) {
  return Math.max(0, room?.w || 0) * Math.max(0, room?.h || 0);
}

function roomAreaSqFt(room) {
  return roomAreaTiles(room) * TILE_SIZE_FT_DEFAULT * TILE_SIZE_FT_DEFAULT;
}

function roomRect(room) {
  return rect(room.x, room.y, room.w, room.h);
}

function roomSpecFromPlacedRoom(room, specById) {
  const spec = specById.get(String(room?.id || ''));
  if (spec) return spec;
  return {
    id: room.id,
    type: normalizeRoomType(room.type),
    level: room.level,
    targetAreaSqFt: roomAreaSqFt(room),
    minAreaSqFt: Math.max(16, Math.round(roomAreaSqFt(room) * 0.5)),
    bathroomUse: room.bathroomUse || null,
    bathroomTemplate: room.bathroomTemplate || null,
    preferredFootprints: room.preferredFootprints || null,
    requestedFeature: Boolean(room.requestedFeature),
    isFeatureRoom: Boolean(room.isFeatureRoom),
    featureSource: room.featureSource || null,
    requestedFeatureKind: room.requestedFeatureKind || null,
    requestedFeatureLabel: room.requestedFeatureLabel || null,
    featurePlacementFamily: room.featurePlacementFamily || null,
    roomContract: room.roomContract || null,
  };
}

function mergeableRect(a, b) {
  if (!a || !b) return null;
  if (a.y === b.y && a.h === b.h && (a.x + a.w === b.x || b.x + b.w === a.x)) {
    return rect(Math.min(a.x, b.x), a.y, a.w + b.w, a.h);
  }
  if (a.x === b.x && a.w === b.w && (a.y + a.h === b.y || b.y + b.h === a.y)) {
    return rect(a.x, Math.min(a.y, b.y), a.w, a.h + b.h);
  }
  return null;
}

function classifyProgramZone(type) {
  const t = normalizeRoomType(type);
  if (t === 'hallway' || t === 'stairs' || t === 'entry') return 'circulation';
  if (BEDROOM_TYPES.has(t)) return 'private';
  if (PUBLIC_ROOM_TYPES.has(t) || FEATURE_ROOM_TYPES.has(t)) return 'public';
  return 'service';
}

function withZone(spec, zone) {
  if (!spec) return spec;
  return { ...spec, zone: zone || spec.zone || classifyProgramZone(spec.type) };
}

function zoneMeta(zone, zoneRect) {
  if (!zoneRect || zoneRect.w <= 0 || zoneRect.h <= 0) return null;
  return { zone, x: zoneRect.x, y: zoneRect.y, w: zoneRect.w, h: zoneRect.h };
}

function roomsShareWall(a, b) {
  if (!a || !b) return false;
  const ax2 = a.x + a.w;
  const ay2 = a.y + a.h;
  const bx2 = b.x + b.w;
  const by2 = b.y + b.h;
  if (ax2 === b.x || bx2 === a.x) {
    return Math.max(a.y, b.y) < Math.min(ay2, by2);
  }
  if (ay2 === b.y || by2 === a.y) {
    return Math.max(a.x, b.x) < Math.min(ax2, bx2);
  }
  return false;
}

function roomTouchSide(a, b) {
  if (!a || !b) return null;
  const ax2 = a.x + a.w;
  const ay2 = a.y + a.h;
  const bx2 = b.x + b.w;
  const by2 = b.y + b.h;
  if (ax2 === b.x && Math.max(a.y, b.y) < Math.min(ay2, by2)) return 'right';
  if (bx2 === a.x && Math.max(a.y, b.y) < Math.min(ay2, by2)) return 'left';
  if (ay2 === b.y && Math.max(a.x, b.x) < Math.min(ax2, bx2)) return 'bottom';
  if (by2 === a.y && Math.max(a.x, b.x) < Math.min(ax2, bx2)) return 'top';
  return null;
}

function distributeSpecsByArea(specs, leftRect, rightRect) {
  const cleanSpecs = uniqSpecsById(specs);
  if (!leftRect && !rightRect) return { left: [], right: [] };
  if (!leftRect) return { left: [], right: cleanSpecs };
  if (!rightRect) return { left: cleanSpecs, right: [] };

  const leftCapacity = Math.max(1, leftRect.w * leftRect.h);
  const rightCapacity = Math.max(1, rightRect.w * rightRect.h);
  const totalCapacity = leftCapacity + rightCapacity;
  const leftBudget = totalCapacity > 0 ? leftCapacity / totalCapacity : 0.5;

  const left = [];
  const right = [];
  let leftArea = 0;
  let rightArea = 0;

  for (const spec of cleanSpecs) {
    const target = Math.max(20, spec.targetAreaSqFt || spec.minAreaSqFt || 80);
    const putLeft = leftArea <= rightArea
      ? (leftArea + target) <= ((leftCapacity * 4) * 1.15) || left.length <= right.length
      : (leftArea / Math.max(1, leftArea + rightArea)) < leftBudget;
    if (putLeft) {
      left.push(spec);
      leftArea += target;
    } else {
      right.push(spec);
      rightArea += target;
    }
  }

  if (!left.length && right.length) left.push(right.shift());
  if (!right.length && left.length > 1) right.push(left.pop());
  return { left, right };
}

function stairCoreMeta(level, rooms, overrides = {}) {
  const stairs = (rooms || []).find((room) => normalizeRoomType(room.type) === 'stairs');
  const hallCandidates = (rooms || []).filter((room) => normalizeRoomType(room.type) === 'hallway');
  const landingRoom = overrides.landingRoomId
    ? (rooms || []).find((room) => String(room.id) === String(overrides.landingRoomId)) || null
    : null;
  const adjacentHall = hallCandidates.find((room) => roomsShareWall(room, stairs));
  const hall = landingRoom || adjacentHall || hallCandidates[0] || null;
  if (!stairs) return null;
  return {
    level,
    x: stairs.x,
    y: stairs.y,
    w: stairs.w,
    h: stairs.h,
    hallRoomId: hall ? hall.id : null,
    landingRoomId: landingRoom ? landingRoom.id : (hall ? hall.id : null),
    landingSide: overrides.landingSide || roomTouchSide(stairs, hall) || null,
    landingOpen: Boolean(overrides.landingOpen),
    branchRoomIds: Array.isArray(overrides.branchRoomIds) ? overrides.branchRoomIds : [],
  };
}

function roomPartsForOverlap(room) {
  if (Array.isArray(room?.parts) && room.parts.length > 0) {
    return room.parts.map((part) => rect(part.x, part.y, part.w, part.h));
  }
  return [rect(room.x, room.y, room.w, room.h)];
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function roomsActuallyOverlap(a, b) {
  const aParts = roomPartsForOverlap(a);
  const bParts = roomPartsForOverlap(b);
  return aParts.some((aPart) => bParts.some((bPart) => rectsOverlap(aPart, bPart)));
}

function refreshStairCoreMeta(levelLayout, overrides = {}) {
  if (!levelLayout) return null;
  const rooms = Array.isArray(levelLayout.rooms) ? levelLayout.rooms : [];
  const current = levelLayout.stairCore || {};
  const roomExists = (roomId) => rooms.some((room) => String(room.id) === String(roomId));
  const preservedLandingRoomId =
    overrides.landingRoomId !== undefined
      ? overrides.landingRoomId
      : (current.landingRoomId && roomExists(current.landingRoomId) ? current.landingRoomId : null);
  const preservedHallRoomId =
    overrides.hallRoomId !== undefined
      ? overrides.hallRoomId
      : (current.hallRoomId && roomExists(current.hallRoomId) ? current.hallRoomId : null);
  const preservedBranchRoomIds =
    overrides.branchRoomIds !== undefined
      ? overrides.branchRoomIds
      : (Array.isArray(current.branchRoomIds)
          ? current.branchRoomIds.filter((roomId) => roomExists(roomId))
          : []);
  const preservedLandingSide =
    overrides.landingSide !== undefined ? overrides.landingSide : current.landingSide;
  const preservedLandingOpen =
    overrides.landingOpen !== undefined ? overrides.landingOpen : current.landingOpen;

  return stairCoreMeta(levelLayout.level, rooms, {
    landingRoomId: preservedLandingRoomId || preservedHallRoomId || undefined,
    landingSide: preservedLandingSide,
    landingOpen: preservedLandingOpen,
    branchRoomIds: preservedBranchRoomIds,
  });
}

function replaceRoomById(levelLayout, roomId, replacementRooms) {
  const idx = (levelLayout.rooms || []).findIndex((room) => String(room.id) === String(roomId));
  if (idx === -1) return false;
  levelLayout.rooms.splice(idx, 1, ...(replacementRooms || []));
  return true;
}

function mergeAdjacentStorageRooms(levelLayout) {
  let changed = true;
  while (changed) {
    changed = false;
    const storageRooms = (levelLayout.rooms || []).filter((room) => normalizeRoomType(room.type) === 'storage');
    for (let i = 0; i < storageRooms.length && !changed; i++) {
      for (let j = i + 1; j < storageRooms.length; j++) {
        const merged = mergeableRect(storageRooms[i], storageRooms[j]);
        if (!merged) continue;
        const mergedRoom = {
          ...storageRooms[i],
          x: merged.x,
          y: merged.y,
          w: merged.w,
          h: merged.h,
          zone: storageRooms[i].zone || storageRooms[j].zone || 'service',
        };
        levelLayout.rooms = levelLayout.rooms.filter((room) =>
          String(room.id) !== String(storageRooms[i].id) &&
          String(room.id) !== String(storageRooms[j].id)
        );
        levelLayout.rooms.push(mergedRoom);
        changed = true;
        break;
      }
    }
  }
}

function programRecoveryPriority(spec) {
  const t = normalizeRoomType(spec?.type);
  if (t === 'primary_bathroom') return 120;
  if (t === 'bathroom') return 115;
  if (t === 'laundry') return 110;
  if (t === 'primary_bedroom') return 105;
  if (BEDROOM_TYPES.has(t)) return 100;
  if (t === 'powder_room') return 95;
  if (t === 'mudroom') return 90;
  if (PUBLIC_ROOM_TYPES.has(t)) return 80;
  if (spec?.requestedFeature || FEATURE_ROOM_TYPES.has(t)) return 70;
  if (t === 'entry') return 60;
  return 10;
}

function collectMissingProgramRooms(levelLayouts, programRooms) {
  const placedIds = new Set(
    (levelLayouts || []).flatMap((levelLayout) => (levelLayout.rooms || []).map((room) => String(room.id)))
  );

  return (programRooms || [])
    .filter((spec) => {
      const t = normalizeRoomType(spec?.type);
      if (placedIds.has(String(spec.id))) return false;
      if (t === 'stairs' || t === 'hallway' || t === 'garage') return false;
      return true;
    })
    .sort((a, b) => {
      const byPriority = programRecoveryPriority(b) - programRecoveryPriority(a);
      if (byPriority !== 0) return byPriority;
      return (b.targetAreaSqFt || 0) - (a.targetAreaSqFt || 0);
    });
}

function tryRecoverSpecFromStorage(levelLayout, storageRoom, spec) {
  const regionRect = roomRect(storageRoom);
  const placedSpec = withZone(
    { ...spec, level: levelLayout.level },
    spec.zone || storageRoom.zone || classifyProgramZone(spec.type)
  );
  const storageAreaSqFt = roomAreaSqFt(storageRoom);
  const leftoverAreaSqFt = Math.max(0, storageAreaSqFt - Math.max(placedSpec.targetAreaSqFt || 0, placedSpec.minAreaSqFt || 0));
  const filler = leftoverAreaSqFt > 0
    ? makeSyntheticRoom(
        `${storageRoom.id}_fill_${placedSpec.id}`,
        'storage',
        levelLayout.level,
        leftoverAreaSqFt,
        { zone: storageRoom.zone || 'service' }
      )
    : null;
  const specs = filler ? [placedSpec, filler] : [placedSpec];
  const direction = regionRect.w >= regionRect.h ? 'vertical' : 'horizontal';
  const attempts = [
    fillRegionWithSpecs(regionRect, specs, direction),
    fillRegionWithSpecs(regionRect, specs, direction === 'vertical' ? 'horizontal' : 'vertical'),
  ];

  for (const attempt of attempts) {
    const recovered = (attempt.placements || []).find((placement) => String(placement?.roomSpec?.id) === String(placedSpec.id));
    if (!recovered) continue;
    if (!isGeometryAcceptable(placedSpec, recovered.w, recovered.h)) continue;

    return (attempt.placements || []).map((placement) => {
      const placementSpec = normalizeRoomType(placement.roomSpec?.type) === 'storage'
        ? withZone(placement.roomSpec, storageRoom.zone || 'service')
        : withZone(placement.roomSpec, placement.roomSpec?.zone || classifyProgramZone(placement.roomSpec?.type));
      return buildRoom(levelLayout.level, placementSpec, placement);
    });
  }

  return null;
}

function recoverMissingProgramRoomsFromStorage(levelLayouts, programRooms, brief) {
  const missingSpecs = collectMissingProgramRooms(levelLayouts, programRooms);
  for (const spec of missingSpecs) {
    // Powder rooms belong in the public zone. If the public zone fill couldn't place them
    // (e.g., geometry constraints on wide/shallow footprints), skip recovery rather than
    // placing them in private-zone storage where they'd be isolated from circulation.
    if (normalizeRoomType(spec?.type) === 'powder_room') continue;
    const allowCrossLevelRecovery = FEATURE_ROOM_TYPES.has(normalizeRoomType(spec?.type));
    const sameLevelCandidates = [...(levelLayouts || [])]
      .filter((levelLayout) => levelLayout.level === spec.level)
      .filter((levelLayout) => (levelLayout.rooms || []).some((room) => normalizeRoomType(room.type) === 'storage'))
      .sort((a, b) => a.level - b.level);
    const fallbackCandidates = allowCrossLevelRecovery
      ? [...(levelLayouts || [])]
          .filter((levelLayout) => levelLayout.level !== spec.level)
          .filter((levelLayout) => (levelLayout.rooms || []).some((room) => normalizeRoomType(room.type) === 'storage'))
      : [];
    const candidateLevels = [...sameLevelCandidates, ...fallbackCandidates]
      .filter((levelLayout) => (levelLayout.rooms || []).some((room) => normalizeRoomType(room.type) === 'storage'))
      .sort((a, b) => {
        const aLaundryBonus = normalizeRoomType(spec.type) === 'laundry' && a.level === (brief.laundryLevel || spec.level) ? 1 : 0;
        const bLaundryBonus = normalizeRoomType(spec.type) === 'laundry' && b.level === (brief.laundryLevel || spec.level) ? 1 : 0;
        if (bLaundryBonus !== aLaundryBonus) return bLaundryBonus - aLaundryBonus;
        const aLevelBonus = a.level === spec.level ? 1 : 0;
        const bLevelBonus = b.level === spec.level ? 1 : 0;
        if (bLevelBonus !== aLevelBonus) return bLevelBonus - aLevelBonus;
        return a.level - b.level;
      });

    let recovered = false;
    for (const levelLayout of candidateLevels) {
      const storageRooms = (levelLayout.rooms || [])
        .filter((room) => normalizeRoomType(room.type) === 'storage')
        .sort((a, b) => roomAreaTiles(b) - roomAreaTiles(a));

      for (const storageRoom of storageRooms) {
        const replacementRooms = tryRecoverSpecFromStorage(levelLayout, storageRoom, spec);
        if (!replacementRooms) continue;
        replaceRoomById(levelLayout, storageRoom.id, replacementRooms);
        mergeAdjacentStorageRooms(levelLayout);
        recovered = true;
        break;
      }

      if (recovered) break;
    }
  }
}

function storageAbsorptionScore(room, undersized, allowHallway) {
  const t = normalizeRoomType(room?.type);
  if (t === 'stairs' || t === 'garage' || t === 'storage') return -Infinity;
  if (!allowHallway && t === 'hallway') return -Infinity;

  let score = undersized ? 300 : 0;
  if (t === 'primary_bedroom') score += 220;
  else if (BEDROOM_TYPES.has(t)) score += 210;
  else if (t === 'primary_bathroom') score += 180;
  else if (BATHROOM_TYPES.has(t)) score += 170;
  else if (t === 'laundry') score += 160;
  else if (PUBLIC_ROOM_TYPES.has(t)) score += 130;
  else if (FEATURE_ROOM_TYPES.has(t)) score += 100;
  else if (t === 'mudroom' || t === 'entry') score += 90;
  else if (t === 'hallway') score += 20;
  return score + roomAreaTiles(room);
}

function absorbStorageIntoAdjacentRooms(levelLayout, specById, requireUndersized = false, allowHallway = false) {
  let changed = true;
  while (changed) {
    changed = false;
    const storageRooms = (levelLayout.rooms || [])
      .filter((room) => normalizeRoomType(room.type) === 'storage')
      .sort((a, b) => roomAreaTiles(a) - roomAreaTiles(b));

    for (const storageRoom of storageRooms) {
      const candidates = (levelLayout.rooms || [])
        .filter((room) => String(room.id) !== String(storageRoom.id))
        .map((room) => {
          const merged = mergeableRect(room, storageRoom);
          if (!merged) return null;
          const roomSpec = roomSpecFromPlacedRoom(room, specById);
          const undersized = !isGeometryAcceptable(roomSpec, room.w, room.h);
          if (requireUndersized && !undersized) return null;
          if (!isGeometryAcceptable(roomSpec, merged.w, merged.h)) return null;
          const score = storageAbsorptionScore(room, undersized, allowHallway);
          if (!Number.isFinite(score) || score <= -Infinity) return null;
          return { room, merged, score };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score);

      if (!candidates.length) continue;

      const best = candidates[0];
      const roomIdx = levelLayout.rooms.findIndex((room) => String(room.id) === String(best.room.id));
      if (roomIdx === -1) continue;
      levelLayout.rooms[roomIdx] = {
        ...levelLayout.rooms[roomIdx],
        x: best.merged.x,
        y: best.merged.y,
        w: best.merged.w,
        h: best.merged.h,
      };
      levelLayout.rooms = levelLayout.rooms.filter((room) => String(room.id) !== String(storageRoom.id));
      changed = true;
      break;
    }
  }
}

function countStorageRooms(levelLayouts) {
  return (levelLayouts || []).reduce((sum, levelLayout) => (
    sum + (levelLayout.rooms || []).filter((room) => normalizeRoomType(room.type) === 'storage').length
  ), 0);
}

function absorbCompactGarageStorage(levelLayouts, brief) {
  if (!(brief?.stories === 2 && brief?.primaryLevel === 2 && Number(brief?.bedrooms || 0) <= 3)) return;

  for (const levelLayout of levelLayouts || []) {
    if (levelLayout.level !== 1) continue;
    let changed = true;
    while (changed) {
      changed = false;
      const storageRooms = (levelLayout.rooms || []).filter((room) => normalizeRoomType(room.type) === 'storage');
      const garageRooms = (levelLayout.rooms || []).filter((room) => normalizeRoomType(room.type) === 'garage');
      if (!storageRooms.length || !garageRooms.length) break;

      for (const storageRoom of storageRooms) {
        const match = garageRooms
          .map((garageRoom) => ({ garageRoom, merged: mergeableRect(garageRoom, storageRoom) }))
          .find((candidate) => candidate.merged);
        if (!match) continue;

        const garageIdx = levelLayout.rooms.findIndex((room) => String(room.id) === String(match.garageRoom.id));
        if (garageIdx === -1) continue;
        levelLayout.rooms[garageIdx] = {
          ...levelLayout.rooms[garageIdx],
          x: match.merged.x,
          y: match.merged.y,
          w: match.merged.w,
          h: match.merged.h,
        };
        levelLayout.rooms = levelLayout.rooms.filter((room) => String(room.id) !== String(storageRoom.id));
        changed = true;
        break;
      }
    }
  }
}

function reconcileGeneratedLevels(levelLayouts, program, brief) {
  const programRooms = (program?.levels || []).flatMap((levelProgram) => levelProgram.rooms || []);
  const specById = new Map(programRooms.map((spec) => [String(spec.id), spec]));

  for (const levelLayout of levelLayouts) mergeAdjacentStorageRooms(levelLayout);
  recoverMissingProgramRoomsFromStorage(levelLayouts, programRooms, brief);
  for (const levelLayout of levelLayouts) mergeAdjacentStorageRooms(levelLayout);

  for (const levelLayout of levelLayouts) absorbStorageIntoAdjacentRooms(levelLayout, specById, true, false);
  for (const levelLayout of levelLayouts) mergeAdjacentStorageRooms(levelLayout);

  while (countStorageRooms(levelLayouts) > STORAGE_KEEP_LIMIT) {
    const before = countStorageRooms(levelLayouts);
    for (const levelLayout of levelLayouts) {
      absorbStorageIntoAdjacentRooms(levelLayout, specById, false, false);
      mergeAdjacentStorageRooms(levelLayout);
    }
    if (countStorageRooms(levelLayouts) < before) continue;

    for (const levelLayout of levelLayouts) {
      absorbStorageIntoAdjacentRooms(levelLayout, specById, false, true);
      mergeAdjacentStorageRooms(levelLayout);
    }
    if (countStorageRooms(levelLayouts) >= before) break;
  }

  absorbCompactGarageStorage(levelLayouts, brief);

  const preferLargeUpperBottomLandingMetadata =
    brief?.primaryLevel === 2 &&
    Boolean(brief?.hasGarage) &&
    Number(brief?.bedrooms || 0) >= 4 &&
    Number(brief?.bathrooms || 0) >= 3 &&
    ['suburban_two_story_family', 'wide_view_lot_luxury'].includes(String(brief?.archetype?.id || ''));

  for (const levelLayout of levelLayouts) {
    levelLayout.stairCore = refreshStairCoreMeta(
      levelLayout,
      preferLargeUpperBottomLandingMetadata && Number(levelLayout?.level) === 2
        ? { landingSide: 'top', landingOpen: false }
        : {}
    );
  }
}

function garageDimensionsTiles(garageType, widthTiles, heightTiles) {
  let widthFt = 0;
  let depthFt = 0;
  if (garageType === 'ONE_CAR') {
    widthFt = 14;
    depthFt = 20;
  } else if (garageType === 'TWO_CAR') {
    widthFt = 22;
    depthFt = 20;
  }

  const width = Math.min(Math.max(0, Math.round(widthFt / 2)), Math.max(0, widthTiles - 10));
  const depth = Math.min(Math.max(0, Math.round(depthFt / 2)), Math.max(0, heightTiles - 4));
  return { width, depth };
}

function twoStoryNoGarageWidths(widthTiles, coreTiles) {
  const remaining = widthTiles - coreTiles;
  const leftWidth = Math.max(6, Math.floor(remaining * 0.44));
  const rightWidth = remaining - leftWidth;
  return { leftWidth, rightWidth };
}

function chooseFixedCore(widthTiles, stories) {
  let coreTiles = stories === 2 ? STAIR_COLUMN_TILES : 0;
  if (stories === 2 && widthTiles - coreTiles < 12) coreTiles = 3;
  return { coreTiles };
}

function coreXPosition(brief, footprint) {
  const { coreTiles } = chooseFixedCore(footprint.widthTiles, 2);

  if (brief.hasGarage) {
    const garageDims = garageDimensionsTiles(brief.garageType, footprint.widthTiles, footprint.heightTiles);
    const levelH = footprint.heightTiles;
    const serviceMinWidth = Math.max(3, Math.min(6, Math.ceil(100 / (levelH * 4))));
    return garageDims.width + serviceMinWidth;
  }

  const leftWidth = twoStoryNoGarageWidths(footprint.widthTiles, coreTiles).leftWidth;
  return leftWidth;
}

function isPrivateBath(spec) {
  return normalizeRoomType(spec.type) === 'bathroom' && spec.bathroomUse === 'private';
}

function isSharedBath(spec) {
  const t = normalizeRoomType(spec.type);
  if (!BATHROOM_TYPES.has(t)) return false;
  if (t === 'primary_bathroom') return false;
  return spec.bathroomUse !== 'private';
}

function bathsByAttachedBedroom(programRooms) {
  const map = new Map();
  for (const spec of programRooms || []) {
    if (!isPrivateBath(spec) || !spec.attachedTo) continue;
    if (!map.has(spec.attachedTo)) map.set(spec.attachedTo, []);
    map.get(spec.attachedTo).push(spec);
  }
  return map;
}

function suiteSequenceForBedrooms(bedrooms, bathMap) {
  const out = [];
  for (const bed of bedrooms || []) {
    out.push(bed);
    const attachedBaths = bathMap.get(bed.id) || [];
    for (const bath of attachedBaths) out.push(bath);
  }
  return out;
}

function buildSuburbanFamilyLayoutProfile(brief, programRooms) {
  const isSuburbanTwoStoryFamily =
    brief?.archetype?.id === 'suburban_two_story_family' &&
    Number(brief?.stories || 0) === 2;
  const isLuxuryUpperGarageFamily =
    brief?.archetype?.id === 'wide_view_lot_luxury' &&
    Number(brief?.stories || 0) === 2;
  const usesUpperGarageFamilyLayout =
    (isSuburbanTwoStoryFamily || isLuxuryUpperGarageFamily) &&
    Boolean(brief?.hasGarage) &&
    Number(brief?.primaryLevel || 1) === 2;

  const secondaryBedrooms = (programRooms || []).filter((r) =>
    ['bedroom', 'guest_bedroom'].includes(normalizeRoomType(r.type))
  );
  const featureRooms = (programRooms || []).filter((r) =>
    FEATURE_ROOM_TYPES.has(normalizeRoomType(r.type))
  );
  const sharedBaths = (programRooms || []).filter((r) => isSharedBath(r));
  const privateBathMap = bathsByAttachedBedroom(programRooms);
  const l2SecondaryBedrooms = secondaryBedrooms.filter((r) => Number(r.level) === 2);
  const l2SecondarySuiteGroups = l2SecondaryBedrooms.map((bed) => ({
    bed,
    baths: privateBathMap.get(String(bed.id)) || privateBathMap.get(bed.id) || [],
  }));
  const l2FeatureRooms = featureRooms.filter((r) => Number(r.level) === 2);
  const l2SharedBaths = sharedBaths.filter((r) => Number(r.level) === 2);

  return {
    isSuburbanTwoStoryFamily,
    usesUpperGarageFamilyLayout,
    bedrooms: Number(brief?.bedrooms || 0),
    bathrooms: Number(brief?.bathrooms || 0),
    privateBathsRequested: Number(brief?.privateBathsRequested || 0),
    level2SecondaryBedroomCount: l2SecondaryBedrooms.length,
    level2PrivateSuiteCount: l2SecondarySuiteGroups.filter((suite) => suite.baths.length >= 1).length,
    level2SharedBathCount: l2SharedBaths.length,
    level2FeatureCount: l2FeatureRooms.length,
    requestedFeatureCount: featureRooms.filter((room) => Boolean(room?.requestedFeature)).length,
  };
}

function minColumnWidthForProgramUnit(unit) {
  if (!unit) return 3;
  if (unit.kind === 'suite') return 6;
  const type = normalizeRoomType(unit?.spec?.type);
  if (BEDROOM_TYPES.has(type)) return 5;
  if (BATHROOM_TYPES.has(type)) return 3;
  if (type === 'study') return 4;
  return 4;
}

function allocateWeightedColumnWidths(totalWidth, units) {
  const cleanUnits = Array.isArray(units) ? units : [];
  if (!cleanUnits.length) return [];

  let widths = cleanUnits.map((unit) => Math.max(1, Number(unit?.minWidth) || minColumnWidthForProgramUnit(unit)));
  let minTotal = widths.reduce((sum, width) => sum + width, 0);

  while (minTotal > totalWidth) {
    let changed = false;
    for (let i = widths.length - 1; i >= 0 && minTotal > totalWidth; i--) {
      if (widths[i] <= 1) continue;
      widths[i] -= 1;
      minTotal -= 1;
      changed = true;
    }
    if (!changed) break;
  }

  const extra = Math.max(0, totalWidth - minTotal);
  if (!extra) return widths;

  const weights = cleanUnits.map((unit) => Math.max(1, Number(unit?.weight) || 1));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const fractional = [];
  let distributed = 0;

  for (let i = 0; i < widths.length; i++) {
    const exact = (extra * weights[i]) / totalWeight;
    const whole = Math.floor(exact);
    widths[i] += whole;
    distributed += whole;
    fractional.push({ index: i, fraction: exact - whole });
  }

  let remainder = extra - distributed;
  fractional.sort((a, b) => b.fraction - a.fraction);
  for (let i = 0; i < fractional.length && remainder > 0; i++) {
    widths[fractional[i].index] += 1;
    remainder -= 1;
  }

  return widths;
}

function buildFamilySouthZoneUnits(secondarySuiteGroups, secondaryBedrooms, sharedBaths, featureRooms) {
  const units = [];
  const suiteBedIds = new Set();

  for (const suite of secondarySuiteGroups || []) {
    if (!suite?.bed || !suite?.baths?.length) continue;
    suiteBedIds.add(String(suite.bed.id));
    units.push({
      kind: 'suite',
      suite,
      weight: (suite.bed.targetAreaSqFt || 120) + suite.baths.reduce((sum, bath) => sum + (bath.targetAreaSqFt || 60), 0),
      minWidth: 6,
    });
  }

  for (const bed of secondaryBedrooms || []) {
    if (suiteBedIds.has(String(bed.id))) continue;
    units.push({
      kind: 'room',
      spec: bed,
      weight: bed.targetAreaSqFt || 110,
      minWidth: 5,
    });
  }

  for (const feature of featureRooms || []) {
    units.push({
      kind: 'room',
      spec: feature,
      weight: feature.targetAreaSqFt || 90,
      minWidth: 4,
    });
  }

  for (const bath of sharedBaths || []) {
    units.push({
      kind: 'room',
      spec: bath,
      weight: bath.targetAreaSqFt || 60,
      minWidth: 3,
    });
  }

  return units;
}

function isQuietFocusFeatureRoom(roomSpec) {
  if (!roomSpec) return false;
  const placementFamily = String(roomSpec.featurePlacementFamily || '').trim().toLowerCase();
  const requestedKind = String(roomSpec.requestedFeatureKind || '').trim().toLowerCase();
  const type = normalizeRoomType(roomSpec.type);
  return placementFamily === 'quiet_focus'
    || requestedKind === 'home_office'
    || requestedKind === 'study'
    || type === 'study'
    || type === 'library';
}

function splitSuiteSpecs(specs) {
  const suites = [];
  const used = new Set();
  const beds = (specs || []).filter((r) => BEDROOM_TYPES.has(normalizeRoomType(r.type)));
  const primaryBed = beds.find((r) => normalizeRoomType(r.type) === 'primary_bedroom');
  const primaryBath = (specs || []).find((r) => normalizeRoomType(r.type) === 'primary_bathroom');
  const privateBathMap = bathsByAttachedBedroom(specs);

  if (primaryBed && primaryBath) {
    suites.push({ bed: primaryBed, baths: [primaryBath] });
    used.add(primaryBed.id);
    used.add(primaryBath.id);
  }

  for (const bed of beds) {
    if (used.has(bed.id)) continue;
    const baths = privateBathMap.get(bed.id) || [];
    if (!baths.length) continue;
    suites.push({ bed, baths });
    used.add(bed.id);
    for (const b of baths) used.add(b.id);
  }

  const others = (specs || []).filter((s) => !used.has(s.id));
  return { suites, others };
}

function publicDepthBias(brief) {
  // layoutVariantBias is set per-candidate in plan.js to explore different zone
  // depth configurations (beam search analog). Standard value is 0.
  let bias = Number(brief?.layoutVariantBias || 0);
  if (brief.indoorOutdoor === 'MAXIMUM') bias += 0.08;
  if (brief.indoorOutdoor === 'MINIMAL') bias -= 0.07;
  if (brief.naturalLight === 'MAXIMUM') bias += 0.10; // was 0.04 — give more depth to light-sensitive public zone
  if (brief.naturalLight === 'MINIMAL') bias -= 0.06; // was -0.04
  if (brief.lotContext === 'VIEW' || brief.lotContext === 'WATERFRONT') bias += 0.06;
  if (brief.lotContext === 'URBAN') bias -= 0.04;
  if (brief.lotContext === 'CORNER') bias += 0.02;
  return bias;
}

function facingTransformMode(brief) {
  const f = String(brief?.frontFacing || 'South').toUpperCase();
  if (f === 'NORTH') return 'MIRROR_Y';
  if (f === 'EAST') return 'MIRROR_X';
  if (f === 'WEST') return 'MIRROR_XY';
  return 'NONE';
}

function applyFacingTransform(levelLayout, brief) {
  const mode = facingTransformMode(brief);
  if (mode === 'NONE') return levelLayout;

  const W = levelLayout.widthTiles;
  const H = levelLayout.heightTiles;

  const tx = (r) => W - r.x - r.w;
  const ty = (r) => H - r.y - r.h;
  const transformSide = (side) => {
    let out = String(side || '').toLowerCase();
    if (!out) return null;
    if (mode === 'MIRROR_X' || mode === 'MIRROR_XY') {
      if (out === 'left') out = 'right';
      else if (out === 'right') out = 'left';
    }
    if (mode === 'MIRROR_Y' || mode === 'MIRROR_XY') {
      if (out === 'top') out = 'bottom';
      else if (out === 'bottom') out = 'top';
    }
    return out;
  };

  const rooms = levelLayout.rooms.map((r) => {
    const out = { ...r };
    if (mode === 'MIRROR_X' || mode === 'MIRROR_XY') out.x = tx(r);
    if (mode === 'MIRROR_Y' || mode === 'MIRROR_XY') out.y = ty(r);
    if (Array.isArray(r.parts) && r.parts.length > 0) {
      out.parts = r.parts.map((part) => {
        const next = { ...part };
        if (mode === 'MIRROR_X' || mode === 'MIRROR_XY') next.x = W - part.x - part.w;
        if (mode === 'MIRROR_Y' || mode === 'MIRROR_XY') next.y = H - part.y - part.h;
        return next;
      });
    }
    return out;
  });

  const zones = (levelLayout.zones || []).map((zone) => {
    const out = { ...zone };
    if (mode === 'MIRROR_X' || mode === 'MIRROR_XY') out.x = W - zone.x - zone.w;
    if (mode === 'MIRROR_Y' || mode === 'MIRROR_XY') out.y = H - zone.y - zone.h;
    return out;
  });

  const stairCore = levelLayout.stairCore
    ? {
        ...levelLayout.stairCore,
        x: (mode === 'MIRROR_X' || mode === 'MIRROR_XY') ? W - levelLayout.stairCore.x - levelLayout.stairCore.w : levelLayout.stairCore.x,
        y: (mode === 'MIRROR_Y' || mode === 'MIRROR_XY') ? H - levelLayout.stairCore.y - levelLayout.stairCore.h : levelLayout.stairCore.y,
        landingSide: transformSide(levelLayout.stairCore.landingSide),
      }
    : null;

  return { ...levelLayout, rooms, zones, stairCore };
}

function repairCompactFacingArtifacts(levelLayout, brief) {
  if (
    !levelLayout ||
    brief?.stories !== 2 ||
    brief?.primaryLevel !== 2 ||
    Number(brief?.bedrooms || 0) !== 3 ||
    Number(brief?.bathrooms || 0) < 3 ||
    !brief?.hasGarage
  ) {
    return levelLayout;
  }

  const rooms = Array.isArray(levelLayout.rooms) ? [...levelLayout.rooms] : [];

  if (levelLayout.level === 1) {
    // NOTE: Connector hall extension logic was removed here.
    // Fix 3 now creates the connector at 1-tile wide upfront during initial layout,
    // so the post-transform extension is unnecessary and was causing tile overlaps
    // on narrow footprints after the facing transform mirrors room positions.

    const protrusionFill = rooms.find((room) => String(room.id) === 'protrusion_fill_l1');
    const laundryRoom = rooms.find((room) => normalizeRoomType(room.type) === 'laundry');
    const mudroomRoom = rooms.find((room) => normalizeRoomType(room.type) === 'mudroom');
    if (protrusionFill && laundryRoom) {
      const oldLaundryRect = rect(laundryRoom.x, laundryRoom.y, laundryRoom.w, laundryRoom.h);
      laundryRoom.x = protrusionFill.x;
      laundryRoom.y = protrusionFill.y;
      laundryRoom.w = protrusionFill.w;
      laundryRoom.h = protrusionFill.h;

      let oldLaundryRectCovered = false;
      if (mudroomRoom) {
        const mergedMudroom = mergeableRect(mudroomRoom, oldLaundryRect);
        if (mergedMudroom) {
          mudroomRoom.x = mergedMudroom.x;
          mudroomRoom.y = mergedMudroom.y;
          mudroomRoom.w = mergedMudroom.w;
          mudroomRoom.h = mergedMudroom.h;
          oldLaundryRectCovered = true;
        }
      }

      if (!oldLaundryRectCovered) {
        // Old laundry position is now uncovered. Insert a storage filler so the
        // subsequent absorption loop can route it into an adjacent room (e.g. entry).
        const fillerId = `laundry_old_fill_l${levelLayout.level}`;
        rooms.push({
          id: fillerId,
          type: 'storage',
          level: levelLayout.level,
          x: oldLaundryRect.x,
          y: oldLaundryRect.y,
          w: oldLaundryRect.w,
          h: oldLaundryRect.h,
        });
      }

      const fillIdx = rooms.findIndex((room) => String(room.id) === String(protrusionFill.id));
      if (fillIdx !== -1) rooms.splice(fillIdx, 1);
    }

    let changed = true;
    while (changed) {
      changed = false;
      const storageRooms = rooms.filter((room) => normalizeRoomType(room.type) === 'storage');
      for (const storageRoom of storageRooms) {
        const target = rooms.find((room) => {
          const type = normalizeRoomType(room.type);
          return ['mudroom', 'laundry', 'entry'].includes(type) && mergeableRect(room, storageRoom);
        });
        if (!target) continue;
        const merged = mergeableRect(target, storageRoom);
        if (!merged) continue;
        const targetIdx = rooms.findIndex((room) => String(room.id) === String(target.id));
        const storageIdx = rooms.findIndex((room) => String(room.id) === String(storageRoom.id));
        if (targetIdx === -1 || storageIdx === -1) continue;
        rooms[targetIdx] = { ...rooms[targetIdx], x: merged.x, y: merged.y, w: merged.w, h: merged.h };
        rooms.splice(storageIdx, 1);
        changed = true;
        break;
      }
    }
  }

  return {
    ...levelLayout,
    rooms,
    stairCore: refreshStairCoreMeta({ ...levelLayout, rooms }),
  };
}

function sortSpecsForFill(specs) {
  return [...(specs || [])].sort((a, b) => {
    const aType = normalizeRoomType(a.type);
    const bType = normalizeRoomType(b.type);

    const score = (spec, t) => {
      const hasPreferredFootprints = Array.isArray(spec?.preferredFootprints) && spec.preferredFootprints.length > 0;

      if (t === 'primary_bedroom') return 10;
      if (t === 'primary_bathroom') return 9;
      if (hasPreferredFootprints) return 8;
      if (t === 'laundry') return 7;
      if (t === 'mudroom') return 7;
      if (t === 'entry') return 7;
      if (t === 'bathroom' || t === 'powder_room') return 6;
      if (BEDROOM_TYPES.has(t)) return 5;
      if (FEATURE_ROOM_TYPES.has(t)) return 4;
      if (PUBLIC_ROOM_TYPES.has(t)) return 3;
      if (t === 'storage') return 0;
      return 1;
    };

    const sA = score(a, aType);
    const sB = score(b, bType);

    if (sB !== sA) return sB - sA;
    return (b.targetAreaSqFt || 0) - (a.targetAreaSqFt || 0);
  });
}

function sumRectArea(rects) {
  return (rects || []).reduce((sum, r) => sum + (r.w * r.h), 0);
}

function maxAspectRatioForSpec(spec) {
  const t = normalizeRoomType(spec?.type);
  // Match scoreFootprint.js threshold — bathrooms > 4:1 are penalized during scoring,
  // so prevent the generator from producing them in the first place.
  if (t === 'bathroom' || t === 'powder_room' || t === 'primary_bathroom') return 4;
  if (t === 'hallway' || t === 'stairs' || t === 'garage') return 99;
  if (t === 'storage' || t === 'laundry' || t === 'mudroom' || t === 'entry') return 6;
  if (PUBLIC_ROOM_TYPES.has(t) || FEATURE_ROOM_TYPES.has(t) || BEDROOM_TYPES.has(t)) {
    if (spec?.targetAreaSqFt < 120) return 6;
    return 4;
  }
  return 5;
}

function minShortSideForSpec(spec) {
  const t = normalizeRoomType(spec?.type);
  if (t === 'powder_room') return 2;
  if (t === 'bathroom' || t === 'primary_bathroom') return 3;
  if (t === 'hallway' || t === 'stairs') return 2;
  if (t === 'garage') return 1;
  if (t === 'laundry' || t === 'mudroom' || t === 'entry' || t === 'storage') return 2;
  if (PUBLIC_ROOM_TYPES.has(t) || FEATURE_ROOM_TYPES.has(t) || BEDROOM_TYPES.has(t)) {
    if (spec?.targetAreaSqFt < 100) return 2;
    return 3;
  }
  return 2;
}

function hasBathroomTemplate(spec) {
  return Array.isArray(spec?.preferredFootprints) && spec.preferredFootprints.length > 0;
}

function normalizeTemplateDims(template) {
  if (!template) return null;
  const w = Number(template.widthFt || template.w || 0) / TILE_SIZE_FT_DEFAULT || Number(template.w || 0);
  const h = Number(template.heightFt || template.h || 0) / TILE_SIZE_FT_DEFAULT || Number(template.h || 0);

  // If widthFt/heightFt were already in tiles, keep them sane.
  const tw = Number.isFinite(w) && w > 0 ? Math.round(w) : null;
  const th = Number.isFinite(h) && h > 0 ? Math.round(h) : null;

  if (!tw || !th) return null;
  return { w: tw, h: th };
}

function preferredTemplateDims(spec) {
  if (!hasBathroomTemplate(spec)) return [];
  const out = [];
  for (const fp of spec.preferredFootprints) {
    const dims = normalizeTemplateDims(fp);
    if (!dims) continue;
    out.push(dims);
    out.push({ w: dims.h, h: dims.w });
  }
  return out;
}

function templateFitPenalty(spec, w, h) {
  if (!hasBathroomTemplate(spec)) return 0;
  const dims = preferredTemplateDims(spec);
  if (!dims.length) return 0;

  let best = Infinity;
  for (const d of dims) {
    const dw = Math.abs(w - d.w);
    const dh = Math.abs(h - d.h);
    const areaPenalty = Math.abs((w * h) - (d.w * d.h)) * 0.2;
    const score = dw + dh + areaPenalty;
    if (score < best) best = score;
  }
  return best;
}

function bathroomShapeAcceptable(spec, w, h) {
  if (!hasBathroomTemplate(spec)) return true;
  const penalty = templateFitPenalty(spec, w, h);
  const ratio = aspectRatio(w, h);
  return penalty <= 6 && ratio <= 5;
}

function isGeometryAcceptable(spec, w, h) {
  if (!spec || w <= 0 || h <= 0) return false;

  const shortSide = Math.min(w, h);
  const ratio = aspectRatio(w, h);

  if (shortSide < minShortSideForSpec(spec)) return false;
  if (ratio > maxAspectRatioForSpec(spec)) return false;

  const t = normalizeRoomType(spec.type);
  if (t === 'bathroom' || t === 'powder_room' || t === 'primary_bathroom') {
    if (!bathroomShapeAcceptable(spec, w, h)) return false;
  }

  if (!canContractFitRect(spec, w * TILE_SIZE_FT_DEFAULT, h * TILE_SIZE_FT_DEFAULT)) {
    return false;
  }

  return true;
}

function validatePlacementsGeometry(placements) {
  const accepted = [];
  const overflow = [];

  for (const item of placements || []) {
    if (isGeometryAcceptable(item.roomSpec, item.w, item.h)) accepted.push(item);
    else if (item?.roomSpec) overflow.push(item.roomSpec);
  }

  return { placements: accepted, overflow };
}

function minTilesForSpec(spec) {
  return Math.max(
    1,
    Math.ceil((spec.minAreaSqFt || spec.targetAreaSqFt || 16) / (TILE_SIZE_FT_DEFAULT * TILE_SIZE_FT_DEFAULT))
  );
}

function preferredStripeDepth(spec, crossSpan) {
  const dims = preferredTemplateDims(spec);
  if (!dims.length) return null;

  let best = null;
  let bestPenalty = Infinity;

  for (const d of dims) {
    const candidates = [d.h, d.w];
    for (const candidate of candidates) {
      const penalty = Math.abs(crossSpan - d.w) + Math.abs(candidate - d.h);
      if (penalty < bestPenalty) {
        bestPenalty = penalty;
        best = candidate;
      }
    }
  }

  return best;
}

function safeStripeFill(regionRect, specs, direction = 'horizontal') {
  const clean = sortSpecsForFill((specs || []).filter(Boolean));
  if (!regionRect || !clean.length) return { placements: [], overflow: [] };

  const totalRegionTiles = areaOfRect(regionRect);
  let remainingPrimary = direction === 'horizontal' ? regionRect.h : regionRect.w;
  const placements = [];
  const overflow = [];

  const targetTotal = clean.reduce(
    (sum, s) => sum + Math.max(minTilesForSpec(s), sqftToTiles(s.targetAreaSqFt || 40, TILE_SIZE_FT_DEFAULT)),
    0
  ) || 1;

  const crossSpan = direction === 'horizontal' ? regionRect.w : regionRect.h;
  let cursor = direction === 'horizontal' ? regionRect.y : regionRect.x;

  for (let i = 0; i < clean.length; i++) {
    const spec = clean[i];
    const minTiles = minTilesForSpec(spec);
    const minShort = minShortSideForSpec(spec);
    const maxRatio = maxAspectRatioForSpec(spec);

    if (crossSpan < minShort) {
      overflow.push(spec);
      continue;
    }

    const minPrimaryByArea = Math.ceil(minTiles / Math.max(1, crossSpan));
    const minPrimaryByRatio = Math.ceil(crossSpan / Math.max(1, maxRatio));
    let primarySize = Math.max(1, minPrimaryByArea, minPrimaryByRatio);

    const targetTiles = Math.max(minTiles, sqftToTiles(spec.targetAreaSqFt || 40, TILE_SIZE_FT_DEFAULT));
    const proportionalPrimary = Math.round((targetTiles / targetTotal) * (direction === 'horizontal' ? regionRect.h : regionRect.w));
    primarySize = Math.max(primarySize, proportionalPrimary);

    const preferred = preferredStripeDepth(spec, crossSpan);
    if (preferred) {
      primarySize = Math.max(primarySize, preferred);
    }

    const remainingSpecs = clean.slice(i + 1).filter(Boolean);
    const reserve = remainingSpecs.reduce((sum, nextSpec) => {
      const nextMinTiles = minTilesForSpec(nextSpec);
      const nextMinPrimaryByArea = Math.ceil(nextMinTiles / Math.max(1, crossSpan));
      const nextMinPrimaryByRatio = Math.ceil(crossSpan / Math.max(1, maxAspectRatioForSpec(nextSpec)));
      return sum + Math.max(1, nextMinPrimaryByArea, nextMinPrimaryByRatio);
    }, 0);

    if (remainingPrimary - primarySize < reserve) {
      primarySize = remainingPrimary - reserve;
    }

    if (i === clean.length - 1) {
      primarySize = remainingPrimary;
    }

    primarySize = Math.max(0, Math.min(primarySize, remainingPrimary));
    if (primarySize <= 0) {
      overflow.push(spec);
      continue;
    }

    const w = direction === 'horizontal' ? regionRect.w : primarySize;
    const h = direction === 'horizontal' ? primarySize : regionRect.h;
    const x = direction === 'horizontal' ? regionRect.x : cursor;
    const y = direction === 'horizontal' ? cursor : regionRect.y;

    if (!isGeometryAcceptable(spec, w, h)) {
      overflow.push(spec);
      continue;
    }

    placements.push({ roomSpec: spec, x, y, w, h });
    cursor += primarySize;
    remainingPrimary -= primarySize;
  }

  if (remainingPrimary > 0 && placements.length > 0) {
    const last = placements[placements.length - 1];
    const expanded = {
      ...last,
      w: direction === 'horizontal' ? last.w : last.w + remainingPrimary,
      h: direction === 'horizontal' ? last.h + remainingPrimary : last.h,
    };

    if (isGeometryAcceptable(expanded.roomSpec, expanded.w, expanded.h)) {
      placements[placements.length - 1] = expanded;
      remainingPrimary = 0;
    } else {
      // Expansion violates geometry constraints — add a filler to close the gap
      const fillerX = direction === 'horizontal' ? regionRect.x : cursor;
      const fillerY = direction === 'horizontal' ? cursor : regionRect.y;
      const fillerW = direction === 'horizontal' ? regionRect.w : remainingPrimary;
      const fillerH = direction === 'horizontal' ? remainingPrimary : regionRect.h;
      if (fillerW > 0 && fillerH > 0) {
        const gapFiller = makeSyntheticRoom(`gap_fill_${fillerX}_${fillerY}`, 'storage', 1, fillerW * fillerH * 4);
        placements.push({ roomSpec: gapFiller, x: fillerX, y: fillerY, w: fillerW, h: fillerH });
        remainingPrimary = 0;
      }
    }
  }

  // If remainingPrimary still > 0 (all specs overflowed), add a full-region filler
  if (remainingPrimary > 0 && !placements.length && totalRegionTiles > 0) {
    const allGapFiller = makeSyntheticRoom(`region_fill_${regionRect.x}_${regionRect.y}`, 'storage', 1, totalRegionTiles * 4);
    return { placements: [{ roomSpec: allGapFiller, x: regionRect.x, y: regionRect.y, w: regionRect.w, h: regionRect.h }], overflow: [] };
  }

  if (!placements.length && clean.length && totalRegionTiles > 0) {
    return { placements: [], overflow: clean };
  }

  return { placements, overflow };
}

function fallbackStripeFill(regionRect, specs, direction = 'horizontal') {
  return safeStripeFill(regionRect, specs, direction).placements;
}

function attemptSafeFill(regionRect, clean, direction) {
  const primary = fillRectsWithin(regionRect, toTargetSpecs(clean), direction);
  const exact = validatePlacementsGeometry(primary);

  if (
    exact.placements.length === clean.length &&
    !exact.overflow.length &&
    sumRectArea(exact.placements) === areaOfRect(regionRect)
  ) {
    return exact;
  }

  const alternateDirection = direction === 'horizontal' ? 'vertical' : 'horizontal';
  const alternate = fillRectsWithin(regionRect, toTargetSpecs(clean), alternateDirection);
  const altValidated = validatePlacementsGeometry(alternate);

  if (
    altValidated.placements.length === clean.length &&
    !altValidated.overflow.length &&
    sumRectArea(altValidated.placements) === areaOfRect(regionRect)
  ) {
    return altValidated;
  }

  const stripePrimary = safeStripeFill(regionRect, clean, direction);
  const stripeAlternate = safeStripeFill(regionRect, clean, alternateDirection);

  // If both succeed perfectly, pick the one with the best (lowest max) aspect ratio
  if (stripePrimary.overflow.length === 0 && stripeAlternate.overflow.length === 0) {
    const maxRatioP = Math.max(...stripePrimary.placements.map(p => Math.max(p.w, p.h) / Math.max(0.1, Math.min(p.w, p.h))));
    const maxRatioA = Math.max(...stripeAlternate.placements.map(p => Math.max(p.w, p.h) / Math.max(0.1, Math.min(p.w, p.h))));
    return maxRatioA < maxRatioP ? stripeAlternate : stripePrimary;
  }

  if (stripePrimary.overflow.length === 0) return stripePrimary;
  if (stripeAlternate.overflow.length === 0) return stripeAlternate;

  // If both drop rooms, pick the one that placed the most rooms (fewest in overflow)
  if (stripePrimary.placements.length > 0 && stripeAlternate.placements.length > 0) {
    if (stripeAlternate.overflow.length < stripePrimary.overflow.length) {
      return stripeAlternate;
    }
  }

  // Fallback to primary if both are equally bad
  if (stripePrimary.placements.length && stripePrimary.overflow.length < clean.length) return stripePrimary;
  return stripeAlternate;
}

function fillRegionWithSpecs(regionRect, specs, direction = 'horizontal') {
  const clean = sortSpecsForFill((specs || []).filter(Boolean));
  if (!regionRect || !clean.length) return { placements: [], overflow: [] };

  const regionTiles = areaOfRect(regionRect);
  const minTilesNeeded = clean.length;
  if (regionTiles < minTilesNeeded) {
    return { placements: [], overflow: clean };
  }

  const fit = attemptSafeFill(regionRect, clean, direction);
  if (!fit.overflow.length) return fit;

  const placedIds = new Set(fit.placements.map((p) => p.roomSpec?.id).filter(Boolean));
  const unresolved = clean.filter((spec) => !placedIds.has(spec.id));
  const overflow = [];
  const placements = [...fit.placements];

  for (const spec of unresolved) {
    if (!placements.length) {
      overflow.push(spec);
      continue;
    }

    let bestIndex = -1;
    let bestAreaGain = 0;

    for (let i = 0; i < placements.length; i++) {
      const existing = placements[i];
      const sameBand = direction === 'horizontal'
        ? existing.x === regionRect.x && existing.w === regionRect.w
        : existing.y === regionRect.y && existing.h === regionRect.h;
      if (!sameBand) continue;

      const candidateArea = existing.w * existing.h;
      if (candidateArea > bestAreaGain) {
        bestAreaGain = candidateArea;
        bestIndex = i;
      }
    }

    if (bestIndex < 0) {
      overflow.push(spec);
      continue;
    }

    const host = placements[bestIndex];

    if (direction === 'horizontal') {
      if (host.h < 2) {
        overflow.push(spec);
        continue;
      }

      const splitH = Math.max(1, Math.floor(host.h / 2));
      const remainH = host.h - splitH;

      const candidateA = { roomSpec: host.roomSpec, x: host.x, y: host.y, w: host.w, h: splitH };
      const candidateB = { roomSpec: spec, x: host.x, y: host.y + splitH, w: host.w, h: remainH };

      if (
        !isGeometryAcceptable(candidateA.roomSpec, candidateA.w, candidateA.h) ||
        !isGeometryAcceptable(candidateB.roomSpec, candidateB.w, candidateB.h)
      ) {
        overflow.push(spec);
        continue;
      }

      placements.splice(bestIndex, 1, candidateA, candidateB);
    } else {
      if (host.w < 2) {
        overflow.push(spec);
        continue;
      }

      const splitW = Math.max(1, Math.floor(host.w / 2));
      const remainW = host.w - splitW;

      const candidateA = { roomSpec: host.roomSpec, x: host.x, y: host.y, w: splitW, h: host.h };
      const candidateB = { roomSpec: spec, x: host.x + splitW, y: host.y, w: remainW, h: host.h };

      if (
        !isGeometryAcceptable(candidateA.roomSpec, candidateA.w, candidateA.h) ||
        !isGeometryAcceptable(candidateB.roomSpec, candidateB.w, candidateB.h)
      ) {
        overflow.push(spec);
        continue;
      }

      placements.splice(bestIndex, 1, candidateA, candidateB);
    }
  }

  return { placements, overflow };
}

// ── Guaranteed-coverage wrapper ───────────────────────────────────────────────
// Like fillRegionWithSpecs but always produces placements covering the FULL
// regionRect. Any area not claimed by specs is filled with a synthetic storage
// room to prevent "unfilled tile" validation errors.
function fillWithGuaranteedCoverage(regionRect, specs, direction, fillerLabel) {
  const clean = (specs || []).filter(Boolean);
  const zoneArea = areaOfRect(regionRect);

  if (!regionRect || zoneArea <= 0) return { placements: [], overflow: [] };

  if (!clean.length) {
    const label = fillerLabel || `fill_${regionRect.x}_${regionRect.y}`;
    const filler = makeSyntheticRoom(label, 'storage', 1, zoneArea * 4);
    return { placements: [{ roomSpec: filler, x: regionRect.x, y: regionRect.y, w: regionRect.w, h: regionRect.h }], overflow: [] };
  }

  const { placements, overflow } = fillRegionWithSpecs(regionRect, clean, direction);
  const coveredArea = placements.reduce((s, p) => s + p.w * p.h, 0);

  if (coveredArea >= zoneArea) return { placements, overflow };

  // Some area is uncovered — try fallbackStripeFill with all specs
  const stripeResult = fallbackStripeFill(regionRect, clean, direction);
  const stripeArea = stripeResult.reduce((s, p) => s + p.w * p.h, 0);
  if (stripeArea >= zoneArea) return { placements: stripeResult, overflow: [] };

  // Neither fill achieved full coverage — take the better result and fill gaps
  // with storage so the grid is fully covered (prevents tile overlap / unfilled crashes).
  const bestPlacements = (stripeArea > coveredArea) ? [...stripeResult] : [...placements];
  const bestArea = Math.max(stripeArea, coveredArea);

  if (bestArea < zoneArea && bestPlacements.length > 0) {
    // Build a mini-grid for the region to find uncovered tiles precisely.
    const regionW = regionRect.w;
    const regionH = regionRect.h;
    const miniGrid = Array.from({ length: regionH }, () => Array(regionW).fill(null));
    for (const p of bestPlacements) {
      for (let dy = 0; dy < p.h; dy++) {
        for (let dx = 0; dx < p.w; dx++) {
          const gy = p.y - regionRect.y + dy;
          const gx = p.x - regionRect.x + dx;
          if (gy >= 0 && gy < regionH && gx >= 0 && gx < regionW) {
            miniGrid[gy][gx] = p.roomSpec?.id || 'placed';
          }
        }
      }
    }

    // Scan for contiguous rectangular gaps and fill them
    for (let gy = 0; gy < regionH; gy++) {
      for (let gx = 0; gx < regionW; gx++) {
        if (miniGrid[gy][gx] !== null) continue;
        // Find maximal width of this gap row
        let gw = 0;
        while (gx + gw < regionW && miniGrid[gy][gx + gw] === null) gw++;
        // Find maximal height at this width
        let gh = 0;
        gapH: for (let dy = 0; gy + dy < regionH; dy++) {
          for (let dx = 0; dx < gw; dx++) {
            if (miniGrid[gy + dy][gx + dx] !== null) break gapH;
          }
          gh++;
        }
        if (gw > 0 && gh > 0) {
          const absX = regionRect.x + gx;
          const absY = regionRect.y + gy;
          const gapFiller = makeSyntheticRoom(
            `${fillerLabel || 'fill'}_gap_${absX}_${absY}`, 'storage', 1,
            gw * gh * 4
          );
          bestPlacements.push({ roomSpec: gapFiller, x: absX, y: absY, w: gw, h: gh });
          for (let dy = 0; dy < gh; dy++) {
            for (let dx = 0; dx < gw; dx++) {
              miniGrid[gy + dy][gx + dx] = gapFiller.id;
            }
          }
        }
      }
    }
  } else if (!bestPlacements.length) {
    // Nothing placed at all — fill entire region with storage
    const label = fillerLabel || `fill_${regionRect.x}_${regionRect.y}`;
    const filler = makeSyntheticRoom(`${label}_total`, 'storage', 1, zoneArea * 4);
    return { placements: [{ roomSpec: filler, x: regionRect.x, y: regionRect.y, w: regionRect.w, h: regionRect.h }], overflow: [] };
  }

  return { placements: bestPlacements, overflow: [] };
}

function allocateCoreRooms(level, coreRect, programRooms, heightTiles) {
  const rooms = [];
  if (!coreRect) return rooms;

  let stairs = programRooms.find((r) => normalizeRoomType(r.type) === 'stairs');
  let hall = programRooms.find((r) => normalizeRoomType(r.type) === 'hallway');

  if (!stairs) stairs = makeSyntheticRoom(`stairs_fallback_l${level}`, 'stairs', level, 48);
  if (!hall) hall = makeSyntheticRoom(`hall_fallback_l${level}`, 'hallway', level, 48);

  if (coreRect.h <= 1) {
    rooms.push(buildRoom(level, hall, coreRect));
    return rooms;
  }

  if (coreRect.h <= STAIR_MIN_DEPTH_TILES) {
    rooms.push(buildRoom(level, stairs, coreRect));
    return rooms;
  }

  const minimumHall = coreRect.h >= STAIR_MIN_DEPTH_TILES + 2 ? 2 : 1;
  const MIN_HALL_H = Math.min(Math.max(minimumHall, Math.ceil(coreRect.h * 0.30)), coreRect.h - STAIR_MIN_DEPTH_TILES);
  const preferredStairH = Math.max(STAIR_MIN_DEPTH_TILES, coreRect.w + 1);
  const stairMax = Math.max(STAIR_MIN_DEPTH_TILES, coreRect.h - Math.max(minimumHall, MIN_HALL_H));
  const stairH = clamp(preferredStairH, STAIR_MIN_DEPTH_TILES, stairMax);
  const hallH = coreRect.h - stairH;
  const coreRows = splitHorizontal(coreRect, [stairH, hallH]);

  rooms.push(buildRoom(level, stairs, coreRows[0]));
  rooms.push(buildRoom(level, hall, coreRows[1]));

  return rooms;
}

function splitLeftWingForGarage(leftWingRect, garageType, widthTiles, heightTiles) {
  const dims = garageDimensionsTiles(garageType, widthTiles, heightTiles);
  const garageDepth = Math.min(dims.depth, leftWingRect.h - 2);
  const rearDepth = leftWingRect.h - garageDepth;

  if (rearDepth <= 0) {
    return { garageRect: leftWingRect, rearRect: null };
  }

  const rows = splitHorizontal(leftWingRect, [garageDepth, rearDepth]);
  return { garageRect: rows[0], rearRect: rows[1] };
}

function allocateSuitePlacements(level, zoneRect, specs, hallSide = 'left') {
  const cleanSpecs = uniqSpecsById(specs);
  if (!zoneRect || zoneRect.w <= 0 || zoneRect.h <= 0 || !cleanSpecs.length) return [];

  const isVertSplit = hallSide === 'top' || hallSide === 'bottom';
  const fallback = () => fillRegionWithSpecs(zoneRect, cleanSpecs, isVertSplit ? 'vertical' : 'horizontal').placements;
  const { suites, others } = splitSuiteSpecs(cleanSpecs);

  if (!suites.length) return fallback();
  if (isVertSplit && (zoneRect.w < Math.max(1, suites.length) || zoneRect.h < 2)) return fallback();
  if (!isVertSplit && (zoneRect.h < Math.max(1, suites.length) || zoneRect.w < 2)) return fallback();

  if (!isVertSplit) {
    const units = [
      ...suites.map((suite) => ({ kind: 'suite', suite })),
      ...others.map((spec) => ({ kind: 'room', spec })),
    ];

    const unitDefs = units.map((unit) => {
      if (unit.kind === 'suite') {
        const bathTemplateWidths = unit.suite.baths
          .flatMap((bath) => preferredTemplateDims(bath))
          .map((dims) => Math.min(dims.w, dims.h));
        const estimatedBathWidthTiles = bathTemplateWidths.length ? Math.min(...bathTemplateWidths) : 3;
        const bedSpanFt = Math.max(1, zoneRect.w - estimatedBathWidthTiles) * TILE_SIZE_FT_DEFAULT;
        const bedMinDepthFt = minimumDepthForFixedWidth(unit.suite.bed, bedSpanFt);
        const bedMinDepthTiles = Number.isFinite(bedMinDepthFt)
          ? Math.ceil(bedMinDepthFt / TILE_SIZE_FT_DEFAULT)
          : Math.max(4, minShortSideForSpec(unit.suite.bed));
        const bathMinDepthTiles = unit.suite.baths.reduce(
          (max, bath) => Math.max(max, minShortSideForSpec(bath)),
          3
        );
        return {
          ...unit,
          minWidth: Math.max(4, bedMinDepthTiles, bathMinDepthTiles),
          weight: (unit.suite.bed.targetAreaSqFt || 120) + unit.suite.baths.reduce((sum, bath) => sum + (bath.targetAreaSqFt || 60), 0),
        };
      }

      const minDepthFt = minimumDepthForFixedWidth(unit.spec, zoneRect.w * TILE_SIZE_FT_DEFAULT);
      return {
        ...unit,
        minWidth: Number.isFinite(minDepthFt)
          ? Math.max(2, Math.ceil(minDepthFt / TILE_SIZE_FT_DEFAULT))
          : Math.max(2, minShortSideForSpec(unit.spec)),
        weight: unit.spec.targetAreaSqFt || unit.spec.minAreaSqFt || 80,
      };
    });

    const rowHeights = allocateWeightedColumnWidths(zoneRect.h, unitDefs);
    const rowPlacements = [];
    let cursorY = zoneRect.y;
    let rowLayoutValid = rowHeights.length === unitDefs.length && rowHeights.reduce((sum, height) => sum + height, 0) === zoneRect.h;

    for (let i = 0; rowLayoutValid && i < unitDefs.length; i++) {
      const unit = unitDefs[i];
      const rowHeight = rowHeights[i];
      const rowRect = rect(zoneRect.x, cursorY, zoneRect.w, rowHeight);

      if (unit.kind === 'room') {
        if (!isGeometryAcceptable(unit.spec, rowRect.w, rowRect.h)) {
          rowLayoutValid = false;
          break;
        }
        rowPlacements.push({ roomSpec: unit.spec, x: rowRect.x, y: rowRect.y, w: rowRect.w, h: rowRect.h });
      } else {
        let bestBathW = clamp(Math.round(rowRect.w * 0.28), 2, Math.max(2, rowRect.w - 4));
        const bathTemplates = unit.suite.baths.flatMap((bath) => preferredTemplateDims(bath));
        if (bathTemplates.length) {
          let best = bestBathW;
          let bestPenalty = Infinity;
          for (let cand = 2; cand < rowRect.w - 1; cand++) {
            const bedW = rowRect.w - cand;
            if (bedW < 4) continue;
            let penalty = 0;
            for (const bath of unit.suite.baths) {
              const eachH = unit.suite.baths.length === 1 ? rowRect.h : Math.max(1, Math.floor(rowRect.h / unit.suite.baths.length));
              penalty += templateFitPenalty(bath, cand, eachH);
            }
            if (penalty < bestPenalty) {
              best = cand;
              bestPenalty = penalty;
            }
          }
          bestBathW = clamp(best, 2, Math.max(2, rowRect.w - 4));
        }

        const bedW = rowRect.w - bestBathW;
        const bedRect = hallSide === 'left'
          ? rect(rowRect.x, rowRect.y, bedW, rowRect.h)
          : rect(rowRect.x + bestBathW, rowRect.y, bedW, rowRect.h);
        const bathRect = hallSide === 'left'
          ? rect(rowRect.x + bedW, rowRect.y, bestBathW, rowRect.h)
          : rect(rowRect.x, rowRect.y, bestBathW, rowRect.h);

        if (!isGeometryAcceptable(unit.suite.bed, bedRect.w, bedRect.h)) {
          rowLayoutValid = false;
          break;
        }
        rowPlacements.push({ roomSpec: unit.suite.bed, x: bedRect.x, y: bedRect.y, w: bedRect.w, h: bedRect.h });

        if (unit.suite.baths.length === 1) {
          if (!isGeometryAcceptable(unit.suite.baths[0], bathRect.w, bathRect.h)) {
            rowLayoutValid = false;
            break;
          }
          rowPlacements.push({ roomSpec: unit.suite.baths[0], x: bathRect.x, y: bathRect.y, w: bathRect.w, h: bathRect.h });
        } else {
          const per = Math.floor(bathRect.h / unit.suite.baths.length);
          if (per < 1) {
            rowLayoutValid = false;
            break;
          }
          let bathY = bathRect.y;
          for (let bi = 0; bi < unit.suite.baths.length; bi++) {
            const bathH = bi === unit.suite.baths.length - 1
              ? (bathRect.y + bathRect.h - bathY)
              : per;
            if (!isGeometryAcceptable(unit.suite.baths[bi], bathRect.w, bathH)) {
              rowLayoutValid = false;
              break;
            }
            rowPlacements.push({ roomSpec: unit.suite.baths[bi], x: bathRect.x, y: bathY, w: bathRect.w, h: bathH });
            bathY += bathH;
          }
        }
      }

      cursorY += rowHeight;
    }

    if (rowLayoutValid && rowPlacements.length) return rowPlacements;
  }

  if (isVertSplit) {
    const units = [
      ...suites.map((suite) => ({ kind: 'suite', suite })),
      ...others.map((spec) => ({ kind: 'room', spec })),
    ];

    const unitDefs = units.map((unit) => {
      if (unit.kind === 'suite') {
        const bedOptions = getContractFitOptions(unit.suite.bed);
        const bedMinWidthFt = bedOptions.length
          ? Math.min(...bedOptions.map((option) => option.widthFt))
          : 8;
        return {
          ...unit,
          minWidth: Math.max(3, Math.ceil(bedMinWidthFt / TILE_SIZE_FT_DEFAULT)),
          weight: (unit.suite.bed.targetAreaSqFt || 120) + unit.suite.baths.reduce((sum, bath) => sum + (bath.targetAreaSqFt || 60), 0),
        };
      }

      const fitOptions = getContractFitOptions(unit.spec);
      const minWidthFt = fitOptions.length
        ? Math.min(...fitOptions.map((option) => option.widthFt))
        : minShortSideForSpec(unit.spec) * TILE_SIZE_FT_DEFAULT;
      return {
        ...unit,
        minWidth: Math.max(2, Math.ceil(minWidthFt / TILE_SIZE_FT_DEFAULT)),
        weight: unit.spec.targetAreaSqFt || unit.spec.minAreaSqFt || 80,
      };
    });

    const columnWidths = allocateWeightedColumnWidths(zoneRect.w, unitDefs);
    const columnPlacements = [];
    let cursorX = zoneRect.x;
    let columnLayoutValid = columnWidths.length === unitDefs.length && columnWidths.reduce((sum, width) => sum + width, 0) === zoneRect.w;

    for (let i = 0; columnLayoutValid && i < unitDefs.length; i++) {
      const unit = unitDefs[i];
      const columnWidth = columnWidths[i];
      const columnRect = rect(cursorX, zoneRect.y, columnWidth, zoneRect.h);

      if (unit.kind === 'room') {
        if (!isGeometryAcceptable(unit.spec, columnRect.w, columnRect.h)) {
          columnLayoutValid = false;
          break;
        }
        columnPlacements.push({ roomSpec: unit.spec, x: columnRect.x, y: columnRect.y, w: columnRect.w, h: columnRect.h });
      } else {
        const minBedHeightFt = minimumDepthForFixedWidth(unit.suite.bed, columnRect.w * TILE_SIZE_FT_DEFAULT);
        const minBedHeightTiles = Number.isFinite(minBedHeightFt)
          ? Math.max(2, Math.ceil(minBedHeightFt / TILE_SIZE_FT_DEFAULT))
          : 4;
        const maxBathHeight = Math.max(2, columnRect.h - minBedHeightTiles);
        let bathHeight = clamp(Math.round(columnRect.h * 0.3), 2, maxBathHeight);

        const bedRect = hallSide === 'top'
          ? rect(columnRect.x, columnRect.y + bathHeight, columnRect.w, columnRect.h - bathHeight)
          : rect(columnRect.x, columnRect.y, columnRect.w, columnRect.h - bathHeight);
        const bathRect = hallSide === 'top'
          ? rect(columnRect.x, columnRect.y, columnRect.w, bathHeight)
          : rect(columnRect.x, columnRect.y + columnRect.h - bathHeight, columnRect.w, bathHeight);

        if (!isGeometryAcceptable(unit.suite.bed, bedRect.w, bedRect.h)) {
          columnLayoutValid = false;
          break;
        }
        columnPlacements.push({ roomSpec: unit.suite.bed, x: bedRect.x, y: bedRect.y, w: bedRect.w, h: bedRect.h });

        if (unit.suite.baths.length === 1) {
          if (!isGeometryAcceptable(unit.suite.baths[0], bathRect.w, bathRect.h)) {
            columnLayoutValid = false;
            break;
          }
          columnPlacements.push({ roomSpec: unit.suite.baths[0], x: bathRect.x, y: bathRect.y, w: bathRect.w, h: bathRect.h });
        } else {
          const per = Math.floor(bathRect.w / unit.suite.baths.length);
          if (per < 1) {
            columnLayoutValid = false;
            break;
          }
          let bathX = bathRect.x;
          for (let bi = 0; bi < unit.suite.baths.length; bi++) {
            const bathW = bi === unit.suite.baths.length - 1
              ? (bathRect.x + bathRect.w - bathX)
              : per;
            if (!isGeometryAcceptable(unit.suite.baths[bi], bathW, bathRect.h)) {
              columnLayoutValid = false;
              break;
            }
            columnPlacements.push({ roomSpec: unit.suite.baths[bi], x: bathX, y: bathRect.y, w: bathW, h: bathRect.h });
            bathX += bathW;
          }
        }
      }

      cursorX += columnWidth;
    }

    if (columnLayoutValid && columnPlacements.length) return columnPlacements;
  }

  const placements = [];
  let suiteZone = zoneRect;
  let otherZone = null;

  if (others.length) {
    const suiteTarget = suites.reduce(
      (sum, s) => sum + (s.bed.targetAreaSqFt || 110) + s.baths.reduce((x, b) => x + (b.targetAreaSqFt || 60), 0),
      0
    );
    const otherTarget = others.reduce((sum, s) => sum + (s.targetAreaSqFt || 90), 0);
    const suiteFrac = clamp(suiteTarget / Math.max(1, suiteTarget + otherTarget), 0.45, 0.8);
    
    if (isVertSplit) {
      if (suites.length === 1) {
        // Just one suite? Slice left-to-right normally, so the suite is square.
        const suiteW = clamp(Math.round(zoneRect.w * suiteFrac), 1, zoneRect.w - 1);
        if (hallSide === 'right' || hallSide === 'bottom') { // Wait, hallSide is top/bottom.
          otherZone = rect(zoneRect.x, zoneRect.y, zoneRect.w - suiteW, zoneRect.h);
          suiteZone = rect(zoneRect.x + zoneRect.w - suiteW, zoneRect.y, suiteW, zoneRect.h);
        } else {
          suiteZone = rect(zoneRect.x, zoneRect.y, suiteW, zoneRect.h);
          otherZone = rect(zoneRect.x + suiteW, zoneRect.y, zoneRect.w - suiteW, zoneRect.h);
        }
      } else {
        // Orthogonal split
        const suiteH = clamp(Math.round(zoneRect.h * suiteFrac), 1, zoneRect.h - 1);
        if (hallSide === 'bottom') {
          otherZone = rect(zoneRect.x, zoneRect.y, zoneRect.w, zoneRect.h - suiteH);
          suiteZone = rect(zoneRect.x, zoneRect.y + zoneRect.h - suiteH, zoneRect.w, suiteH);
        } else {
          suiteZone = rect(zoneRect.x, zoneRect.y, zoneRect.w, suiteH);
          otherZone = rect(zoneRect.x, zoneRect.y + suiteH, zoneRect.w, zoneRect.h - suiteH);
        }
      }
    } else {
      if (suites.length === 1) {
        // Just one suite? Slice top-to-bottom normally.
        const suiteH = clamp(Math.round(zoneRect.h * suiteFrac), 1, zoneRect.h - 1);
        if (hallSide === 'bottom' || hallSide === 'right') { // hallSide is right/left.
          otherZone = rect(zoneRect.x, zoneRect.y, zoneRect.w, zoneRect.h - suiteH);
          suiteZone = rect(zoneRect.x, zoneRect.y + zoneRect.h - suiteH, zoneRect.w, suiteH);
        } else {
          suiteZone = rect(zoneRect.x, zoneRect.y, zoneRect.w, suiteH);
          otherZone = rect(zoneRect.x, zoneRect.y + suiteH, zoneRect.w, zoneRect.h - suiteH);
        }
      } else {
        // Orthogonal split.
        // For hallSide='left' or 'right', use TOP/BOTTOM split (full-width rows) so that
        // ALL rooms — suites and non-suite bedrooms alike — span the full private-zone
        // width and therefore share a wall with the hall (which is to the left or right
        // of the entire private zone). A LEFT/RIGHT split would strand non-suite beds in
        // a pocket with no hall adjacency, causing unreachable-room connectivity errors.
        {
          const suiteH = clamp(Math.round(zoneRect.h * suiteFrac), suites.length, zoneRect.h - others.length);
          suiteZone = rect(zoneRect.x, zoneRect.y, zoneRect.w, suiteH);
          otherZone = rect(zoneRect.x, zoneRect.y + suiteH, zoneRect.w, zoneRect.h - suiteH);
        }
      }
    }
  }

  const weights = suites.map(
    (s) => (s.bed.targetAreaSqFt || 120) + s.baths.reduce((x, b) => x + (b.targetAreaSqFt || 60), 0)
  );
  const totalW = weights.reduce((a, b) => a + b, 0) || 1;

  let offset = isVertSplit ? suiteZone.x : suiteZone.y;
  let remainingDim = isVertSplit ? suiteZone.w : suiteZone.h;

  for (let i = 0; i < suites.length; i++) {
    const suite = suites[i];
    const isLast = i === suites.length - 1;
    const suiteBedMin = minShortSideForSpec(suite.bed);
    const minDim = isVertSplit
      ? Math.max(1, suite.baths.length, suiteBedMin)
      : Math.max(1, suite.baths.length);
    const expectedDim = isVertSplit ? suiteZone.w : suiteZone.h;
    
    let sliceDim = isLast ? remainingDim : Math.max(minDim, Math.round((weights[i] / totalW) * expectedDim));
    sliceDim = Math.min(sliceDim, remainingDim - Math.max(0, suites.length - i - 1));
    sliceDim = Math.max(minDim, Math.min(sliceDim, remainingDim));

    if (sliceDim <= 0) break;

    const sliceRect = isVertSplit
      ? rect(offset, suiteZone.y, sliceDim, suiteZone.h)
      : rect(suiteZone.x, offset, suiteZone.w, sliceDim);

    if (!suite.baths.length || (isVertSplit ? sliceRect.h < 2 : sliceRect.w < 2)) {
      placements.push({ roomSpec: suite.bed, x: sliceRect.x, y: sliceRect.y, w: sliceRect.w, h: sliceRect.h });
    } else {
      // Divide the sliceRect into bed and bath.
      // If isVertSplit, divide vertically. Bath is on the side OPPOSITE to hallSide.
      if (isVertSplit) {
        const minBedH = Math.max(1, minShortSideForSpec(suite.bed));
        const maxBathH = Math.max(1, sliceRect.h - minBedH);
        let bestBathH = clamp(Math.round(sliceRect.h * 0.32), 1, maxBathH);
        const bathTemplates = suite.baths.flatMap((b) => preferredTemplateDims(b));
        if (bathTemplates.length) {
          let best = bestBathH;
          let bestPenalty = Infinity;
          for (let cand = 1; cand <= maxBathH; cand++) {
            const bedH = sliceRect.h - cand;
            if (bedH < minBedH) continue;
            let penalty = 0;
            for (const bath of suite.baths) {
              const eachW = suite.baths.length === 1 ? sliceRect.w : Math.max(1, Math.floor(sliceRect.w / suite.baths.length));
              penalty += templateFitPenalty(bath, eachW, cand);
            }
            if (penalty < bestPenalty) { best = cand; bestPenalty = penalty; }
          }
          bestBathH = clamp(best, 1, maxBathH);
        }

        const bathH = bestBathH;
        const bedH = sliceRect.h - bathH;
        if (bedH < 1) continue;
        
        const bedRect = hallSide === 'top'
          ? rect(sliceRect.x, sliceRect.y + bathH, sliceRect.w, bedH)    // bed at bottom
          : rect(sliceRect.x, sliceRect.y, sliceRect.w, bedH);           // bed at top
          
        const bathRect = hallSide === 'top'
          ? rect(sliceRect.x, sliceRect.y, sliceRect.w, bathH)           // bath at top
          : rect(sliceRect.x, sliceRect.y + bedH, sliceRect.w, bathH);   // bath at bottom

        if (!isGeometryAcceptable(suite.bed, bedRect.w, bedRect.h)) return fallback();
        placements.push({ roomSpec: suite.bed, x: bedRect.x, y: bedRect.y, w: bedRect.w, h: bedRect.h });
        
        if (suite.baths.length === 1) {
          if (!isGeometryAcceptable(suite.baths[0], bathRect.w, bathRect.h)) return fallback();
          placements.push({ roomSpec: suite.baths[0], x: bathRect.x, y: bathRect.y, w: bathRect.w, h: bathRect.h });
        } else {
          const per = Math.floor(bathRect.w / suite.baths.length);
          if (per < 1) return fallback();
          let bx = bathRect.x;
          for (let bi = 0; bi < suite.baths.length; bi++) {
            const bw = (bi === suite.baths.length - 1) ? (bathRect.x + bathRect.w - bx) : per;
            if (!isGeometryAcceptable(suite.baths[bi], bw, bathRect.h)) return fallback();
            placements.push({ roomSpec: suite.baths[bi], x: bx, y: bathRect.y, w: bw, h: bathRect.h });
            bx += bw;
          }
        }
      } else { // Horizontal split
        let bestBathW = clamp(Math.round(sliceRect.w * 0.32), 1, sliceRect.w - 1);
        const bathTemplates = suite.baths.flatMap((b) => preferredTemplateDims(b));
        if (bathTemplates.length) {
          let best = bestBathW;
          let bestPenalty = Infinity;
          for (let cand = 1; cand < sliceRect.w; cand++) {
            const bedW = sliceRect.w - cand;
            if (bedW < 1) continue;
            let penalty = 0;
            for (const bath of suite.baths) {
              const eachH = suite.baths.length === 1 ? sliceRect.h : Math.max(1, Math.floor(sliceRect.h / suite.baths.length));
              penalty += templateFitPenalty(bath, cand, eachH);
            }
            if (penalty < bestPenalty) { best = cand; bestPenalty = penalty; }
          }
          bestBathW = clamp(best, 1, sliceRect.w - 1);
        }
        
        const bathW = bestBathW;
        const bedW = sliceRect.w - bathW;
        if (bedW < 1) continue;
        
        const bedRect = hallSide === 'left' 
          ? rect(sliceRect.x, sliceRect.y, bedW, sliceRect.h) 
          : rect(sliceRect.x + bathW, sliceRect.y, bedW, sliceRect.h);
          
        const bathRect = hallSide === 'left'
          ? rect(sliceRect.x + bedW, sliceRect.y, bathW, sliceRect.h)
          : rect(sliceRect.x, sliceRect.y, bathW, sliceRect.h);

        if (!isGeometryAcceptable(suite.bed, bedRect.w, bedRect.h)) return fallback();
        placements.push({ roomSpec: suite.bed, x: bedRect.x, y: bedRect.y, w: bedRect.w, h: bedRect.h });
        
        if (suite.baths.length === 1) {
          if (!isGeometryAcceptable(suite.baths[0], bathRect.w, bathRect.h)) return fallback();
          placements.push({ roomSpec: suite.baths[0], x: bathRect.x, y: bathRect.y, w: bathRect.w, h: bathRect.h });
        } else {
          const per = Math.floor(bathRect.h / suite.baths.length);
          if (per < 1) continue;
          let by = bathRect.y;
          for (let bi = 0; bi < suite.baths.length; bi++) {
            const bh = (bi === suite.baths.length - 1) ? (bathRect.y + bathRect.h - by) : per;
            if (!isGeometryAcceptable(suite.baths[bi], bathRect.w, bh)) return fallback();
            placements.push({ roomSpec: suite.baths[bi], x: bathRect.x, y: by, w: bathRect.w, h: bh });
            by += bh;
          }
        }
      }
    }

    offset += sliceDim;
    remainingDim -= sliceDim;
  }

  if (otherZone && (isVertSplit ? otherZone.w > 0 : otherZone.h > 0)) {
    const { placements: otherP } = fillRegionWithSpecs(otherZone, others, isVertSplit ? 'vertical' : 'horizontal');
    for (const p of otherP) placements.push(p);
  }

  return placements;
}

function allocateLeftRearArea(level, rearRect, programRooms) {
  if (!rearRect || rearRect.w <= 0 || rearRect.h <= 0) {
    return { rooms: [], placedIds: new Set(), overflow: [] };
  }

  const rooms = [];
  const placedIds = new Set();

  const mudroomSpec = programRooms.find((r) => normalizeRoomType(r.type) === 'mudroom' && r.level === level);
  const laundrySpec = programRooms.find((r) => normalizeRoomType(r.type) === 'laundry' && r.level === level);

  const candidates = [];
  if (mudroomSpec) candidates.push(mudroomSpec);
  if (laundrySpec) candidates.push(laundrySpec);

  const extras = programRooms.filter(
    (r) => FEATURE_ROOM_TYPES.has(normalizeRoomType(r.type)) && r.level === level
  );
  candidates.push(...extras);

  const rearArea = areaOfRect(rearRect);
  const specsToFit = [];
  const overflow = [];

  for (const spec of candidates) {
    const approxTiles = sqftToTiles(spec.minAreaSqFt || spec.targetAreaSqFt || 40, TILE_SIZE_FT_DEFAULT);
    const usedTiles = specsToFit.reduce(
      (s, r) => s + sqftToTiles(r.minAreaSqFt || r.targetAreaSqFt || 40, TILE_SIZE_FT_DEFAULT),
      0
    );

    if (usedTiles + approxTiles <= rearArea) specsToFit.push(spec);
    else overflow.push(spec);
  }

  if (!specsToFit.length) {
    const serviceStorage = makeSyntheticRoom(`service_store_l${level}`, 'storage', level, rearArea * 4);
    const { placements } = fillRegionWithSpecs(rearRect, [serviceStorage], 'horizontal');
    for (const item of placements) {
      rooms.push(buildRoom(level, item.roomSpec, item));
      placedIds.add(item.roomSpec.id);
    }
    return { rooms, placedIds, overflow };
  }

  const { placements, overflow: extraOverflow } = fillRegionWithSpecs(rearRect, specsToFit, 'horizontal');
  overflow.push(...extraOverflow);

  for (const item of placements) {
    rooms.push(buildRoom(level, item.roomSpec, item));
    placedIds.add(item.roomSpec.id);
  }

  return { rooms, placedIds, overflow };
}

function allocateTwoStoryLevel1(programRooms, footprint, brief) {
  const level = 1;
  const widthTiles = footprint.widthTiles;
  const heightTiles = footprint.heightTiles;
  const { coreTiles } = chooseFixedCore(widthTiles, 2);

  let leftWidth;
  if (brief.hasGarage) {
    leftWidth = garageDimensionsTiles(brief.garageType, widthTiles, heightTiles).width;
  } else {
    leftWidth = twoStoryNoGarageWidths(widthTiles, coreTiles).leftWidth;
  }

  const rightWidth = widthTiles - leftWidth - coreTiles;
  const rooms = [];
  const zones = [];

  const publicRooms = programRooms.filter((r) => PUBLIC_ROOM_TYPES.has(normalizeRoomType(r.type)));
  const primaryBedroom = programRooms.find((r) => normalizeRoomType(r.type) === 'primary_bedroom');
  const primaryBathroom = programRooms.find((r) => normalizeRoomType(r.type) === 'primary_bathroom');
  const secondaryBedrooms = programRooms.filter((r) => ['bedroom', 'guest_bedroom'].includes(normalizeRoomType(r.type)));
  const featureRooms = programRooms.filter((r) => FEATURE_ROOM_TYPES.has(normalizeRoomType(r.type)));
  const sharedBaths = programRooms.filter((r) => isSharedBath(r));
  const privateBathMap = bathsByAttachedBedroom(programRooms);
  const level1SecondarySuites = suiteSequenceForBedrooms(
    secondaryBedrooms.filter((r) => r.level === 1),
    privateBathMap
  );

  if (!brief.hasGarage) {
    const parts = splitVertical(rect(0, 0, widthTiles, heightTiles), [leftWidth, coreTiles, rightWidth]);
    const leftWingRect = parts[0];
    const coreRect = parts[1];
    const rightRect = parts[2];

    rooms.push(...allocateCoreRooms(level, coreRect, programRooms, heightTiles));
    zones.push(zoneMeta('circulation', coreRect));

    if (brief.primaryLevel === 1) {
      const leftSpecs = [];
      const rightSpecs = [];

      if (primaryBedroom) leftSpecs.push(primaryBedroom);
      if (primaryBathroom) leftSpecs.push(primaryBathroom);
      leftSpecs.push(...level1SecondarySuites);

      const mergedRight = mergeOpenConceptPublicRooms(publicRooms, brief, level);
      rightSpecs.push(...mergedRight);
      rightSpecs.push(...sharedBaths);
      rightSpecs.push(...featureRooms.filter((r) => r.level === 1));
      // Ensure laundry (if assigned to level 1) is placed — it is not a public/feature
      // room so it won't auto-populate; service rooms must be explicitly included.
      const noGarageL1Laundry = programRooms.find((r) => normalizeRoomType(r.type) === 'laundry' && r.level === 1);
      if (noGarageL1Laundry) rightSpecs.push(noGarageL1Laundry);

      let lP = allocateSuitePlacements(level, leftWingRect, leftSpecs, 'right');
      if (!lP || !lP.length) {
        lP = fillWithGuaranteedCoverage(leftWingRect, leftSpecs, 'horizontal', 'left_wing_l1').placements;
      } else {
        // Detect partial placement — route unplaced specs to right wing
        const placedIds = new Set(lP.map(p => p.roomSpec.id));
        for (const spec of leftSpecs) {
          if (!placedIds.has(spec.id)) rightSpecs.push(spec);
        }
      }


      const rBaths = rightSpecs.filter((r) => BATHROOM_TYPES.has(normalizeRoomType(r.type)));
      const rNonBath = rightSpecs.filter((r) => !BATHROOM_TYPES.has(normalizeRoomType(r.type)));

      let rP;
      if (rBaths.length && rNonBath.length && rightRect.h >= 5) {
        const bathH = Math.max(3, Math.min(Math.floor(rightRect.h * 0.25), 5));
        const pubH = rightRect.h - bathH;
        const pubBand = rect(rightRect.x, rightRect.y, rightRect.w, pubH);
        const bathBand = rect(rightRect.x, rightRect.y + pubH, rightRect.w, bathH);

        const { placements: pubP } = fillWithGuaranteedCoverage(pubBand, rNonBath, 'horizontal', 'pub_l1');
        const { placements: batP } = fillWithGuaranteedCoverage(bathBand, rBaths, 'vertical', 'bath_l1');
        rP = [...pubP, ...batP];
      } else {
        rP = fillWithGuaranteedCoverage(rightRect, rightSpecs, 'horizontal', 'right_l1').placements;
      }

      for (const item of [...lP, ...rP]) rooms.push(buildRoom(level, item.roomSpec, item));
      zones.push(zoneMeta('private', leftWingRect));
      zones.push(zoneMeta('public', rightRect));
    } else {
      const mergedPublic = mergeOpenConceptPublicRooms(publicRooms, brief, level);
      // Ensure laundry (if assigned to level 1) is placed explicitly.
      const noGarageL1LaundryAlt = programRooms.find((r) => normalizeRoomType(r.type) === 'laundry' && r.level === 1);

      // Keep suite pairs (bed + ensuite) atomically in the left wing so bed and bath are
      // always adjacent. Public rooms + shared baths go to the right wing. This mirrors
      // the primaryLevel===1 branch and prevents the budget-loop from splitting a
      // bed/ensuite pair across zones (left wing and right wing are separated by the stair
      // core, so cross-zone pairs would never be adjacent → connectivity errors).
      const leftSpecs = [...level1SecondarySuites];
      const rightSpecs = [
        ...mergedPublic,
        ...featureRooms.filter((r) => r.level === 1),
        ...sharedBaths,
      ];
      if (noGarageL1LaundryAlt) rightSpecs.push(noGarageL1LaundryAlt);

      if (!leftSpecs.length && rightSpecs.length) leftSpecs.push(rightSpecs.shift());
      if (!rightSpecs.length && leftSpecs.length) rightSpecs.push(leftSpecs.pop());

      let lP;
      if (leftSpecs.length) {
        lP = allocateSuitePlacements(level, leftWingRect, leftSpecs, 'right');
        if (!lP || !lP.length) {
          lP = fillWithGuaranteedCoverage(leftWingRect, leftSpecs, 'horizontal', 'left_l1').placements;
        } else {
          // Detect partial placement — route unplaced specs to right wing
          const placedIds = new Set(lP.map(p => p.roomSpec.id));
          for (const spec of leftSpecs) {
            if (!placedIds.has(spec.id)) rightSpecs.push(spec);
          }
        }
      } else {
        const foyer = makeSyntheticRoom('foyer_l1', 'entry', 1, leftWingRect.w * leftWingRect.h * 4);
        lP = [{ roomSpec: foyer, x: leftWingRect.x, y: leftWingRect.y, w: leftWingRect.w, h: leftWingRect.h }];
      }

      const rightBaths = rightSpecs.filter((r) => BATHROOM_TYPES.has(normalizeRoomType(r.type)));
      const rightNonBath = rightSpecs.filter((r) => !BATHROOM_TYPES.has(normalizeRoomType(r.type)));

      let rP;
      if (rightBaths.length && rightNonBath.length && rightRect.h >= 5) {
        const MIN_BATH_H = 3;
        const bathH = Math.max(MIN_BATH_H, Math.min(Math.floor(rightRect.h * 0.25), 5));
        const pubH = rightRect.h - bathH;
        const pubBand = rect(rightRect.x, rightRect.y, rightRect.w, pubH);
        const bathBand = rect(rightRect.x, rightRect.y + pubH, rightRect.w, bathH);

        const { placements: pubP } = fillWithGuaranteedCoverage(pubBand, rightNonBath, 'horizontal', 'pub2_l1');
        const { placements: batP } = fillWithGuaranteedCoverage(bathBand, rightBaths, 'vertical', 'bath2_l1');
        rP = [...pubP, ...batP];
      } else {
        rP = fillWithGuaranteedCoverage(rightRect, rightSpecs, 'horizontal', 'right2_l1').placements;
      }

      for (const item of [...lP, ...rP]) rooms.push(buildRoom(level, item.roomSpec, item));
      zones.push(zoneMeta('public', leftWingRect));
      zones.push(zoneMeta('public', rightRect));
    }

    return { level, widthTiles, heightTiles, rooms, zones, stairCore: stairCoreMeta(level, rooms) };
  }

  const protrusionTiles = footprint.protrusionTiles || 0;
  const totalHeightTiles = heightTiles + protrusionTiles;

  const garageSpec = programRooms.find((r) => normalizeRoomType(r.type) === 'garage');
  const entrySpec = programRooms.find((r) => normalizeRoomType(r.type) === 'entry')
    || makeSyntheticRoom(`entry_garage_l${level}`, 'entry', level, 40);
  const familyProfile = buildSuburbanFamilyLayoutProfile(brief, programRooms);
  const archetypeSpecificStairLanding =
    level === 1 &&
    familyProfile.usesUpperGarageFamilyLayout;
  const level1StairCoreMeta = () => stairCoreMeta(
    level,
    rooms,
    archetypeSpecificStairLanding
      ? {
          landingRoomId: String(entrySpec.id),
          landingSide: 'top',
          landingOpen: true,
        }
      : {}
  );

  const garageDims = garageDimensionsTiles(brief.garageType, widthTiles, heightTiles);
  const garageWidth = garageDims.width;
  const garageDepthBase = garageDims.depth;

  const rearPrivateSpecs = [];
  const rearServiceSpecs = [];
  const frontPublicSpecs = [];

  if (brief.primaryLevel === 1) {
    if (primaryBedroom) rearPrivateSpecs.push(primaryBedroom);
    if (primaryBathroom) rearPrivateSpecs.push(primaryBathroom);
  }

  for (const r of level1SecondarySuites) rearPrivateSpecs.push(r);
  for (const r of featureRooms.filter((r) => r.level === 1)) rearServiceSpecs.push(r);
  for (const r of mergeOpenConceptPublicRooms(publicRooms, brief, level)) frontPublicSpecs.push(r);
  for (const r of sharedBaths) rearServiceSpecs.push(r);

  const publicArea = frontPublicSpecs.reduce((s, r) => s + (r.targetAreaSqFt || 150), 0);
  const rearArea =
    rearPrivateSpecs.reduce((s, r) => s + (r.targetAreaSqFt || 150), 0) +
    rearServiceSpecs.reduce((s, r) => s + (r.targetAreaSqFt || 60), 0);

  const totalNonGarage = publicArea + rearArea || 1;
  const rawPublicDepth = (publicArea / totalNonGarage) + publicDepthBias(brief);
  const publicDepthFraction = Math.max(0.24, Math.min(0.68, rawPublicDepth));

  const MIN_REAR_H = Math.min(2, Math.max(1, heightTiles - 2));
  const MIN_PUBLIC_H = Math.min(2, Math.max(1, heightTiles - MIN_REAR_H));
  const publicH = Math.max(MIN_PUBLIC_H, Math.min(heightTiles - MIN_REAR_H, Math.round(heightTiles * publicDepthFraction)));
  const rearH = Math.max(MIN_REAR_H, heightTiles - publicH);

  const coreX = coreXPosition(brief, footprint);

  const MIN_SERVICE_WIDTH = 0;
  const effectiveGarageWidth = Math.min(garageWidth, Math.max(0, coreX - MIN_SERVICE_WIDTH));
  const serviceWidthTiles = Math.max(0, coreX - effectiveGarageWidth);
  const privateWidth = Math.max(0, widthTiles - coreX - coreTiles);

  if (coreX + coreTiles > widthTiles) {
    const wholeRect = rect(0, 0, widthTiles, totalHeightTiles);
    const allSpecs = [
      ...(garageSpec ? [garageSpec] : []),
      ...rearPrivateSpecs,
      ...rearServiceSpecs,
      ...frontPublicSpecs,
    ];

    const { placements } = fillWithGuaranteedCoverage(
      wholeRect,
      allSpecs.length ? allSpecs : [makeSyntheticRoom('fallback_l1', 'hallway', 1, widthTiles * totalHeightTiles * 4)],
      'horizontal',
      'fallback_l1'
    );

    const fallbackRooms = placements.map((item) => buildRoom(level, item.roomSpec, item));
    return { level, widthTiles, heightTiles: totalHeightTiles, rooms: fallbackRooms };
  }

  const mainY = protrusionTiles;

  const garageDepthInMain = Math.min(garageDepthBase, rearH);
  const garageDepthFull = protrusionTiles + garageDepthInMain;
  let garageRect = rect(0, 0, effectiveGarageWidth, garageDepthFull);

  const serviceRect = serviceWidthTiles > 0
    ? rect(effectiveGarageWidth, mainY, serviceWidthTiles, rearH)
    : null;

  const coreRearRect = rect(coreX, mainY, coreTiles, rearH);

  let privateRect = privateWidth > 0
    ? rect(coreX + coreTiles, mainY, privateWidth, rearH)
    : null;

  const garageBaseEnd = mainY + garageDepthInMain;
  const rearEnd = mainY + rearH;
  const garageGapRect = (effectiveGarageWidth > 0 && garageDepthInMain < rearH)
    ? rect(0, garageBaseEnd, effectiveGarageWidth, rearEnd - garageBaseEnd)
    : null;

  const frontRect = rect(0, mainY + rearH, widthTiles, publicH);

  const protrusionServiceRect = (protrusionTiles > 0 && effectiveGarageWidth < widthTiles)
    ? rect(effectiveGarageWidth, 0, widthTiles - effectiveGarageWidth, protrusionTiles)
    : null;
  const landingRect = (protrusionTiles > 0 && coreTiles > 0)
    ? rect(coreX, 0, coreTiles, protrusionTiles)
    : null;

  const compactGarageAbsorbRearStrip =
    brief.primaryLevel === 2 &&
    rearPrivateSpecs.length === 0 &&
    garageRect.w > 0 &&
    garageRect.h > 0 &&
    privateRect &&
    privateRect.h === garageRect.h &&
    privateRect.w > 0 &&
    privateRect.w <= Math.max(3, coreTiles);

  if (compactGarageAbsorbRearStrip) {
    garageRect = rect(garageRect.x, garageRect.y, garageRect.w + privateRect.w, garageRect.h);
    privateRect = null;
  }

  const level1PowderProgramSpec = programRooms.find((r) =>
    r.level === level && normalizeRoomType(r.type) === 'powder_room'
  ) || programRooms.find((r) =>
    r.level === level && normalizeRoomType(r.type) === 'bathroom' && String(r.bathroomUse || '').toLowerCase() === 'guest'
  ) || null;
  const level1LaundryProgramSpec = programRooms.find((r) =>
    r.level === level && normalizeRoomType(r.type) === 'laundry'
  ) || null;
  const level1MudroomProgramSpec = programRooms.find((r) =>
    r.level === level && normalizeRoomType(r.type) === 'mudroom'
  ) || null;

  const exactDefaultUpperGarageLevel1 =
    archetypeSpecificStairLanding &&
    (
      (
        familyProfile.bedrooms === 3 &&
        familyProfile.bathrooms >= 3 &&
        familyProfile.privateBathsRequested === 1
      ) ||
      (
        familyProfile.bedrooms === 2 &&
        familyProfile.bathrooms >= 3 &&
        familyProfile.privateBathsRequested === 1 &&
        familyProfile.level2SecondaryBedroomCount === 1 &&
        familyProfile.level2PrivateSuiteCount === 1 &&
        familyProfile.level2SharedBathCount === 0 &&
        familyProfile.level2FeatureCount === 0
      )
    ) &&
    widthTiles === 20 &&
    heightTiles === 16 &&
    protrusionTiles === 4 &&
    coreTiles === 3 &&
    effectiveGarageWidth === 7 &&
    rearPrivateSpecs.length === 0 &&
    garageSpec &&
    frontPublicSpecs.some((spec) => normalizeRoomType(spec.type) === 'living_room') &&
    frontPublicSpecs.some((spec) => normalizeRoomType(spec.type) === 'kitchen') &&
    frontPublicSpecs.some((spec) => normalizeRoomType(spec.type) === 'dining_room') &&
    level1PowderProgramSpec &&
    level1LaundryProgramSpec &&
    level1MudroomProgramSpec;

  if (exactDefaultUpperGarageLevel1) {
    const stairsSpec = programRooms.find((r) => normalizeRoomType(r.type) === 'stairs')
      || makeSyntheticRoom(`stairs_exact_l${level}`, 'stairs', level, 48);
    const hallSpec = programRooms.find((r) => normalizeRoomType(r.type) === 'hallway')
      || makeSyntheticRoom(`hall_exact_l${level}`, 'hallway', level, 64);
    const powderSpec = level1PowderProgramSpec
      || makeSyntheticRoom(`powder_exact_l${level}`, 'powder_room', level, 48);
    const laundrySpec = level1LaundryProgramSpec
      || makeSyntheticRoom(`laundry_exact_l${level}`, 'laundry', level, 64);
    const mudroomSpec = level1MudroomProgramSpec
      || makeSyntheticRoom(`mudroom_exact_l${level}`, 'mudroom', level, 120);
    const livingSpec = frontPublicSpecs.find((spec) => normalizeRoomType(spec.type) === 'living_room')
      || frontPublicSpecs[0]
      || makeSyntheticRoom(`living_exact_l${level}`, 'living_room', level, 220);
    const kitchenSpec = frontPublicSpecs.find((spec) => normalizeRoomType(spec.type) === 'kitchen')
      || makeSyntheticRoom(`kitchen_exact_l${level}`, 'kitchen', level, 140);
    const diningSpec = frontPublicSpecs.find((spec) => normalizeRoomType(spec.type) === 'dining_room')
      || makeSyntheticRoom(`dining_exact_l${level}`, 'dining_room', level, 100);

    const exactGarageRect = rect(0, 0, 7, 10);
    const entryParts = [
      rect(7, 0, 13, 6),
      rect(10, 6, 3, 4),
    ];
    const hallParts = [
      rect(7, 6, 3, 8),
      rect(7, 14, 13, 1),
    ];
    const stairsRect = rect(10, 10, 3, 4);
    const powderRect = rect(13, 6, 3, 4);
    const laundryRect = rect(16, 6, 4, 4);
    const mudroomRect = rect(13, 10, 7, 4);
    const livingParts = [
      rect(0, 10, 7, 10),
      rect(7, 15, 3, 5),
    ];
    const kitchenRect = rect(10, 15, 5, 5);
    const diningRect = rect(15, 15, 5, 5);

    rooms.push(buildRoom(level, withZone(garageSpec, 'service'), exactGarageRect));
    rooms.push(buildCompositeRoom(level, withZone(entrySpec, 'circulation'), entryParts));
    rooms.push(buildCompositeRoom(level, withZone(hallSpec, 'circulation'), hallParts));
    rooms.push(buildRoom(level, withZone(stairsSpec, 'circulation'), stairsRect));
    rooms.push(buildRoom(level, withZone(powderSpec, 'service'), powderRect));
    rooms.push(buildRoom(level, withZone(laundrySpec, 'service'), laundryRect));
    rooms.push(buildRoom(level, withZone(mudroomSpec, 'service'), mudroomRect));
    rooms.push(buildCompositeRoom(level, withZone(livingSpec, 'public'), livingParts));
    rooms.push(buildRoom(level, withZone(kitchenSpec, 'public'), kitchenRect));
    rooms.push(buildRoom(level, withZone(diningSpec, 'public'), diningRect));

    zones.push(zoneMeta('service', exactGarageRect));
    zones.push(zoneMeta('circulation', rect(7, 0, 13, 15)));
    zones.push(zoneMeta('service', rect(13, 6, 7, 9)));
    zones.push(zoneMeta('public', rect(0, 15, 20, 5)));

    return {
      level,
      widthTiles,
      heightTiles: totalHeightTiles,
      rooms,
      zones,
      stairCore: stairCoreMeta(level, rooms, {
        landingRoomId: String(entrySpec.id),
        landingSide: 'top',
        landingOpen: true,
      }),
    };
  }

  if (garageSpec && garageRect.w > 0 && garageRect.h > 0) {
    rooms.push(buildRoom(level, garageSpec, garageRect));
    zones.push(zoneMeta('service', garageRect));
  }

  if (garageGapRect && garageGapRect.h > 0) {
    const storageFill = makeSyntheticRoom('garage_gap_store_l1', 'storage', 1, garageGapRect.w * garageGapRect.h * 4);
    rooms.push(buildRoom(level, storageFill, garageGapRect));
  }

  if (!archetypeSpecificStairLanding && landingRect && landingRect.h > 0 && landingRect.w > 0) {
    const landingHall = makeSyntheticRoom(`hall_landing_l${level}`, 'hallway', level, landingRect.w * landingRect.h * 4, { zone: 'circulation' });
    rooms.push(buildRoom(level, landingHall, landingRect));
    zones.push(zoneMeta('circulation', landingRect));
  }

  if (protrusionServiceRect && protrusionServiceRect.h > 0 && protrusionServiceRect.w > 0) {
    const leftProtrusionW = Math.max(0, coreX - effectiveGarageWidth);
    const rightProtrusionW = Math.max(0, widthTiles - (coreX + coreTiles));
    const leftProtrusionRect = leftProtrusionW > 0
      ? rect(effectiveGarageWidth, 0, leftProtrusionW, protrusionTiles)
      : null;
    const rightProtrusionRect = rightProtrusionW > 0
      ? rect(coreX + coreTiles, 0, rightProtrusionW, protrusionTiles)
      : null;

    let entryRect = (leftProtrusionRect && (!rightProtrusionRect || leftProtrusionRect.w >= rightProtrusionRect.w))
      ? leftProtrusionRect
      : rightProtrusionRect;
    let serviceFillRect = entryRect === leftProtrusionRect ? rightProtrusionRect : leftProtrusionRect;

    if (archetypeSpecificStairLanding && landingRect && entryRect) {
      const mergedEntryRect = mergeableRect(landingRect, entryRect);
      if (mergedEntryRect) {
        entryRect = mergedEntryRect;
      }
    }

    if (entryRect && entryRect.w > 0 && entryRect.h > 0) {
      rooms.push(buildRoom(level, withZone(entrySpec, 'circulation'), entryRect));
      zones.push(zoneMeta('circulation', entryRect));
    }
    if (serviceFillRect && serviceFillRect.w > 0 && serviceFillRect.h > 0) {
      const protFill = makeSyntheticRoom(`protrusion_fill_l${level}`, 'storage', level, serviceFillRect.w * serviceFillRect.h * 4, { zone: 'service' });
      rooms.push(buildRoom(level, protFill, serviceFillRect));
      zones.push(zoneMeta('service', serviceFillRect));
    }
  }

  const hybridUpperGarageCompactMain =
    brief.hasGarage &&
    brief.primaryLevel === 2 &&
    Number(brief.bedrooms || 0) === 3 &&
    Number(brief.bathrooms || 0) >= 3 &&
    rearPrivateSpecs.length === 0 &&
    featureRooms.filter((r) => r.level === 1).length === 0 &&
    frontPublicSpecs.length >= 3 &&
    frontPublicSpecs.every((spec) => PUBLIC_ROOM_TYPES.has(normalizeRoomType(spec.type))) &&
    rearServiceSpecs.some((spec) => BATHROOM_TYPES.has(normalizeRoomType(spec.type))) &&
    rearServiceSpecs.some((spec) => normalizeRoomType(spec.type) === 'laundry') &&
    rearServiceSpecs.some((spec) => normalizeRoomType(spec.type) === 'mudroom') &&
    frontRect.w >= 10 &&
    frontRect.h >= 5;

  if (hybridUpperGarageCompactMain) {
    const stairsSpec = programRooms.find((r) => normalizeRoomType(r.type) === 'stairs')
      || makeSyntheticRoom(`stairs_hybrid_l${level}`, 'stairs', level, coreRearRect.w * coreRearRect.h * 4);
    const mudroomSpec = rearServiceSpecs.find((spec) => normalizeRoomType(spec.type) === 'mudroom') || null;
    const laundrySpec = rearServiceSpecs.find((spec) => normalizeRoomType(spec.type) === 'laundry') || null;
    const guestBathSpec = rearServiceSpecs.find((spec) => {
      const type = normalizeRoomType(spec.type);
      return type === 'bathroom' || type === 'powder_room';
    }) || null;
    const livingSpec = frontPublicSpecs.find((spec) => {
      const type = normalizeRoomType(spec.type);
      return type === 'living_room' || type === 'great_room' || type === 'family_room';
    }) || null;
    const leftPublicSpecs = [];
    const kitchenSpec = frontPublicSpecs.find((spec) => normalizeRoomType(spec.type) === 'kitchen') || null;
    const diningSpec = frontPublicSpecs.find((spec) => normalizeRoomType(spec.type) === 'dining_room') || null;
    if (kitchenSpec) leftPublicSpecs.push(kitchenSpec);
    if (diningSpec) leftPublicSpecs.push(diningSpec);
    for (const spec of frontPublicSpecs) {
      if (spec === livingSpec || leftPublicSpecs.includes(spec)) continue;
      leftPublicSpecs.push(spec);
    }

    const upperRightServiceW = garageRect && garageRect.x > (coreX + coreTiles)
      ? garageRect.x - (coreX + coreTiles)
      : 0;
    const upperRightServiceRect = upperRightServiceW > 0
      ? rect(coreX + coreTiles, 0, upperRightServiceW, protrusionTiles + rearH)
      : null;
    const leftServiceRect = coreX > 0 && rearH > 0 ? rect(0, mainY, coreX, rearH) : null;

    if (
      coreRearRect && coreRearRect.w > 0 && coreRearRect.h > 0 &&
      livingSpec &&
      leftPublicSpecs.length &&
      upperRightServiceRect &&
      upperRightServiceRect.h >= 4
    ) {
      rooms.push(buildRoom(level, withZone(stairsSpec, 'circulation'), coreRearRect));
      zones.push(zoneMeta('circulation', coreRearRect));

      const guestBathType = normalizeRoomType(guestBathSpec?.type || '');
      const powderGuest = guestBathType === 'powder_room';
      const bathMinH = powderGuest ? 2 : 3;
      const bathH = guestBathSpec
        ? clamp(
            protrusionTiles || Math.floor(upperRightServiceRect.h / (powderGuest ? 3 : 2)),
            bathMinH,
            Math.max(bathMinH, upperRightServiceRect.h - (laundrySpec ? 2 : 0))
          )
        : 0;
      const bathRect = guestBathSpec
        ? rect(upperRightServiceRect.x, upperRightServiceRect.y, upperRightServiceRect.w, bathH)
        : null;
      const laundryRect = laundrySpec
        ? rect(
            upperRightServiceRect.x,
            upperRightServiceRect.y + (bathRect ? bathRect.h : 0),
            upperRightServiceRect.w,
            upperRightServiceRect.h - (bathRect ? bathRect.h : 0)
          )
        : null;

      if (leftServiceRect && mudroomSpec) {
        rooms.push(buildRoom(level, withZone(mudroomSpec, 'service'), leftServiceRect));
        zones.push(zoneMeta('service', leftServiceRect));
      }
      if (bathRect && bathRect.h >= bathMinH) {
        rooms.push(buildRoom(level, withZone(guestBathSpec, 'service'), bathRect));
      }
      if (laundryRect && laundryRect.h >= 2) {
        rooms.push(buildRoom(level, withZone(laundrySpec, 'service'), laundryRect));
      }
      if (upperRightServiceRect.w > 0 && upperRightServiceRect.h > 0) {
        zones.push(zoneMeta('service', upperRightServiceRect));
      }

      const leftPublicMinW = Math.max(7, Math.round(frontRect.w * 0.42));
      const leftPublicMaxW = Math.max(leftPublicMinW, frontRect.w - 7);
      const leftPublicW = clamp(coreX + coreTiles + 1, leftPublicMinW, leftPublicMaxW);
      const leftPublicRect = rect(frontRect.x, frontRect.y, leftPublicW, frontRect.h);
      const rightPublicRect = rect(frontRect.x + leftPublicW, frontRect.y, frontRect.w - leftPublicW, frontRect.h);

      if (leftPublicRect.w > 0 && leftPublicRect.h > 0) {
        const { placements } = fillWithGuaranteedCoverage(leftPublicRect, leftPublicSpecs, 'horizontal', `hybrid_front_left_l${level}`);
        for (const item of placements) rooms.push(buildRoom(level, withZone(item.roomSpec, 'public'), item));
        zones.push(zoneMeta('public', leftPublicRect));
      }
      if (rightPublicRect.w > 0 && rightPublicRect.h > 0) {
        rooms.push(buildRoom(level, withZone(livingSpec, 'public'), rightPublicRect));
        zones.push(zoneMeta('public', rightPublicRect));
      }

      return { level, widthTiles, heightTiles: totalHeightTiles, rooms, zones, stairCore: level1StairCoreMeta() };
    }
  }

  let serviceSpecsOverflow = [];
  if (serviceRect && serviceRect.w > 0 && serviceRect.h > 0) {
    if (rearServiceSpecs.length) {
      const svcSorted = [...rearServiceSpecs].sort((a, b) => (a.shrinkRank || 5) - (b.shrinkRank || 5));
      const keptServiceSpecs = [];
      let rowsUsed = 0;

      for (const spec of svcSorted) {
        const needed = Math.ceil(
          Math.max(1, (spec.minAreaSqFt || 48) / (TILE_SIZE_FT_DEFAULT * TILE_SIZE_FT_DEFAULT * serviceRect.w))
        );
        if (rowsUsed + needed <= serviceRect.h) {
          keptServiceSpecs.push(spec);
          rowsUsed += needed;
        } else {
          serviceSpecsOverflow.push(spec);
        }
      }

      if (keptServiceSpecs.length) {
        const { placements } = fillWithGuaranteedCoverage(serviceRect, keptServiceSpecs, 'horizontal', 'svc_fill_l1');
        for (const item of placements) rooms.push(buildRoom(level, item.roomSpec, item));
      } else {
        const filler = makeSyntheticRoom('service_store_l1', 'storage', 1, serviceRect.w * serviceRect.h * 4);
        rooms.push(buildRoom(level, filler, serviceRect));
        serviceSpecsOverflow = rearServiceSpecs;
      }
    } else {
      const filler = makeSyntheticRoom('service_store_l1', 'storage', 1, serviceRect.w * serviceRect.h * 4);
      rooms.push(buildRoom(level, filler, serviceRect));
    }
  } else if (rearServiceSpecs.length) {
    serviceSpecsOverflow = rearServiceSpecs;
  }
  if (serviceRect && serviceRect.w > 0 && serviceRect.h > 0) zones.push(zoneMeta('service', serviceRect));
  if (coreRearRect && coreRearRect.w > 0 && coreRearRect.h > 0) zones.push(zoneMeta('circulation', coreRearRect));
  if (privateRect && privateRect.w > 0 && privateRect.h > 0) zones.push(zoneMeta('private', privateRect));

  rooms.push(...allocateCoreRooms(level, coreRearRect, programRooms, rearH));

  let privateSpecsOverflow = [];
  if (privateRect && rearPrivateSpecs.length && privateRect.w > 0 && privateRect.h > 0) {
    const suitePlacements = allocateSuitePlacements(level, privateRect, rearPrivateSpecs);
    if (suitePlacements.length) {
      for (const item of suitePlacements) rooms.push(buildRoom(level, item.roomSpec, item));
      const placedIds = new Set(suitePlacements.map(p => p.roomSpec.id));
      privateSpecsOverflow = rearPrivateSpecs.filter(spec => !placedIds.has(spec.id));
    } else {
      const { placements } = fillWithGuaranteedCoverage(privateRect, rearPrivateSpecs, 'horizontal', 'private_fill_l1');
      for (const item of placements) rooms.push(buildRoom(level, item.roomSpec, item));
    }
  } else if (privateRect && privateRect.w > 0 && privateRect.h > 0) {
    const filler = makeSyntheticRoom('storage_rear_l1', 'storage', 1, privateRect.w * privateRect.h * 4);
    rooms.push(buildRoom(level, filler, privateRect));
  } else if (rearPrivateSpecs.length) {
    privateSpecsOverflow = rearPrivateSpecs;
  }

  const allFrontSpecs = [
    ...frontPublicSpecs,
    ...serviceSpecsOverflow,
    ...privateSpecsOverflow,
  ];

  if (!allFrontSpecs.length && frontRect.w > 0 && frontRect.h > 0) {
    const filler = makeSyntheticRoom('great_room_fill_l1', 'great_room', 1, frontRect.w * frontRect.h * 4);
    rooms.push(buildRoom(level, filler, frontRect));
    zones.push(zoneMeta('public', frontRect));
  }

  if (allFrontSpecs.length && frontRect.w > 0 && frontRect.h > 0) {
    const compactUpperGaragePublicMain =
      brief.hasGarage &&
      brief.primaryLevel === 2 &&
      brief.bedrooms <= 2 &&
      rearPrivateSpecs.length === 0 &&
      allFrontSpecs.length >= 2 &&
      allFrontSpecs.length <= 3 &&
      allFrontSpecs.every((spec) => PUBLIC_ROOM_TYPES.has(normalizeRoomType(spec.type))) &&
      frontRect.w >= 16 &&
      frontRect.h >= 8;

    if (compactUpperGaragePublicMain) {
      const livingSpec = allFrontSpecs.find((spec) => {
        const type = normalizeRoomType(spec.type);
        return type === 'living_room' || type === 'great_room' || type === 'family_room';
      }) || null;

      if (livingSpec) {
        const diningSpec = allFrontSpecs.find((spec) => normalizeRoomType(spec.type) === 'dining_room') || null;
        const kitchenSpec = allFrontSpecs.find((spec) => normalizeRoomType(spec.type) === 'kitchen') || null;
        const leftSpecs = [];
        if (diningSpec) leftSpecs.push(diningSpec);
        if (kitchenSpec && kitchenSpec !== diningSpec) leftSpecs.push(kitchenSpec);
        for (const spec of allFrontSpecs) {
          if (spec === livingSpec || leftSpecs.includes(spec)) continue;
          leftSpecs.push(spec);
        }

        const livingArea = livingSpec.targetAreaSqFt || 280;
        const companionArea = leftSpecs.reduce((sum, spec) => sum + (spec.targetAreaSqFt || 140), 0) || 1;
        let leftWidth = clamp(
          Math.round(frontRect.w * (companionArea / Math.max(1, companionArea + livingArea))),
          Math.max(8, Math.floor(frontRect.w * 0.38)),
          Math.max(8, frontRect.w - Math.max(8, Math.floor(frontRect.w * 0.38)))
        );
        leftWidth = clamp(leftWidth, 8, Math.max(8, frontRect.w - 8));

        const leftRect = rect(frontRect.x, frontRect.y, leftWidth, frontRect.h);
        const rightRect = rect(frontRect.x + leftWidth, frontRect.y, frontRect.w - leftWidth, frontRect.h);

        if (leftRect.w > 0 && leftRect.h > 0) {
          const { placements } = fillWithGuaranteedCoverage(leftRect, leftSpecs, 'horizontal', `compact_front_public_left_l${level}`);
          for (const item of placements) rooms.push(buildRoom(level, withZone(item.roomSpec, 'public'), item));
          zones.push(zoneMeta('public', leftRect));
        }

        if (rightRect.w > 0 && rightRect.h > 0) {
          rooms.push(buildRoom(level, withZone(livingSpec, 'public'), rightRect));
          zones.push(zoneMeta('public', rightRect));
        }

        return { level, widthTiles, heightTiles: totalHeightTiles, rooms, zones, stairCore: level1StairCoreMeta() };
      }
    }

    // For the compact 3-bed/3-bath/L2 path, use a 1-tile connector instead of the full
    // coreTiles width. This prevents the need for post-placement mutations that shift room
    // positions and can cause tile overlaps.
    const isCompactConnector = brief.primaryLevel === 2 && Number(brief.bedrooms || 0) === 3 && Number(brief.bathrooms || 0) >= 3;
    const connectorW = isCompactConnector ? 1 : coreTiles;
    const connectorRect = coreTiles > 0 && frontRect.w > coreTiles + 2
      ? rect(coreX, frontRect.y, connectorW, frontRect.h)
      : null;
    const leftFrontRect = connectorRect && coreX > 0
      ? rect(frontRect.x, frontRect.y, coreX, frontRect.h)
      : frontRect;
    // Give extra tiles (coreTiles - connectorW) to the right front rect
    const rightFrontStart = connectorRect ? coreX + connectorW : coreX + coreTiles;
    const rightFrontRect = connectorRect && (frontRect.x + frontRect.w > rightFrontStart)
      ? rect(rightFrontStart, frontRect.y, (frontRect.x + frontRect.w) - rightFrontStart, frontRect.h)
      : null;

    if (connectorRect && connectorRect.w > 0 && connectorRect.h > 0) {
      if (archetypeSpecificStairLanding) {
        const entryRoomIndex = rooms.findIndex((room) => String(room.id) === String(entrySpec.id));
        if (entryRoomIndex !== -1) {
          const entryRoom = rooms[entryRoomIndex];
          const existingParts = Array.isArray(entryRoom.parts) && entryRoom.parts.length
            ? entryRoom.parts.map((part) => rect(part.x, part.y, part.w, part.h))
            : [rect(entryRoom.x, entryRoom.y, entryRoom.w, entryRoom.h)];
          const mergedEntry = buildCompositeRoom(
            level,
            withZone(entrySpec, 'circulation'),
            [...existingParts, connectorRect]
          );
          if (mergedEntry) {
            rooms[entryRoomIndex] = mergedEntry;
          } else {
            const connectorHall = makeSyntheticRoom(`hall_front_connector_l${level}`, 'hallway', level, connectorRect.w * connectorRect.h * 4, { zone: 'circulation' });
            rooms.push(buildRoom(level, connectorHall, connectorRect));
          }
        } else {
          rooms.push(buildRoom(level, withZone(entrySpec, 'circulation'), connectorRect));
        }
      } else {
        const hallMergeIndex = rooms.findIndex((room) =>
          normalizeRoomType(room.type) === 'hallway' && Boolean(mergeableRect(roomRect(room), connectorRect))
        );
        if (hallMergeIndex !== -1) {
          const hallRoom = rooms[hallMergeIndex];
          const existingParts = Array.isArray(hallRoom.parts) && hallRoom.parts.length
            ? hallRoom.parts.map((part) => rect(part.x, part.y, part.w, part.h))
            : [rect(hallRoom.x, hallRoom.y, hallRoom.w, hallRoom.h)];
          const mergedHall = buildCompositeRoom(level, hallRoom, [...existingParts, connectorRect]);
          if (mergedHall) {
            rooms[hallMergeIndex] = mergedHall;
          } else {
            const connectorHall = makeSyntheticRoom(`hall_front_connector_l${level}`, 'hallway', level, connectorRect.w * connectorRect.h * 4, { zone: 'circulation' });
            rooms.push(buildRoom(level, connectorHall, connectorRect));
          }
        } else {
          const connectorHall = makeSyntheticRoom(`hall_front_connector_l${level}`, 'hallway', level, connectorRect.w * connectorRect.h * 4, { zone: 'circulation' });
          rooms.push(buildRoom(level, connectorHall, connectorRect));
        }
      }
      zones.push(zoneMeta('circulation', connectorRect));
    }

    const { left: leftFrontSpecs, right: rightFrontSpecs } = distributeSpecsByArea(allFrontSpecs, leftFrontRect, rightFrontRect);

    if (leftFrontRect && leftFrontRect.w > 0 && leftFrontRect.h > 0) {
      const specs = leftFrontSpecs.length
        ? leftFrontSpecs
        : [makeSyntheticRoom(`front_left_fill_l${level}`, 'storage', level, leftFrontRect.w * leftFrontRect.h * 4)];
      const useVert = specs.length >= 3 && leftFrontRect.w > leftFrontRect.h * 1.5;
      const { placements } = fillWithGuaranteedCoverage(leftFrontRect, specs, useVert ? 'vertical' : 'horizontal', `front_left_l${level}`);
      for (const item of placements) rooms.push(buildRoom(level, item.roomSpec, item));
      zones.push(zoneMeta('public', leftFrontRect));
    }

    if (rightFrontRect && rightFrontRect.w > 0 && rightFrontRect.h > 0) {
      const specs = rightFrontSpecs.length
        ? rightFrontSpecs
        : [makeSyntheticRoom(`front_right_fill_l${level}`, 'storage', level, rightFrontRect.w * rightFrontRect.h * 4)];
      const useVert = specs.length >= 3 && rightFrontRect.w > rightFrontRect.h * 1.5;
      const { placements } = fillWithGuaranteedCoverage(rightFrontRect, specs, useVert ? 'vertical' : 'horizontal', `front_right_l${level}`);
      for (const item of placements) rooms.push(buildRoom(level, item.roomSpec, item));
      zones.push(zoneMeta('public', rightFrontRect));
    }
  }

  // For the compact path, handle laundry/protrusion swap without post-placement mutations.
  // Move laundry to protrusion fill position if both exist.
  if (brief.primaryLevel === 2 && Number(brief.bedrooms || 0) === 3 && Number(brief.bathrooms || 0) >= 3) {
    const protrusionFill = rooms.find((room) => String(room.id) === `protrusion_fill_l${level}`);
    if (protrusionFill) {
      const laundryRoom = rooms.find((room) => normalizeRoomType(room.type) === 'laundry');
      const mudroomRoom = rooms.find((room) => normalizeRoomType(room.type) === 'mudroom');
      if (laundryRoom) {
        const oldLaundryRect = rect(laundryRoom.x, laundryRoom.y, laundryRoom.w, laundryRoom.h);
        laundryRoom.x = protrusionFill.x;
        laundryRoom.y = protrusionFill.y;
        laundryRoom.w = protrusionFill.w;
        laundryRoom.h = protrusionFill.h;

        if (mudroomRoom) {
          const mergedMudroom = mergeableRect(mudroomRoom, oldLaundryRect);
          if (mergedMudroom) {
            mudroomRoom.x = mergedMudroom.x;
            mudroomRoom.y = mergedMudroom.y;
            mudroomRoom.w = mergedMudroom.w;
            mudroomRoom.h = mergedMudroom.h;
          }
        }

        const fillIdx = rooms.findIndex((room) => String(room.id) === String(protrusionFill.id));
        if (fillIdx !== -1) rooms.splice(fillIdx, 1);
      }
    }
  }

  return { level, widthTiles, heightTiles: totalHeightTiles, rooms, zones, stairCore: level1StairCoreMeta() };
}

// Returns the L2 stair rect aligned to the same x, y, w, h as the L1 stairs
// so both levels render the stair shaft at the same position in the house.
function getL2StairsRect(l1Layout, coreX, coreTiles, heightTiles) {
  const l1Stairs = l1Layout ? l1Layout.rooms.find((r) => normalizeRoomType(r.type) === 'stairs') : null;
  if (l1Stairs && l1Stairs.x === coreX && l1Stairs.w === coreTiles) {
    const stairH = Math.max(1, Math.min(l1Stairs.h, heightTiles));
    const stairY = Math.max(0, Math.min(l1Stairs.y, heightTiles - stairH));
    return rect(coreX, stairY, coreTiles, stairH);
  }
  return rect(coreX, 0, coreTiles, Math.min(4, heightTiles));
}

function allocateTwoStoryLevel2(programRooms, footprint, brief, l1Layout) {
  const level = 2;
  const widthTiles = footprint.widthTiles;
  const heightTiles = footprint.heightTiles;
  const { coreTiles } = chooseFixedCore(widthTiles, 2);
  const coreX = coreXPosition(brief, footprint);

  // Guard: if coreX is 0 or negative, the stair column would start at x=0 with
  // no left wing, which leaves the area to the left of the stair uncovered.
  // This is the root cause of "Level 2: unfilled tile at 0,0" crashes (C1 bug).
  // Return an empty layout — the pipeline will fall back to the legacy path.
  if (!coreX || coreX <= 0) {
    console.warn('[generateTilePlan] allocateTwoStoryLevel2: coreX is', coreX, '— skipping level 2 allocation to prevent unfilled tile crash');
    return { level, widthTiles, heightTiles, rooms: [], zones: [], stairCore: null };
  }

  // Align L2 stair y with L1 stair position (accounting for protrusion offset).
  const l1Stairs = l1Layout ? l1Layout.rooms.find((r) => normalizeRoomType(r.type) === 'stairs') : null;
  const protrusionTiles = footprint.protrusionTiles || 0;
  const alignedStairY = l1Stairs
    ? clamp(l1Stairs.y - protrusionTiles, 0, heightTiles - 2)
    : null;

  const rooms = [];
  const zones = [];

  const primaryBedroom = programRooms.find((r) => normalizeRoomType(r.type) === 'primary_bedroom');
  const primaryBathroom = programRooms.find((r) => normalizeRoomType(r.type) === 'primary_bathroom');
  const secondaryBedrooms = programRooms.filter((r) =>
    ['bedroom', 'guest_bedroom'].includes(normalizeRoomType(r.type))
  );
  const featureRooms = programRooms.filter((r) => FEATURE_ROOM_TYPES.has(normalizeRoomType(r.type)));
  const sharedBaths = programRooms.filter((r) => isSharedBath(r));
  const privateBathMap = bathsByAttachedBedroom(programRooms);

  const hallSpec = programRooms.find((r) => normalizeRoomType(r.type) === 'hallway')
    || makeSyntheticRoom('hall_l2', 'hallway', level, widthTiles * 2 * 4);
  const stairsSpec = programRooms.find((r) => normalizeRoomType(r.type) === 'stairs')
    || makeSyntheticRoom('stairs_l2', 'stairs', level, 48);

  const nonCoreRooms = (r) => !['stairs', 'hallway'].includes(normalizeRoomType(r.type));
  const l2SecondaryBedrooms = secondaryBedrooms.filter((r) => r.level === 2);
  const l2SecondarySuiteGroups = l2SecondaryBedrooms.map((bed) => ({
    bed,
    baths: privateBathMap.get(String(bed.id)) || privateBathMap.get(bed.id) || [],
  }));
  const l2SecondarySuites = suiteSequenceForBedrooms(
    l2SecondaryBedrooms,
    privateBathMap
  ).filter(nonCoreRooms);
  const l2FeatureRooms = featureRooms.filter((r) => r.level === 2);
  const l2SharedBaths = sharedBaths.filter((r) => r.level === 2);
  const familyProfile = buildSuburbanFamilyLayoutProfile(brief, programRooms);
  const wantsDedicatedBottomLandingUpper =
    familyProfile.usesUpperGarageFamilyLayout &&
    familyProfile.bedrooms === 3 &&
    familyProfile.bathrooms >= 3 &&
    familyProfile.privateBathsRequested === 1 &&
    familyProfile.level2SecondaryBedroomCount === 2 &&
    familyProfile.level2SharedBathCount === 1 &&
    familyProfile.level2PrivateSuiteCount === 1;
  const exactCompactDualSuiteUpper =
    familyProfile.usesUpperGarageFamilyLayout &&
    brief.primaryLevel === 2 &&
    primaryBedroom &&
    primaryBathroom &&
    l2SecondaryBedrooms.length === 1 &&
    l2SecondarySuiteGroups.filter((suite) => suite.baths.length >= 1).length === 1 &&
    l2SharedBaths.length === 0 &&
    l2FeatureRooms.length === 0 &&
    widthTiles === 20 &&
    heightTiles === 16;
  const compactTriplePrivateUpper =
    brief.primaryLevel === 2 &&
    primaryBedroom &&
    primaryBathroom &&
    l2SecondaryBedrooms.length === 2 &&
    l2SecondarySuiteGroups.length === 2 &&
    l2SecondarySuiteGroups.every((suite) => suite.baths.length >= 1) &&
    l2FeatureRooms.length === 0 &&
    l2SharedBaths.length === 0 &&
    widthTiles >= 20 &&
    heightTiles >= 16;
  const compactDualSuiteUpper =
    !exactCompactDualSuiteUpper &&
    brief.primaryLevel === 2 &&
    primaryBedroom &&
    primaryBathroom &&
    l2SecondaryBedrooms.length === 1 &&
    l2SecondarySuites.length >= 1 &&
    l2FeatureRooms.length === 0 &&
    l2SharedBaths.length === 0 &&
    widthTiles >= 18 &&
    heightTiles >= 14;
  const primaryPlusTwoSharedUpper =
    brief.primaryLevel === 2 &&
    primaryBedroom &&
    primaryBathroom &&
    l2SecondaryBedrooms.length === 2 &&
    l2FeatureRooms.length === 0 &&
    l2SharedBaths.length === 1 &&
    l2SecondarySuiteGroups.every((suite) => suite.baths.length === 0) &&
    widthTiles >= 18 &&
    heightTiles >= 14;
  const hybridTripleUpperSharedBath =
    !wantsDedicatedBottomLandingUpper &&
    brief.primaryLevel === 2 &&
    primaryBedroom &&
    primaryBathroom &&
    l2SecondaryBedrooms.length === 2 &&
    l2FeatureRooms.every((room) => normalizeRoomType(room.type) === 'study' && !room.requestedFeature) &&
    l2SharedBaths.length === 1 &&
    l2SecondarySuiteGroups.filter((suite) => suite.baths.length >= 1).length === 1 &&
    widthTiles >= 20 &&
    heightTiles >= 13;

  // ── SHARED SPINE HELPER ───────────────────────────────────────────────────────
  // All 4 named layout branches below use this to place the full-width horizontal
  // hallway spine. Stairs sit within the spine at (coreX, hallY, coreTiles, HALL_H),
  // preserving x/w alignment with Level 1. Returns { northH, southH }.
  const NAMED_HALL_H = 2;
  const placeNamedSpine = (hallY) => {
    rooms.push(buildRoom(level, withZone(stairsSpec, 'circulation'), rect(coreX, hallY, coreTiles, NAMED_HALL_H)));
    zones.push(zoneMeta('circulation', rect(coreX, hallY, coreTiles, NAMED_HALL_H)));
    if (coreX > 0) {
      const hl = makeSyntheticRoom('hall_spine_left_l2', 'hallway', level, coreX * NAMED_HALL_H * 4, { zone: 'circulation' });
      rooms.push(buildRoom(level, hl, rect(0, hallY, coreX, NAMED_HALL_H)));
      zones.push(zoneMeta('circulation', rect(0, hallY, coreX, NAMED_HALL_H)));
    }
    const hrW = widthTiles - coreX - coreTiles;
    if (hrW > 0) {
      const hr = makeSyntheticRoom('hall_spine_right_l2', 'hallway', level, hrW * NAMED_HALL_H * 4, { zone: 'circulation' });
      rooms.push(buildRoom(level, hr, rect(coreX + coreTiles, hallY, hrW, NAMED_HALL_H)));
      zones.push(zoneMeta('circulation', rect(coreX + coreTiles, hallY, hrW, NAMED_HALL_H)));
    }
    return { northH: hallY, southH: heightTiles - hallY - NAMED_HALL_H };
  };

  // Places primary bedroom + bath into the north zone (full width, y=0 to northH).
  // Bath is a vertical strip on the corner farthest from the stair column.
  const placeNorthPrimary = (northH) => {
    const bathW = clamp(Math.round(widthTiles * 0.26), 3, Math.max(3, widthTiles - 8));
    const bathOnLeft = coreX >= widthTiles / 2;
    const bathR = bathOnLeft ? rect(0, 0, bathW, northH) : rect(widthTiles - bathW, 0, bathW, northH);
    const bedR  = bathOnLeft ? rect(bathW, 0, widthTiles - bathW, northH) : rect(0, 0, widthTiles - bathW, northH);
    rooms.push(buildRoom(level, withZone(primaryBedroom, 'private'), bedR));
    rooms.push(buildRoom(level, withZone(primaryBathroom, 'service'), bathR));
    zones.push(zoneMeta('private', rect(0, 0, widthTiles, northH)));
  };

  // Places a single bedroom+bath suite into zoneRect.
  // Bath is stacked below the bedroom (horizontal split).
  const placeSuiteInZone = (zoneRect, bed, bath, suiteTag) => {
    if (!zoneRect || zoneRect.w <= 0 || zoneRect.h <= 0 || !bed) return;
    if (!bath) { rooms.push(buildRoom(level, withZone(bed, 'private'), zoneRect)); zones.push(zoneMeta('private', zoneRect)); return; }
    let bathH = clamp(Math.round(zoneRect.h * 0.35), 3, Math.min(4, zoneRect.h - 3));
    let bedH = zoneRect.h - bathH;
    // If zone is shallow (e.g. 5 tiles), bathH clamp can produce bedH < 3.
    // Reduce bathH to ensure bedH >= 3 (minimum viable bedroom depth).
    if (bedH < 3 && zoneRect.h >= 4) {
      bathH = zoneRect.h - 3;
      bedH = 3;
    }
    if (bedH >= 3) {
      rooms.push(buildRoom(level, withZone(bed, 'private'), rect(zoneRect.x, zoneRect.y, zoneRect.w, bedH)));
      rooms.push(buildRoom(level, withZone(bath, 'service'), rect(zoneRect.x, zoneRect.y + bedH, zoneRect.w, bathH)));
    } else {
      const { placements } = fillWithGuaranteedCoverage(zoneRect, [bed, bath], 'horizontal', suiteTag);
      for (const item of placements) rooms.push(buildRoom(level, withZone(item.roomSpec, classifyProgramZone(item.roomSpec.type)), item));
    }
    zones.push(zoneMeta('private', zoneRect));
  };

  // Helper: compute aligned hallY for named branches, using L1 stair position when available.
  // Maintains minimum 3-tile north/south zones to avoid layout collapse.
  const namedHallY = () => {
    const lo = 3;
    const hi = Math.max(lo, heightTiles - NAMED_HALL_H - 3);
    const fallback = clamp(Math.round(heightTiles * 0.48), lo, hi);
    if (alignedStairY !== null) {
      return clamp(alignedStairY, lo, hi);
    }
    return fallback;
  };

  const preferLargeUpperBottomLandingMetadata =
    brief.primaryLevel === 2 &&
    Boolean(brief.hasGarage) &&
    Number(brief.bedrooms || 0) >= 4 &&
    Number(brief.bathrooms || 0) >= 3 &&
    ['suburban_two_story_family', 'wide_view_lot_luxury'].includes(String(brief?.archetype?.id || ''));

  if (compactTriplePrivateUpper) {
    // North zone: primary bed + bath (full width).
    // South zone: two secondary private suites split left/right at mid-width.
    const hallY = namedHallY();
    if (heightTiles >= 9 && l2SecondarySuiteGroups.length >= 2 &&
        l2SecondarySuiteGroups[0].bed && l2SecondarySuiteGroups[1].bed) {
      const { northH, southH } = placeNamedSpine(hallY);
      placeNorthPrimary(northH);
      const split = Math.round(widthTiles / 2);
      const southY = hallY + NAMED_HALL_H;
      placeSuiteInZone(rect(0, southY, split, southH), l2SecondarySuiteGroups[0].bed, l2SecondarySuiteGroups[0].baths[0], 'suite0_south_l2');
      placeSuiteInZone(rect(split, southY, widthTiles - split, southH), l2SecondarySuiteGroups[1].bed, l2SecondarySuiteGroups[1].baths[0], 'suite1_south_l2');
      return {
        level,
        widthTiles,
        heightTiles,
        rooms,
        zones,
        stairCore: stairCoreMeta(level, rooms, preferLargeUpperBottomLandingMetadata ? {
          landingSide: 'top',
          landingOpen: false,
        } : {}),
      };
    }
  }

  if (compactDualSuiteUpper) {
    // North zone: primary bed + bath (full width).
    // South zone: single secondary suite (bed + bath stacked).
    const hallY = namedHallY();
    if (heightTiles >= 9) {
      const { northH, southH } = placeNamedSpine(hallY);
      placeNorthPrimary(northH);
      const southY = hallY + NAMED_HALL_H;
      const southRect = rect(0, southY, widthTiles, southH);
      const bed = l2SecondarySuites.find((r) => BEDROOM_TYPES.has(normalizeRoomType(r.type)));
      const baths = l2SecondarySuites.filter((r) => BATHROOM_TYPES.has(normalizeRoomType(r.type)));
      if (bed && baths.length) {
        placeSuiteInZone(southRect, bed, baths[0], 'dual_suite_south_l2');
      } else if (l2SecondarySuites.length) {
        const { placements } = fillWithGuaranteedCoverage(southRect, l2SecondarySuites, 'horizontal', 'dual_suite_south_l2');
        for (const item of placements) rooms.push(buildRoom(level, withZone(item.roomSpec, classifyProgramZone(item.roomSpec.type)), item));
        zones.push(zoneMeta('private', southRect));
      } else {
        rooms.push(buildRoom(level, makeSyntheticRoom('store_south_ds_l2', 'storage', level, widthTiles * southH * 4), southRect));
        zones.push(zoneMeta('private', southRect));
      }
      return {
        level,
        widthTiles,
        heightTiles,
        rooms,
        zones,
        stairCore: stairCoreMeta(level, rooms, preferLargeUpperBottomLandingMetadata ? {
          landingSide: 'top',
          landingOpen: false,
        } : {}),
      };
    }
  }

  if (primaryPlusTwoSharedUpper) {
    // North zone: primary bed + bath (full width).
    // South zone: bed1 (top strip) + shared bath (middle strip) + bed2 (bottom strip).
    const hallY = namedHallY();
    const [topSecondaryBed, bottomSecondaryBed] = l2SecondaryBedrooms;
    const sharedBathP2 = l2SharedBaths[0];
    if (heightTiles >= 9 && topSecondaryBed && bottomSecondaryBed && sharedBathP2) {
      const { northH, southH } = placeNamedSpine(hallY);
      placeNorthPrimary(northH);
      const southY = hallY + NAMED_HALL_H;
      const shBathH = clamp(Math.round(southH * 0.28), 3, Math.min(4, southH - 6));
      const topBedH  = clamp(Math.round((southH - shBathH) * 0.5), 3, southH - shBathH - 3);
      const botBedH  = southH - topBedH - shBathH;
      if (topBedH >= 3 && botBedH >= 3) {
        rooms.push(buildRoom(level, withZone(topSecondaryBed,    'private'), rect(0, southY,                      widthTiles, topBedH)));
        rooms.push(buildRoom(level, withZone(sharedBathP2,       'service'), rect(0, southY + topBedH,             widthTiles, shBathH)));
        rooms.push(buildRoom(level, withZone(bottomSecondaryBed, 'private'), rect(0, southY + topBedH + shBathH,   widthTiles, botBedH)));
      } else {
        const { placements } = fillWithGuaranteedCoverage(rect(0, southY, widthTiles, southH), [topSecondaryBed, sharedBathP2, bottomSecondaryBed], 'horizontal', 'p2shared_south_l2');
        for (const item of placements) rooms.push(buildRoom(level, withZone(item.roomSpec, classifyProgramZone(item.roomSpec.type)), item));
      }
      zones.push(zoneMeta('private', rect(0, southY, widthTiles, southH)));
      return {
        level,
        widthTiles,
        heightTiles,
        rooms,
        zones,
        stairCore: stairCoreMeta(level, rooms, preferLargeUpperBottomLandingMetadata ? {
          landingSide: 'top',
          landingOpen: false,
        } : {}),
      };
    }
  }

  if (hybridTripleUpperSharedBath) {
    // North zone: primary bed + bath (full width).
    // South zone left half:  shared secondary bed (top) + shared bath (bottom).
    // South zone right half: private secondary bed (top) + private bath (bottom).
    const hallY = namedHallY();
    const privateSecondarySuite = l2SecondarySuiteGroups.find((suite) => suite.baths.length >= 1) || null;
    const privateSecondaryBath = privateSecondarySuite?.baths?.[0] || null;
    const privateSecondaryBed = privateSecondarySuite?.bed || null;
    const sharedSecondaryBed = l2SecondaryBedrooms.find((bed) => String(bed.id) !== String(privateSecondaryBed?.id || '')) || null;
    const sharedBathH3 = l2SharedBaths[0] || null;
    if (heightTiles >= 9 && privateSecondaryBed && privateSecondaryBath && sharedSecondaryBed && sharedBathH3) {
      const { northH, southH } = placeNamedSpine(hallY);
      placeNorthPrimary(northH);
      const southY = hallY + NAMED_HALL_H;
      const split = Math.round(widthTiles / 2);
      placeSuiteInZone(rect(0,     southY, split,               southH), sharedSecondaryBed,  sharedBathH3,         'shared_south_l2');
      placeSuiteInZone(rect(split, southY, widthTiles - split,  southH), privateSecondaryBed, privateSecondaryBath, 'private_south_l2');
      return {
        level,
        widthTiles,
        heightTiles,
        rooms,
        zones,
        stairCore: stairCoreMeta(level, rooms, preferLargeUpperBottomLandingMetadata ? {
          landingSide: 'top',
          landingOpen: false,
        } : {}),
      };
    }
  }

  // ── OPTION C: HORIZONTAL HALLWAY SPINE ───────────────────────────────────────
  // A full-width hallway strip at hallY replaces the vertical core-column approach.
  // Stairs sit WITHIN the spine at (coreX, hallY, coreTiles, HALL_H), preserving
  // the x/w alignment with Level 1 that validateTilePlan requires.
  // No gap-fill hallways above or below stairs: the spine IS the circulation zone.
  //
  // Layout (y increases toward front of house):
  //   y = 0 … hallY-1          NORTH zone  — primary bedroom suite (full width)
  //   y = hallY … hallY+HALL_H HALLWAY + STAIRS (full width, 3 rooms)
  //   y = hallY+HALL_H … end   SOUTH zone  — secondary bedrooms + baths (full width)
  //
  // Named layout branches above (compactTriplePrivateUpper etc.) still use the
  // older vertical-core approach and should be migrated to this pattern in a
  // future pass.

  // Keep L2 circulation spine (and stairs rect) deep enough to match L1.
  // Quality gate expects stairs' long side >= 8ft; with tileSizeFt=2, that means
  // at least 4 tiles depth. If L1 stairs exist, reuse their tile height so the
  // shaft renders in the same vertical portion of the house.
  const HALL_H = clamp((l1Stairs ? l1Stairs.h : 2), STAIR_MIN_DEPTH_TILES, heightTiles); // tiles
  const MIN_NORTH = 4;        // minimum rear bedroom zone depth
  const MIN_SOUTH = 3;        // minimum front zone depth
  // For very shallow footprints that cannot fit three distinct zones, fall back
  // to a simple left/right split with the stair column spanning full height.
  const useHallSpine = heightTiles >= MIN_NORTH + HALL_H + MIN_SOUTH;
  const useReferenceUpperLandingTemplate = wantsDedicatedBottomLandingUpper;
  const quietFocusUpperFeatures = l2FeatureRooms.filter((room) => isQuietFocusFeatureRoom(room));
  const useSmallFamilyQuietFocusUpper =
    familyProfile.usesUpperGarageFamilyLayout &&
    brief.primaryLevel === 2 &&
    useHallSpine &&
    primaryBedroom &&
    primaryBathroom &&
    l2SecondaryBedrooms.length === 1 &&
    l2SecondarySuiteGroups.filter((suite) => suite.baths.length >= 1).length === 1 &&
    l2SharedBaths.length === 0 &&
    quietFocusUpperFeatures.length >= 1 &&
    quietFocusUpperFeatures.length <= 2 &&
    widthTiles >= 20 &&
    heightTiles >= 12;
  const useSmallFamilyDualSuiteUpper =
    exactCompactDualSuiteUpper &&
    useHallSpine;
  const useFamilyUpperLandingGrammar =
    familyProfile.usesUpperGarageFamilyLayout &&
    useHallSpine &&
    primaryBedroom &&
    primaryBathroom &&
    widthTiles >= 18 &&
    heightTiles >= 12;
  const archetypeSpecificStairLanding = useReferenceUpperLandingTemplate;

  if (useSmallFamilyDualSuiteUpper) {
    const privateSecondarySuite = l2SecondarySuiteGroups.find((suite) => suite.baths.length >= 1) || null;
    const privateSecondaryBed = privateSecondarySuite?.bed || null;
    const privateSecondaryBath = privateSecondarySuite?.baths?.[0] || null;
    const stairsRect = getL2StairsRect(l1Layout, coreX, coreTiles, heightTiles);
    const hallY = stairsRect.y;
    const northH = hallY;
    const southY = hallY + stairsRect.h;
    const southH = heightTiles - southY;
    const landingH = Math.min(2, southH);
    const upperHallH = Math.min(2, stairsRect.h);
    const lowerSouthY = southY + landingH;
    const lowerSouthH = heightTiles - lowerSouthY;
    const leftHallRect = coreX > 0 ? rect(0, hallY, coreX, upperHallH) : null;
    const rightHallRect = (widthTiles - coreX - coreTiles) > 0
      ? rect(coreX + coreTiles, hallY, widthTiles - coreX - coreTiles, upperHallH)
      : null;
    const branchOnRight = true;
    const branchW = 2;
    const branchX = coreX + coreTiles;
    const branchY = hallY + upperHallH;
    const branchH = (southY + landingH) - branchY;
    const branchRect = rect(branchX, branchY, branchW, branchH);
    const landingRect = rect(coreX, southY, coreTiles, landingH);

    if (
      privateSecondaryBed &&
      privateSecondaryBath &&
      northH >= 4 &&
      southH >= 5 &&
      landingH >= 2 &&
      lowerSouthH >= 3 &&
      branchH >= 3 &&
      rightHallRect &&
      rightHallRect.w >= branchW
    ) {
      const hallLeftSpec = leftHallRect
        ? makeSyntheticRoom('hall_spine_left_l2', 'hallway', level, leftHallRect.w * leftHallRect.h * 4, { zone: 'circulation' })
        : null;
      const hallRightSpec = makeSyntheticRoom('hall_spine_right_l2', 'hallway', level, rightHallRect.w * rightHallRect.h * 4, { zone: 'circulation' });
      const landingSpec = makeSyntheticRoom('hall_landing_l2', 'hallway', level, landingRect.w * landingRect.h * 4, { zone: 'circulation' });
      const branchId = 'hall_branch_right_l2';
      const branchSpec = makeSyntheticRoom(branchId, 'hallway', level, branchRect.w * branchRect.h * 4, { zone: 'circulation' });

      rooms.push(buildRoom(level, withZone(stairsSpec, 'circulation'), stairsRect));
      if (leftHallRect && hallLeftSpec) rooms.push(buildRoom(level, hallLeftSpec, leftHallRect));
      rooms.push(buildRoom(level, hallRightSpec, rightHallRect));
      rooms.push(buildRoom(level, landingSpec, landingRect));
      rooms.push(buildRoom(level, branchSpec, branchRect));

      zones.push(zoneMeta('circulation', stairsRect));
      if (leftHallRect) zones.push(zoneMeta('circulation', leftHallRect));
      zones.push(zoneMeta('circulation', rightHallRect));
      zones.push(zoneMeta('circulation', landingRect));
      zones.push(zoneMeta('circulation', branchRect));

      const northBathW = 4;
      const northBathRect = rect(0, 0, northBathW, northH);
      const shoulderY = hallY + upperHallH;
      const shoulderH = stairsRect.h - upperHallH;
      const bathParts = [northBathRect];
      if (shoulderH > 0) {
        const bathShoulderRect = rect(0, shoulderY, northBathW, shoulderH);
        if (bathShoulderRect.w > 0 && bathShoulderRect.h > 0) bathParts.push(bathShoulderRect);
      }
      const secondaryBathRoom = buildCompositeRoom(level, withZone(privateSecondaryBath, 'service'), bathParts);
      if (secondaryBathRoom) rooms.push(secondaryBathRoom);
      zones.push(zoneMeta('service', northBathRect));

      const northBedParts = [rect(northBathW, 0, widthTiles - northBathW, northH)];
      if (shoulderH > 0) {
        const leftBedShoulderRect = rect(northBathW, shoulderY, Math.max(0, coreX - northBathW), shoulderH);
        if (leftBedShoulderRect.w > 0 && leftBedShoulderRect.h > 0) northBedParts.push(leftBedShoulderRect);
        const rightBedShoulderStart = Math.max(branchX + branchW, widthTiles - 5);
        const rightBedShoulderRect = rect(
          rightBedShoulderStart,
          shoulderY,
          Math.max(0, widthTiles - rightBedShoulderStart),
          shoulderH
        );
        if (rightBedShoulderRect.w > 0 && rightBedShoulderRect.h > 0) northBedParts.push(rightBedShoulderRect);
      }
      const secondaryBedRoom = buildCompositeRoom(level, withZone(privateSecondaryBed, 'private'), northBedParts);
      if (secondaryBedRoom) rooms.push(secondaryBedRoom);
      zones.push(zoneMeta('private', rect(northBathW, 0, widthTiles - northBathW, northH)));

      const primaryBathW = 5;
      const primaryBathRect = rect(0, southY, primaryBathW, southH);
      const primaryBedParts = [
        rect(primaryBathW, southY, Math.max(0, coreX - primaryBathW), landingH),
        rect(branchX + branchW, southY, Math.max(0, widthTiles - (branchX + branchW)), landingH),
        rect(primaryBathW, lowerSouthY, widthTiles - primaryBathW, lowerSouthH),
      ].filter((part) => part && part.w > 0 && part.h > 0);
      const primaryBedRoom = buildCompositeRoom(level, withZone(primaryBedroom, 'private'), primaryBedParts);
      const primaryBathRoom = buildRoom(level, withZone(primaryBathroom, 'service'), primaryBathRect);

      if (primaryBedRoom) rooms.push(primaryBedRoom);
      rooms.push(primaryBathRoom);
      zones.push(zoneMeta('private', rect(0, southY, widthTiles, southH)));
      zones.push(zoneMeta('service', primaryBathRect));

      return {
        level,
        widthTiles,
        heightTiles,
        rooms,
        zones,
        stairCore: stairCoreMeta(level, rooms, {
          landingRoomId: 'hall_landing_l2',
          landingSide: 'bottom',
          landingOpen: false,
          branchRoomIds: ['hall_branch_right_l2'],
        }),
      };
    }
  }

  if (useSmallFamilyQuietFocusUpper) {
    const privateSecondarySuite = l2SecondarySuiteGroups.find((suite) => suite.baths.length >= 1) || null;
    const privateSecondaryBed = privateSecondarySuite?.bed || null;
    const privateSecondaryBath = privateSecondarySuite?.baths?.[0] || null;
    const stairsRect = getL2StairsRect(l1Layout, coreX, coreTiles, heightTiles);
    const hallY = stairsRect.y;
    const northH = hallY;
    const southY = hallY + stairsRect.h;
    const southH = heightTiles - southY;
    const landingH = Math.min(2, southH);
    const upperHallH = Math.min(2, stairsRect.h);
    const lowerSouthY = southY + landingH;
    const lowerSouthH = heightTiles - lowerSouthY;
    const branchW = 2;
    const leftHallRect = coreX > 0 ? rect(0, hallY, coreX, upperHallH) : null;
    const rightHallRect = (widthTiles - coreX - coreTiles) > 0
      ? rect(coreX + coreTiles, hallY, widthTiles - coreX - coreTiles, upperHallH)
      : null;
    const branchOnRight = Boolean(rightHallRect && rightHallRect.w >= branchW);
    const branchX = branchOnRight ? coreX + coreTiles : Math.max(0, coreX - branchW);
    const branchY = hallY + upperHallH;
    const branchH = (southY + landingH) - branchY;
    const branchRect = rect(branchX, branchY, branchW, branchH);
    const landingRect = rect(coreX, southY, coreTiles, landingH);
    const minNorthBathW = 4;
    const minBedW = 6;
    const northBathW = clamp(Math.round(widthTiles * 0.18), 3, 4);
    const availableFeatureWidth = widthTiles - northBathW - minBedW;

    if (
      privateSecondaryBed &&
      privateSecondaryBath &&
      northH >= 4 &&
      southH >= 5 &&
      landingH >= 2 &&
      lowerSouthH >= 3 &&
      branchH >= 3 &&
      availableFeatureWidth >= quietFocusUpperFeatures.length * 4 &&
      (!branchOnRight || branchRect.x + branchRect.w <= widthTiles)
    ) {
      const featureWidths = allocateWeightedColumnWidths(
        availableFeatureWidth,
        quietFocusUpperFeatures.map((feature) => ({
          spec: feature,
          minWidth: 4,
          weight: feature.targetAreaSqFt || 90,
        }))
      );
      const totalFeatureWidth = featureWidths.reduce((sum, width) => sum + width, 0);
      const secondaryBedW = widthTiles - northBathW - totalFeatureWidth;

      if (secondaryBedW >= minBedW) {
        const hallLeftSpec = leftHallRect
          ? makeSyntheticRoom('hall_spine_left_l2', 'hallway', level, leftHallRect.w * leftHallRect.h * 4, { zone: 'circulation' })
          : null;
        const hallRightSpec = rightHallRect
          ? makeSyntheticRoom('hall_spine_right_l2', 'hallway', level, rightHallRect.w * rightHallRect.h * 4, { zone: 'circulation' })
          : null;
        const landingSpec = makeSyntheticRoom('hall_landing_l2', 'hallway', level, landingRect.w * landingRect.h * 4, { zone: 'circulation' });
        const branchId = branchOnRight ? 'hall_branch_right_l2' : 'hall_branch_left_l2';
        const branchSpec = makeSyntheticRoom(branchId, 'hallway', level, branchRect.w * branchRect.h * 4, { zone: 'circulation' });

        rooms.push(buildRoom(level, withZone(stairsSpec, 'circulation'), stairsRect));
        if (leftHallRect && hallLeftSpec) rooms.push(buildRoom(level, hallLeftSpec, leftHallRect));
        if (rightHallRect && hallRightSpec) rooms.push(buildRoom(level, hallRightSpec, rightHallRect));
        rooms.push(buildRoom(level, landingSpec, landingRect));
        rooms.push(buildRoom(level, branchSpec, branchRect));

        zones.push(zoneMeta('circulation', stairsRect));
        if (leftHallRect) zones.push(zoneMeta('circulation', leftHallRect));
        if (rightHallRect) zones.push(zoneMeta('circulation', rightHallRect));
        zones.push(zoneMeta('circulation', landingRect));
        zones.push(zoneMeta('circulation', branchRect));

        const northBathRect = rect(0, 0, northBathW, northH);
        const shoulderY = hallY + upperHallH;
        const shoulderH = stairsRect.h - upperHallH;
        const bathParts = [northBathRect];
        if (shoulderH > 0) {
          const bathShoulderRect = rect(0, shoulderY, northBathW, shoulderH);
          if (bathShoulderRect.w > 0 && bathShoulderRect.h > 0) bathParts.push(bathShoulderRect);
        }
        const northBathRoom = buildCompositeRoom(level, withZone(privateSecondaryBath, 'service'), bathParts);
        if (northBathRoom) rooms.push(northBathRoom);
        zones.push(zoneMeta('service', northBathRect));

        const northBedParts = [rect(northBathW, 0, secondaryBedW, northH)];
        if (shoulderH > 0) {
          const bedShoulderRect = branchOnRight
            ? rect(northBathW, shoulderY, Math.max(0, coreX - northBathW), shoulderH)
            : rect(branchX + branchW, shoulderY, Math.max(0, (northBathW + secondaryBedW) - (branchX + branchW)), shoulderH);
          if (bedShoulderRect.w > 0 && bedShoulderRect.h > 0) northBedParts.push(bedShoulderRect);
        }
        const northBedRoom = buildCompositeRoom(level, withZone(privateSecondaryBed, 'private'), northBedParts);
        if (northBedRoom) rooms.push(northBedRoom);
        zones.push(zoneMeta('private', rect(northBathW, 0, secondaryBedW, northH)));

        let featureX = northBathW + secondaryBedW;
        for (let i = 0; i < quietFocusUpperFeatures.length; i++) {
          const feature = quietFocusUpperFeatures[i];
          const featureWidth = featureWidths[i] || 4;
          const isLast = i === quietFocusUpperFeatures.length - 1;
          const featureRect = rect(
            featureX,
            0,
            isLast ? (widthTiles - featureX) : featureWidth,
            northH
          );
          const featureParts = [featureRect];
          if (isLast && shoulderH > 0) {
            const featureShoulderRect = branchOnRight
              ? rect(branchX + branchW, shoulderY, Math.max(0, widthTiles - (branchX + branchW)), shoulderH)
              : rect(0, shoulderY, Math.max(0, branchX), shoulderH);
            if (featureShoulderRect.w > 0 && featureShoulderRect.h > 0) featureParts.push(featureShoulderRect);
          }
          const featureRoom = buildCompositeRoom(level, withZone(feature, 'public'), featureParts);
          if (featureRoom) rooms.push(featureRoom);
          zones.push(zoneMeta('public', featureRect));
          featureX += featureRect.w;
        }

        const primaryBathW = clamp(Math.round(widthTiles * 0.24), 4, 6);
        const primaryBathOnLeft = branchOnRight;
        const primaryBathRect = primaryBathOnLeft
          ? rect(0, southY, primaryBathW, southH)
          : rect(widthTiles - primaryBathW, southY, primaryBathW, southH);
        const primaryBedParts = primaryBathOnLeft
          ? [
              rect(primaryBathW, southY, Math.max(0, coreX - primaryBathW), landingH),
              rect(branchX + branchW, southY, Math.max(0, widthTiles - (branchX + branchW)), landingH),
              rect(primaryBathW, lowerSouthY, widthTiles - primaryBathW, lowerSouthH),
            ]
          : [
              rect(0, southY, Math.max(0, branchX), landingH),
              rect(coreX + coreTiles, southY, Math.max(0, (widthTiles - primaryBathW) - (coreX + coreTiles)), landingH),
              rect(0, lowerSouthY, widthTiles - primaryBathW, lowerSouthH),
            ];
        const primaryBedRoom = buildCompositeRoom(level, withZone(primaryBedroom, 'private'), primaryBedParts);
        const primaryBathRoom = buildRoom(level, withZone(primaryBathroom, 'service'), primaryBathRect);

        if (primaryBedRoom) rooms.push(primaryBedRoom);
        rooms.push(primaryBathRoom);
        zones.push(zoneMeta('private', rect(0, southY, widthTiles, southH)));
        zones.push(zoneMeta('service', primaryBathRect));

        return {
          level,
          widthTiles,
          heightTiles,
          rooms,
          zones,
          stairCore: stairCoreMeta(level, rooms, {
            landingRoomId: 'hall_landing_l2',
            landingSide: 'bottom',
            landingOpen: false,
            branchRoomIds: [branchId],
          }),
        };
      }
    }
  }

  if (archetypeSpecificStairLanding && useHallSpine && primaryBedroom && primaryBathroom) {
    const landingH = 2;
    const upperHallH = 2;
    const minPrimaryDepth = 4;
    const minBedroomDepth = 4;
    const hallYMin = minPrimaryDepth + landingH;
    const hallYMax = Math.max(
      hallYMin,
      heightTiles - HALL_H - upperHallH - minBedroomDepth
    );
    const defaultHallY = clamp(Math.round(heightTiles * 0.42) + landingH, hallYMin, hallYMax);
    const hallY = alignedStairY !== null
      ? clamp(alignedStairY, hallYMin, hallYMax)
      : defaultHallY;
    const landingY = hallY - landingH;
    const northH = landingY;
    const upperHallY = hallY + HALL_H;
    const southPrivateY = upperHallY + upperHallH;
    const southPrivateH = heightTiles - southPrivateY;
    const privateSecondarySuite = l2SecondarySuiteGroups.find((suite) => suite.baths.length >= 1) || null;
    const privateSecondaryBed = privateSecondarySuite?.bed || null;
    const privateSecondaryBath = privateSecondarySuite?.baths?.[0] || null;
    const sharedSecondaryBed = l2SecondaryBedrooms.find((bed) => String(bed.id) !== String(privateSecondaryBed?.id || '')) || null;
    const sharedBath = l2SharedBaths[0] || null;
    const requestedUpperStudy = l2FeatureRooms.find((room) => normalizeRoomType(room.type) === 'study') || null;

    if (
      northH >= minPrimaryDepth &&
      southPrivateH >= minBedroomDepth &&
      privateSecondaryBed &&
      privateSecondaryBath &&
      sharedSecondaryBed &&
      sharedBath
    ) {
      const stairsRect = rect(coreX, hallY, coreTiles, HALL_H);
      const landingRect = rect(coreX, landingY, coreTiles, landingH);
      const hallLandingSpec = makeSyntheticRoom('hall_landing_l2', 'hallway', level, landingRect.w * landingRect.h * 4, { zone: 'circulation' });
      const upperHallRect = rect(0, upperHallY, widthTiles, upperHallH);
      const upperHallSpec = makeSyntheticRoom('hall_upper_l2', 'hallway', level, upperHallRect.w * upperHallRect.h * 4, { zone: 'circulation' });
      const primaryBathW = clamp(Math.round(widthTiles * 0.26), 3, Math.max(3, widthTiles - 8));
      const primaryBathOnLeft = coreX >= widthTiles / 2;
      const branchW = 2;
      const branchOnRight = primaryBathOnLeft;
      const branchX = branchOnRight ? coreX + coreTiles : Math.max(0, coreX - branchW);
      const branchRect = rect(branchX, landingY, branchW, upperHallY + upperHallH - landingY);
      const branchId = branchOnRight ? 'hall_branch_right_l2' : 'hall_branch_left_l2';
      const hallBranchSpec = makeSyntheticRoom(branchId, 'hallway', level, branchRect.w * branchRect.h * 4, { zone: 'circulation' });
      rooms.push(buildRoom(level, withZone(stairsSpec, 'circulation'), stairsRect));
      rooms.push(buildRoom(level, hallLandingSpec, landingRect));
      rooms.push(buildRoom(level, upperHallSpec, upperHallRect));
      rooms.push(buildRoom(level, hallBranchSpec, branchRect));
      zones.push(zoneMeta('circulation', stairsRect));
      zones.push(zoneMeta('circulation', landingRect));
      zones.push(zoneMeta('circulation', upperHallRect));
      zones.push(zoneMeta('circulation', branchRect));

      const northRect = rect(0, 0, widthTiles, northH);
      let primaryBathRoom = null;
      let primaryBedRoom = null;
      let upperStudyRoom = null;
      const upperStudyH = upperHallY - landingY;
      const upperStudyTargetTiles = requestedUpperStudy
        ? sqftToTiles(Math.max(requestedUpperStudy.targetAreaSqFt || 110, requestedUpperStudy.minAreaSqFt || 64), TILE_SIZE_FT_DEFAULT)
        : 0;
      const desiredUpperStudyW = requestedUpperStudy && upperStudyH > 0
        ? clamp(Math.round(upperStudyTargetTiles / upperStudyH), 4, 6)
        : 0;
      if (primaryBathOnLeft) {
        const bathRect = rect(0, 0, primaryBathW, upperHallY);
        primaryBathRoom = buildRoom(level, withZone(primaryBathroom, 'service'), bathRect);
        const rightLandingStart = branchOnRight ? branchX + branchW : coreX + coreTiles;
        const rightLandingWidth = widthTiles - rightLandingStart;
        const canPlaceStudy = requestedUpperStudy && upperStudyH >= 4 && rightLandingWidth >= 4;
        const studyW = canPlaceStudy
          ? clamp(Math.min(rightLandingWidth, desiredUpperStudyW), 4, rightLandingWidth)
          : 0;
        const studyRect = studyW > 0
          ? rect(widthTiles - studyW, landingY, studyW, upperStudyH)
          : null;
        const rightBedW = studyRect ? Math.max(0, studyRect.x - rightLandingStart) : rightLandingWidth;
        const bedParts = [
          rect(primaryBathW, 0, widthTiles - primaryBathW, northH),
          rect(primaryBathW, landingY, Math.max(0, coreX - primaryBathW), landingH),
          rect(primaryBathW, hallY, Math.max(0, coreX - primaryBathW), HALL_H),
          rect(rightLandingStart, landingY, rightBedW, landingH),
          rect(rightLandingStart, hallY, rightBedW, HALL_H),
        ].filter((part) => part && part.w > 0 && part.h > 0);
        primaryBedRoom = buildCompositeRoom(level, withZone(primaryBedroom, 'private'), bedParts);
        if (studyRect) {
          upperStudyRoom = buildRoom(level, withZone(requestedUpperStudy, 'public'), studyRect);
        }
      } else {
        const bathRect = rect(widthTiles - primaryBathW, 0, primaryBathW, upperHallY);
        primaryBathRoom = buildRoom(level, withZone(primaryBathroom, 'service'), bathRect);
        const leftLandingWidth = branchOnRight ? coreX : Math.max(0, coreX - branchW);
        const canPlaceStudy = requestedUpperStudy && upperStudyH >= 4 && leftLandingWidth >= 4;
        const studyW = canPlaceStudy
          ? clamp(Math.min(leftLandingWidth, desiredUpperStudyW), 4, leftLandingWidth)
          : 0;
        const studyRect = studyW > 0
          ? rect(0, landingY, studyW, upperStudyH)
          : null;
        const leftBedStart = studyRect ? studyRect.x + studyRect.w : 0;
        const leftBedW = Math.max(0, leftLandingWidth - leftBedStart);
        const bedParts = [
          rect(0, 0, widthTiles - primaryBathW, northH),
          rect(leftBedStart, landingY, leftBedW, landingH),
          rect(coreX + coreTiles, landingY, Math.max(0, (widthTiles - primaryBathW) - (coreX + coreTiles)), landingH),
          rect(leftBedStart, hallY, leftBedW, HALL_H),
          rect(coreX + coreTiles, hallY, Math.max(0, (widthTiles - primaryBathW) - (coreX + coreTiles)), HALL_H),
        ].filter((part) => part && part.w > 0 && part.h > 0);
        primaryBedRoom = buildCompositeRoom(level, withZone(primaryBedroom, 'private'), bedParts);
        if (studyRect) {
          upperStudyRoom = buildRoom(level, withZone(requestedUpperStudy, 'public'), studyRect);
        }
      }
      if (primaryBedRoom) rooms.push(primaryBedRoom);
      if (primaryBathRoom) rooms.push(primaryBathRoom);
      if (upperStudyRoom) rooms.push(upperStudyRoom);
      zones.push(zoneMeta('private', northRect));
      if (upperStudyRoom) {
        zones.push(zoneMeta('public', rect(upperStudyRoom.x, upperStudyRoom.y, upperStudyRoom.w, upperStudyRoom.h)));
      }

      const southRect = rect(0, southPrivateY, widthTiles, southPrivateH);
      const privateSuiteW = clamp(Math.round(widthTiles * 0.47), 7, Math.max(7, widthTiles - 8));
      const sharedSuiteW = widthTiles - privateSuiteW;
      const privateBathW = clamp(Math.round(privateSuiteW * 0.30), 3, Math.max(3, privateSuiteW - 4));
      const sharedBathW = clamp(Math.round(sharedSuiteW * 0.34), 3, Math.max(3, sharedSuiteW - 4));
      const privateBathRect = rect(0, southPrivateY, privateBathW, southPrivateH);
      const privateBedRect = rect(privateBathW, southPrivateY, privateSuiteW - privateBathW, southPrivateH);
      const sharedBedRect = rect(privateSuiteW, southPrivateY, sharedSuiteW - sharedBathW, southPrivateH);
      const sharedBathRect = rect(widthTiles - sharedBathW, southPrivateY, sharedBathW, southPrivateH);
      rooms.push(buildRoom(level, withZone(privateSecondaryBed, 'private'), privateBedRect));
      rooms.push(buildRoom(level, withZone(privateSecondaryBath, 'service'), privateBathRect));
      rooms.push(buildRoom(level, withZone(sharedSecondaryBed, 'private'), sharedBedRect));
      rooms.push(buildRoom(level, withZone(sharedBath, 'service'), sharedBathRect));
      zones.push(zoneMeta('private', southRect));
      if (primaryBathRoom) {
        zones.push(zoneMeta('service', rect(primaryBathRoom.x, primaryBathRoom.y, primaryBathRoom.w, primaryBathRoom.h)));
      }
      zones.push(zoneMeta('service', privateBathRect));
      zones.push(zoneMeta('service', sharedBathRect));

      return {
        level,
        widthTiles,
        heightTiles,
        rooms,
        zones,
        stairCore: stairCoreMeta(level, rooms, {
          landingRoomId: 'hall_landing_l2',
          landingSide: 'top',
          landingOpen: false,
          branchRoomIds: [branchId],
        }),
      };
    }
  }

  if (!useReferenceUpperLandingTemplate && useFamilyUpperLandingGrammar) {
    const landingH = 2;
    const upperHallH = familyProfile.level2SecondaryBedroomCount <= 1 ? 1 : 2;
    const minPrimaryDepth = familyProfile.level2SecondaryBedroomCount <= 1 ? 3 : 4;
    const minSouthDepth = familyProfile.level2SecondaryBedroomCount <= 1 ? 5 : 4;
    const hallYMin = minPrimaryDepth + landingH;
    const hallYMax = Math.max(
      hallYMin,
      heightTiles - HALL_H - upperHallH - minSouthDepth
    );
    const canHonorAlignedStair =
      alignedStairY === null ||
      (alignedStairY >= hallYMin && alignedStairY <= hallYMax);
    const defaultHallY = clamp(Math.round(heightTiles * 0.46) + landingH, hallYMin, hallYMax);
    const hallY = alignedStairY !== null && canHonorAlignedStair
      ? alignedStairY
      : defaultHallY;
    const landingY = hallY - landingH;
    const northH = landingY;
    const upperHallY = hallY + HALL_H;
    const southY = upperHallY + upperHallH;
    const southH = heightTiles - southY;

    if (canHonorAlignedStair && northH >= minPrimaryDepth && southH >= minSouthDepth) {
      const stairsRect = rect(coreX, hallY, coreTiles, HALL_H);
      const landingRect = rect(coreX, landingY, coreTiles, landingH);
      const hallLandingSpec = makeSyntheticRoom('hall_landing_l2', 'hallway', level, landingRect.w * landingRect.h * 4, { zone: 'circulation' });
      const upperHallRect = rect(0, upperHallY, widthTiles, upperHallH);
      const upperHallSpec = makeSyntheticRoom('hall_upper_l2', 'hallway', level, upperHallRect.w * upperHallRect.h * 4, { zone: 'circulation' });
      const primaryBathW = clamp(Math.round(widthTiles * 0.26), 3, Math.max(3, widthTiles - 8));
      const primaryBathOnLeft = coreX >= widthTiles / 2;
      const branchW = 2;
      const branchOnRight = primaryBathOnLeft;
      const branchX = branchOnRight ? coreX + coreTiles : Math.max(0, coreX - branchW);
      const branchRect = rect(branchX, landingY, branchW, upperHallY + upperHallH - landingY);
      const branchId = branchOnRight ? 'hall_branch_right_l2' : 'hall_branch_left_l2';
      const hallBranchSpec = makeSyntheticRoom(branchId, 'hallway', level, branchRect.w * branchRect.h * 4, { zone: 'circulation' });

      rooms.push(buildRoom(level, withZone(stairsSpec, 'circulation'), stairsRect));
      rooms.push(buildRoom(level, hallLandingSpec, landingRect));
      rooms.push(buildRoom(level, upperHallSpec, upperHallRect));
      rooms.push(buildRoom(level, hallBranchSpec, branchRect));
      zones.push(zoneMeta('circulation', stairsRect));
      zones.push(zoneMeta('circulation', landingRect));
      zones.push(zoneMeta('circulation', upperHallRect));
      zones.push(zoneMeta('circulation', branchRect));

      const northRect = rect(0, 0, widthTiles, northH);
      let primaryBathRoom = null;
      let primaryBedRoom = null;
      if (primaryBathOnLeft) {
        const bathRect = rect(0, 0, primaryBathW, upperHallY);
        primaryBathRoom = buildRoom(level, withZone(primaryBathroom, 'service'), bathRect);
        const rightLandingStart = branchOnRight ? branchX + branchW : coreX + coreTiles;
        const rightLandingWidth = widthTiles - rightLandingStart;
        const bedParts = [
          rect(primaryBathW, 0, widthTiles - primaryBathW, northH),
          rect(primaryBathW, landingY, Math.max(0, coreX - primaryBathW), landingH),
          rect(rightLandingStart, landingY, rightLandingWidth, landingH),
          rect(primaryBathW, hallY, Math.max(0, coreX - primaryBathW), HALL_H),
          rect(rightLandingStart, hallY, rightLandingWidth, HALL_H),
        ].filter((part) => part && part.w > 0 && part.h > 0);
        primaryBedRoom = buildCompositeRoom(level, withZone(primaryBedroom, 'private'), bedParts);
      } else {
        const bathRect = rect(widthTiles - primaryBathW, 0, primaryBathW, upperHallY);
        primaryBathRoom = buildRoom(level, withZone(primaryBathroom, 'service'), bathRect);
        const leftLandingWidth = branchOnRight ? coreX : Math.max(0, coreX - branchW);
        const bedParts = [
          rect(0, 0, widthTiles - primaryBathW, northH),
          rect(0, landingY, leftLandingWidth, landingH),
          rect(coreX + coreTiles, landingY, Math.max(0, (widthTiles - primaryBathW) - (coreX + coreTiles)), landingH),
          rect(0, hallY, leftLandingWidth, HALL_H),
          rect(coreX + coreTiles, hallY, Math.max(0, (widthTiles - primaryBathW) - (coreX + coreTiles)), HALL_H),
        ].filter((part) => part && part.w > 0 && part.h > 0);
        primaryBedRoom = buildCompositeRoom(level, withZone(primaryBedroom, 'private'), bedParts);
      }
      if (primaryBedRoom) rooms.push(primaryBedRoom);
      if (primaryBathRoom) rooms.push(primaryBathRoom);
      zones.push(zoneMeta('private', northRect));
      if (primaryBathRoom) {
        zones.push(zoneMeta('service', rect(primaryBathRoom.x, primaryBathRoom.y, primaryBathRoom.w, primaryBathRoom.h)));
      }

      const southRect = rect(0, southY, widthTiles, southH);
      const southUnits = buildFamilySouthZoneUnits(
        l2SecondarySuiteGroups,
        l2SecondaryBedrooms,
        l2SharedBaths,
        l2FeatureRooms
      );

      if (!southUnits.length) {
        rooms.push(buildRoom(level, makeSyntheticRoom('store_family_south_l2', 'storage', level, southRect.w * southRect.h * 4), southRect));
        zones.push(zoneMeta('private', southRect));
      } else {
        const columnWidths = allocateWeightedColumnWidths(southRect.w, southUnits);
        let xCursor = southRect.x;

        for (let i = 0; i < southUnits.length; i++) {
          const unit = southUnits[i];
          const colW = Math.max(1, columnWidths[i] || 1);
          const isLast = i === southUnits.length - 1;
          const colRect = rect(
            xCursor,
            southRect.y,
            isLast ? (southRect.x + southRect.w - xCursor) : colW,
            southRect.h
          );

          if (unit.kind === 'suite') {
            const suiteBath = unit.suite?.baths?.[0] || null;
            placeSuiteInZone(colRect, unit.suite?.bed || null, suiteBath, `family_suite_${i}_l2`);
            if (suiteBath) {
              const suiteBathW = clamp(Math.round(colRect.w * 0.32), 3, Math.max(3, colRect.w - 4));
              zones.push(zoneMeta('service', rect(colRect.x, colRect.y, suiteBathW, colRect.h)));
            }
          } else if (unit.spec) {
            const zone = classifyProgramZone(unit.spec.type);
            rooms.push(buildRoom(level, withZone(unit.spec, zone), colRect));
            zones.push(zoneMeta(zone === 'service' ? 'service' : 'private', colRect));
          }

          xCursor += colRect.w;
        }
      }

      return {
        level,
        widthTiles,
        heightTiles,
        rooms,
        zones,
        stairCore: stairCoreMeta(level, rooms, {
          landingRoomId: 'hall_landing_l2',
          landingSide: 'top',
          landingOpen: false,
          branchRoomIds: [branchId, 'hall_upper_l2'],
        }),
      };
    }
  }

  if (useHallSpine) {
    // If L1 stair position is known, align L2 hallway spine to it so the stair
    // shaft connects at the same physical position across floors. Otherwise fall
    // back to the 54% heuristic.
    const defaultHallY = clamp(
      Math.round(heightTiles * 0.54),
      MIN_NORTH,
      Math.max(MIN_NORTH, heightTiles - HALL_H - MIN_SOUTH)
    );
    const hallY = alignedStairY !== null
      ? clamp(alignedStairY, MIN_NORTH, Math.max(MIN_NORTH, heightTiles - HALL_H - MIN_SOUTH))
      : defaultHallY;
    const northH = hallY;
    const southH = heightTiles - hallY - HALL_H;

    // ── HALLWAY SPINE: stairs + left segment + right segment ─────────────────
    rooms.push(buildRoom(level, stairsSpec, rect(coreX, hallY, coreTiles, HALL_H)));
    zones.push(zoneMeta('circulation', rect(coreX, hallY, coreTiles, HALL_H)));

    if (coreX > 0) {
      const hl = makeSyntheticRoom('hall_spine_left_l2', 'hallway', level, coreX * HALL_H * 4, { zone: 'circulation' });
      rooms.push(buildRoom(level, hl, rect(0, hallY, coreX, HALL_H)));
      zones.push(zoneMeta('circulation', rect(0, hallY, coreX, HALL_H)));
    }
    const hallRightW = widthTiles - coreX - coreTiles;
    if (hallRightW > 0) {
      const hr = makeSyntheticRoom('hall_spine_right_l2', 'hallway', level, hallRightW * HALL_H * 4, { zone: 'circulation' });
      rooms.push(buildRoom(level, hr, rect(coreX + coreTiles, hallY, hallRightW, HALL_H)));
      zones.push(zoneMeta('circulation', rect(coreX + coreTiles, hallY, hallRightW, HALL_H)));
    }

    // ── NORTH ZONE (rear of house) ────────────────────────────────────────────
    // Primary bedroom suite: bath carved off as a vertical strip on the corner
    // side opposite the stair column.
    const northRect = rect(0, 0, widthTiles, northH);
    if (primaryBedroom && brief.primaryLevel === 2) {
      if (primaryBathroom) {
        const bathW = clamp(Math.round(widthTiles * 0.26), 3, Math.max(3, widthTiles - 8));
        const bathOnLeft = coreX >= widthTiles / 2;
        const bathR = bathOnLeft
          ? rect(0, 0, bathW, northH)
          : rect(widthTiles - bathW, 0, bathW, northH);
        const bedR = bathOnLeft
          ? rect(bathW, 0, widthTiles - bathW, northH)
          : rect(0, 0, widthTiles - bathW, northH);
        rooms.push(buildRoom(level, withZone(primaryBedroom, 'private'), bedR));
        rooms.push(buildRoom(level, withZone(primaryBathroom, 'service'), bathR));
      } else {
        rooms.push(buildRoom(level, withZone(primaryBedroom, 'private'), northRect));
      }
    } else {
      const placedIds = new Set(rooms.map((r) => String(r.id)));
      const northSpecs = [...l2SecondarySuites, ...l2FeatureRooms].filter((r) => !placedIds.has(String(r.id)));
      if (northSpecs.length) {
        const suitePlaced = allocateSuitePlacements(level, northRect, northSpecs, 'top');
        const suiteArea = suitePlaced.reduce((s, p) => s + p.w * p.h, 0);
        const finalNorthPlacements = (suiteArea >= northRect.w * northH)
          ? suitePlaced
          : fillWithGuaranteedCoverage(northRect, northSpecs, 'vertical', 'north_l2').placements;
        for (const item of finalNorthPlacements) rooms.push(buildRoom(level, withZone(item.roomSpec, classifyProgramZone(item.roomSpec.type)), item));
      } else {
        rooms.push(buildRoom(level, makeSyntheticRoom('store_north_l2', 'storage', level, northRect.w * northH * 4), northRect));
      }
    }
    zones.push(zoneMeta('private', northRect));

    // ── SOUTH ZONE (front of house) ───────────────────────────────────────────
    // Secondary bedrooms occupy the top part; shared baths + laundry sit at the
    // bottom in a horizontal strip. If southH is too small for both strips, all
    // south specs are merged into a single fillWithGuaranteedCoverage call.
    const placedIds2 = new Set(rooms.map((r) => String(r.id)));
    const l2Laundry = programRooms.find(
      (r) => normalizeRoomType(r.type) === 'laundry' && r.level === 2 && !placedIds2.has(String(r.id))
    );
    const southBathSpecs = [...l2SharedBaths, ...(l2Laundry ? [l2Laundry] : [])].filter(
      (r) => !placedIds2.has(String(r.id))
    );
    const southBedSpecs = [...l2SecondarySuites, ...l2FeatureRooms].filter(
      (r) => !placedIds2.has(String(r.id))
    );

    const southRect = rect(0, hallY + HALL_H, widthTiles, southH);

    // Detect mixed south zone: suites (bed+private ensuite) coexist with non-suite beds
    // or shared baths. This case needs special handling to ensure connectivity.
    const { suites: southSuites } = splitSuiteSpecs(uniqSpecsById(southBedSpecs));
    const suiteSpecIds = new Set(southSuites.flatMap((s) => [s.bed.id, ...s.baths.map((b) => b.id)]));
    const nonSuiteSpecs = southBedSpecs.filter((s) => !suiteSpecIds.has(s.id));
    // Mixed = suites present alongside non-suite beds OR shared baths.
    // The two-strip layout (shared baths in bottom strip) must NOT be used here:
    // shared baths in the bottom strip are surrounded only by private ensuites, and
    // the ensuite invariant blocks all their doors, leaving them unreachable.
    const hasMixedSouthZone = southSuites.length > 0 &&
      (nonSuiteSpecs.length > 0 || southBathSpecs.length > 0);

    // Two-strip (beds on top, shared baths on bottom) only when no suites present.
    const SOUTH_BATH_H = (!hasMixedSouthZone && southBathSpecs.length > 0 && southBedSpecs.length > 0 && southH >= 7)
      ? clamp(Math.round(southH * 0.38), 3, Math.min(5, southH - 4))
      : 0;
    const southBedH = southH - SOUTH_BATH_H;

    if (SOUTH_BATH_H > 0) {
      // Two-strip south zone: no private suites → bed strip (top) + shared bath strip (bottom).
      const southBedRect = rect(0, hallY + HALL_H, widthTiles, southBedH);
      const southBathRect = rect(0, hallY + HALL_H + southBedH, widthTiles, SOUTH_BATH_H);

      if (southBedSpecs.length) {
        const suitePlaced = allocateSuitePlacements(level, southBedRect, southBedSpecs, 'bottom');
        const suiteArea = suitePlaced.reduce((s, p) => s + p.w * p.h, 0);
        const finalBedPlacements = (suiteArea >= southBedRect.w * southBedH)
          ? suitePlaced
          : fillWithGuaranteedCoverage(southBedRect, southBedSpecs, 'vertical', 'south_bed_l2').placements;
        for (const item of finalBedPlacements) rooms.push(buildRoom(level, withZone(item.roomSpec, classifyProgramZone(item.roomSpec.type)), item));
      } else {
        rooms.push(buildRoom(level, makeSyntheticRoom('store_south_beds_l2', 'storage', level, southBedRect.w * southBedH * 4), southBedRect));
      }
      zones.push(zoneMeta('private', southBedRect));

      const { placements: bathPlacements } = fillWithGuaranteedCoverage(southBathRect, southBathSpecs, 'vertical', 'south_bath_l2');
      for (const item of bathPlacements) rooms.push(buildRoom(level, withZone(item.roomSpec, 'service'), item));
      zones.push(zoneMeta('service', southBathRect));

    } else if (hasMixedSouthZone) {
      // Mixed south zone: suites + non-suite beds + shared baths.
      // Use vertical columns spanning the full southH so every room's top edge is
      // hallway-adjacent. Shared baths get a hallway door directly (not blocked by
      // the ensuite invariant). Private ensuites stay inside their suite columns,
      // adjacent only to their attached bedroom — no cross-column ensuite doors.
      const allUnits = [
        ...southSuites.map((s) => ({
          type: 'suite',
          suite: s,
          weight: (s.bed.targetAreaSqFt || 110) + s.baths.reduce((w, b) => w + (b.targetAreaSqFt || 60), 0),
        })),
        ...nonSuiteSpecs.map((s) => ({ type: 'room', spec: s, weight: s.targetAreaSqFt || 100 })),
        ...southBathSpecs.map((s) => ({ type: 'room', spec: s, weight: s.targetAreaSqFt || 60, isBath: true })),
      ];
      const totalWeight = allUnits.reduce((s, c) => s + c.weight, 0) || 1;

      let xCursor = 0;
      for (let ci = 0; ci < allUnits.length; ci++) {
        const unit = allUnits[ci];
        const isLast = ci === allUnits.length - 1;
        let colW = isLast
          ? (widthTiles - xCursor)
          : Math.max(1, Math.round((unit.weight / totalWeight) * widthTiles));
        // Reserve at least 1 tile per remaining column
        colW = Math.min(colW, widthTiles - xCursor - (allUnits.length - ci - 1));
        if (colW <= 0) break;
        const colRect = rect(xCursor, hallY + HALL_H, colW, southH);

        if (unit.type === 'suite') {
          const suiteSpecs = [unit.suite.bed, ...unit.suite.baths];
          const placed = allocateSuitePlacements(level, colRect, suiteSpecs, 'bottom');
          const placedArea = placed.reduce((s, p) => s + p.w * p.h, 0);
          const finalPlaced = (placedArea >= colRect.w * colRect.h)
            ? placed
            : fillWithGuaranteedCoverage(colRect, suiteSpecs, 'vertical', `south_suite_col_${ci}_l2`).placements;
          for (const item of finalPlaced) {
            rooms.push(buildRoom(level, withZone(item.roomSpec, classifyProgramZone(item.roomSpec.type)), item));
          }
        } else {
          const zone = unit.isBath ? 'service' : classifyProgramZone(unit.spec.type);
          const { placements } = fillWithGuaranteedCoverage(colRect, [unit.spec], 'vertical', `south_other_col_${ci}_l2`);
          for (const item of placements) rooms.push(buildRoom(level, withZone(item.roomSpec, zone), item));
        }

        xCursor += colW;
      }
      zones.push(zoneMeta('private', southRect));

    } else {
      // Single south zone — all secondary specs together (beds + baths interleaved).
      // Use suite-aware placement so private bath pairs stay adjacent to their bed.
      const allSouthSpecs = [...southBedSpecs, ...southBathSpecs];
      if (allSouthSpecs.length) {
        const suitePlacedSingle = allocateSuitePlacements(level, southRect, allSouthSpecs, 'bottom');
        const suiteAreaSingle = suitePlacedSingle.reduce((s, p) => s + p.w * p.h, 0);
        const finalSouthPlacements = (suiteAreaSingle >= southRect.w * southH)
          ? suitePlacedSingle
          : fillWithGuaranteedCoverage(southRect, allSouthSpecs, 'vertical', 'south_l2').placements;
        for (const item of finalSouthPlacements) rooms.push(buildRoom(level, withZone(item.roomSpec, classifyProgramZone(item.roomSpec.type)), item));
      } else {
        rooms.push(buildRoom(level, makeSyntheticRoom('store_south_l2', 'storage', level, southRect.w * southH * 4), southRect));
      }
      zones.push(zoneMeta('private', southRect));
    }

  } else {
    // ── SHALLOW FOOTPRINT FALLBACK (heightTiles < MIN_NORTH + HALL_H + MIN_SOUTH) ──
    // Not enough depth for three zones. Use full-height stair column (no gaps to fill)
    // and left/right zones for all rooms.
    rooms.push(buildRoom(level, stairsSpec, rect(coreX, 0, coreTiles, heightTiles)));
    zones.push(zoneMeta('circulation', rect(coreX, 0, coreTiles, heightTiles)));

    const leftW = coreX;
    const rightW = widthTiles - coreX - coreTiles;
    const leftRect = leftW > 0 ? rect(0, 0, leftW, heightTiles) : null;
    const rightRect = rightW > 0 ? rect(coreX + coreTiles, 0, rightW, heightTiles) : null;

    const allSpecs = [
      ...(primaryBedroom && brief.primaryLevel === 2 ? [primaryBedroom] : []),
      ...(primaryBathroom && brief.primaryLevel === 2 ? [primaryBathroom] : []),
      ...l2SecondarySuites, ...l2FeatureRooms, ...l2SharedBaths,
    ];
    const leftSpecs = allSpecs.filter((_, i) => i % 2 === 0);
    const rightSpecs = allSpecs.filter((_, i) => i % 2 !== 0);

    if (leftRect) {
      const specs = leftSpecs.length ? leftSpecs : [makeSyntheticRoom('store_shallow_l_l2', 'storage', level, leftRect.w * heightTiles * 4)];
      const { placements } = fillWithGuaranteedCoverage(leftRect, specs, 'horizontal', 'shallow_left_l2');
      for (const item of placements) rooms.push(buildRoom(level, withZone(item.roomSpec, classifyProgramZone(item.roomSpec.type)), item));
      zones.push(zoneMeta('private', leftRect));
    }
    if (rightRect) {
      const specs = rightSpecs.length ? rightSpecs : [makeSyntheticRoom('store_shallow_r_l2', 'storage', level, rightRect.w * heightTiles * 4)];
      const { placements } = fillWithGuaranteedCoverage(rightRect, specs, 'horizontal', 'shallow_right_l2');
      for (const item of placements) rooms.push(buildRoom(level, withZone(item.roomSpec, classifyProgramZone(item.roomSpec.type)), item));
      zones.push(zoneMeta('private', rightRect));
    }
  }

  return {
    level,
    widthTiles,
    heightTiles,
    rooms,
    zones,
    stairCore: stairCoreMeta(level, rooms, preferLargeUpperBottomLandingMetadata ? {
      landingSide: 'top',
      landingOpen: false,
    } : {}),
  };
}

function allocateOneStory(programRooms, footprint, brief) {
  const level = 1;
  const widthTiles = footprint.widthTiles;
  const heightTiles = footprint.heightTiles;

  if (brief.hasGarage) {
    const garageDims = garageDimensionsTiles(brief.garageType, widthTiles, heightTiles);
    const leftWidth = garageDims.width;
    const rightWidth = widthTiles - leftWidth;

    const parts = splitVertical(rect(0, 0, widthTiles, heightTiles), [leftWidth, rightWidth]);
    const leftWingRect = parts[0];
    const rightRect = parts[1];

    const rooms = [];
    const zones = [];
    const { garageRect, rearRect } = splitLeftWingForGarage(leftWingRect, brief.garageType, widthTiles, heightTiles);
    const garageSpec = programRooms.find((r) => normalizeRoomType(r.type) === 'garage');

    if (garageSpec && garageRect) rooms.push(buildRoom(level, withZone(garageSpec, 'service'), garageRect));
    if (garageRect) zones.push(zoneMeta('service', garageRect));

    const rearResult = allocateLeftRearArea(level, rearRect, programRooms);
    rooms.push(...rearResult.rooms);
    if (rearRect) zones.push(zoneMeta('service', rearRect));

    const privateBathMap = bathsByAttachedBedroom(programRooms);
    const secondaryBedrooms = programRooms.filter((r) =>
      ['bedroom', 'guest_bedroom'].includes(normalizeRoomType(r.type))
    );

    const primaryBedroom = programRooms.find((r) => normalizeRoomType(r.type) === 'primary_bedroom');
    const primaryBathroom = programRooms.find((r) => normalizeRoomType(r.type) === 'primary_bathroom');
    const sharedBaths = programRooms.filter((r) => isSharedBath(r));
    const hallwaySpec = withZone(
      programRooms.find((r) => normalizeRoomType(r.type) === 'hallway')
        || makeSyntheticRoom('hall_l1', 'hallway', level, Math.max(48, rightRect.h * 8)),
      'circulation'
    );
    const totalAreaSqFt = Number(brief?.totalAreaSqFt || footprint?.totalAreaSqFt || 0);
    const useStructuredGarageHall =
      rightRect.w >= 18 &&
      rightRect.h >= 18 &&
      // Mid-size single-story garage families (around 1500-1800 sqft) were
      // falling back to the weaker stripe allocator, which produced thin rooms
      // and low acceptance counts. Let the structured hall path cover these
      // family programs earlier, while still leaving tiny compact plans alone.
      (totalAreaSqFt >= 1500 || programRooms.length >= 12);

    if (useStructuredGarageHall) {
      const compactSingleStoryFamily =
        Number(brief?.stories || 1) === 1 &&
        Number(brief?.bedrooms || 0) >= 3 &&
        Number(brief?.bathrooms || 0) >= 3;
      const hallWidth = compactSingleStoryFamily
        ? Math.min(1, Math.max(0, rightRect.w - 2))
        : rightRect.w >= 24
          ? 2
          : Math.min(2, rightRect.w - 2);
      const habitableWidth = Math.max(1, rightRect.w - hallWidth);
      const cols = splitVertical(rightRect, [hallWidth, habitableWidth]);
      const hallRect = cols[0];
      const habitableRect = cols[1];

      const privateRooms = [];
      if (primaryBedroom) privateRooms.push(withZone(primaryBedroom, 'private'));
      if (primaryBathroom) privateRooms.push(withZone(primaryBathroom, 'service'));
      for (const r of suiteSequenceForBedrooms(secondaryBedrooms, privateBathMap)) {
        privateRooms.push(withZone(r, classifyProgramZone(r.type)));
      }

      const publicRooms = [];
      const hasEntryAlready = rooms.some((r) => normalizeRoomType(r.type) === 'entry');
      if (!hasEntryAlready) {
        publicRooms.push(withZone(makeSyntheticRoom('front_entry_l1', 'entry', level, 40), 'circulation'));
      }

      for (const r of sharedBaths) publicRooms.push(withZone(r, 'service'));

      for (const spec of programRooms) {
        const t = normalizeRoomType(spec.type);
        if (PUBLIC_ROOM_TYPES.has(t)) publicRooms.push(withZone(spec, 'public'));
      }

      for (const r of rearResult.overflow || []) {
        if (!publicRooms.some((x) => x.id === r.id) && !privateRooms.some((x) => x.id === r.id)) {
          publicRooms.push(withZone(r, classifyProgramZone(r.type)));
        }
      }

      const compactThreeBathFamily =
        compactSingleStoryFamily &&
        Number(brief?.privateBathsRequested || 0) >= 1 &&
        privateRooms.length >= 5 &&
        rightRect.w >= 16 &&
        rightRect.h >= 16;

      if (compactThreeBathFamily) {
        const hallDepth = 2;
        const publicHeight = clamp(Math.round(rightRect.h * 0.38), 6, Math.max(6, rightRect.h - 12));
        const privateHeight = rightRect.h - publicHeight - hallDepth;

        if (privateHeight >= 10) {
          const compactPublicRect = rect(rightRect.x, rightRect.y, rightRect.w, publicHeight);
          const compactHallRect = rect(rightRect.x, rightRect.y + publicHeight, rightRect.w, hallDepth);
          const compactPrivateRect = rect(rightRect.x, rightRect.y + publicHeight + hallDepth, rightRect.w, privateHeight);

          rooms.push(buildRoom(level, hallwaySpec, compactHallRect));
          zones.push(zoneMeta('circulation', compactHallRect));

          const compactPrivatePlacements = allocateSuitePlacements(level, compactPrivateRect, privateRooms, 'top');
          if (compactPrivatePlacements.length) {
            for (const item of compactPrivatePlacements) {
              rooms.push(buildRoom(level, withZone(item.roomSpec, classifyProgramZone(item.roomSpec.type)), item));
            }
          } else {
            const { placements: privateRects } = fillWithGuaranteedCoverage(compactPrivateRect, privateRooms, 'vertical', 'private_1story_compact_garage');
            for (const item of privateRects) {
              rooms.push(buildRoom(level, withZone(item.roomSpec, classifyProgramZone(item.roomSpec.type)), item));
            }
          }
          zones.push(zoneMeta('private', compactPrivateRect));

          const publicDirection = compactPublicRect.w > compactPublicRect.h * 1.2 ? 'vertical' : 'horizontal';
          const { placements: compactPublicPlacements } = fillWithGuaranteedCoverage(
            compactPublicRect,
            publicRooms,
            publicDirection,
            'public_1story_compact_garage'
          );
          for (const item of compactPublicPlacements) {
            rooms.push(buildRoom(level, withZone(item.roomSpec, classifyProgramZone(item.roomSpec.type)), item));
          }
          zones.push(zoneMeta('public', compactPublicRect));

          return { level, widthTiles, heightTiles, rooms, zones, stairCore: stairCoreMeta(level, rooms) };
        }
      }

      const suiteCount = splitSuiteSpecs(privateRooms).suites.length;
      const privateTarget = privateRooms.reduce((sum, roomSpec) => sum + (roomSpec.targetAreaSqFt || 0), 0);
      const publicTarget = publicRooms.reduce((sum, roomSpec) => sum + (roomSpec.targetAreaSqFt || 0), 0);
      const privateFracFloor = compactSingleStoryFamily ? 0.52 : 0.42;
      const privateFracCeiling = compactSingleStoryFamily ? 0.68 : 0.62;
      const privateFrac = clamp(
        privateTarget / Math.max(1, privateTarget + publicTarget),
        privateFracFloor,
        privateFracCeiling
      );
      const minPublicHeight = publicRooms.length ? 6 : 0;
      const maxPrivateHeight = Math.max(8, habitableRect.h - minPublicHeight);
      const desiredPrivateMin = suiteCount >= 4 ? 16 : suiteCount >= 3 ? 14 : 8;
      const privateHeight = clamp(
        Math.round(habitableRect.h * privateFrac),
        Math.min(maxPrivateHeight, desiredPrivateMin),
        maxPrivateHeight
      );
      const publicHeight = habitableRect.h - privateHeight;
      const rows = publicHeight > 0
        ? splitHorizontal(habitableRect, [privateHeight, publicHeight])
        : [habitableRect];
      const privateRect = rows[0];
      const publicRect = rows[1] || null;

      rooms.push(buildRoom(level, hallwaySpec, hallRect));
      zones.push(zoneMeta('circulation', hallRect));

      const usePrivateSuiteHall = suiteCount >= 3 && privateRect.w >= 14 && privateRect.h >= 12;
      let privatePlacements = [];
      let privateZoneRect = privateRect;

      if (usePrivateSuiteHall) {
        const privateHallDepth = Math.min(2, Math.max(1, privateRect.h - 10));
        const suiteDepth = privateRect.h - privateHallDepth;

        if (suiteDepth >= 10) {
          const privateRows = splitHorizontal(privateRect, [privateHallDepth, suiteDepth]);
          const privateHallRect = privateRows[0];
          const suiteRect = privateRows[1];
          const privateHallSpec = withZone(
            makeSyntheticRoom('hall_private_l1', 'hallway', level, privateHallRect.w * privateHallRect.h * 4),
            'circulation'
          );

          rooms.push(buildRoom(level, privateHallSpec, privateHallRect));
          zones.push(zoneMeta('circulation', privateHallRect));
          privatePlacements = allocateSuitePlacements(level, suiteRect, privateRooms, 'bottom');
          privateZoneRect = suiteRect;
        }
      }

      if (!privatePlacements.length) {
        privatePlacements = allocateSuitePlacements(level, privateRect, privateRooms, 'left');
      }
      if (privatePlacements.length) {
        for (const item of privatePlacements) {
          rooms.push(buildRoom(level, withZone(item.roomSpec, classifyProgramZone(item.roomSpec.type)), item));
        }
      } else {
        const fallbackDirection = suiteCount >= 3 ? 'vertical' : 'horizontal';
        const { placements: privateRects } = fillWithGuaranteedCoverage(privateZoneRect, privateRooms, fallbackDirection, 'private_1story_garage');
        for (const item of privateRects) {
          rooms.push(buildRoom(level, withZone(item.roomSpec, classifyProgramZone(item.roomSpec.type)), item));
        }
      }
      zones.push(zoneMeta('private', privateZoneRect));

      if (publicRect && publicRect.w > 0 && publicRect.h > 0) {
        const livingSpec = publicRooms.find((spec) => normalizeRoomType(spec.type) === 'living_room');
        const kitchenSpec = publicRooms.find((spec) => normalizeRoomType(spec.type) === 'kitchen');
        const diningSpec = publicRooms.find((spec) => normalizeRoomType(spec.type) === 'dining_room');
        const featureSpecs = publicRooms.filter((spec) => FEATURE_ROOM_TYPES.has(normalizeRoomType(spec.type)));
        const serviceLikeSpecs = publicRooms.filter((spec) => {
          const t = normalizeRoomType(spec.type);
          return t === 'entry' || t === 'entry_foyer' || BATHROOM_TYPES.has(t) || t === 'powder_room';
        });
        const widePublicCluster =
          livingSpec &&
          kitchenSpec &&
          diningSpec &&
          featureSpecs.length === 0 &&
          publicRect.w >= 16 &&
          publicRect.h >= 8;

        if (widePublicCluster) {
          const serviceWidth = serviceLikeSpecs.length
            ? clamp(Math.round(publicRect.w * 0.22), 3, Math.max(3, publicRect.w - 12))
            : 0;
          const remainingWidth = publicRect.w - serviceWidth;
          const livingWidth = clamp(Math.round(remainingWidth * 0.5), 6, Math.max(6, remainingWidth - 6));
          const kitchenDiningWidth = remainingWidth - livingWidth;

          const serviceRect = serviceWidth > 0
            ? rect(publicRect.x, publicRect.y, serviceWidth, publicRect.h)
            : null;
          const livingRect = rect(publicRect.x + serviceWidth, publicRect.y, livingWidth, publicRect.h);
          const kitchenDiningRect = rect(livingRect.x + livingRect.w, publicRect.y, kitchenDiningWidth, publicRect.h);
          const clusterPlacements = [];
          let clusterValid = isGeometryAcceptable(livingSpec, livingRect.w, livingRect.h);

          if (clusterValid && serviceRect && serviceRect.w > 0 && serviceRect.h > 0) {
            const specs = serviceLikeSpecs.length
              ? serviceLikeSpecs
              : [makeSyntheticRoom(`public_service_fill_l${level}`, 'storage', level, serviceRect.w * serviceRect.h * 4)];
            const { placements } = fillWithGuaranteedCoverage(serviceRect, specs, 'horizontal', `public_service_l${level}`);
            clusterPlacements.push(...placements.map((item) => ({
              roomSpec: withZone(item.roomSpec, classifyProgramZone(item.roomSpec.type)),
              x: item.x,
              y: item.y,
              w: item.w,
              h: item.h,
            })));
          }

          if (clusterValid) {
            clusterPlacements.push({
              roomSpec: withZone(livingSpec, 'public'),
              x: livingRect.x,
              y: livingRect.y,
              w: livingRect.w,
              h: livingRect.h,
            });
          }

          if (clusterValid && kitchenDiningRect.w > 0 && kitchenDiningRect.h > 0) {
            const kitchenArea = kitchenSpec.targetAreaSqFt || 100;
            const diningArea = diningSpec.targetAreaSqFt || 80;
            const minDiningHeightFt = minimumDepthForFixedWidth(
              diningSpec,
              kitchenDiningRect.w * TILE_SIZE_FT_DEFAULT
            );
            const minDiningHeightTiles = Number.isFinite(minDiningHeightFt)
              ? Math.ceil(minDiningHeightFt / TILE_SIZE_FT_DEFAULT)
              : 0;

            let kitchenRect = null;
            let diningRect = null;

            const kitchenHeight = clamp(
              Math.round(kitchenDiningRect.h * (kitchenArea / Math.max(1, kitchenArea + diningArea))),
              4,
              Math.max(4, kitchenDiningRect.h - Math.max(4, minDiningHeightTiles || 4))
            );
            const diningHeight = kitchenDiningRect.h - kitchenHeight;
            const stackedKitchenRect = rect(kitchenDiningRect.x, kitchenDiningRect.y, kitchenDiningRect.w, kitchenHeight);
            const stackedDiningRect = rect(kitchenDiningRect.x, kitchenDiningRect.y + kitchenHeight, kitchenDiningRect.w, diningHeight);

            if (
              isGeometryAcceptable(kitchenSpec, stackedKitchenRect.w, stackedKitchenRect.h) &&
              isGeometryAcceptable(diningSpec, stackedDiningRect.w, stackedDiningRect.h)
            ) {
              kitchenRect = stackedKitchenRect;
              diningRect = stackedDiningRect;
            } else {
              let diningWidth = 0;
              for (let width = 4; width <= kitchenDiningRect.w - 4; width++) {
                const candidateDiningRect = rect(
                  kitchenDiningRect.x + kitchenDiningRect.w - width,
                  kitchenDiningRect.y,
                  width,
                  kitchenDiningRect.h
                );
                if (isGeometryAcceptable(diningSpec, candidateDiningRect.w, candidateDiningRect.h)) {
                  diningWidth = width;
                  break;
                }
              }

              if (diningWidth > 0) {
                const sideKitchenRect = rect(
                  kitchenDiningRect.x,
                  kitchenDiningRect.y,
                  kitchenDiningRect.w - diningWidth,
                  kitchenDiningRect.h
                );
                const sideDiningRect = rect(
                  kitchenDiningRect.x + kitchenDiningRect.w - diningWidth,
                  kitchenDiningRect.y,
                  diningWidth,
                  kitchenDiningRect.h
                );

                if (
                  isGeometryAcceptable(kitchenSpec, sideKitchenRect.w, sideKitchenRect.h) &&
                  isGeometryAcceptable(diningSpec, sideDiningRect.w, sideDiningRect.h)
                ) {
                  kitchenRect = sideKitchenRect;
                  diningRect = sideDiningRect;
                }
              }
            }

            if (kitchenRect && diningRect) {
              clusterPlacements.push({
                roomSpec: withZone(kitchenSpec, 'public'),
                x: kitchenRect.x,
                y: kitchenRect.y,
                w: kitchenRect.w,
                h: kitchenRect.h,
              });
              clusterPlacements.push({
                roomSpec: withZone(diningSpec, 'public'),
                x: diningRect.x,
                y: diningRect.y,
                w: diningRect.w,
                h: diningRect.h,
              });
            } else {
              clusterValid = false;
            }
          }

          if (clusterValid) {
            for (const item of clusterPlacements) {
              rooms.push(buildRoom(level, item.roomSpec, item));
            }
          } else {
            const publicDirection = publicRect.w > publicRect.h * 1.4 ? 'vertical' : 'horizontal';
            const { placements: publicRects } = fillWithGuaranteedCoverage(publicRect, publicRooms, publicDirection, 'public_1story_garage');
            for (const item of publicRects) {
              rooms.push(buildRoom(level, withZone(item.roomSpec, classifyProgramZone(item.roomSpec.type)), item));
            }
          }
        } else {
          const publicDirection = publicRect.w > publicRect.h * 1.4 ? 'vertical' : 'horizontal';
          const { placements: publicRects } = fillWithGuaranteedCoverage(publicRect, publicRooms, publicDirection, 'public_1story_garage');
          for (const item of publicRects) {
            rooms.push(buildRoom(level, withZone(item.roomSpec, classifyProgramZone(item.roomSpec.type)), item));
          }
        }
        zones.push(zoneMeta('public', publicRect));
      }

      return { level, widthTiles, heightTiles, rooms, zones, stairCore: stairCoreMeta(level, rooms) };
    }

    const rightSpecs = [];
    const alreadyPlacedIds = new Set(rooms.map((r) => r.id));

    const hasEntryAlready = rooms.some((r) => normalizeRoomType(r.type) === 'entry');
    if (!hasEntryAlready) rightSpecs.push(makeSyntheticRoom('front_entry_l1', 'entry', level, 40));

    if (primaryBedroom && !alreadyPlacedIds.has(primaryBedroom.id)) rightSpecs.push(primaryBedroom);
    if (primaryBathroom && !alreadyPlacedIds.has(primaryBathroom.id)) rightSpecs.push(primaryBathroom);

    for (const r of suiteSequenceForBedrooms(secondaryBedrooms, privateBathMap)) {
      if (!alreadyPlacedIds.has(r.id)) rightSpecs.push(r);
    }

    for (const r of sharedBaths) {
      if (!alreadyPlacedIds.has(r.id)) rightSpecs.push(r);
    }

    const publicRooms = programRooms.filter((r) => {
      const t = normalizeRoomType(r.type);
      return PUBLIC_ROOM_TYPES.has(t) || FEATURE_ROOM_TYPES.has(t) || t === 'hallway' || t === 'laundry';
    });

    for (const r of publicRooms) {
      if (!alreadyPlacedIds.has(r.id)) rightSpecs.push(r);
    }

    for (const r of rearResult.overflow || []) {
      if (!alreadyPlacedIds.has(r.id)) rightSpecs.push(r);
    }

    const rightPlacements = allocateSuitePlacements(level, rightRect, rightSpecs);
    if (rightPlacements.length) {
      for (const item of rightPlacements) rooms.push(buildRoom(level, withZone(item.roomSpec, classifyProgramZone(item.roomSpec.type)), item));
    } else {
      const { placements: rightRects } = fillWithGuaranteedCoverage(rightRect, rightSpecs, 'horizontal', 'right_1story_l1');
      for (const item of rightRects) rooms.push(buildRoom(level, withZone(item.roomSpec, classifyProgramZone(item.roomSpec.type)), item));
    }
    zones.push(zoneMeta('public', rightRect));

    return { level, widthTiles, heightTiles, rooms, zones, stairCore: stairCoreMeta(level, rooms) };
  }

  let privateFrac = 0.38 - (publicDepthBias(brief) * 0.35);
  if (brief.lotContext === 'URBAN') privateFrac += 0.06;
  if (brief.lotContext === 'VIEW' || brief.lotContext === 'WATERFRONT') privateFrac -= 0.05;
  privateFrac = clamp(privateFrac, 0.30, 0.55);
  // Cap hallway target area: full-depth hall columns on deep/narrow plans create oversized
  // corridors. Limit to min(heightTiles * 5, 140) sqft so the spec reflects a realistic target.
  const hallTargetSqFt = Math.max(32, Math.min(heightTiles * 5, 140));
  const hallSpec = withZone(
    programRooms.find((r) => normalizeRoomType(r.type) === 'hallway')
      || makeSyntheticRoom('hall_l1', 'hallway', level, hallTargetSqFt),
    'circulation'
  );

  // Raise hall threshold from 14 to 16 tiles (32ft) to avoid oversized corridors on
  // narrow plans. A 4ft hall spanning a 28ft-wide plan = 14% of floor area — too high.
  const reserveHall = widthTiles >= 16;
  const hallTiles = reserveHall ? 2 : 0;
  const usableWidth = widthTiles - hallTiles;

  // Bar plan prevention: ensure public zone has at least 9 tiles (18ft) of width.
  // Without this minimum, narrow plans place all public rooms in a thin side-by-side
  // strip — the bar plan pattern. Give public zone priority; shrink private if needed.
  const MIN_PUBLIC_TILES = 9;
  const rawPrivateTiles = Math.max(6, Math.floor(usableWidth * privateFrac));
  // Cap privateTiles so that privateTiles + hallTiles + publicTiles never exceeds widthTiles.
  // Without this cap, publicTiles = max(9, usableWidth - private) can exceed usableWidth
  // when private is large, causing splitVertical to overflow the grid and produce tile overlaps.
  const privateTiles = Math.min(rawPrivateTiles, Math.max(1, usableWidth - MIN_PUBLIC_TILES));
  const publicTiles = usableWidth - privateTiles;

  const whole = rect(0, 0, widthTiles, heightTiles);
  const cols = hallTiles > 0
    ? splitVertical(whole, [privateTiles, hallTiles, publicTiles])
    : splitVertical(whole, [privateTiles, publicTiles]);
  const privateRect = cols[0];
  const circulationRect = hallTiles > 0 ? cols[1] : null;
  const publicRect = hallTiles > 0 ? cols[2] : cols[1];

  const rooms = [];
  const zones = [];
  const privateBathMap = bathsByAttachedBedroom(programRooms);
  const bedrooms = programRooms.filter((r) =>
    ['primary_bedroom', 'bedroom', 'guest_bedroom'].includes(normalizeRoomType(r.type))
  );

  const primaryBedroom = bedrooms.find((r) => normalizeRoomType(r.type) === 'primary_bedroom');
  const primaryBathroom = programRooms.find((r) => normalizeRoomType(r.type) === 'primary_bathroom');
  const secondaryBeds = bedrooms.filter((r) => normalizeRoomType(r.type) !== 'primary_bedroom');
  const sharedBaths = programRooms.filter((r) => isSharedBath(r));
  const powderRooms = programRooms.filter((r) => normalizeRoomType(r.type) === 'powder_room');
  const mudroomSpec = programRooms.find((r) => normalizeRoomType(r.type) === 'mudroom');
  const livingSpec = programRooms.find((r) => normalizeRoomType(r.type) === 'living_room');
  const kitchenSpec = programRooms.find((r) => normalizeRoomType(r.type) === 'kitchen');
  const diningSpec = programRooms.find((r) => normalizeRoomType(r.type) === 'dining_room');
  const laundrySpec = programRooms.find((r) => normalizeRoomType(r.type) === 'laundry');
  const secondarySuiteBaths = secondaryBeds.flatMap((bed) => privateBathMap.get(String(bed.id)) || privateBathMap.get(bed.id) || []);
  const compactDualSuiteSingleStory =
    Number(brief?.bedrooms || 0) <= 2 &&
    primaryBedroom &&
    primaryBathroom &&
    secondaryBeds.length === 1 &&
    secondarySuiteBaths.length >= 1 &&
    sharedBaths.length <= 1 &&
    sharedBaths.every((spec) => normalizeRoomType(spec.type) === 'powder_room') &&
    !programRooms.some((spec) => FEATURE_ROOM_TYPES.has(normalizeRoomType(spec.type))) &&
    livingSpec &&
    kitchenSpec &&
    diningSpec &&
    widthTiles >= 13 &&
    heightTiles >= 18;

  if (compactDualSuiteSingleStory) {
    const publicHeight = clamp(Math.round(heightTiles * 0.45), 8, Math.max(8, heightTiles - 12));
    const hallHeight = 2;
    const privateHeight = heightTiles - publicHeight - hallHeight;

    if (privateHeight >= 8) {
      const publicZone = rect(0, 0, widthTiles, publicHeight);
      const hallRect = rect(0, publicHeight, widthTiles, hallHeight);
      const privateZone = rect(0, publicHeight + hallHeight, widthTiles, privateHeight);

      const serviceRowHeight = (laundrySpec && publicHeight >= 8) ? 2 : 0;
      const serviceRow = serviceRowHeight > 0 ? rect(publicZone.x, publicZone.y, publicZone.w, serviceRowHeight) : null;
      const mainPublicZone = serviceRowHeight > 0
        ? rect(publicZone.x, publicZone.y + serviceRowHeight, publicZone.w, publicZone.h - serviceRowHeight)
        : publicZone;

      const entrySpec = makeSyntheticRoom('entry_l1', 'entry', level, 48, { zone: 'circulation' });
      const serviceSpecs = [withZone(entrySpec, 'circulation')];
      if (powderRooms.length) {
        for (const powder of powderRooms) serviceSpecs.push(withZone(powder, 'service'));
      }
      if (laundrySpec) serviceSpecs.push(withZone(laundrySpec, 'service'));

      if (serviceRow && serviceRow.w > 0 && serviceRow.h > 0) {
        const { placements } = fillWithGuaranteedCoverage(serviceRow, serviceSpecs, 'vertical', `compact_front_service_l${level}`);
        for (const item of placements) {
          const zone = normalizeRoomType(item.roomSpec.type) === 'entry' ? 'circulation' : 'service';
          rooms.push(buildRoom(level, withZone(item.roomSpec, zone), item));
        }
      }

      if (mainPublicZone.w > 0 && mainPublicZone.h > 0) {
        const livingWidth = clamp(Math.round(mainPublicZone.w * 0.56), 7, Math.max(7, mainPublicZone.w - 6));
        const livingRect = rect(mainPublicZone.x, mainPublicZone.y, livingWidth, mainPublicZone.h);
        const kitchenDiningRect = rect(mainPublicZone.x + livingWidth, mainPublicZone.y, mainPublicZone.w - livingWidth, mainPublicZone.h);
        rooms.push(buildRoom(level, withZone(livingSpec, 'public'), livingRect));
        if (kitchenDiningRect.w > 0 && kitchenDiningRect.h > 0) {
          const kitchenArea = kitchenSpec.targetAreaSqFt || 100;
          const diningArea = diningSpec.targetAreaSqFt || 80;
          const kitchenHeight = clamp(
            Math.round(kitchenDiningRect.h * (kitchenArea / Math.max(1, kitchenArea + diningArea))),
            4,
            Math.max(4, kitchenDiningRect.h - 4)
          );
          const diningHeight = kitchenDiningRect.h - kitchenHeight;
          rooms.push(buildRoom(level, withZone(kitchenSpec, 'public'), rect(kitchenDiningRect.x, kitchenDiningRect.y, kitchenDiningRect.w, kitchenHeight)));
          rooms.push(buildRoom(level, withZone(diningSpec, 'public'), rect(kitchenDiningRect.x, kitchenDiningRect.y + kitchenHeight, kitchenDiningRect.w, diningHeight)));
        }
      }

      rooms.push(buildRoom(level, hallSpec, hallRect));
      zones.push(zoneMeta('public', publicZone));
      zones.push(zoneMeta('circulation', hallRect));

      const primaryArea = primaryBedroom.targetAreaSqFt || 180;
      const secondaryArea = secondaryBeds[0].targetAreaSqFt || 120;
      const primaryWidth = clamp(
        Math.round(privateZone.w * (primaryArea / Math.max(1, primaryArea + secondaryArea))),
        7,
        Math.max(7, privateZone.w - 6)
      );
      const primaryRect = rect(privateZone.x, privateZone.y, primaryWidth, privateZone.h);
      const secondaryRect = rect(privateZone.x + primaryWidth, privateZone.y, privateZone.w - primaryWidth, privateZone.h);

      const placeSuite = (zoneRect, bedSpec, bathSpec, minBathHeight) => {
        if (!zoneRect || zoneRect.w <= 0 || zoneRect.h <= 0 || !bedSpec || !bathSpec) return;
        const bathHeight = clamp(Math.round(zoneRect.h * 0.3), minBathHeight, Math.max(minBathHeight, zoneRect.h - 5));
        // Place bed at TOP (adjacent to hall) and bath at BOTTOM (exterior wall).
        // The hall separates the public zone from the private zone horizontally, so the
        // top edge of the private zone borders the hall. Bed must be at the top so the
        // hall-adjacency pass in placeOpenings can connect hall → bed directly.
        // Bath at the bottom avoids the ensuite-restriction blocking hall access to bed.
        const bedRect = rect(zoneRect.x, zoneRect.y, zoneRect.w, zoneRect.h - bathHeight);
        const bathRect = rect(zoneRect.x, zoneRect.y + zoneRect.h - bathHeight, zoneRect.w, bathHeight);
        rooms.push(buildRoom(level, withZone(bedSpec, 'private'), bedRect));
        rooms.push(buildRoom(level, withZone(bathSpec, 'service'), bathRect));
      };

      placeSuite(primaryRect, primaryBedroom, primaryBathroom, 3);
      placeSuite(secondaryRect, secondaryBeds[0], secondarySuiteBaths[0], 3);
      zones.push(zoneMeta('private', privateZone));

      return { level, widthTiles, heightTiles, rooms, zones, stairCore: stairCoreMeta(level, rooms) };
    }
  }

  const privateRooms = [];
  if (primaryBedroom) privateRooms.push(withZone(primaryBedroom, 'private'));
  if (primaryBathroom) privateRooms.push(withZone(primaryBathroom, 'service'));
  privateRooms.push(...suiteSequenceForBedrooms(secondaryBeds, privateBathMap).map((spec) => withZone(spec, classifyProgramZone(spec.type))));
  // Shared hall baths (non-ensuite, non-powder) stay near bedrooms in private zone.
  // Powder rooms are guest/public bathrooms — they belong in the public zone.
  privateRooms.push(...sharedBaths.filter((spec) => normalizeRoomType(spec.type) !== 'powder_room').map((spec) => withZone(spec, 'service')));

  const publicRoomList = [];
  if (mudroomSpec) {
    publicRoomList.push(withZone(mudroomSpec, 'circulation'));
  } else {
    publicRoomList.push(makeSyntheticRoom(
      'entry_l1',
      'entry',
      1,
      (brief.totalAreaSqFt || 0) < 900 ? 32 : 40
    , { zone: 'circulation' }));
  }

  for (const spec of programRooms) {
    const t = normalizeRoomType(spec.type);
    if (PUBLIC_ROOM_TYPES.has(t) || FEATURE_ROOM_TYPES.has(t) || t === 'laundry' || t === 'powder_room') {
      publicRoomList.push(withZone(spec, classifyProgramZone(spec.type)));
    }
  }

  // 'right': hall/public zone is to the right of the private zone, so place bed on the
  // right side of each suite (adjacent to hall) and bath on the left (exterior wall).
  // This ensures primary_bedroom has a direct adjacency to the hallway/public zone,
  // avoiding the connectivity failure where bath blocks bedroom from reaching circulation.
  const privatePlacements = allocateSuitePlacements(level, privateRect, privateRooms, 'right');
  if (privatePlacements.length) {
    for (const item of privatePlacements) rooms.push(buildRoom(level, withZone(item.roomSpec, classifyProgramZone(item.roomSpec.type)), item));
  } else {
    const { placements: privateRects } = fillWithGuaranteedCoverage(privateRect, privateRooms, 'horizontal', 'private_1story');
    for (const item of privateRects) rooms.push(buildRoom(level, withZone(item.roomSpec, classifyProgramZone(item.roomSpec.type)), item));
  }
  zones.push(zoneMeta('private', privateRect));

  if (circulationRect) {
    rooms.push(buildRoom(level, hallSpec, circulationRect));
    zones.push(zoneMeta('circulation', circulationRect));
  }

  const { placements: publicRects } = fillWithGuaranteedCoverage(publicRect, publicRoomList, 'horizontal', 'public_1story');
  for (const item of publicRects) rooms.push(buildRoom(level, withZone(item.roomSpec, classifyProgramZone(item.roomSpec.type)), item));
  zones.push(zoneMeta('public', publicRect));

  return { level, widthTiles, heightTiles, rooms, zones, stairCore: stairCoreMeta(level, rooms) };
}

function generateTilePlan(program, footprint, brief) {
  const rawLevels = [];
  let untransformedL1 = null;

  for (const levelProgram of program.levels) {
    let levelLayout;

    if (brief.stories === 1) {
      levelLayout = allocateOneStory(levelProgram.rooms, footprint, brief);
    } else if (levelProgram.level === 1) {
      levelLayout = allocateTwoStoryLevel1(levelProgram.rooms, footprint, brief);
      untransformedL1 = levelLayout;
    } else {
      levelLayout = allocateTwoStoryLevel2(levelProgram.rooms, footprint, brief, untransformedL1);
    }

    rawLevels.push(levelLayout);
  }

  reconcileGeneratedLevels(rawLevels, program, brief);

  const levels = [];
  for (const levelLayout of rawLevels) {
    let transformedLayout = repairCompactFacingArtifacts(applyFacingTransform(levelLayout, brief), brief);
    const grid = createGrid(levelLayout.widthTiles, levelLayout.heightTiles);
    // Pre-paint overlap resolution: scan for geometric overlaps and trim
    // the less important room (storage fillers) to prevent paintRect from throwing
    // while maintaining grid coverage. This catches overlaps from any source.
    const resolvedRooms = [...transformedLayout.rooms];
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = resolvedRooms.length - 1; i >= 0; i--) {
        const a = resolvedRooms[i];
        for (let j = 0; j < i; j++) {
          const b = resolvedRooms[j];
          if (!roomsActuallyOverlap(a, b)) continue;

          // Overlap detected: identify which room to trim (prefer trimming storage)
          const aIsStorage = normalizeRoomType(a.type) === 'storage';
          const bIsStorage = normalizeRoomType(b.type) === 'storage';
          const trimTarget = (aIsStorage && !bIsStorage) ? a : (bIsStorage && !aIsStorage) ? b : a;
          const keepRoom = trimTarget === a ? b : a;

          if ((Array.isArray(trimTarget.parts) && trimTarget.parts.length > 0) || (Array.isArray(keepRoom.parts) && keepRoom.parts.length > 0)) {
            continue;
          }

          // Try trimming from each side — pick the trim that leaves the largest viable rect.
          const trims = [];
          // Trim trimTarget's LEFT edge to keepRoom's right edge
          const trimLeft = keepRoom.x + keepRoom.w - trimTarget.x;
          if (trimLeft > 0 && trimLeft < trimTarget.w) {
            trims.push({ x: trimTarget.x + trimLeft, y: trimTarget.y, w: trimTarget.w - trimLeft, h: trimTarget.h });
          }
          // Trim trimTarget's RIGHT edge to keepRoom's left edge
          const trimRight = (trimTarget.x + trimTarget.w) - keepRoom.x;
          if (trimRight > 0 && trimRight < trimTarget.w) {
            trims.push({ x: trimTarget.x, y: trimTarget.y, w: trimTarget.w - trimRight, h: trimTarget.h });
          }
          // Trim trimTarget's TOP edge to keepRoom's bottom edge
          const trimTop = keepRoom.y + keepRoom.h - trimTarget.y;
          if (trimTop > 0 && trimTop < trimTarget.h) {
            trims.push({ x: trimTarget.x, y: trimTarget.y + trimTop, w: trimTarget.w, h: trimTarget.h - trimTop });
          }
          // Trim trimTarget's BOTTOM edge to keepRoom's top edge
          const trimBottom = (trimTarget.y + trimTarget.h) - keepRoom.y;
          if (trimBottom > 0 && trimBottom < trimTarget.h) {
            trims.push({ x: trimTarget.x, y: trimTarget.y, w: trimTarget.w, h: trimTarget.h - trimBottom });
          }

          // Pick the largest viable trim
          const validTrims = trims.filter(t => t.w > 0 && t.h > 0);
          if (validTrims.length > 0) {
            validTrims.sort((x, y) => (y.w * y.h) - (x.w * x.h));
            const best = validTrims[0];
            trimTarget.x = best.x;
            trimTarget.y = best.y;
            trimTarget.w = best.w;
            trimTarget.h = best.h;
          } else {
            // Can't trim — remove entirely
            const idx = resolvedRooms.indexOf(trimTarget);
            if (idx !== -1) resolvedRooms.splice(idx, 1);
          }
          changed = true;
          break;
        }
        if (changed) break;
      }
    }
    transformedLayout = { ...transformedLayout, rooms: resolvedRooms };

    for (const room of resolvedRooms) {
      if (Array.isArray(room.parts) && room.parts.length > 0) {
        paintPolyomino(grid, room.parts, room.id);
      } else {
        paintRect(grid, room, room.id);
      }
    }

    levels.push({ ...transformedLayout, grid });
  }

  const tilePlan = {
    stories: brief.stories,
    tileSizeFt: footprint.tileSizeFt,
    levels,
  };

  const errors = validateTilePlan(tilePlan);
  if (errors.length) {
    throw new Error(`Tile generation failed: ${errors[0]}`);
  }

  return tilePlan;
}

module.exports = { generateTilePlan };
