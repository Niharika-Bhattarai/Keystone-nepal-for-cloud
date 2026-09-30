'use strict';

const { shareWall } = require('../../../planGeometry');

function validateStairLanding(level) {
  const rooms = Array.isArray(level?.rooms) ? level.rooms : [];
  const stairCore = level?.stairCore || null;
  const stairRoom = stairCore
    ? rooms.find((room) => String(room?.id) === String(stairCore?.roomId || '')) || rooms.find((room) => String(room?.type) === 'stairs')
    : rooms.find((room) => String(room?.type) === 'stairs');

  if (!stairRoom) return null;
  if (!stairCore?.landingRoomId) {
    return `Stair landing invalid: level ${level?.level} is missing landing metadata`;
  }

  const landingRoom = rooms.find((room) => String(room?.id) === String(stairCore?.landingRoomId));
  if (!landingRoom) {
    return `Stair landing invalid: level ${level?.level} landing room ${stairCore?.landingRoomId} is missing`;
  }

  if (!shareWall(stairRoom, landingRoom, 2)) {
    return `Stair landing invalid: level ${level?.level} stairs must touch the landing room`;
  }

  return null;
}

module.exports = {
  validateStairLanding,
};
