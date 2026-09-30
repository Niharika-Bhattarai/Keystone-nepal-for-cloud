'use strict';

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function roomArea(roomRect) {
  return num(roomRect?.w) * num(roomRect?.h);
}

function minSide(roomRect) {
  return Math.min(num(roomRect?.w), num(roomRect?.h));
}

function classifyUpperCirculationRoom(roomRect, options = {}) {
  const area = roomArea(roomRect);
  const shortSide = minSide(roomRect);
  const level = Number(options?.level || 2);
  const label = String(options?.label || 'Landing Hall');

  if (area >= 90 && shortSide >= 8) {
    return {
      id: String(options?.id || 'upper_loft'),
      type: 'loft',
      level,
      label: 'Loft',
      zone: 'public',
    };
  }

  return {
    id: String(options?.id || 'upper_hall'),
    type: 'hallway',
    level,
    label,
    zone: 'circulation',
  };
}

function classifyUpperSupportRoom(roomRect, options = {}) {
  const area = roomArea(roomRect);
  const shortSide = minSide(roomRect);
  const level = Number(options?.level || 2);

  if (area >= 72 && shortSide >= 6) {
    return {
      id: String(options?.id || 'upper_loft_support'),
      type: 'loft',
      level,
      label: 'Loft',
      zone: 'public',
    };
  }

  return {
    id: String(options?.id || 'upper_storage'),
    type: String(options?.fallbackType || 'storage'),
    level,
    label: String(options?.fallbackLabel || 'Storage'),
    zone: String(options?.fallbackZone || 'service'),
  };
}

module.exports = {
  classifyUpperCirculationRoom,
  classifyUpperSupportRoom,
};
