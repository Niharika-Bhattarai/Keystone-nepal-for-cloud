'use strict';

const { normalizeRoomType } = require('../../../tile/canonicalRoomTypes');
const { partListOf } = require('../../../planGeometry');

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function levelByNumber(planSpec, levelNumber) {
  return (Array.isArray(planSpec?.levels) ? planSpec.levels : [])
    .find((level) => num(level?.level, 1) === num(levelNumber, 1)) || null;
}

function roomByIdMap(planSpec) {
  const rooms = (Array.isArray(planSpec?.levels) ? planSpec.levels : [])
    .flatMap((level) => Array.isArray(level?.rooms) ? level.rooms : []);
  return new Map(rooms.map((room) => [String(room?.id || ''), room]).filter(([id]) => id));
}

function isHabitableForDaylight(type) {
  const t = normalizeRoomType(type);
  return [
    'living_room',
    'kitchen',
    'dining_room',
    'primary_bedroom',
    'bedroom',
    'guest_bedroom',
    'study',
    'library',
    'gym',
    'gaming_room',
    'movie_room',
    'music_room',
    'loft',
  ].includes(t);
}

function roomTypeWeight(type) {
  const t = normalizeRoomType(type);
  if (['living_room', 'kitchen', 'dining_room'].includes(t)) return 1.3;
  if (['primary_bedroom', 'bedroom', 'guest_bedroom'].includes(t)) return 1.25;
  return 1.0;
}

function roomExteriorSides(room, level) {
  const width = num(level?.width);
  const height = num(level?.height);
  const sides = new Set();
  for (const part of partListOf(room)) {
    if (num(part?.y) <= 0) sides.add('north');
    if (num(part?.y2) >= height) sides.add('south');
    if (num(part?.x) <= 0) sides.add('west');
    if (num(part?.x2) >= width) sides.add('east');
  }
  return sides;
}

function daylightEntries(planSpec, graph) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  if (nodes.length) {
    return nodes.map((node) => ({
      roomId: String(node?.roomId || ''),
      level: num(node?.level, 1),
      type: String(node?.type || ''),
      exteriorEdgesRequired: num(node?.exteriorEdgesRequired, NaN),
      resolvedPreferredSide: String(node?.resolvedPreferredSide || '').toLowerCase() || null,
    }));
  }

  const fallback = [];
  for (const level of Array.isArray(planSpec?.levels) ? planSpec.levels : []) {
    for (const room of Array.isArray(level?.rooms) ? level.rooms : []) {
      fallback.push({
        roomId: String(room?.id || ''),
        level: num(level?.level, 1),
        type: String(room?.type || ''),
        exteriorEdgesRequired: num(room?.exteriorEdgesRequired, NaN),
        resolvedPreferredSide: String(room?.resolvedPreferredSide || '').toLowerCase() || null,
      });
    }
  }
  return fallback;
}

function scoreDaylightOrientation({ planSpec, graph }) {
  const roomsById = roomByIdMap(planSpec);
  const entries = daylightEntries(planSpec, graph);

  let weightedTarget = 0;
  let weightedAchieved = 0;
  const issues = [];
  const warnings = [];

  for (const entry of entries) {
    const room = roomsById.get(String(entry?.roomId || ''));
    if (!room) continue;
    const type = normalizeRoomType(entry?.type || room?.type);
    if (!isHabitableForDaylight(type)) continue;

    const level = levelByNumber(planSpec, entry?.level);
    if (!level) continue;

    const exposureSides = roomExteriorSides(room, level);
    const exposureCount = exposureSides.size;
    const requiredEdges = Math.max(1, num(entry?.exteriorEdgesRequired, num(room?.exteriorEdgesRequired, 1)));
    const preferredSide = String(entry?.resolvedPreferredSide || room?.resolvedPreferredSide || '').toLowerCase() || null;
    const preferredSatisfied = !preferredSide || exposureSides.has(preferredSide);

    const exposureScore = Math.max(0, Math.min(1, exposureCount / requiredEdges));
    const orientationScore = preferredSatisfied ? 1 : 0.45;
    const combined = (0.7 * exposureScore) + (0.3 * orientationScore);
    const weight = roomTypeWeight(type);

    weightedTarget += weight;
    weightedAchieved += combined * weight;

    if (exposureCount < requiredEdges) {
      issues.push(`daylight:exposure_missing:${String(room?.id)}:${exposureCount}/${requiredEdges}`);
    }
    if (preferredSide && !preferredSatisfied) {
      warnings.push(`daylight:orientation_miss:${String(room?.id)}:${preferredSide}`);
    }
  }

  if (weightedTarget <= 0) {
    return { score: 100, issues, warnings };
  }

  const score = Math.max(0, Math.min(100, Math.round((weightedAchieved / weightedTarget) * 100)));
  return { score, issues, warnings };
}

module.exports = {
  scoreDaylightOrientation,
};

