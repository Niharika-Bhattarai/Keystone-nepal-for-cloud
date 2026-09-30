'use strict';

// Boundary lines are nominal wall centrelines. Exterior wall halves outside
// the nominal envelope are excluded from the floor partition equation. This
// is a measurement model with stated assembly assumptions, not rated framing.
const { WALL_ASSEMBLIES, PLUMBING_ROOM_TYPES, GARAGE_ROOM_TYPES, roundFt } = require('./units');
const { boundarySegments } = require('../openingGeometry');
const { union, subtract, intersection, unionArea } = require('./rectBoolean');
const { openPairKeys, pairKey } = require('../openEdges');
const EPS = 1e-7;
const roomType = room => String(room?.type || '').toLowerCase();
const publicTypes = new Set(['living_room', 'kitchen', 'dining_room']);

function partsOf(room) {
  return (room.parts?.length ? room.parts : [room]).map(p => ({ x: Number(p.x), y: Number(p.y), w: Number(p.w), h: Number(p.h) }));
}
function assemblyFor(a, b, exterior) {
  if (exterior) return WALL_ASSEMBLIES.exterior;
  const types = [roomType(a), roomType(b)];
  if (types.some(t => GARAGE_ROOM_TYPES.has(t))) return WALL_ASSEMBLIES.garage;
  if (types.every(t => PLUMBING_ROOM_TYPES.has(t))) return WALL_ASSEMBLIES.plumbing;
  return WALL_ASSEMBLIES.interior;
}
function wallRect(wall) {
  const half = wall.assembly.thicknessFt / 2;
  return wall.orientation === 'vertical'
    ? { x: wall.axisFt - half, y: wall.startFt, w: half * 2, h: wall.lengthFt }
    : { x: wall.startFt, y: wall.axisFt - half, w: wall.lengthFt, h: half * 2 };
}
function buildWallModel(level) {
  const errors = [];
  const rooms = (level?.rooms || []).filter(room => {
    const parts = partsOf(room);
    const valid = parts.every(p => [p.x, p.y, p.w, p.h].every(Number.isFinite) && p.w > 0 && p.h > 0);
    if (!valid) errors.push({ code: 'ROOM_GEOMETRY_INVALID', roomId: room.id, message: 'Room parts must have finite coordinates and positive dimensions.' });
    return valid;
  });
  const roomParts = new Map(rooms.map(r => [r, union(partsOf(r))]));
  const boundaries = new Map(rooms.map(r => [r, boundarySegments(r)]));
  const walls = [];
  const seen = new Set();
  const openPairs = openPairKeys(level);
  function add(segment, a, b = null) {
    if (b && a.openConcept && b.openConcept && publicTypes.has(roomType(a)) && publicTypes.has(roomType(b))) return;
    // A wall a person took out in edit mode.
    if (b && openPairs.has(pairKey(a.id, b.id))) return;
    const { dir: orientation, fixed: axisFt, start: startFt, end: endFt } = segment;
    if (endFt - startFt < EPS) return;
    const id = orientation + ':' + axisFt + ':' + startFt + ':' + endFt;
    if (seen.has(id)) return;
    seen.add(id);
    const exterior = !b;
    walls.push({ id, orientation, axisFt, startFt, endFt, lengthFt: endFt - startFt, exterior,
      assembly: assemblyFor(a, b, exterior), roomIds: [a.id, b?.id].filter(Boolean),
      assemblyBasis: 'conventional_assumption; service locations and rated assembly not verified' });
  }
  // Real boundary segments remove composite seams and include recessed edges.
  // A bounding box cannot supply the perimeter of an L, T or courtyard.
  for (let i = 0; i < rooms.length; i++) {
    const a = rooms[i];
    for (const edge of boundarySegments(a, rooms, true)) add(edge, a);
    for (let j = i + 1; j < rooms.length; j++) {
      const b = rooms[j];
      const overlap = roomParts.get(a).flatMap(pa => roomParts.get(b).map(pb => intersection(pa, pb)).filter(Boolean));
      if (unionArea(overlap) > EPS) errors.push({ code: 'ROOMS_OVERLAP', roomId: a.id, otherRoomId: b.id, message: 'Rooms ' + a.id + ' and ' + b.id + ' overlap.' });
      for (const ea of boundaries.get(a)) for (const eb of boundaries.get(b)) {
        if (ea.dir !== eb.dir || Math.abs(ea.fixed - eb.fixed) > EPS || ea.side === eb.side) continue;
        add({ ...ea, start: Math.max(ea.start, eb.start), end: Math.min(ea.end, eb.end) }, a, b);
      }
    }
  }
  const solids = walls.map(wallRect);
  const roomClear = rooms.map(room => {
    const nominal = roomParts.get(room);
    const localSolids = solids.filter(s => nominal.some(p => intersection(s, p)));
    const clear = subtract(nominal, localSolids);
    const clearArea = unionArea(clear);
    if (clearArea <= EPS) errors.push({ code: 'ROOM_CLEAR_SPACE_COLLAPSED', roomId: room.id, roomType: roomType(room), message: 'Room ' + room.id + ' has no clear space after wall solids are reserved.' });
    return { roomId: room.id, roomType: roomType(room), nominalAreaSqFt: unionArea(nominal), clearAreaSqFt: clearArea, parts: clear };
  });
  const nominal = union([...roomParts.values()].flat());
  const wallSolids = union(solids.flatMap(s => nominal.map(p => intersection(s, p)).filter(Boolean)));
  const nominalAreaSqFt = unionArea(nominal);
  const roomClearAreaSqFt = unionArea(roomClear.flatMap(r => r.parts));
  const wallSolidAreaSqFt = unionArea(wallSolids);
  return { version: 'wall-measurement-v2', level: Number(level?.level || 1),
    coordinateBasis: 'nominal_wall_centrelines', openingVoidsIncluded: false,
    walls, wallSolids, roomClear, errors,
    partition: { nominalAreaSqFt: roundFt(nominalAreaSqFt, 8), roomClearAreaSqFt: roundFt(roomClearAreaSqFt, 8),
      wallSolidAreaSqFt: roundFt(wallSolidAreaSqFt, 8), residualSqFt: roundFt(nominalAreaSqFt - roomClearAreaSqFt - wallSolidAreaSqFt, 8) } };
}

// Levels mutate during placement, refinement and rotation. Cache by geometry
// content as well as identity so rechecks cannot reuse an old room dimension.
const cache = new WeakMap();
function wallModelForLevel(level) {
  const signature = JSON.stringify([(level?.rooms || []).map(r => [r.id, r.type, r.x, r.y, r.w, r.h, r.parts, r.openConcept]), level?.openEdges || null]);
  const previous = cache.get(level);
  if (previous?.signature === signature) return previous.model;
  const model = buildWallModel(level);
  cache.set(level, { signature, model });
  return model;
}
module.exports = { buildWallModel, buildWallModelForPlan: plan => (plan?.levels || []).map(buildWallModel), wallModelForLevel };
