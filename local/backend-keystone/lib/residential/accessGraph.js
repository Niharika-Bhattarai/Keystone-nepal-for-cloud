'use strict';

const { normalizeRoomType, isPublicRoomType } = require('../tile/canonicalRoomTypes');
const { shareWall, touchesExterior } = require('../planGeometry');

function normalizeType(raw) {
  return normalizeRoomType(raw);
}

function isCirculationLikeType(type) {
  const t = normalizeType(type);
  return ['hallway', 'stairs', 'entry', 'mudroom', 'laundry'].includes(t);
}

function buildAccessGraph(level, brief = null) {
  const rooms = Array.isArray(level?.rooms) ? level.rooms : [];
  const doors = Array.isArray(level?.doors) ? level.doors : [];
  const graph = new Map(rooms.map((room) => [String(room.id), new Set()]));

  for (const door of doors) {
    const a = String(door?.a || '');
    const b = String(door?.b || '');
    if (!graph.has(a) || !graph.has(b) || b === '__exterior__') continue;
    graph.get(a).add(b);
    graph.get(b).add(a);
  }

  const openConcept =
    brief?.openConcept === true ||
    String(brief?.openConcept || '').toLowerCase().includes('open');

  if (openConcept) {
    for (let i = 0; i < rooms.length; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        const roomA = rooms[i];
        const roomB = rooms[j];
        const typeA = normalizeType(roomA?.type);
        const typeB = normalizeType(roomB?.type);
        const isPublicA = isPublicRoomType(typeA) || isCirculationLikeType(typeA);
        const isPublicB = isPublicRoomType(typeB) || isCirculationLikeType(typeB);
        if (!isPublicA || !isPublicB) continue;
        if (!shareWall(roomA, roomB, 2)) continue;
        const a = String(roomA.id);
        const b = String(roomB.id);
        graph.get(a).add(b);
        graph.get(b).add(a);
      }
    }
  }

  return graph;
}

function chooseEntryRoom(level) {
  const rooms = Array.isArray(level?.rooms) ? level.rooms : [];
  const doors = Array.isArray(level?.doors) ? level.doors : [];
  const byId = new Map(rooms.map((room) => [String(room.id), room]));
  const exteriorDoors = doors.filter((door) => String(door?.b) === '__exterior__' && !door?.garageDoor);
  const mainEntryDoor = exteriorDoors.find((door) => door?.isMainEntry) || exteriorDoors[0] || null;
  if (mainEntryDoor) {
    const room = byId.get(String(mainEntryDoor?.a || ''));
    if (room) return room;
  }

  const lvlW = Number(level?.width) || 0;
  const lvlH = Number(level?.height) || 0;
  return (
    rooms.find((room) => normalizeType(room?.type) === 'entry' && touchesExterior(room, lvlW, lvlH)) ||
    rooms.find((room) => normalizeType(room?.type) === 'entry') ||
    rooms.find((room) => isPublicRoomType(normalizeType(room?.type)) && touchesExterior(room, lvlW, lvlH)) ||
    rooms.find((room) => normalizeType(room?.type) === 'hallway') ||
    rooms[0] ||
    null
  );
}

function bfsReachable(graph, startId) {
  const start = String(startId || '');
  if (!start || !graph.has(start)) return new Set();
  const seen = new Set([start]);
  const queue = [start];

  while (queue.length) {
    const current = queue.shift();
    for (const next of graph.get(current) || []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }

  return seen;
}

function shortestPath(graph, startId, targetId) {
  const start = String(startId || '');
  const target = String(targetId || '');
  if (!start || !target || !graph.has(start) || !graph.has(target)) return null;
  if (start === target) return [start];

  const queue = [start];
  const prev = new Map();
  const seen = new Set([start]);

  while (queue.length) {
    const current = queue.shift();
    for (const next of graph.get(current) || []) {
      if (seen.has(next)) continue;
      seen.add(next);
      prev.set(next, current);
      if (next === target) {
        const path = [target];
        let cursor = target;
        while (prev.has(cursor)) {
          cursor = prev.get(cursor);
          path.push(cursor);
        }
        return path.reverse();
      }
      queue.push(next);
    }
  }

  return null;
}

module.exports = {
  buildAccessGraph,
  chooseEntryRoom,
  bfsReachable,
  shortestPath,
};
