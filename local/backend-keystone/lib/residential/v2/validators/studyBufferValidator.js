'use strict';

const { normalizeRoomType } = require('../../../tile/canonicalRoomTypes');
const { shareWall, touchesExterior } = require('../../../planGeometry');

function validateStudyBuffer(level) {
  const rooms = Array.isArray(level?.rooms) ? level.rooms : [];
  const errors = [];
  const levelWidth = Number(level?.width || 0);
  const levelHeight = Number(level?.height || 0);

  for (const study of rooms.filter((room) => normalizeRoomType(room?.type) === 'study')) {
    if (!touchesExterior(study, levelWidth, levelHeight)) {
      errors.push(`Study buffer invalid: ${study?.label || study?.id} must touch an exterior edge for light`);
    }

    for (const other of rooms) {
      if (!other || String(other.id) === String(study.id)) continue;
      if (!shareWall(study, other, 2)) continue;
      const type = normalizeRoomType(other?.type);
      if (['garage', 'laundry', 'mudroom'].includes(type)) {
        errors.push(`Study buffer invalid: ${study?.label || study?.id} shares a wall with ${type}`);
      }
    }
  }

  return errors;
}

module.exports = {
  validateStudyBuffer,
};
