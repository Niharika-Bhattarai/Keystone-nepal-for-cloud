'use strict';

const { normalizeRoomType } = require('../../../tile/canonicalRoomTypes');
const { roomArea, shareWall, touchesExterior } = require('../../../planGeometry');

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function validateKitchenWorkflow(level) {
  const rooms = Array.isArray(level?.rooms) ? level.rooms : [];
  const kitchen = rooms.find((room) => normalizeRoomType(room?.type) === 'kitchen');
  if (!kitchen) return null;

  const width = num(kitchen?.w);
  const height = num(kitchen?.h);
  const shortSide = Math.min(width, height);
  const area = roomArea(kitchen);
  if (shortSide < 8 || area < 96) {
    return `Kitchen workflow invalid: kitchen is too small (${width}x${height})`;
  }

  const dining = rooms.find((room) => normalizeRoomType(room?.type) === 'dining_room');
  const living = rooms.find((room) => normalizeRoomType(room?.type) === 'living_room');
  const study = rooms.find((room) => normalizeRoomType(room?.type) === 'study');
  if (!dining || !shareWall(kitchen, dining, 2)) {
    return 'Kitchen workflow invalid: kitchen must connect directly to dining';
  }
  const studyBridge =
    study &&
    shareWall(dining, study, 2) &&
    shareWall(living, study, 2);
  if (!living || (!shareWall(kitchen, living, 2) && !shareWall(dining, living, 2) && !studyBridge)) {
    return 'Kitchen workflow invalid: public core must keep kitchen, dining, and living connected';
  }

  if (!touchesExterior(kitchen, num(level?.width), num(level?.height))) {
    return 'Kitchen workflow invalid: kitchen should touch an exterior wall for light and venting';
  }

  return null;
}

module.exports = {
  validateKitchenWorkflow,
};
