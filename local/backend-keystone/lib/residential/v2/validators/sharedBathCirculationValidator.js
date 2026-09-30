'use strict';

const { normalizeRoomType } = require('../../../tile/canonicalRoomTypes');

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function validateSharedBathCirculation(level, brief = null) {
  const rooms = Array.isArray(level?.rooms) ? level.rooms : [];
  const doors = Array.isArray(level?.doors) ? level.doors : [];
  const byId = new Map(rooms.map((room) => [String(room.id), room]));
  const errors = [];
  const stories = Math.max(1, num(brief?.stories, 1));
  const levelNumber = num(level?.level, 1);
  const oneStoryLevelOne = stories === 1 && levelNumber === 1;

  for (const room of rooms) {
    if (normalizeRoomType(room?.type) !== 'bathroom') continue;
    if (String(room?.bathroomUse || '') === 'private' || room?.attachedTo) continue;

    const neighborTypes = doors
      .filter((door) => String(door?.a) === String(room.id) || String(door?.b) === String(room.id))
      .map((door) => {
        const otherId = String(door?.a) === String(room.id) ? String(door?.b || '') : String(door?.a || '');
        return normalizeRoomType(byId.get(otherId)?.type);
      })
      .filter(Boolean);

    const circulationOkay =
      neighborTypes.includes('hallway') ||
      (
        levelNumber === 1 &&
        (
          neighborTypes.includes('entry') ||
          neighborTypes.includes('mudroom') ||
          neighborTypes.includes('laundry')
        )
      ) ||
      (
        oneStoryLevelOne &&
        (
          neighborTypes.includes('living_room') ||
          neighborTypes.includes('dining_room') ||
          neighborTypes.includes('kitchen')
        )
      );
    if (!circulationOkay) {
      errors.push(`Shared bath circulation invalid: ${room?.label || room?.id} must open directly to hallway or level-1 circulation`);
    }
  }

  return errors;
}

module.exports = {
  validateSharedBathCirculation,
};
