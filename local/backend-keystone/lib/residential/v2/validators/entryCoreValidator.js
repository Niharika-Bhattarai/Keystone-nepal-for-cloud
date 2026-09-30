'use strict';

const { normalizeRoomType, isPublicRoomType } = require('../../../tile/canonicalRoomTypes');
const { buildAccessGraph, chooseEntryRoom } = require('../../accessGraph');

function validateEntryCore(level, brief) {
  if (Number(level?.level) !== 1) return null;

  const rooms = Array.isArray(level?.rooms) ? level.rooms : [];
  const roomById = new Map(rooms.map((room) => [String(room.id), room]));
  const entryRoom = chooseEntryRoom(level);
  if (!entryRoom) return null;

  const graph = buildAccessGraph(level, brief);
  const neighbors = [...(graph.get(String(entryRoom.id)) || [])]
    .map((id) => roomById.get(String(id)))
    .filter(Boolean);

  const hasDirectPublicNeighbor = neighbors.some((room) => isPublicRoomType(normalizeRoomType(room?.type)));
  if (hasDirectPublicNeighbor) return null;

  const hasHallToPublic = neighbors.some((room) => {
    if (normalizeRoomType(room?.type) !== 'hallway') return false;
    const hallNeighbors = [...(graph.get(String(room.id)) || [])]
      .map((id) => roomById.get(String(id)))
      .filter(Boolean);
    return hallNeighbors.some((candidate) => isPublicRoomType(normalizeRoomType(candidate?.type)));
  });

  if (hasHallToPublic) return null;
  // A compact arrival vestibule may lead through a mudroom to the landing.
  // Keep this bounded to one usable mudroom and one hall; baths, bedrooms,
  // laundry rooms, and chains of service rooms are never arrival circulation.
  const doorGraph = buildAccessGraph(level, { ...brief, openConcept: false });
  const hasMudroomArrival = [...(doorGraph.get(String(entryRoom.id)) || [])].map(id => roomById.get(String(id))).filter(Boolean).some((room) => {
    if (normalizeRoomType(room.type) !== 'mudroom' || Math.min(room.w, room.h) < 4 || room.w * room.h > 64) return false;
    return [...(doorGraph.get(String(room.id)) || [])].some(id => {
      const next = roomById.get(String(id));
      if (!next || next.id === entryRoom.id) return false;
      if (isPublicRoomType(normalizeRoomType(next.type))) return true;
      if (normalizeRoomType(next.type) !== 'hallway') return false;
      return [...(doorGraph.get(String(next.id)) || [])].some(publicId => isPublicRoomType(normalizeRoomType(roomById.get(String(publicId))?.type)));
    });
  });
  if (hasMudroomArrival) return null;
  return `Entry/core invalid: level 1 entry does not connect directly to the common core`;
}

module.exports = {
  validateEntryCore,
};
