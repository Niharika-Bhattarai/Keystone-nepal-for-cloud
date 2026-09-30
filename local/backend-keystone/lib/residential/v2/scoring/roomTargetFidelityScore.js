'use strict';

const { normalizeRoomType } = require('../../../tile/canonicalRoomTypes');
const { roomArea } = require('../../../planGeometry');

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function roomByIdMap(planSpec) {
  const rooms = (Array.isArray(planSpec?.levels) ? planSpec.levels : [])
    .flatMap((level) => Array.isArray(level?.rooms) ? level.rooms : []);
  return new Map(rooms.map((room) => [String(room?.id || ''), room]).filter(([id]) => id));
}

function isTrackedRoomType(type) {
  const t = normalizeRoomType(type);
  return ![
    'hallway',
    'stairs',
    'entry',
    'garage',
    'storage',
    'closet',
    'pantry',
    'mudroom',
    'laundry',
  ].includes(t);
}

function roomTypeWeight(type) {
  const t = normalizeRoomType(type);
  if (['primary_bedroom', 'bedroom', 'guest_bedroom'].includes(t)) return 1.4;
  if (['primary_bathroom', 'bathroom', 'powder_room'].includes(t)) return 1.15;
  if (['living_room', 'kitchen', 'dining_room'].includes(t)) return 1.25;
  if (['study', 'library', 'gym', 'gaming_room', 'movie_room', 'music_room', 'loft'].includes(t)) return 1.1;
  return 1.0;
}

function roomTargetEntries(planSpec, graph) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  if (nodes.length) {
    return nodes.map((node) => ({
      roomId: String(node?.roomId || ''),
      type: String(node?.type || ''),
      targetAreaSqFt: num(node?.targetAreaSqFt, NaN),
    }));
  }

  const fallbackRooms = (Array.isArray(planSpec?.levels) ? planSpec.levels : [])
    .flatMap((level) => Array.isArray(level?.rooms) ? level.rooms : []);
  return fallbackRooms.map((room) => ({
    roomId: String(room?.id || ''),
    type: String(room?.type || ''),
    targetAreaSqFt: num(room?.targetAreaSqFt, NaN),
  }));
}

function scoreRoomTargetFidelity({ planSpec, graph }) {
  const roomsById = roomByIdMap(planSpec);
  const entries = roomTargetEntries(planSpec, graph);

  let weightedTarget = 0;
  let weightedCompliance = 0;
  const issues = [];
  const warnings = [];

  for (const entry of entries) {
    const roomId = String(entry?.roomId || '');
    if (!roomId || !Number.isFinite(entry?.targetAreaSqFt) || num(entry?.targetAreaSqFt) <= 0) continue;

    const room = roomsById.get(roomId);
    if (!room) {
      warnings.push(`room_target:missing_room:${roomId}`);
      continue;
    }

    const type = normalizeRoomType(entry?.type || room?.type);
    if (!isTrackedRoomType(type)) continue;

    const targetArea = Math.max(1, num(entry?.targetAreaSqFt));
    const actualArea = Math.max(0, roomArea(room));
    const deltaRatio = Math.abs(actualArea - targetArea) / targetArea;
    const compliance = Math.max(0, 1 - deltaRatio);
    const weight = roomTypeWeight(type);

    weightedTarget += weight;
    weightedCompliance += compliance * weight;

    if (deltaRatio > 0.25) {
      issues.push(
        `room_target:${roomId}:actual_${Math.round(actualArea)}_target_${Math.round(targetArea)}_delta_${Math.round(deltaRatio * 100)}pct`
      );
    }
  }

  if (weightedTarget <= 0) {
    return { score: 100, issues, warnings };
  }

  const score = Math.max(0, Math.min(100, Math.round((weightedCompliance / weightedTarget) * 100)));
  return { score, issues, warnings };
}

module.exports = {
  scoreRoomTargetFidelity,
};

