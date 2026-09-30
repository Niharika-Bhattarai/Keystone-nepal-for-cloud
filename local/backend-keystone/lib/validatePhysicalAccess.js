'use strict';

const { shareWall } = require('./planGeometry');
const { normalizeRoomType } = require('./tile/canonicalRoomTypes');
const { openPairKeys } = require('./openEdges');

// Match the wall omissions in renderPlanSvg. Open concept never removes a
// laundry, mudroom, bedroom, bathroom, or entry wall merely due to adjacency.
const OPEN_CORE_TYPES = new Set(['kitchen', 'dining_room', 'living_room', 'hallway']);

function physicalAccessState(level, openConcept = false) {
  const rooms = level.rooms || [];
  const graph = new Map(rooms.map(room => [String(room.id), new Set()]));
  const connect = (a, b) => {
    a = String(a); b = String(b);
    if (!graph.has(a) || !graph.has(b)) return;
    graph.get(a).add(b); graph.get(b).add(a);
  };
  for (const door of level.doors || []) connect(door.a, door.b);
  // Walls a person took out in edit mode join their rooms like a doorway.
  for (const key of openPairKeys(level)) connect(...key.split('|'));
  if (openConcept) {
    for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
      if (OPEN_CORE_TYPES.has(normalizeRoomType(rooms[i].type)) && OPEN_CORE_TYPES.has(normalizeRoomType(rooms[j].type)) && shareWall(rooms[i], rooms[j], 3)) connect(rooms[i].id, rooms[j].id);
    }
  }
  const exteriorDoors = (level.doors || []).filter(door => door.b === '__exterior__' && !door.garageDoor);
  const mainEntry = exteriorDoors.find(door => door.isMainEntry) || exteriorDoors[0];
  const stair = rooms.find(room => normalizeRoomType(room.type) === 'stairs');
  const root = Number(level.level) === 1 ? mainEntry?.a : stair?.id;
  const seen = new Set(root ? [String(root)] : []), queue = [...seen];
  for (let i = 0; i < queue.length; i++) for (const next of graph.get(queue[i]) || []) {
    if (!seen.has(next)) { seen.add(next); queue.push(next); }
  }
  return { graph, root, seen };
}

function validatePhysicalAccess(plan) {
  const errors = [];
  for (const level of plan.levels || []) {
    const { graph, root, seen } = physicalAccessState(level, plan.openConcept);
    if (!root || !graph.has(String(root))) {
      errors.push(`Physical access: level ${level.level} has no ${Number(level.level) === 1 ? 'exterior entry' : 'stair'} connection`);
      continue;
    }
    for (const room of level.rooms || []) if (!seen.has(String(room.id))) errors.push(`Physical access: level ${level.level} room ${room.id} is disconnected from arrival`);
  }
  return errors;
}

module.exports = { validatePhysicalAccess, physicalAccessState };
