'use strict';

const { placeRoom } = require('./fitRoomsToRealms');
const { buildLowerFloorGarageCluster, rebalanceOversizedServiceRooms } = require('./lowerFloorClusters');
const { buildSharedUpperGarageCirculationCore, placeGraphSupportRoom } = require('./clusterBuilders');
const { isSocialFeaturePair } = require('./featurePairPolicy');
const { VARIATION_PROFILES } = require('./variationProfiles');
const { roomToCells, cellsToParts, boundsFromCells, partListOf } = require('../../planGeometry');
const { subtract, intersection } = require('../../geometry/rectBoolean');

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, minValue, maxValue) {
  return Math.min(Math.max(value, minValue), maxValue);
}

function boundsOfRooms(rooms) {
  if (!Array.isArray(rooms) || rooms.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  const minX = Math.min(...rooms.map((room) => num(room.x)));
  const minY = Math.min(...rooms.map((room) => num(room.y)));
  const maxX = Math.max(...rooms.map((room) => num(room.x) + num(room.w)));
  const maxY = Math.max(...rooms.map((room) => num(room.y) + num(room.h)));
  return {
    x: minX,
    y: minY,
    w: maxX - minX,
    h: maxY - minY,
  };
}

function overlaps(a, b) {
  return num(a.x) < num(b.x) + num(b.w) &&
    num(a.x) + num(a.w) > num(b.x) &&
    num(a.y) < num(b.y) + num(b.h) &&
    num(a.y) + num(a.h) > num(b.y);
}

function overlapArea(a, b) {
  const left = Math.max(num(a?.x), num(b?.x));
  const right = Math.min(num(a?.x) + num(a?.w), num(b?.x) + num(b?.w));
  const top = Math.max(num(a?.y), num(b?.y));
  const bottom = Math.min(num(a?.y) + num(a?.h), num(b?.y) + num(b?.h));
  const w = right - left;
  const h = bottom - top;
  if (w <= 0 || h <= 0) return 0;
  return w * h;
}

function rangesOverlap(startA, endA, startB, endB, eps = 0.01) {
  return Math.min(endA, endB) - Math.max(startA, startB) > eps;
}

function rectsShareEdge(a, b, eps = 0.01) {
  const ax1 = num(a?.x);
  const ay1 = num(a?.y);
  const ax2 = ax1 + num(a?.w);
  const ay2 = ay1 + num(a?.h);
  const bx1 = num(b?.x);
  const by1 = num(b?.y);
  const bx2 = bx1 + num(b?.w);
  const by2 = by1 + num(b?.h);

  const verticalTouch = (Math.abs(ax2 - bx1) <= eps || Math.abs(bx2 - ax1) <= eps) &&
    rangesOverlap(ay1, ay2, by1, by2, eps);
  const horizontalTouch = (Math.abs(ay2 - by1) <= eps || Math.abs(by2 - ay1) <= eps) &&
    rangesOverlap(ax1, ax2, bx1, bx2, eps);
  return verticalTouch || horizontalTouch;
}

function rectArea(rect) {
  return Math.max(0, num(rect?.w)) * Math.max(0, num(rect?.h));
}

function pointInRect(x, y, rect) {
  return (
    x >= num(rect?.x) &&
    x <= num(rect?.x) + num(rect?.w) &&
    y >= num(rect?.y) &&
    y <= num(rect?.y) + num(rect?.h)
  );
}

function rectInsideRect(inner, outer) {
  return (
    num(inner?.x) >= num(outer?.x) &&
    num(inner?.y) >= num(outer?.y) &&
    num(inner?.x) + num(inner?.w) <= num(outer?.x) + num(outer?.w) &&
    num(inner?.y) + num(inner?.h) <= num(outer?.y) + num(outer?.h)
  );
}

function clampRectToBounds(rect, width, height) {
  const rw = Math.max(0, num(rect?.w));
  const rh = Math.max(0, num(rect?.h));
  const maxX = Math.max(0, num(width) - rw);
  const maxY = Math.max(0, num(height) - rh);
  return {
    x: clamp(num(rect?.x), 0, maxX),
    y: clamp(num(rect?.y), 0, maxY),
    w: rw,
    h: rh,
  };
}

function totalVoidOverlap(rect, voidRects) {
  return (voidRects || []).reduce((sum, voidRect) => sum + overlapArea(rect, voidRect), 0);
}

function roomRect(room) {
  return {
    x: num(room?.x),
    y: num(room?.y),
    w: num(room?.w),
    h: num(room?.h),
  };
}

function roomType(room) {
  return String(room?.type || '').toLowerCase();
}

function isWingPreferredType(type) {
  const normalized = String(type || '').toLowerCase();
  return (
    normalized === 'bedroom' ||
    normalized === 'secondary_bedroom' ||
    normalized === 'guest_bedroom' ||
    normalized === 'study' ||
    normalized === 'library' ||
    normalized === 'gym' ||
    normalized === 'loft' ||
    normalized === 'movie_room' ||
    normalized === 'gaming_room' ||
    normalized === 'playroom' ||
    normalized === 'music_room'
  );
}

function preferredZoneRectForRoom(room, zoneModel) {
  if (!zoneModel) return null;
  return isWingPreferredType(roomType(room)) ? zoneModel.wingRect : zoneModel.bodyRect;
}

function placeRectInsideZone(baseRect, zoneRect, levelWidth, levelHeight, blockedRects = []) {
  if (!zoneRect) return baseRect;
  const rect = {
    x: num(baseRect?.x),
    y: num(baseRect?.y),
    w: num(baseRect?.w),
    h: num(baseRect?.h),
  };
  if (rect.w <= 0 || rect.h <= 0) return baseRect;
  if (rect.w > num(zoneRect?.w) || rect.h > num(zoneRect?.h)) return baseRect;

  const minX = num(zoneRect?.x);
  const maxX = num(zoneRect?.x) + num(zoneRect?.w) - rect.w;
  const minY = num(zoneRect?.y);
  const maxY = num(zoneRect?.y) + num(zoneRect?.h) - rect.h;

  const clamped = clampRectToBounds({
    x: clamp(rect.x, minX, maxX),
    y: clamp(rect.y, minY, maxY),
    w: rect.w,
    h: rect.h,
  }, levelWidth, levelHeight);

  const candidates = [
    clamped,
    { x: minX, y: minY, w: rect.w, h: rect.h },
    { x: maxX, y: minY, w: rect.w, h: rect.h },
    { x: minX, y: maxY, w: rect.w, h: rect.h },
    { x: maxX, y: maxY, w: rect.w, h: rect.h },
    { x: (minX + maxX) / 2, y: (minY + maxY) / 2, w: rect.w, h: rect.h },
  ].map((candidate) => clampRectToBounds(candidate, levelWidth, levelHeight));

  const valid = candidates.filter((candidate) => {
    if (!rectInsideRect(candidate, zoneRect)) return false;
    return !blockedRects.some((blocked) => overlapArea(candidate, blocked) > 0);
  });
  if (!valid.length) return baseRect;

  valid.sort((a, b) => {
    const da = Math.abs(num(a.x) - rect.x) + Math.abs(num(a.y) - rect.y);
    const db = Math.abs(num(b.x) - rect.x) + Math.abs(num(b.y) - rect.y);
    return da - db;
  });
  return valid[0];
}

function deriveZoneNativeRect(baseRect, zoneRect, levelWidth, levelHeight, blockedRects = [], options = {}) {
  if (!zoneRect) return baseRect;
  const base = {
    x: num(baseRect?.x),
    y: num(baseRect?.y),
    w: num(baseRect?.w),
    h: num(baseRect?.h),
  };
  const zoneW = num(zoneRect?.w);
  const zoneH = num(zoneRect?.h);
  const minWidth = num(options?.minWidth, 8);
  const minHeight = num(options?.minHeight, 8);
  if (base.w <= 0 || base.h <= 0) return baseRect;

  // If the base geometry already fits the zone, preserve dimensions and only place it.
  if (base.w <= zoneW && base.h <= zoneH) {
    return placeRectInsideZone(base, zoneRect, levelWidth, levelHeight, blockedRects);
  }

  // Zone-native derivation: fit inside zone while retaining as much area/aspect as possible.
  const targetArea = Math.min(base.w * base.h, zoneW * zoneH);
  const aspect = base.h > 0 ? base.w / base.h : 1;
  let derivedW = Math.sqrt(Math.max(0, targetArea) * Math.max(0.1, aspect));
  let derivedH = targetArea / Math.max(derivedW, 0.1);

  if (derivedW > zoneW) {
    derivedW = zoneW;
    derivedH = targetArea / Math.max(derivedW, 0.1);
  }
  if (derivedH > zoneH) {
    derivedH = zoneH;
    derivedW = targetArea / Math.max(derivedH, 0.1);
  }

  derivedW = Math.max(minWidth, Math.min(zoneW, derivedW));
  derivedH = Math.max(minHeight, Math.min(zoneH, derivedH));
  if (derivedW > zoneW || derivedH > zoneH) {
    // Min constraints cannot be met inside this zone; keep translational fallback behavior.
    return placeRectInsideZone(base, zoneRect, levelWidth, levelHeight, blockedRects);
  }

  return placeRectInsideZone(
    {
      x: base.x,
      y: base.y,
      w: derivedW,
      h: derivedH,
    },
    zoneRect,
    levelWidth,
    levelHeight,
    blockedRects
  );
}

function roomBlocksMove(room) {
  if (room?.zonePlacementSource === 'upper_zone_native') return true;
  const type = roomType(room);
  return type === 'stairs' || type === 'hallway';
}

function withZonePlacementMeta(room, zonePlacement, zoneGeometryMode = 'zone_native') {
  if (!room || !zonePlacement) return room;
  return {
    ...room,
    zonePlacement,
    zonePlacementSource: 'upper_zone_native',
    zoneGeometryMode,
  };
}

function roomHasCollision(candidate, rooms, roomId) {
  for (const other of rooms || []) {
    if (String(other?.id) === String(roomId)) continue;
    const overlapSqFt = overlapArea(candidate, roomRect(other));
    if (overlapSqFt > 0) return true;
  }
  return false;
}

function resolveWingZoneModel(footprint, width, height) {
  const envelopeShape = String(footprint?.envelopeShape || footprint?.shape || 'RECTANGULAR').toUpperCase();
  const voidRects = Array.isArray(footprint?.envelopeVoidRects) ? footprint.envelopeVoidRects : [];
  const levelWidth = num(width);
  const levelHeight = num(height);
  const edgeEps = 0.2;

  if (envelopeShape === 'L_SHAPE' && voidRects.length >= 1) {
    const v = voidRects[0];
    const left = num(v?.x) <= edgeEps;
    const right = num(v?.x) + num(v?.w) >= levelWidth - edgeEps;
    const top = num(v?.y) <= edgeEps;
    const bottom = num(v?.y) + num(v?.h) >= levelHeight - edgeEps;

    let bodyRect = null;
    let wingRect = null;

    if (top && right) {
      bodyRect = { x: 0, y: num(v.h), w: levelWidth, h: levelHeight - num(v.h) };
      wingRect = { x: 0, y: 0, w: levelWidth - num(v.w), h: num(v.h) };
    } else if (top && left) {
      bodyRect = { x: 0, y: num(v.h), w: levelWidth, h: levelHeight - num(v.h) };
      wingRect = { x: num(v.w), y: 0, w: levelWidth - num(v.w), h: num(v.h) };
    } else if (bottom && right) {
      bodyRect = { x: 0, y: 0, w: levelWidth, h: levelHeight - num(v.h) };
      wingRect = { x: 0, y: levelHeight - num(v.h), w: levelWidth - num(v.w), h: num(v.h) };
    } else if (bottom && left) {
      bodyRect = { x: 0, y: 0, w: levelWidth, h: levelHeight - num(v.h) };
      wingRect = { x: num(v.w), y: levelHeight - num(v.h), w: levelWidth - num(v.w), h: num(v.h) };
    }

    if (bodyRect && wingRect) {
      if (rectArea(wingRect) > rectArea(bodyRect)) {
        const swap = bodyRect;
        bodyRect = wingRect;
        wingRect = swap;
      }
      return { shape: 'L_SHAPE', bodyRect, wingRect };
    }
  }

  if (envelopeShape === 'T_SHAPE' && voidRects.length >= 2) {
    const sorted = [...voidRects].sort((a, b) => num(a?.x) - num(b?.x));
    const leftVoid = sorted[0];
    const rightVoid = sorted[sorted.length - 1];
    const topOriented = num(leftVoid?.y) <= edgeEps && num(rightVoid?.y) <= edgeEps;
    const bottomOriented =
      num(leftVoid?.y) + num(leftVoid?.h) >= levelHeight - edgeEps &&
      num(rightVoid?.y) + num(rightVoid?.h) >= levelHeight - edgeEps;

    if (topOriented) {
      const notchDepth = Math.max(num(leftVoid?.h), num(rightVoid?.h));
      const stemX = num(leftVoid?.w);
      const stemWidth = levelWidth - num(leftVoid?.w) - num(rightVoid?.w);
      const wingRect = { x: stemX, y: 0, w: stemWidth, h: notchDepth };
      const bodyRect = { x: 0, y: notchDepth, w: levelWidth, h: levelHeight - notchDepth };
      if (rectArea(wingRect) > 0 && rectArea(bodyRect) > 0) return { shape: 'T_SHAPE', bodyRect, wingRect };
    }

    if (bottomOriented) {
      const notchDepth = Math.max(num(leftVoid?.h), num(rightVoid?.h));
      const stemX = num(leftVoid?.w);
      const stemWidth = levelWidth - num(leftVoid?.w) - num(rightVoid?.w);
      const wingRect = { x: stemX, y: levelHeight - notchDepth, w: stemWidth, h: notchDepth };
      const bodyRect = { x: 0, y: 0, w: levelWidth, h: levelHeight - notchDepth };
      if (rectArea(wingRect) > 0 && rectArea(bodyRect) > 0) return { shape: 'T_SHAPE', bodyRect, wingRect };
    }
  }

  return null;
}

function preferredZoneKeyForRoom(room) {
  const type = roomType(room);
  if (
    type === 'bedroom' ||
    type === 'secondary_bedroom' ||
    type === 'guest_bedroom' ||
    type === 'study' ||
    type === 'library' ||
    type === 'gym' ||
    type === 'loft' ||
    type === 'movie_room' ||
    type === 'gaming_room' || type === 'playroom'
  ) return 'wingRect';
  return 'bodyRect';
}

function zonePenalty(candidate, zoneModel, room) {
  if (!zoneModel) return 0;
  const zoneKey = preferredZoneKeyForRoom(room);
  const preferred = zoneModel?.[zoneKey];
  if (!preferred) return 0;
  const cx = num(candidate?.x) + num(candidate?.w) / 2;
  const cy = num(candidate?.y) + num(candidate?.h) / 2;
  return pointInRect(cx, cy, preferred) ? 0 : 1;
}

function candidateEscapeRects(rect, voidRects, levelWidth, levelHeight) {
  const candidates = [clampRectToBounds(rect, levelWidth, levelHeight)];
  for (const voidRect of voidRects || []) {
    if (overlapArea(rect, voidRect) <= 0) continue;
    candidates.push(clampRectToBounds({
      ...rect,
      x: num(voidRect?.x) - num(rect?.w),
      y: num(rect?.y),
    }, levelWidth, levelHeight));
    candidates.push(clampRectToBounds({
      ...rect,
      x: num(voidRect?.x) + num(voidRect?.w),
      y: num(rect?.y),
    }, levelWidth, levelHeight));
    candidates.push(clampRectToBounds({
      ...rect,
      x: num(rect?.x),
      y: num(voidRect?.y) - num(rect?.h),
    }, levelWidth, levelHeight));
    candidates.push(clampRectToBounds({
      ...rect,
      x: num(rect?.x),
      y: num(voidRect?.y) + num(voidRect?.h),
    }, levelWidth, levelHeight));
  }

  const dedup = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.x.toFixed(3)}:${candidate.y.toFixed(3)}:${candidate.w.toFixed(3)}:${candidate.h.toFixed(3)}`;
    if (!dedup.has(key)) dedup.set(key, candidate);
  }
  return [...dedup.values()];
}

function nudgeRectOutOfVoids(rect, context) {
  const original = clampRectToBounds(rect, context.levelWidth, context.levelHeight);
  const candidates = candidateEscapeRects(original, context.voidRects, context.levelWidth, context.levelHeight);
  if (candidates.length <= 1) return original;
  const validCandidates = candidates.filter((candidate) =>
    totalVoidOverlap(candidate, context.voidRects) <= 0 &&
    !roomHasCollision(candidate, context.levelRooms, context.roomId)
  );
  if (!validCandidates.length) return original;
  validCandidates.sort((a, b) => {
    const aZonePenalty = zonePenalty(a, context.zoneModel, context.room);
    const bZonePenalty = zonePenalty(b, context.zoneModel, context.room);
    if (aZonePenalty !== bZonePenalty) return aZonePenalty - bZonePenalty;
    const aDistance = Math.abs(num(a.x) - num(original.x)) + Math.abs(num(a.y) - num(original.y));
    const bDistance = Math.abs(num(b.x) - num(original.x)) + Math.abs(num(b.y) - num(original.y));
    return aDistance - bDistance;
  });
  return validCandidates[0];
}

function placeAdjacent(anchor, room, side) {
  const w = num(room.w);
  const h = num(room.h);
  const ax = num(anchor.x);
  const ay = num(anchor.y);
  const aw = num(anchor.w);
  const ah = num(anchor.h);

  if (side === 'north') return { x: ax, y: ay - h, w, h };
  if (side === 'south') return { x: ax, y: ay + ah, w, h };
  if (side === 'west') return { x: ax - w, y: ay, w, h };
  return { x: ax + aw, y: ay, w, h };
}

function placeVerticalStack(items, x, y, width, totalHeight) {
  const placed = [];
  let cursorY = y;
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (!item?.room) continue;
    const remainingHeight = Math.max(0, totalHeight - (cursorY - y));
    const fixedHeight = index === items.length - 1
      ? remainingHeight
      : Math.min(remainingHeight, Math.max(0, num(item.height)));
    if (fixedHeight <= 0) continue;
    placed.push(placeRoom(item.room, { x, y: cursorY, w: width, h: fixedHeight }));
    cursorY += fixedHeight;
  }
  return placed;
}

function crossSectionMetric(bounds, side) {
  return side === 'north' || side === 'south' ? bounds.h : bounds.w;
}

function attachRoomToBranch(cluster, room, options = {}) {
  const preferredSide = String(options.preferredSide || 'east').toLowerCase();
  const maxCrossSectionFt = num(options.maxCrossSectionFt, 25);
  const anchor = options.anchorRect || boundsOfRooms(cluster);
  const candidateSides = [preferredSide]
    .concat(preferredSide === 'north' || preferredSide === 'south' ? ['east', 'west', 'north', 'south'] : ['north', 'south', 'east', 'west'])
    .filter((side, index, sides) => sides.indexOf(side) === index);

  for (const side of candidateSides) {
    const rect = placeAdjacent(anchor, room, side);
    if (cluster.some((placed) => overlaps(placed, rect))) continue;
    const bounds = boundsOfRooms([...cluster, rect]);
    if (crossSectionMetric(bounds, side) > maxCrossSectionFt) continue;
    return { rect, side, bounds };
  }

  const fallbackRect = placeAdjacent(anchor, room, candidateSides[candidateSides.length - 1] || 'east');
  return {
    rect: fallbackRect,
    side: candidateSides[candidateSides.length - 1] || 'east',
    bounds: boundsOfRooms([...cluster, fallbackRect]),
  };
}

function rectToCells(rect, tileSizeFt = 2) {
  const cells = new Set();
  const safeTile = Math.max(1, num(tileSizeFt, 2));
  const startX = Math.round(num(rect?.x) / safeTile);
  const startY = Math.round(num(rect?.y) / safeTile);
  const widthTiles = Math.max(0, Math.round(num(rect?.w) / safeTile));
  const heightTiles = Math.max(0, Math.round(num(rect?.h) / safeTile));
  for (let dx = 0; dx < widthTiles; dx++) {
    for (let dy = 0; dy < heightTiles; dy++) {
      cells.add(`${startX + dx},${startY + dy}`);
    }
  }
  return cells;
}

function normalizeRoomFromCells(room, cells, tileSizeFt = 2) {
  if (!cells || cells.size === 0) return null;
  const parts = cellsToParts(cells, tileSizeFt);
  if (!parts.length) return null;
  const bounds = boundsFromCells(cells, tileSizeFt);
  const normalized = {
    ...room,
    x: bounds.x,
    y: bounds.y,
    w: bounds.w,
    h: bounds.h,
  };
  if (parts.length === 1) {
    const [part] = parts;
    if (
      num(part?.x) === num(bounds?.x) &&
      num(part?.y) === num(bounds?.y) &&
      num(part?.w) === num(bounds?.w) &&
      num(part?.h) === num(bounds?.h)
    ) {
      if (normalized.parts) delete normalized.parts;
      return normalized;
    }
  }
  normalized.parts = parts;
  return normalized;
}

function applyVoidCellsToRoom(room, voidCells, tileSizeFt = 2) {
  if (!voidCells || voidCells.size === 0) return room;
  const originalCells = roomToCells(room, tileSizeFt);
  if (!originalCells.size) return room;

  const filtered = new Set();
  for (const key of originalCells) {
    if (!voidCells.has(key)) filtered.add(key);
  }
  if (filtered.size === originalCells.size) return room;
  return normalizeRoomFromCells(room, filtered, tileSizeFt);
}

function buildFootprintVoidCells(footprint, tileSizeFt = 2) {
  const voidRects = Array.isArray(footprint?.envelopeVoidRects) ? footprint.envelopeVoidRects : [];
  const cells = new Set();
  for (const rect of voidRects) {
    const rectCells = rectToCells(rect, tileSizeFt);
    for (const key of rectCells) cells.add(key);
  }
  return cells;
}

function isStructuralRoom(room) {
  const type = String(room?.type || '').toLowerCase();
  return type === 'stairs' || type === 'hallway';
}

// Carving uses exact rectangle subtraction rather than the 2 ft cell grid. A
// room placed on an odd boundary (x=37, w=15) does not align to that grid, so
// rounding it into cells both shifted its edges and could grow it past the
// envelope: a 15 ft bedroom at x=37 became cells covering 38..54 on a 52 ft
// house. Subtraction leaves every retained edge exactly where it was placed.
function applyFootprintVoidsToRoom(room, voidRects) {
  const source = Array.isArray(room?.parts) && room.parts.length
    ? room.parts.map((part) => ({ x: num(part?.x), y: num(part?.y), w: num(part?.w), h: num(part?.h) }))
    : [{ x: num(room?.x), y: num(room?.y), w: num(room?.w), h: num(room?.h) }];
  const sourceArea = source.reduce((sum, r) => sum + r.w * r.h, 0);
  if (!(sourceArea > 0)) return room;

  const retained = subtract(source, voidRects);
  if (!retained.length) return null;
  const retainedArea = retained.reduce((sum, r) => sum + r.w * r.h, 0);
  if (Math.abs(retainedArea - sourceArea) < 1e-9) return room;

  const x = Math.min(...retained.map((r) => r.x));
  const y = Math.min(...retained.map((r) => r.y));
  const w = Math.max(...retained.map((r) => r.x + r.w)) - x;
  const h = Math.max(...retained.map((r) => r.y + r.h)) - y;
  const normalized = { ...room, x, y, w, h };
  if (retained.length === 1) {
    delete normalized.parts;
    return normalized;
  }
  normalized.parts = retained;
  return normalized;
}

function applyFootprintShapeToLayout(layout, footprint, tileSizeFt = 2) {
  const envelopeShape = String(footprint?.envelopeShape || footprint?.shape || 'RECTANGULAR').toUpperCase();
  if (envelopeShape !== 'L_SHAPE' && envelopeShape !== 'T_SHAPE') return layout;

  const voidRects = (Array.isArray(footprint?.envelopeVoidRects) ? footprint.envelopeVoidRects : [])
    .map((r) => ({ x: num(r?.x), y: num(r?.y), w: num(r?.w), h: num(r?.h) }))
    .filter((r) => r.w > 0 && r.h > 0);
  if (!voidRects.length) return layout;

  const levels = (layout?.levels || []).map((level) => {
    const carvedRooms = [];
    for (const room of level?.rooms || []) {
      // A fitted stair cannot be cropped without redesigning its flights.
      // Reject the candidate rather than allowing it to occupy the exterior
      // void. Hallways can be clipped; downstream circulation checks must then
      // verify their actual remaining geometry and door connections.
      if (String(room.type).toLowerCase() === 'stairs') {
        const parts = room.parts?.length ? room.parts : [room];
        if (parts.some(part => voidRects.some(cut => intersection(part, cut)))) {
          throw new Error(`Envelope reservation: stair ${room.id} intersects the requested exterior void`);
        }
        carvedRooms.push(room);
        continue;
      }
      const carved = applyFootprintVoidsToRoom(room, voidRects);
      if (carved) carvedRooms.push(carved);
    }
    return {
      ...level,
      rooms: carvedRooms,
      envelopeAreaSqFt: num(footprint?.levelAreaSqFtActual, level.envelopeAreaSqFt),
    };
  });

  return {
    ...layout,
    levels,
  };
}

function applyWingAwarePlacement(layout, footprint) {
  const envelopeShape = String(footprint?.envelopeShape || footprint?.shape || 'RECTANGULAR').toUpperCase();
  if (envelopeShape !== 'L_SHAPE' && envelopeShape !== 'T_SHAPE') return layout;
  const voidRects = Array.isArray(footprint?.envelopeVoidRects) ? footprint.envelopeVoidRects : [];
  if (!voidRects.length) return layout;

  const levels = (layout?.levels || []).map((level) => {
    const levelWidth = num(level?.width);
    const levelHeight = num(level?.height);
    const zoneModel = resolveWingZoneModel(footprint, levelWidth, levelHeight);
    const levelRooms = (level?.rooms || []).map((room) => ({ ...room }));
    for (let index = 0; index < levelRooms.length; index++) {
      const room = levelRooms[index];
      if (roomBlocksMove(room)) {
        continue;
      }
      const originalRect = roomRect(room);
      const overlapBefore = totalVoidOverlap(originalRect, voidRects);
      if (overlapBefore <= 0) {
        continue;
      }
      const nudged = nudgeRectOutOfVoids(originalRect, {
        voidRects,
        levelWidth,
        levelHeight,
        levelRooms,
        roomId: room?.id,
        room,
        zoneModel,
      });
      levelRooms[index] = {
        ...room,
        x: nudged.x,
        y: nudged.y,
        w: nudged.w,
        h: nudged.h,
      };
    }
    return {
      ...level,
      rooms: levelRooms,
    };
  });

  return {
    ...layout,
    levels,
  };
}

function roomByKey(graph, program, key) {
  const node = (graph?.nodes || []).find((candidate) => candidate.key === key);
  if (!node) return null;
  for (const level of program?.levels || []) {
    const match = (level?.rooms || []).find((room) => String(room?.id) === String(node.roomId));
    if (match) return match;
  }
  // A bathroom slot with no requested bathroom (a primary without an ensuite)
  // stays a storage room beside its bedroom. Drawing a bathroom nobody asked
  // for breaks the survey's bathroom count; the storage can hold a walk-in.
  if (['bathroom', 'primary_bathroom'].includes(String(node.type))) {
    return syntheticRoom(`${node.roomId}_storage`, 'storage', node.level, { label: 'Storage' });
  }
  return {
    id: node.roomId,
    type: node.type,
    level: node.level,
    zone: node.privacyLevel,
    label: node.type === 'hallway' ? 'Landing Hall' : null,
  };
}

function featureRoomsByKeys(graph, program) {
  const keys = (graph?.nodes || []).filter(node => node.role === 'special_room').map(node => node.key);
  return keys
    .map((key) => roomByKey(graph, program, key))
    .filter(Boolean);
}

function pickFeatureRoomForLevel(graph, program, level) {
  return featureRoomsByKeys(graph, program).find((room) => Number(room?.level) === Number(level)) || null;
}

function syntheticRoom(id, type, level, extras = {}) {
  return {
    id,
    type,
    level,
    zone: extras.zone || 'service',
    label: extras.label || null,
    roomContract: null,
    requestedFeature: false,
  };
}

function roomOfType(program, levelNumber, type, index = 0) {
  const rooms = (program?.levels?.find((level) => Number(level?.level) === Number(levelNumber))?.rooms || [])
    .filter((room) => String(room?.type) === String(type));
  return rooms[index] || null;
}

function resolveUpperVariationCore(footprint = null) {
  const variationId = String(footprint?.variationId || 'variant_a_compact_core');
  const profile = VARIATION_PROFILES.find((candidate) => candidate.id === variationId) || VARIATION_PROFILES[0];
  return {
    variationId,
    variationLabel: String(profile?.label || 'Compact Core'),
    variationTheme: String(profile?.theme || 'balanced_compact'),
    leftWingWidth: num(profile?.twoStory?.upperCore?.leftWingWidth, 14),
    landingDepth: num(profile?.twoStory?.upperCore?.landingDepth, 6),
    landingWidth: num(profile?.twoStory?.upperCore?.landingWidth, 10),
    stairRunBias: num(profile?.twoStory?.upperCore?.stairRunBias, 0),
  };
}

function buildLowerFloorLevel(width, height, program, graph, variant = 'two_bed', footprint = null, interpretation = null) {
  const lowerLevelFeatureRoom = pickFeatureRoomForLevel(graph, program, 1);
  const secondaryLowerFeatureRoom = featureRoomsByKeys(graph, program)
    .find((room) => Number(room?.level) === 1 && String(room?.id) !== String(lowerLevelFeatureRoom?.id)) || null;
  const layout = buildLowerFloorGarageCluster({
    variant,
    width,
    height,
    rooms: {
      entrance_room: roomByKey(graph, program, 'entrance_room'),
      common_area: roomByKey(graph, program, 'common_area'),
      farmhouse_kitchen: roomByKey(graph, program, 'farmhouse_kitchen'),
      dining_room: roomByKey(graph, program, 'dining_room'),
      stair_core_lower: roomByKey(graph, program, 'stair_core_lower'),
      lower_landing: roomByKey(graph, program, 'lower_landing'),
      garage: roomByKey(graph, program, 'garage'),
      mudroom: roomByKey(graph, program, 'mudroom'),
      laundry: roomByKey(graph, program, 'laundry'),
      special_room: lowerLevelFeatureRoom,
      special_room_secondary: secondaryLowerFeatureRoom,
      study: lowerLevelFeatureRoom || roomByKey(graph, program, 'study'),
      lower_shared_bath: roomByKey(graph, program, 'lower_shared_bath'),
      shared_bath: roomByKey(graph, program, 'lower_shared_bath'),
    },
    profileHint: String(footprint?.variationId || ''),
    kitchenIntent: interpretation?.kitchenIntent || null,
    wideDoorways: Boolean(interpretation?.accessibilityPolicy?.wideDoors || interpretation?.accessibilityPolicy?.wheelchair),
  });
  // The non-rectangular wing grammar still reserves a six-foot core. Keep
  // that topology and require a fitted quarter-turn stair; widening it here
  // makes its independently assembled upper wings overlap.
  if (footprint?.envelopeVoidRects?.length && layout.stairCore.w === 7) {
    const core=layout.stairCore;
    for(const room of layout.rooms) {
      if(room.id===core.roomId) room.w=6;
      else if(room.x===core.x+7 && room.y>=core.y && room.y+room.h<=core.y+core.h) {room.x-=1;room.w+=1;}
    }
    core.w=6;
  }
  return layout;
}

function buildLowerFloorCompactLevel(width, height, program, graph, footprint = null) {
  const entranceRoom = roomByKey(graph, program, 'entrance_room');
  const kitchenRoom = roomByKey(graph, program, 'farmhouse_kitchen');
  const diningRoom = roomByKey(graph, program, 'dining_room');
  const commonRoom = roomByKey(graph, program, 'common_area');
  const stairRoom = roomByKey(graph, program, 'stair_core_lower');
  const hallRoom = roomByKey(graph, program, 'lower_landing');
  const laundryRoom = roomByKey(graph, program, 'laundry');
  const lowerSharedBathRoom = roomByKey(graph, program, 'lower_shared_bath');
  const specialRoom = pickFeatureRoomForLevel(graph, program, 1);

  const variationId = String(footprint?.variationId || 'variant_a_compact_core');
  const compactEnvelope = Number(footprint?.totalAreaSqFt) <= 1600 && width <= 34;
  const publicBandHeight = compactEnvelope ? 14 : variationId === 'variant_c_service_spine' ? 18 : 16;
  const kitchenBandHeight = variationId === 'variant_c_service_spine' ? publicBandHeight : 10;

  const stairColumnX = Math.max(10, Math.min(14, width - 20));
  const landingColumnX = stairColumnX + 7;
  const serviceColumnX = landingColumnX + 5;
  const serviceColumnWidth = Math.max(4, width - serviceColumnX);
  const stairRect = { x: stairColumnX, y: publicBandHeight, w: 7, h: Math.max(10, height - publicBandHeight) };
  const landingRect = { x: landingColumnX, y: publicBandHeight, w: 5, h: Math.max(10, height - publicBandHeight) };
  const leftLowerRect = { x: 0, y: kitchenBandHeight, w: stairColumnX, h: Math.max(8, height - kitchenBandHeight) };
  const rightServiceRect = { x: serviceColumnX, y: publicBandHeight, w: serviceColumnWidth, h: Math.max(8, height - publicBandHeight) };
  const minEntryWidth = program?.interpretation?.accessibilityPolicy?.wideDoors || program?.interpretation?.accessibilityPolicy?.wheelchair ? 6 : 4;
  const canSplitServiceColumns = rightServiceRect.w >= 6 + minEntryWidth;

  // variant_b reverses public zone: common left (daylight), kitchen right
  const leftPublicRoom = variationId === 'variant_b_daylight_wing' ? commonRoom : kitchenRoom;
  const rightPublicRoom = variationId === 'variant_b_daylight_wing' ? kitchenRoom : commonRoom;
  const centerKitchen = variationId === 'variant_c_service_spine';

  const rooms = [
    placeRoom(centerKitchen ? diningRoom : leftPublicRoom, { x: 0, y: 0, w: stairColumnX, h: kitchenBandHeight }, { openConcept: true }),
    placeRoom(centerKitchen ? kitchenRoom : diningRoom, { x: stairColumnX, y: 0, w: 12, h: publicBandHeight }, { openConcept: true }),
    placeRoom(rightPublicRoom, { x: serviceColumnX, y: 0, w: serviceColumnWidth, h: publicBandHeight }, { openConcept: true }),
    placeRoom(stairRoom, stairRect),
    placeRoom(hallRoom, landingRect),
  ];

  if (specialRoom && Number(specialRoom?.level || 1) === 1) {
    rooms.push(placeRoom(specialRoom, leftLowerRect));
    if (lowerSharedBathRoom) {
      if (canSplitServiceColumns) {
        const lowerSharedBathHeight = clamp(rightServiceRect.h - 4, 6, 8);
        const lowerSharedBathWidth = clamp(
          Math.min(8, Math.floor(lowerSharedBathHeight * 1.5)),
          6,
          rightServiceRect.w - minEntryWidth
        );
        const rightColumnWidth = rightServiceRect.w - lowerSharedBathWidth;

        rooms.push(placeRoom(lowerSharedBathRoom, {
          x: rightServiceRect.x,
          y: rightServiceRect.y,
          w: lowerSharedBathWidth,
          h: lowerSharedBathHeight,
        }));
        rooms.push(placeRoom(entranceRoom, {
          x: rightServiceRect.x,
          y: rightServiceRect.y + lowerSharedBathHeight,
          w: lowerSharedBathWidth,
          h: rightServiceRect.h - lowerSharedBathHeight,
        }));
        rooms.push(placeRoom(laundryRoom, {
          x: rightServiceRect.x + lowerSharedBathWidth,
          y: rightServiceRect.y,
          w: rightColumnWidth,
          h: rightServiceRect.h,
        }));
      } else {
        const lowerSharedBathHeight = clamp(rightServiceRect.h - 6, 6, 8);
        const remainingHeight = rightServiceRect.h - lowerSharedBathHeight;
        const laundryHeight = clamp(remainingHeight - 2, 2, 4);
        const entryHeight = Math.max(2, remainingHeight - laundryHeight);

        rooms.push(placeRoom(lowerSharedBathRoom, {
          x: rightServiceRect.x,
          y: rightServiceRect.y,
          w: rightServiceRect.w,
          h: lowerSharedBathHeight,
        }));
        rooms.push(placeRoom(laundryRoom, {
          x: rightServiceRect.x,
          y: rightServiceRect.y + lowerSharedBathHeight,
          w: rightServiceRect.w,
          h: laundryHeight,
        }));
        rooms.push(placeRoom(entranceRoom, {
          x: rightServiceRect.x,
          y: rightServiceRect.y + lowerSharedBathHeight + laundryHeight,
          w: rightServiceRect.w,
          h: entryHeight,
        }));
      }
    } else {
      rooms.push(...placeVerticalStack([
        { room: laundryRoom, height: 4 },
        { room: entranceRoom },
      ], rightServiceRect.x, rightServiceRect.y, rightServiceRect.w, rightServiceRect.h));
    }
  } else {
    rooms.push(placeRoom(laundryRoom, leftLowerRect));

    if (lowerSharedBathRoom) {
      if (canSplitServiceColumns) {
        const lowerSharedBathHeight = clamp(rightServiceRect.h - 4, 6, 8);
        const lowerSharedBathWidth = clamp(
          Math.min(8, Math.floor(lowerSharedBathHeight * 1.5)),
          6,
          rightServiceRect.w - minEntryWidth
        );
        const rightColumnWidth = rightServiceRect.w - lowerSharedBathWidth;

        rooms.push(placeRoom(lowerSharedBathRoom, {
          x: rightServiceRect.x,
          y: rightServiceRect.y,
          w: lowerSharedBathWidth,
          h: lowerSharedBathHeight,
        }));
        const bathColumnRemainderHeight = Math.max(0, rightServiceRect.h - lowerSharedBathHeight);
        if (bathColumnRemainderHeight > 0) {
          rooms.push(placeRoom(
            syntheticRoom('architect_v2_compact_service_storage_l1', 'storage', 1, {
              label: 'Service Buffer',
            }),
            {
              x: rightServiceRect.x,
              y: rightServiceRect.y + lowerSharedBathHeight,
              w: lowerSharedBathWidth,
              h: bathColumnRemainderHeight,
            }
          ));
        }
        rooms.push(placeRoom(entranceRoom, {
          x: rightServiceRect.x + lowerSharedBathWidth,
          y: rightServiceRect.y,
          w: rightColumnWidth,
          h: rightServiceRect.h,
        }));
      } else {
        const lowerSharedBathHeight = clamp(rightServiceRect.h - 4, 6, 8);
        rooms.push(placeRoom(lowerSharedBathRoom, {
          x: rightServiceRect.x,
          y: rightServiceRect.y,
          w: rightServiceRect.w,
          h: lowerSharedBathHeight,
        }));
        rooms.push(placeRoom(entranceRoom, {
          x: rightServiceRect.x,
          y: rightServiceRect.y + lowerSharedBathHeight,
          w: rightServiceRect.w,
          h: rightServiceRect.h - lowerSharedBathHeight,
        }));
      }
    } else {
      rooms.push(placeRoom(entranceRoom, rightServiceRect));
    }
  }

  return {
    rooms,
    stairCore: {
      x: stairRect.x,
      y: stairRect.y,
      w: stairRect.w,
      h: stairRect.h,
      roomId: stairRoom?.id || 'stairs_l1',
      hallRoomId: hallRoom?.id || 'architect_v2_lower_hall',
      landingRoomId: hallRoom?.id || 'architect_v2_lower_hall',
      landingOpen: true,
    },
  };
}

function buildTwoBedUpperLevel(width, height, program, graph, options = {}) {
  const upperSupportRoom = roomByKey(graph, program, 'storage_upper');
  const landing = roomByKey(graph, program, 'landing');
  const stairs = roomByKey(graph, program, 'stair_core_upper');
  const specialRoom = pickFeatureRoomForLevel(graph, program, 2);
  const upperCoreVariation = resolveUpperVariationCore(options.footprint || null);
  const upperVariationId = String(upperCoreVariation.variationId || 'variant_a_compact_core');
  const stairRun = num(options.stairRun, Math.max(12, Math.min(16, height - 16))) + upperCoreVariation.stairRunBias;
  const circulation = buildSharedUpperGarageCirculationCore({
    wideDoorways: Boolean(program?.interpretation?.accessibilityPolicy?.wideDoors || program?.interpretation?.accessibilityPolicy?.wheelchair),
    width,
    height,
    leftWingWidth: upperCoreVariation.leftWingWidth,
    landingDepth: upperCoreVariation.landingDepth,
    landingWidth: upperCoreVariation.landingWidth,
    stairRun: Math.max(10, Math.min(16, stairRun)),
    stairAnchor: options.stairCoreAnchor || null,
    stairsRoom: stairs,
    landingRoom: landing,
  });
  const primarySuiteRoom = roomByKey(graph, program, 'primary_suite');
  const primaryBathRoom = roomByKey(graph, program, 'primary_bath_buffer');
  const sharedBathRoom = roomByKey(graph, program, 'shared_bath');
  const secondaryBedroom = roomByKey(graph, program, 'secondary_bedroom_1');
  const suiteBufferRoom = roomByKey(graph, program, 'suite_buffer');
  const zoneModel = resolveWingZoneModel(options?.footprint, width, height);
  const upperSupportRect = { x: 0, y: 0, w: circulation.rightWingX, h: circulation.landingY };
  const upperSupportAreaSqFt = upperSupportRect.w * upperSupportRect.h;
  const featureMinAreaSqFt = num(specialRoom?.minFeatureAreaSqFt, 100);
  const specialRoomKind = String(specialRoom?.requestedFeatureKind || specialRoom?.type || '').trim().toLowerCase();
  const upperSupportHostsFeature =
    specialRoom &&
    Number(specialRoom?.level) === 2 &&
    upperSupportAreaSqFt >= featureMinAreaSqFt;
  const swapPrimaryStackForGym = upperSupportHostsFeature && specialRoomKind === 'gym';
  const primaryBathBandDepth = upperVariationId === 'variant_b_daylight_wing'
    ? 9
    : upperVariationId === 'variant_c_service_spine'
      ? 12
      : 10;
  const swapPrimaryStartY = Math.max(primaryBathBandDepth, circulation.landingY);
  const primaryBathWidth = Math.max(8, Math.min(14, Math.round(circulation.rightWingWidth * 0.4)));
  const primarySuiteRect = swapPrimaryStackForGym
    ? { x: circulation.rightWingX, y: swapPrimaryStartY, w: circulation.rightWingWidth, h: height - swapPrimaryStartY }
    : { x: circulation.rightWingX, y: 0, w: circulation.rightWingWidth, h: height - primaryBathBandDepth };
  const primaryBathRect = swapPrimaryStackForGym
    ? { x: circulation.rightWingX + circulation.rightWingWidth - primaryBathWidth, y: 0, w: primaryBathWidth, h: primaryBathBandDepth }
    : {
      x: circulation.rightWingX + circulation.rightWingWidth - primaryBathWidth,
      y: height - primaryBathBandDepth,
      w: primaryBathWidth,
      h: primaryBathBandDepth,
    };
  const primaryBathSupportRect = swapPrimaryStackForGym
    ? { x: circulation.rightWingX, y: 0, w: circulation.rightWingWidth - primaryBathWidth, h: primaryBathBandDepth }
    : {
      x: circulation.rightWingX,
      y: height - primaryBathBandDepth,
      w: circulation.rightWingWidth - primaryBathWidth,
      h: primaryBathBandDepth,
    };
  const twoBedSuiteBufferRoom = suiteBufferRoom || syntheticRoom(
    'architect_v2_upper_two_bed_suite_buffer',
    'storage',
    2,
    { label: 'Storage', zone: 'service' }
  );
  const normalizedSuiteBufferRoom = {
    ...twoBedSuiteBufferRoom,
    id: twoBedSuiteBufferRoom?.id || 'architect_v2_upper_two_bed_suite_buffer',
    type: 'storage',
    label: twoBedSuiteBufferRoom?.label || 'Storage',
    zone: twoBedSuiteBufferRoom?.zone || 'service',
  };
  const blockedForUpper = [circulation.landingRect, circulation.stairsRect];
  const adjustedSecondaryBedroomRect = zoneModel
    ? deriveZoneNativeRect(
      { x: 0, y: circulation.stairY, w: circulation.leftWingWidth, h: height - circulation.stairY },
      zoneModel.wingRect,
      width,
      height,
      blockedForUpper,
      { minWidth: 10, minHeight: 10 }
    )
    : { x: 0, y: circulation.stairY, w: circulation.leftWingWidth, h: height - circulation.stairY };
  blockedForUpper.push(adjustedSecondaryBedroomRect);

  const adjustedPrimarySuiteRect = primarySuiteRect;
  blockedForUpper.push(adjustedPrimarySuiteRect);

  const supportRoomForZone = upperSupportHostsFeature ? specialRoom : upperSupportRoom;
  const supportZoneRect = zoneModel ? preferredZoneRectForRoom(supportRoomForZone, zoneModel) : null;
  const sharedBathRect = { x: 0, y: circulation.landingY, w: circulation.landingX, h: circulation.landingRect.h };
  blockedForUpper.push(sharedBathRect);
  const adjustedUpperSupportRect = zoneModel
    ? deriveZoneNativeRect(upperSupportRect, supportZoneRect, width, height, blockedForUpper, { minWidth: 8, minHeight: 8 })
    : upperSupportRect;
  blockedForUpper.push(adjustedUpperSupportRect);

  const level2Rooms = [
      upperSupportHostsFeature
        ? withZonePlacementMeta(
          placeRoom(specialRoom, adjustedUpperSupportRect),
          supportZoneRect === zoneModel?.wingRect ? 'wing' : 'body'
        )
        : withZonePlacementMeta(
          placeGraphSupportRoom(upperSupportRoom, adjustedUpperSupportRect, 'architect_v2_upper_storage'),
          supportZoneRect === zoneModel?.wingRect ? 'wing' : 'body'
        ),
      placeRoom(sharedBathRoom, sharedBathRect),
      circulation.landingRoom,
      circulation.stairRoom,
      withZonePlacementMeta(
        placeRoom(secondaryBedroom, adjustedSecondaryBedroomRect),
        zoneModel ? 'wing' : null
      ),
      withZonePlacementMeta(
        placeRoom(primarySuiteRoom, adjustedPrimarySuiteRect),
        zoneModel ? 'body' : null
      ),
      placeRoom(primaryBathRoom, primaryBathRect),
  ];
  if (primaryBathSupportRect.w >= 4 && primaryBathSupportRect.h >= 4) {
    level2Rooms.push(placeRoom(normalizedSuiteBufferRoom, primaryBathSupportRect));
  }

  // In the compact family an eight-by-six shared bathroom competes with its
  // door swing for fixture clearances. Borrow two feet from incidental loft
  // space above it, preserving all area and the existing stair/landing core.
  if (!zoneModel && !upperSupportHostsFeature && sharedBathRoom && sharedBathRect.w <= 8 && sharedBathRect.h < 8) {
    const bath = level2Rooms.find(r => r.id === sharedBathRoom.id);
    const support = level2Rooms[0];
    const extra = 8 - bath.h;
    if (support && !support.requestedFeature && support.y + support.h === bath.y && support.h - extra >= 4) {
      bath.y -= extra;
      bath.h += extra;
      support.parts = subtract([adjustedUpperSupportRect], [bath]);
      Object.assign(support, boundsOfRooms(support.parts));
    }
  }

  return {
    rooms: level2Rooms,
    stairCore: circulation.stairCore,
  };
}

function buildThreeBedUpperLevel(width, height, program, graph, options = {}) {
  if (width >= 38) {
    const upperCoreVariation = resolveUpperVariationCore(options.footprint || null);
    const upperVariationId = String(upperCoreVariation.variationId || 'variant_a_compact_core');
    const stairRun = Math.max(10, Math.min(16, Math.max(12, Math.min(16, height - 16)) + upperCoreVariation.stairRunBias));
    const circulation = buildSharedUpperGarageCirculationCore({
      wideDoorways: Boolean(program?.interpretation?.accessibilityPolicy?.wideDoors || program?.interpretation?.accessibilityPolicy?.wheelchair),
      width,
      height,
      leftWingWidth: upperCoreVariation.leftWingWidth,
      landingDepth: upperCoreVariation.landingDepth,
      landingWidth: upperCoreVariation.landingWidth,
      stairRun,
      stairAnchor: options.stairCoreAnchor || null,
      stairsRoom: roomByKey(graph, program, 'stair_core_upper'),
      landingRoom: roomByKey(graph, program, 'landing'),
    });
    const primaryBedroom = roomByKey(graph, program, 'primary_suite');
    const primaryBath = roomByKey(graph, program, 'primary_bath_buffer');
    const secondaryBedroomA = roomByKey(graph, program, 'secondary_bedroom_1');
    const secondaryBedroomB = roomByKey(graph, program, 'secondary_bedroom_2');
    const sharedBath = roomByKey(graph, program, 'shared_bath');
    const secondaryPrivateBath = roomByKey(graph, program, 'secondary_private_bath');
    const upperSupportRoom = roomByKey(graph, program, 'storage_upper');
    const suiteBufferRoom = roomByKey(graph, program, 'suite_buffer');
    const specialRoom = pickFeatureRoomForLevel(graph, program, 2);
    const zoneModel = resolveWingZoneModel(options?.footprint, width, height);

    const topHeight = Math.max(10, circulation.landingY);
    const topBedroomRect = { x: 0, y: 0, w: circulation.leftWingWidth, h: topHeight };
    const sharedBathRect = { x: 0, y: circulation.landingY, w: circulation.landingX, h: circulation.landingRect.h };
    const lowerBedroomRect = { x: 0, y: circulation.stairY, w: circulation.leftWingWidth, h: height - circulation.stairY };
    let centerTopRect = { x: circulation.leftWingWidth, y: 0, w: circulation.stairWidth, h: topHeight };
    const preferredPrimaryTopDepth = upperVariationId === 'variant_b_daylight_wing'
      ? 12
      : upperVariationId === 'variant_c_service_spine'
        ? 16
        : 14;
    const minimumDoorOverlapDepth = circulation.landingY + (circulation.stairCore.wideDoorways ? 5 : 4);
    const primaryTopDepth = Math.max(10, Math.min(height - 10, Math.max(preferredPrimaryTopDepth, minimumDoorOverlapDepth)));
    const primaryBedroomRect = { x: circulation.rightWingX, y: 0, w: circulation.rightWingWidth, h: primaryTopDepth };
    const eastColumnWidth = Math.min(8, circulation.rightWingWidth);
    const loftRect = {
      x: circulation.rightWingX,
      y: primaryTopDepth,
      w: circulation.rightWingWidth - eastColumnWidth,
      h: height - primaryTopDepth,
    };
    const primaryBathRect = {
      x: circulation.rightWingX + circulation.rightWingWidth - eastColumnWidth,
      y: primaryTopDepth,
      w: eastColumnWidth,
      h: 10,
    };
    let rightSupportRect = {
      x: circulation.rightWingX + circulation.rightWingWidth - eastColumnWidth,
      y: primaryTopDepth + 10,
      w: eastColumnWidth,
      h: height - (primaryTopDepth + 10),
    };

    const northwestSupportRoom = sharedBath
      ? null
      : upperSupportRoom || syntheticRoom('architect_v2_upper_three_bed_northwest_support', 'storage', 2, { label: 'Storage', zone: 'service' });

    // Determine if the loft rect is large enough to host the special room.
    // For gym: requires 200 sqft minimum; for library: 140 sqft; for study: 100 sqft.
    const loftAreaSqFt = loftRect.w * loftRect.h;
    const specialRoomKind = specialRoom?.requestedFeatureKind || specialRoom?.type || null;
    const FEATURE_MIN_AREA = { study: 100, library: 140, gym: 180 };
    const featureMinArea = FEATURE_MIN_AREA[specialRoomKind] || 100;
    const upperGymSwapCandidate =
      specialRoom &&
      Number(specialRoom?.level) === 2 &&
      specialRoomKind === 'gym' &&
      (lowerBedroomRect.w * lowerBedroomRect.h) >= featureMinArea &&
      (loftRect.w * loftRect.h) >= 120;
    const loftSufficientForFeature = specialRoom && Number(specialRoom?.level) === 2 && loftAreaSqFt >= featureMinArea;

    // Study and library go on the left wing (adjacent to landing hall, independent
    // of the primary suite). Gym stays in loft or swaps to the lower wing for area.
    const isStudyOrLibrary = specialRoomKind === 'study' || specialRoomKind === 'library';
    const leftWingStudyCandidate =
      specialRoom &&
      Number(specialRoom?.level) === 2 &&
      isStudyOrLibrary &&
      (lowerBedroomRect.w * lowerBedroomRect.h) >= featureMinArea;

    const lowerWingHostsFeature = upperGymSwapCandidate || leftWingStudyCandidate;
    // This family has two ground-floor features. Give its third profile a
    // genuinely different upper arrangement with the secondary bedroom in
    // the generous east bay, retaining independent access below.
    const socialPairEastBedroom = upperVariationId === 'variant_c_service_spine' &&
      !specialRoom && isSocialFeaturePair(featureRoomsByKeys(graph, program).map(room => room.type));
    let lowerWingRoomRef = lowerWingHostsFeature ? specialRoom : socialPairEastBedroom
      ? syntheticRoom('architect_v2_upper_three_bed_west_loft', 'loft', 2, { label: 'Upper Loft', zone: 'public' })
      : secondaryBedroomA;
    let lowerWingRect = lowerBedroomRect;

    const rightLowerHostsFeature = !upperGymSwapCandidate && !leftWingStudyCandidate && loftSufficientForFeature;
    const rightLowerUsesBedroom = upperGymSwapCandidate || leftWingStudyCandidate || socialPairEastBedroom;
    const rightLowerRoomRef = rightLowerHostsFeature
      ? specialRoom
      : rightLowerUsesBedroom
        ? secondaryBedroomA
        : null;
    let rightLowerRect = loftRect;

    const zoneBlockedRects = [
      circulation.landingRect,
      circulation.stairsRect,
      sharedBathRect,
      centerTopRect,
      topBedroomRect,
      primaryBedroomRect,
      primaryBathRect,
      rightSupportRect,
    ];
    if (zoneModel && lowerWingHostsFeature) {
      const lowerZoneRect = preferredZoneRectForRoom(lowerWingRoomRef, zoneModel);
      lowerWingRect = deriveZoneNativeRect(
        lowerWingRect,
        lowerZoneRect,
        width,
        height,
        zoneBlockedRects,
        { minWidth: specialRoomKind === 'gym' ? 12 : 10, minHeight: specialRoomKind === 'gym' ? 12 : 10 }
      );
    }
    zoneBlockedRects.push(lowerWingRect);

    if (zoneModel && rightLowerHostsFeature) {
      const rightZoneRect = preferredZoneRectForRoom(rightLowerRoomRef, zoneModel);
      rightLowerRect = deriveZoneNativeRect(
        rightLowerRect,
        rightZoneRect,
        width,
        height,
        zoneBlockedRects,
        { minWidth: specialRoomKind === 'gym' ? 12 : 10, minHeight: specialRoomKind === 'gym' ? 12 : 10 }
      );
    }

    let adjustedTopBedroomRect = topBedroomRect;
    const adjustedPrimaryBedroomRect = primaryBedroomRect;
    if (zoneModel) {
      const blocked = [
        circulation.landingRect,
        circulation.stairsRect,
        sharedBathRect,
        lowerWingRect,
        centerTopRect,
        primaryBedroomRect,
        rightLowerRect,
        primaryBathRect,
        rightSupportRect,
      ];
      adjustedTopBedroomRect = deriveZoneNativeRect(topBedroomRect, zoneModel.wingRect, width, height, blocked, { minWidth: 10, minHeight: 10 });
    }

    if (zoneModel && centerTopRect.w >= 4 && centerTopRect.h >= 4) {
      const centerRoomForDerive = secondaryPrivateBath || upperSupportRoom;
      const centerZoneRect = preferredZoneRectForRoom(centerRoomForDerive, zoneModel) || zoneModel.bodyRect;
      const centerCandidate = deriveZoneNativeRect(
        centerTopRect,
        centerZoneRect,
        width,
        height,
        [
          circulation.landingRect,
          circulation.stairsRect,
          sharedBathRect,
          lowerWingRect,
          adjustedTopBedroomRect,
          primaryBedroomRect,
          rightLowerRect,
          primaryBathRect,
          rightSupportRect,
        ],
        { minWidth: 4, minHeight: 4 }
      );
      // Hard gate: an upper secondary private bath must remain landing-accessible.
      if (!secondaryPrivateBath || rectsShareEdge(centerCandidate, circulation.landingRect)) {
        centerTopRect = centerCandidate;
      }
    }

    if (zoneModel && rightSupportRect.w >= 4 && rightSupportRect.h >= 4) {
      const rightSupportCandidate = deriveZoneNativeRect(
        rightSupportRect,
        zoneModel.bodyRect,
        width,
        height,
        [
          circulation.landingRect,
          circulation.stairsRect,
          sharedBathRect,
          lowerWingRect,
          adjustedTopBedroomRect,
          primaryBedroomRect,
          rightLowerRect,
          primaryBathRect,
          centerTopRect,
        ],
        { minWidth: 4, minHeight: 4 }
      );
      // Keep suite buffer physically buffering the primary bath.
      if (rectsShareEdge(rightSupportCandidate, primaryBathRect)) {
        rightSupportRect = rightSupportCandidate;
      }
    }

    const lowerWingRoom = lowerWingHostsFeature
      ? (
        zoneModel
          ? withZonePlacementMeta(
            placeRoom(lowerWingRoomRef, lowerWingRect),
            preferredZoneRectForRoom(lowerWingRoomRef, zoneModel) === zoneModel?.wingRect ? 'wing' : 'body'
          )
          : placeRoom(lowerWingRoomRef, lowerWingRect)
      )
      : placeRoom(lowerWingRoomRef, lowerWingRect);

    const rightLowerRoom = rightLowerHostsFeature
      ? (
        zoneModel
          ? withZonePlacementMeta(
            placeRoom(rightLowerRoomRef, rightLowerRect),
            preferredZoneRectForRoom(rightLowerRoomRef, zoneModel) === zoneModel?.wingRect ? 'wing' : 'body'
          )
          : placeRoom(rightLowerRoomRef, rightLowerRect)
      )
      : rightLowerUsesBedroom
        ? placeRoom(rightLowerRoomRef, rightLowerRect)
        : placeGraphSupportRoom(null, rightLowerRect, 'architect_v2_upper_three_bed_loft', 'Upper Loft');

    const level2Rooms = [
      sharedBath
        ? placeRoom(sharedBath, sharedBathRect)
        : placeGraphSupportRoom(northwestSupportRoom, sharedBathRect, 'architect_v2_upper_three_bed_northwest_support'),
      lowerWingRoom,
      circulation.landingRoom,
      circulation.stairRoom,
      withZonePlacementMeta(
        placeRoom(secondaryBedroomB, adjustedTopBedroomRect),
        zoneModel ? 'wing' : null
      ),
      withZonePlacementMeta(
        placeRoom(primaryBedroom, adjustedPrimaryBedroomRect),
        zoneModel ? 'body' : null
      ),
      rightLowerRoom,
      placeRoom(primaryBath, primaryBathRect),
    ];

    if (centerTopRect.w >= 4 && centerTopRect.h >= 4) {
      if (secondaryPrivateBath) {
        level2Rooms.push(
          zoneModel
            ? withZonePlacementMeta(
              placeRoom(secondaryPrivateBath, centerTopRect),
              preferredZoneRectForRoom(secondaryPrivateBath, zoneModel) === zoneModel?.wingRect ? 'wing' : 'body'
            )
            : placeRoom(secondaryPrivateBath, centerTopRect)
        );
      } else {
        const centerSupportRoom = {
          ...(upperSupportRoom || syntheticRoom('architect_v2_upper_three_bed_center_support', 'storage', 2, { label: 'Storage', zone: 'service' })),
          label: upperSupportRoom?.label || 'Storage',
          zone: upperSupportRoom?.zone || 'service',
        };
        level2Rooms.push(
          zoneModel
            ? withZonePlacementMeta(
              placeRoom(centerSupportRoom, centerTopRect),
              preferredZoneRectForRoom(centerSupportRoom, zoneModel) === zoneModel?.wingRect ? 'wing' : 'body'
            )
            : placeRoom(centerSupportRoom, centerTopRect)
        );
      }
    }
    if (rightSupportRect.w >= 4 && rightSupportRect.h >= 4) {
      const rightSupportRoom = {
        ...(suiteBufferRoom || syntheticRoom('architect_v2_upper_three_bed_right_support', 'storage', 2, { label: 'Storage', zone: 'service' })),
        label: suiteBufferRoom?.label || 'Storage',
        zone: suiteBufferRoom?.zone || 'service',
      };
      level2Rooms.push(
        zoneModel
          ? withZonePlacementMeta(
            placeRoom(rightSupportRoom, rightSupportRect),
            preferredZoneRectForRoom(rightSupportRoom, zoneModel) === zoneModel?.wingRect ? 'wing' : 'body'
          )
          : placeRoom(rightSupportRoom, rightSupportRect)
      );
    }

    if (rightLowerUsesBedroom || rightLowerHostsFeature) {
      reserveUpperRoomAccess(level2Rooms, circulation,
        level2Rooms.find(r => r.id === primaryBedroom.id),
        level2Rooms.find(r => r.id === rightLowerRoom.id));
    }

    return {
      rooms: level2Rooms,
      stairCore: circulation.stairCore,
    };
  }

  const circulation = buildSharedUpperGarageCirculationCore({
    wideDoorways: Boolean(program?.interpretation?.accessibilityPolicy?.wideDoors || program?.interpretation?.accessibilityPolicy?.wheelchair),
    width,
    height,
    ...resolveUpperVariationCore(options.footprint || null),
    stairAnchor: options.stairCoreAnchor || null,
    stairsRoom: roomByKey(graph, program, 'stair_core_upper'),
    landingRoom: roomByKey(graph, program, 'landing'),
  });
  const upperSupportRoom = roomByKey(graph, program, 'storage_upper');
  return {
    rooms: [
      placeGraphSupportRoom(upperSupportRoom, { x: 0, y: 0, w: circulation.landingX, h: circulation.landingY }, 'architect_v2_upper_storage'),
      placeRoom(roomByKey(graph, program, 'secondary_bedroom_2'), { x: circulation.landingX, y: 0, w: circulation.rightWingX - circulation.landingX, h: circulation.landingY }),
      placeRoom(roomByKey(graph, program, 'shared_bath'), { x: 0, y: circulation.landingY, w: circulation.landingX, h: circulation.landingRect.h }),
      circulation.landingRoom,
      circulation.stairRoom,
      placeRoom(roomByKey(graph, program, 'secondary_bedroom_1'), { x: 0, y: circulation.stairY, w: circulation.leftWingWidth, h: height - circulation.stairY }),
      placeRoom(roomByKey(graph, program, 'primary_suite'), { x: circulation.rightWingX, y: 0, w: circulation.rightWingWidth, h: height - 10 }),
      placeRoom(roomByKey(graph, program, 'primary_bath_buffer'), { x: circulation.rightWingX, y: height - 10, w: circulation.rightWingWidth, h: 10 }),
    ],
    stairCore: circulation.stairCore,
  };
}

function reserveUpperRoomAccess(rooms, circulation, primaryRoom, lowerRoom) {
  if (!primaryRoom || !lowerRoom) return;
  // When two private rooms meet halfway down a landing, neither may have
  // enough shared wall for a real doorway. Reserve one short branch and
  // carve its footprint from the rooms instead of drawing doors over corners.
  const accessSpan = circulation.stairCore.wideDoorways ? 5 : 4;
  const landingRight = circulation.landingRect.x + circulation.landingRect.w;
  const splitY = lowerRoom.y;
  const primaryAccess = Math.min(splitY, circulation.stairY) - circulation.landingY;
  const lowerAccess = circulation.stairY - Math.max(splitY, circulation.landingY);
  if (Math.abs(landingRight - circulation.rightWingX) < 0.01 &&
      (primaryAccess < accessSpan || lowerAccess < accessSpan)) {
    const branch = { x: circulation.rightWingX, y: splitY - accessSpan, w: 4, h: accessSpan * 2 };
    if (primaryRoom && lowerRoom && branch.y >= primaryRoom.y &&
        branch.y + branch.h <= lowerRoom.y + lowerRoom.h && lowerRoom.w >= 10 &&
        branch.y < circulation.stairY && branch.y + branch.h > circulation.landingY) {
      primaryRoom.parts = [
        { x: primaryRoom.x, y: primaryRoom.y, w: primaryRoom.w, h: branch.y - primaryRoom.y },
        { x: branch.x + branch.w, y: branch.y, w: primaryRoom.w - branch.w, h: splitY - branch.y },
      ].filter(p => p.w > 0 && p.h > 0);
      lowerRoom.parts = [
        { x: branch.x + branch.w, y: splitY, w: lowerRoom.w - branch.w, h: branch.y + branch.h - splitY },
        { x: lowerRoom.x, y: branch.y + branch.h, w: lowerRoom.w, h: lowerRoom.y + lowerRoom.h - (branch.y + branch.h) },
      ].filter(p => p.w > 0 && p.h > 0);
      const branchId = 'architect_v2_upper_room_access';
      rooms.push(placeRoom(syntheticRoom(branchId, 'hallway', 2, { label: 'Room Access', zone: 'circulation' }), branch));
      circulation.stairCore.branchRoomIds = [branchId];
    }
  }
}

function buildFourBedUpperLevel(width, height, program, graph, options = {}) {
  if (width < 42) {
    throw new Error('orthogonal assembler requires a minimum 42 ft width for two-story four-bedroom families');
  }

  const upperCoreVariation = resolveUpperVariationCore(options.footprint || null);
  const upperVariationId = String(upperCoreVariation.variationId || 'variant_a_compact_core');
  const stairRun = Math.max(10, Math.min(16, Math.max(12, Math.min(16, height - 16)) + upperCoreVariation.stairRunBias));
  const circulation = buildSharedUpperGarageCirculationCore({
    wideDoorways: Boolean(program?.interpretation?.accessibilityPolicy?.wideDoors || program?.interpretation?.accessibilityPolicy?.wheelchair),
    width,
    height,
    leftWingWidth: upperCoreVariation.leftWingWidth,
    landingDepth: upperCoreVariation.landingDepth,
    landingWidth: upperCoreVariation.landingWidth,
    stairRun,
    stairAnchor: options.stairCoreAnchor || null,
    stairsRoom: roomByKey(graph, program, 'stair_core_upper'),
    landingRoom: roomByKey(graph, program, 'landing'),
  });

  const primaryBedroom = roomByKey(graph, program, 'primary_suite');
  const primaryBath = roomByKey(graph, program, 'primary_bath_buffer');
  const secondaryBedroomA = roomByKey(graph, program, 'secondary_bedroom_1');
  const secondaryBedroomB = roomByKey(graph, program, 'secondary_bedroom_2');
  const secondaryBedroomC = roomByKey(graph, program, 'secondary_bedroom_3');
  const sharedBath = roomByKey(graph, program, 'shared_bath');
  const secondaryPrivateBath = roomByKey(graph, program, 'secondary_private_bath');
  const upperSupportRoom = roomByKey(graph, program, 'storage_upper');
  const suiteBufferRoom = roomByKey(graph, program, 'suite_buffer');

  const topHeight = Math.max(10, circulation.landingY);
  const leftTopRect = { x: 0, y: 0, w: circulation.leftWingWidth, h: topHeight };
  const leftBottomRect = { x: 0, y: circulation.stairY, w: circulation.leftWingWidth, h: height - circulation.stairY };
  const centerTopRect = { x: circulation.leftWingWidth, y: 0, w: circulation.stairWidth, h: topHeight };
  const sharedBathRect = { x: 0, y: circulation.landingY, w: circulation.landingX, h: circulation.landingRect.h };

  const preferredPrimaryTopDepth = upperVariationId === 'variant_b_daylight_wing'
    ? 12
    : upperVariationId === 'variant_c_service_spine'
      ? 16
      : 14;
  const primaryTopDepth = Math.max(10, Math.min(height - 10, preferredPrimaryTopDepth));
  const rightLowerDepth = Math.max(8, height - primaryTopDepth);
  const rightLowerMinBedroomWidth = 10;
  const primaryBathWidth = Math.max(6, Math.min(8, circulation.rightWingWidth - rightLowerMinBedroomWidth));
  const rightLowerBedroomWidth = circulation.rightWingWidth - primaryBathWidth;

  if (rightLowerBedroomWidth < rightLowerMinBedroomWidth) {
    throw new Error('orthogonal assembler could not reserve valid lower-right bedroom width for four-bedroom family');
  }

  const primaryBedroomRect = { x: circulation.rightWingX, y: 0, w: circulation.rightWingWidth, h: primaryTopDepth };
  const rightLowerBedroomRect = { x: circulation.rightWingX, y: primaryTopDepth, w: rightLowerBedroomWidth, h: rightLowerDepth };
  const primaryBathRect = {
    x: circulation.rightWingX + rightLowerBedroomWidth,
    y: primaryTopDepth,
    w: primaryBathWidth,
    h: rightLowerDepth,
  };

  const centerRoom = secondaryPrivateBath
    ? placeRoom(secondaryPrivateBath, centerTopRect)
    : placeGraphSupportRoom(
      suiteBufferRoom || upperSupportRoom,
      centerTopRect,
      'architect_v2_upper_four_bed_center_support',
      'Storage'
    );

  const rooms = [
      placeRoom(sharedBath, sharedBathRect),
      placeRoom(secondaryBedroomA, leftBottomRect),
      circulation.landingRoom,
      circulation.stairRoom,
      placeRoom(secondaryBedroomB, leftTopRect),
      centerRoom,
      placeRoom(primaryBedroom, primaryBedroomRect),
      placeRoom(secondaryBedroomC, rightLowerBedroomRect),
      placeRoom(primaryBath, primaryBathRect),
  ];
  reserveUpperRoomAccess(rooms, circulation,
    rooms.find(r => r.id === primaryBedroom.id), rooms.find(r => r.id === secondaryBedroomC.id));
  if (primaryBath && primaryBathRect.h > 20) {
    const bath = rooms.find(r => r.id === primaryBath.id);
    const bedroom = rooms.find(r => r.id === secondaryBedroomC.id);
    // Keep the ensuite at its owner's shared boundary. Surplus depth belongs
    // to the adjacent sleeping room, rather than a forty-foot bathroom strip.
    bedroom.parts = [...partListOf(bedroom).map(({x,y,w,h})=>({x,y,w,h})), {
      x: bath.x, y: bath.y + 16, w: bath.w, h: bath.h - 16,
    }];
    Object.assign(bedroom, boundsOfRooms(bedroom.parts));
    bath.h = 16;
  }
  return { rooms, stairCore: circulation.stairCore };
}

/* A two-storey house whose upper floor stops short of the garage.
 *
 * The two-storey garage templates need roughly 44 ft of service/public width
 * and at least 28 ft of depth on the ground floor. Below about 2,000 finished
 * sq ft that floor plate, doubled, overshoots the requested area: the smallest
 * candidate the search can offer is 44x28, which delivers 2,464 sq ft against a
 * 2,240 sq ft gross target and fails the area check by 224 sq ft on a 179 sq ft
 * tolerance. No amount of repacking fixes that, because both levels are filled
 * to the same rectangle.
 *
 * Building the upper floor over everything except (part of) the garage is the
 * ordinary way a house of this size is drawn - a two-storey block beside a
 * single-storey garage, sometimes with a room bridging over it. This picks the
 * smallest reduction that lands the delivered area inside tolerance, so the
 * overhang is as large as the brief allows rather than the garage being bare by
 * default.
 *
 * It engages ONLY when the full-fill layout would miss the area target. Every
 * brief that fits today keeps its existing geometry.
 */
function resolvePartialUpperFloor({ width, height, level1, footprint }) {
    const targetGrossSqFt = num(footprint?.footprintAreaSqFtTarget);
    if (targetGrossSqFt <= 0) return null;

    // Rectangular envelopes only. An L or T footprint already carves voids out
    // of BOTH levels, so width x height overstates its area and this would
    // shorten an upper floor that is not oversized at all - and the carving
    // assumes the two levels share one rectangle. A partial upper floor on a
    // non-rectangular envelope needs the coordinated envelope/roof work that
    // the execution plan schedules for P10.
    const voidRects = Array.isArray(footprint?.envelopeVoidRects) ? footprint.envelopeVoidRects : [];
    const envelopeShape = String(footprint?.envelopeShape || footprint?.shape || 'RECTANGULAR').toUpperCase();
    if (voidRects.length || (envelopeShape && envelopeShape !== 'RECTANGULAR')) return null;

    const fullGrossSqFt = width * height * 2;
    // Mirrors validators/areaDeltaValidator.js. Kept in sync deliberately: a
    // reduction that satisfies a looser rule here would be rejected later.
    const toleranceSqFt = Math.max(120, Math.round(targetGrossSqFt * 0.08));
    if (fullGrossSqFt - targetGrossSqFt <= toleranceSqFt) return null;

    const garage = (level1?.rooms || []).find((room) => String(room?.type || '').toLowerCase() === 'garage');
    if (!garage) return null;
    const garageX = num(garage.x);
    const garageW = num(garage.w);
    if (garageW < 2) return null;

    // Only a garage against the left or right edge leaves a clean rectangular
    // block for the storey above. A garage in the middle would need a real
    // two-part upper envelope, which is out of scope here.
    const onLeft = garageX === 0;
    const onRight = garageX + garageW === width;
    if (!onLeft && !onRight) return null;

    const stairX = num(level1?.stairCore?.x, NaN);
    const stairW = num(level1?.stairCore?.w, 0);
    if (!Number.isFinite(stairX)) return null;

    let best = null;
    // Even reductions only: the whole assembler works on a 2 ft grid.
    for (let reduction = 2; reduction <= garageW; reduction += 2) {
        const upperWidth = width - reduction;
        if (upperWidth < 20) break;
        const offsetX = onLeft ? reduction : 0;
        // The flight has to land inside the storey above it.
        if (stairX < offsetX || stairX + stairW > offsetX + upperWidth) continue;
        const grossSqFt = width * height + upperWidth * height;
        const deltaSqFt = Math.abs(grossSqFt - targetGrossSqFt);
        if (deltaSqFt > toleranceSqFt) continue;
        if (!best || deltaSqFt < best.deltaSqFt) best = { upperWidth, offsetX, reduction, deltaSqFt };
    }
    return best;
}

function shiftUpperLevel(level, offsetX) {
    if (!offsetX) return level;
    return {
        ...level,
        rooms: (level.rooms || []).map((room) => ({ ...room, x: num(room.x) + offsetX,
          ...(room.parts?.length ? { parts: room.parts.map(part => ({ ...part, x: num(part.x) + offsetX })) } : {}),
        })),
        stairCore: level.stairCore ? { ...level.stairCore, x: num(level.stairCore.x) + offsetX } : level.stairCore,
    };
}

function assembleTwoStoryGarage({
  interpretation,
  footprint,
  program,
  graph,
  includeStudy = false,
  threeBed = false,
  fourBed = false,
}) {
  const width = num(footprint?.widthFt, 40);
  const height = num(footprint?.heightFt, 28);
  if (height < 28) {
    throw new Error('orthogonal assembler requires a minimum 28 ft depth for two-story garage families');
  }

  const specialRoom = roomByKey(graph, program, 'special_room');
  const lowerFeatureVariant = specialRoom && Number(specialRoom?.level) === 1;
  const lowerStudy = includeStudy && (program.levels.find(l=>Number(l.level)===1)?.rooms || []).some(r=>r.type==='study');
  const lowerClusterVariant = fourBed ? 'three_bed' : (threeBed ? 'three_bed' : 'two_bed');

  const level1 = lowerFeatureVariant
    ? buildLowerFloorLevel(width, height, program, graph, 'feature_room', footprint, interpretation)
    : lowerStudy
      ? buildLowerFloorLevel(width, height, program, graph, 'study', footprint, interpretation)
      : buildLowerFloorLevel(width, height, program, graph, lowerClusterVariant, footprint, interpretation);
  const partialUpper = resolvePartialUpperFloor({ width, height, level1, footprint });
  const upperWidth = partialUpper ? partialUpper.upperWidth : width;
  const upperOffsetX = partialUpper ? partialUpper.offsetX : 0;
  // The upper builder works in its own coordinates, so the anchor it is given
  // has to be expressed there too; the finished level is shifted back below.
  const upperStairAnchor = upperOffsetX && level1.stairCore
    ? { ...level1.stairCore, x: num(level1.stairCore.x) - upperOffsetX }
    : level1.stairCore;

  const rawLevel2 = fourBed
    ? buildFourBedUpperLevel(upperWidth, height, program, graph, { footprint, stairCoreAnchor: upperStairAnchor })
    : threeBed
    ? buildThreeBedUpperLevel(upperWidth, height, program, graph, { footprint, stairCoreAnchor: upperStairAnchor })
    : buildTwoBedUpperLevel(
      upperWidth,
      height,
      program,
      graph,
      lowerStudy
        ? { stairRun: Math.max(10, height - 18), footprint, stairCoreAnchor: upperStairAnchor }
        : { footprint, stairCoreAnchor: upperStairAnchor }
    );
  const level2 = shiftUpperLevel(rawLevel2, upperOffsetX);

  return {
    levels: [
      {
        level: 1,
        width,
        height,
        rooms: level1.rooms,
        stairCore: level1.stairCore,
      },
      {
        level: 2,
        width,
        height,
        rooms: level2.rooms,
        stairCore: level2.stairCore,
      },
    ],
  };
}

function assembleTwoStoryCompact({ interpretation, footprint, program, graph, threeBed = false, fourBed = false }) {
  const width = num(footprint?.widthFt, 40);
  const height = num(footprint?.heightFt, 30);
  if (height < (!threeBed && !fourBed && Number(footprint.totalAreaSqFt) <= 1600 ? 26 : 28)) {
    throw new Error('orthogonal assembler requires a minimum 28 ft depth for two-story compact families');
  }

  const level1 = buildLowerFloorCompactLevel(width, height, program, graph, footprint);
  rebalanceOversizedServiceRooms(level1);
  const level2 = fourBed
    ? buildFourBedUpperLevel(width, height, program, graph, { footprint, stairCoreAnchor: level1.stairCore })
    : threeBed
    ? buildThreeBedUpperLevel(width, height, program, graph, { footprint, stairCoreAnchor: level1.stairCore })
    : buildTwoBedUpperLevel(width, height, program, graph, { footprint, stairCoreAnchor: level1.stairCore });

  return {
    levels: [
      {
        level: 1,
        width,
        height,
        rooms: level1.rooms,
        stairCore: level1.stairCore,
      },
      {
        level: 2,
        width,
        height,
        rooms: level2.rooms,
        stairCore: level2.stairCore,
      },
    ],
  };
}

function assembleOrthogonalPlanV2({ interpretation, footprint, program, graph }) {
  const pattern = String(interpretation?.housePattern || '');
  let layout = null;
  if (pattern === 'two_story_upper_primary_compact') {
    layout = assembleTwoStoryCompact({ interpretation, footprint, program, graph, threeBed: false });
  } else if (pattern === 'two_story_upper_primary_three_bed_compact') {
    layout = assembleTwoStoryCompact({ interpretation, footprint, program, graph, threeBed: true });
  } else if (pattern === 'two_story_upper_primary_four_bed_compact') {
    layout = assembleTwoStoryCompact({ interpretation, footprint, program, graph, fourBed: true });
  } else if (pattern === 'two_story_upper_primary_with_garage') {
    layout = assembleTwoStoryGarage({ interpretation, footprint, program, graph, includeStudy: false, threeBed: false });
  } else if (pattern === 'two_story_upper_primary_with_garage_three_bed') {
    layout = assembleTwoStoryGarage({ interpretation, footprint, program, graph, includeStudy: false, threeBed: true });
  } else if (pattern === 'two_story_upper_primary_with_garage_four_bed') {
    layout = assembleTwoStoryGarage({ interpretation, footprint, program, graph, includeStudy: false, fourBed: true });
  } else if (pattern === 'two_story_upper_primary_with_garage_study') {
    layout = assembleTwoStoryGarage({ interpretation, footprint, program, graph, includeStudy: true, threeBed: false });
  } else {
    throw new Error(`orthogonal assembler does not support pattern ${pattern || 'unknown'}`);
  }
  return layout;
}

module.exports = {
  shiftUpperLevel,
  assembleOrthogonalPlanV2,
  attachRoomToBranch,
  applyWingAwarePlacement,
  applyFootprintShapeToLayout,
  resolveWingZoneModel,
  deriveZoneNativeRect,
};
