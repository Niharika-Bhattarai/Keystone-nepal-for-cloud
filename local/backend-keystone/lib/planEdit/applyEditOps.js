'use strict';

/* Hand edits from the Studio's edit mode, as typed operations applied to a
 * plan's geometry. Openings, furniture, areas and checks are recomputed
 * afterwards (recomputeEditedPlan).
 *
 *   { op: 'moveWall', runId, delta }            drag an interior wall run
 *   { op: 'resizeRoom', roomId, side, delta }   move one of a room's walls
 *        side: 'left' | 'right' | 'top' | 'bottom'; +delta makes it larger
 *   { op: 'swapRooms', a, b }                   exchange two rooms' places
 *   { op: 'changeRoomType', roomId, type }      e.g. a bedroom becomes a study
 *   { op: 'openWall', a, b }                    take out the wall between two rooms
 *   { op: 'closeWall', a, b }                   put it back
 *   { op: 'mergeRooms', a, b }                  make two rooms one (the larger keeps its name)
 *   furniture: moveFurniture, turnFurniture, removeFurniture, resetFurniture
 *        (furnitureOps.js)
 *
 * An operation that cannot be applied returns a blocking issue and leaves the
 * plan as it was. Only physically impossible edits block (see wallRuns.js).
 */

const { planWallRuns } = require('./wallRuns');
const { normalizeRoomType } = require('../tile/canonicalRoomTypes');
const { boundingRectOf, partListOf, roomArea } = require('../planGeometry');
const { pairKey, sharedLength } = require('../openEdges');
const { moveFurniture, turnFurniture, removeFurniture, resetFurniture } = require('./furnitureOps');

// Walls snap to six inches.
const SNAP_FT = 0.5;
const snap = (n) => Math.round(n / SNAP_FT) * SNAP_FT;
const round = (n) => Math.round(n * 1000) / 1000;

// Room types a person may turn a room into.
const EDITABLE_TYPES = new Set(['bedroom', 'study', 'library', 'gym', 'playroom', 'gaming_room', 'music_room',
  'guest_bedroom', 'living_room', 'dining_room', 'kitchen', 'laundry', 'mudroom', 'storage', 'closet', 'loft',
  'bathroom', 'powder_room', 'hallway', 'entry']);
const LOCKED_TYPES = new Set(['stairs', 'garage']);

const TYPE_LABELS = {
  bedroom: 'Bedroom', study: 'Study', library: 'Library', gym: 'Gym', playroom: 'Playroom', gaming_room: 'Gaming Room',
  music_room: 'Music Room', guest_bedroom: 'Guest Bedroom', living_room: 'Living Room', dining_room: 'Dining Room',
  kitchen: 'Kitchen', laundry: 'Laundry', mudroom: 'Mudroom', storage: 'Storage', closet: 'Closet', loft: 'Loft',
  bathroom: 'Bathroom', powder_room: 'Powder Room', hallway: 'Hall', entry: 'Entry',
};

const block = (code, message, extra = {}) => ({ severity: 'block', code, message, ...extra });
const roomName = (room) => String(room?.label || room?.type || 'Room').replace(/_/g, ' ');

function findRoom(plan, id) {
  for (const level of plan.levels || []) {
    const room = (level.rooms || []).find((r) => String(r.id) === String(id));
    if (room) return { level, room };
  }
  return null;
}

function moveWall(plan, op) {
  const run = planWallRuns(plan).find((r) => r.id === op.runId);
  if (!run) return { issues: [block('wall_not_found', 'That wall has changed since the plan was drawn. Try again on the updated plan.')] };
  const delta = snap(Number(op.delta));
  if (!Number.isFinite(delta) || delta === 0) return { changed: [] };
  if (!run.movable) {
    const why = run.reason === 'stairs' ? 'It holds the stair, which is fitted to the storey height and stacked with the floor above.'
      : run.reason === 'exterior' ? 'Moving it would cut into the outside wall.' : 'The rooms beside it are already at their smallest.';
    return { issues: [block(`wall_locked_${run.reason}`, `This wall cannot move. ${why}`)] };
  }
  if (delta < run.minDelta - 1e-6 || delta > run.maxDelta + 1e-6) {
    return { issues: [block('room_below_minimum', 'A room would become narrower than 3 ft. Move the wall a shorter distance.',
      { minDelta: run.minDelta, maxDelta: run.maxDelta })] };
  }
  const level = plan.levels.find((l) => (Number(l.level) || 1) === run.level);
  const changed = new Set();
  for (const move of run.moves) {
    const room = level.rooms.find((r) => String(r.id) === move.roomId);
    const cell = move.part === null ? room : room.parts[move.part];
    if (move.edge === 'left') { cell.x = round(cell.x + delta); cell.w = round(cell.w - delta); }
    else if (move.edge === 'right') cell.w = round(cell.w + delta);
    else if (move.edge === 'top') { cell.y = round(cell.y + delta); cell.h = round(cell.h - delta); }
    else cell.h = round(cell.h + delta);
    if (move.part !== null) Object.assign(room, boundingRectOf(room));
    changed.add(move.roomId);
  }
  for (const id of changed) {
    const room = level.rooms.find((r) => String(r.id) === id);
    if (room.parts?.length && !partsConnected(room.parts)) {
      return { issues: [block('room_split', `${roomName(room)} would be split in two. Move the wall a shorter distance.`)] };
    }
  }
  return { changed: [...changed] };
}

function partsConnected(parts) {
  const touch = (a, b) => {
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return (Math.abs(ox) < 1e-6 && oy >= 1) || (Math.abs(oy) < 1e-6 && ox >= 1) || (ox > 0 && oy > 0);
  };
  const seen = new Set([0]);
  const queue = [0];
  while (queue.length) {
    const i = queue.shift();
    parts.forEach((p, j) => { if (!seen.has(j) && touch(parts[i], p)) { seen.add(j); queue.push(j); } });
  }
  return seen.size === parts.length;
}

// One of a room's walls: the run carrying that side of the room (the part on
// the outer edge of its bounding box for a room with parts).
function resizeRoom(plan, op) {
  const found = findRoom(plan, op.roomId);
  if (!found) return { issues: [block('room_not_found', 'That room is no longer in the plan.')] };
  const { room } = found;
  const side = String(op.side);
  const bounds = boundingRectOf(room);
  const edgeAt = { left: bounds.x, right: bounds.x + bounds.w, top: bounds.y, bottom: bounds.y + bounds.h }[side];
  if (edgeAt === undefined) return { issues: [block('bad_side', 'Choose a side: left, right, top or bottom.')] };
  const axis = side === 'left' || side === 'right' ? 'x' : 'y';
  const run = planWallRuns(plan).find((r) => r.axis === axis && Math.abs(r.at - edgeAt) < 1e-6 &&
    r.moves.some((m) => m.roomId === String(room.id) && m.edge === side));
  if (!run) return { issues: [block('outside_wall', `That side of ${roomName(room)} is an outside wall. Outside walls move in a later version of edit mode.`)] };
  // A larger room: its right/bottom edge moves out (+), its left/top edge moves in (-).
  const delta = (side === 'right' || side === 'bottom' ? 1 : -1) * Number(op.delta);
  return moveWall(plan, { runId: run.id, delta });
}

const GEOMETRY_KEYS = ['x', 'y', 'w', 'h'];

function swapRooms(plan, op) {
  const a = findRoom(plan, op.a), b = findRoom(plan, op.b);
  if (!a || !b) return { issues: [block('room_not_found', 'One of those rooms is no longer in the plan.')] };
  if (a.level !== b.level) return { issues: [block('different_floors', 'Rooms can only swap places on the same floor.')] };
  for (const { room } of [a, b]) {
    if (LOCKED_TYPES.has(String(room.type))) return { issues: [block('room_locked', `The ${roomName(room).toLowerCase()} cannot swap places: it is fixed to the structure.`)] };
  }
  const geometry = (room) => ({ ...Object.fromEntries(GEOMETRY_KEYS.map((k) => [k, room[k]])), parts: room.parts ? room.parts.map((p) => ({ ...p })) : null });
  const ga = geometry(a.room), gb = geometry(b.room);
  const put = (room, g) => {
    GEOMETRY_KEYS.forEach((k) => { room[k] = g[k]; });
    if (g.parts) room.parts = g.parts; else delete room.parts;
  };
  put(a.room, gb);
  put(b.room, ga);
  // An opening is in a wall, so it stays where it is: it now joins whichever
  // room took each place.
  const ids = { [String(a.room.id)]: String(b.room.id), [String(b.room.id)]: String(a.room.id) };
  if (a.level.openEdges) a.level.openEdges = a.level.openEdges.map((e) => ({ a: ids[String(e.a)] || String(e.a), b: ids[String(e.b)] || String(e.b) }));
  delete a.room.furnitureEdited;
  delete b.room.furnitureEdited;
  return { changed: [String(a.room.id), String(b.room.id)] };
}

function changeRoomType(plan, op) {
  const found = findRoom(plan, op.roomId);
  if (!found) return { issues: [block('room_not_found', 'That room is no longer in the plan.')] };
  const type = normalizeRoomType(op.type);
  if (!EDITABLE_TYPES.has(type)) return { issues: [block('type_not_allowed', 'Choose a room type from the list.')] };
  const { room } = found;
  if (LOCKED_TYPES.has(String(room.type)) || String(room.type) === 'primary_bedroom' || String(room.type) === 'primary_bathroom') {
    return { issues: [block('room_locked', `The ${roomName(room).toLowerCase()} keeps its type; swap it with another room instead.`)] };
  }
  if (room.type === type) return { changed: [] };
  room.type = type;
  room.label = TYPE_LABELS[type] || type;
  delete room.programId;
  delete room.roomContract;
  room.requestedFeature = false;
  delete room.furnitureEdited;
  return { changed: [String(room.id)] };
}

// Two rooms on one floor that share at least 2 ft of wall.
function neighbours(plan, op, verb) {
  const a = findRoom(plan, op.a), b = findRoom(plan, op.b);
  if (!a || !b) return { issues: [block('room_not_found', 'One of those rooms is no longer in the plan.')] };
  if (String(a.room.id) === String(b.room.id)) return { issues: [block('same_room', 'Choose a different room.')] };
  if (a.level !== b.level) return { issues: [block('different_floors', `Only rooms on the same floor can ${verb}.`)] };
  for (const { room } of [a, b]) {
    if (String(room.type) === 'stairs') return { issues: [block('room_locked', 'The stair keeps its walls: it is fitted to the storey and opens to its landing already.')] };
    if (String(room.type) === 'garage') return { issues: [block('room_locked', 'The garage keeps its walls. They separate the cars from the house for fire safety.')] };
  }
  if (sharedLength(a.room, b.room) < 2 - 1e-6) {
    return { issues: [block('not_neighbours', `${roomName(a.room)} and ${roomName(b.room)} do not share a wall. Choose a room next to it.`)] };
  }
  return { level: a.level, a: a.room, b: b.room };
}

function openWall(plan, op) {
  const found = neighbours(plan, op, 'open into each other');
  if (found.issues) return found;
  const { level, a, b } = found;
  const key = pairKey(a.id, b.id);
  if ((level.openEdges || []).some((e) => pairKey(e.a, e.b) === key)) return { changed: [] };
  level.openEdges = [...(level.openEdges || []), { a: String(a.id), b: String(b.id) }];
  return { changed: [] };
}

function closeWall(plan, op) {
  const key = pairKey(op.a, op.b);
  for (const level of plan.levels || []) {
    if (!level.openEdges) continue;
    level.openEdges = level.openEdges.filter((e) => pairKey(e.a, e.b) !== key);
  }
  return { changed: [] };
}

// Rectangles that together make exactly one rectangle become one.
function simplifyParts(parts) {
  const out = parts.map((p) => ({ x: round(p.x), y: round(p.y), w: round(p.w), h: round(p.h) }));
  const near = (m, n) => Math.abs(m - n) < 1e-6;
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i < out.length && !changed; i++) {
      for (let j = i + 1; j < out.length && !changed; j++) {
        const p = out[i], q = out[j];
        let joined = null;
        if (near(p.x, q.x) && near(p.w, q.w) && (near(p.y + p.h, q.y) || near(q.y + q.h, p.y))) joined = { x: p.x, y: Math.min(p.y, q.y), w: p.w, h: round(p.h + q.h) };
        else if (near(p.y, q.y) && near(p.h, q.h) && (near(p.x + p.w, q.x) || near(q.x + q.w, p.x))) joined = { x: Math.min(p.x, q.x), y: p.y, w: round(p.w + q.w), h: p.h };
        if (joined) { out.splice(j, 1); out[i] = joined; changed = true; }
      }
    }
  }
  return out;
}

// Which of two rooms keeps its name when they become one: the primary
// bedroom, then the primary bath, then the larger room.
function keeperOf(a, b) {
  const rank = (r) => (r.type === 'primary_bedroom' ? 2 : r.type === 'primary_bathroom' ? 1 : 0);
  if (rank(b) !== rank(a)) return rank(b) > rank(a) ? [b, a] : [a, b];
  return roomArea(b) > roomArea(a) + 1e-6 ? [b, a] : [a, b];
}

function mergeRooms(plan, op) {
  const found = neighbours(plan, op, 'become one room');
  if (found.issues) return found;
  const { level } = found;
  const [keep, gone] = keeperOf(found.a, found.b);
  const keepId = String(keep.id), goneId = String(gone.id);
  const parts = simplifyParts([...partListOf(keep), ...partListOf(gone)]);
  if (parts.length === 1) { delete keep.parts; Object.assign(keep, parts[0]); }
  else { keep.parts = parts; Object.assign(keep, boundingRectOf(keep)); }
  delete keep.x2; delete keep.y2;
  keep.mergedFrom = [...(keep.mergedFrom || []), { id: goneId, type: gone.type, label: gone.label || null }];
  delete keep.furnitureEdited;
  level.rooms = level.rooms.filter((r) => r !== gone);
  level.furniture = (level.furniture || []).filter((f) => String(f.roomId) !== goneId);
  // Whatever pointed at the room that went now points at the one it joined.
  for (const room of level.rooms) {
    if (String(room.ownerBedroomId) === goneId) room.ownerBedroomId = keep.id;
    if (String(room.attachedTo) === goneId) room.attachedTo = keep.id;
  }
  const core = level.stairCore;
  if (core) {
    for (const k of ['landingRoomId', 'hallRoomId']) if (String(core[k]) === goneId) core[k] = keep.id;
    if (Array.isArray(core.branchRoomIds)) core.branchRoomIds = [...new Set(core.branchRoomIds.map((id) => (String(id) === goneId ? keep.id : id)))];
  }
  if (level.openEdges) {
    const seen = new Set();
    level.openEdges = level.openEdges
      .map((e) => ({ a: String(e.a) === goneId ? keepId : String(e.a), b: String(e.b) === goneId ? keepId : String(e.b) }))
      .filter((e) => e.a !== e.b && !seen.has(pairKey(e.a, e.b)) && seen.add(pairKey(e.a, e.b)));
  }
  return { changed: [keepId] };
}

// Openings between rooms that no longer touch go.
function pruneOpenEdges(plan) {
  for (const level of plan.levels || []) {
    if (!level.openEdges) continue;
    const byId = new Map((level.rooms || []).map((r) => [String(r.id), r]));
    level.openEdges = level.openEdges.filter((e) => byId.has(String(e.a)) && byId.has(String(e.b)) &&
      sharedLength(byId.get(String(e.a)), byId.get(String(e.b))) > 0.5);
    if (!level.openEdges.length) delete level.openEdges;
  }
}

const HANDLERS = { moveWall, resizeRoom, swapRooms, changeRoomType, openWall, closeWall, mergeRooms,
  moveFurniture, turnFurniture, removeFurniture, resetFurniture };

/**
 * Apply operations in order to a copy of the plan.
 * Returns { plan, changedRoomIds, issues } where issues holds blocking
 * findings; when there are any, `plan` is the unchanged input.
 */
function applyEditOps(planSpec, ops) {
  const plan = structuredClone(planSpec);
  const changed = new Set();
  for (const op of Array.isArray(ops) ? ops : []) {
    const handler = HANDLERS[op?.op];
    if (!handler) return { plan: planSpec, changedRoomIds: [], issues: [block('unknown_op', `Unknown edit: ${String(op?.op)}`)] };
    const result = handler(plan, op);
    if (result.issues?.length) return { plan: planSpec, changedRoomIds: [], issues: result.issues };
    (result.changed || []).forEach((id) => changed.add(id));
  }
  pruneOpenEdges(plan);
  return { plan, changedRoomIds: [...changed], issues: [] };
}

module.exports = { applyEditOps, EDITABLE_TYPES, TYPE_LABELS, SNAP_FT, partsConnected, partListOf, simplifyParts };
