'use strict';

const { normalizeRoomType, isBedroomType } = require('../../tile/canonicalRoomTypes');
const { buildAccessGraph, chooseEntryRoom, shortestPath } = require('../accessGraph');
const { shareWall } = require('../../planGeometry');

function isSharedBathroom(room) {
  const type = normalizeRoomType(room?.type);
  return type === 'bathroom' && String(room?.bathroomUse || '') !== 'private' && !room?.attachedTo;
}

function circulationSeedIds(rooms, fallbackEntryRoom = null) {
  const seeds = new Set(
    (Array.isArray(rooms) ? rooms : [])
      .filter((room) => ['hallway', 'entry', 'stairs'].includes(normalizeRoomType(room?.type)))
      .map((room) => String(room.id))
  );

  if (!seeds.size && fallbackEntryRoom?.id) {
    seeds.add(String(fallbackEntryRoom.id));
  }

  return [...seeds];
}

function validatePrivateCirculation(level, brief = null) {
  const rooms = Array.isArray(level?.rooms) ? level.rooms : [];
  const roomById = new Map(rooms.map((room) => [String(room.id), room]));
  const graph = buildAccessGraph(level, brief);
  const entryRoom = chooseEntryRoom(level);
  const seedIds = circulationSeedIds(rooms, entryRoom);
  if (!seedIds.length) return [];
  const oneStory = Math.max(1, Number(brief?.stories || 1)) === 1;

  const errors = [];
  for (const room of rooms) {
    if (!isSharedBathroom(room)) continue;

    const graphNeighbors = [...(graph.get(String(room.id)) || [])]
      .map((id) => roomById.get(String(id)))
      .filter(Boolean);
    const wallNeighbors = oneStory
      ? rooms.filter((candidate) =>
        String(candidate?.id) !== String(room?.id) &&
        shareWall(room, candidate, 1)
      )
      : [];
    const neighborsById = new Map();
    for (const neighbor of graphNeighbors) neighborsById.set(String(neighbor?.id), neighbor);
    for (const neighbor of wallNeighbors) neighborsById.set(String(neighbor?.id), neighbor);
    const neighbors = [...neighborsById.values()];

    const hasNonBedroomNeighbor = neighbors.some((neighbor) => !isBedroomType(neighbor?.type));
    if (!hasNonBedroomNeighbor) {
      errors.push(`Shared bathroom access invalid: ${room.id} is only connected through bedroom space`);
      continue;
    }

     const neighborTypes = neighbors.map((neighbor) => normalizeRoomType(neighbor?.type));
     const hasServiceCirculationNeighbor = neighborTypes.some((type) =>
       ['entry', 'hallway', 'mudroom', 'laundry'].includes(type)
     );
     if (oneStory && hasServiceCirculationNeighbor) {
       continue;
     }

    const validPath = seedIds
      .map((seedId) => shortestPath(graph, seedId, room.id))
      .find((path) => {
        if (!Array.isArray(path) || !path.length) return false;
        const interiorIds = path.slice(1, -1);
        return !interiorIds.some((id) => isBedroomType(roomById.get(String(id))?.type));
      });

    if (!validPath) {
      errors.push(`Shared bathroom access invalid: ${room.id} is not reachable from the entry route`);
      continue;
    }
  }

  return errors;
}

module.exports = { validatePrivateCirculation };
