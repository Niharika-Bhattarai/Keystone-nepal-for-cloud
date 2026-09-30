'use strict';

const { normalizeRoomType } = require('../../../tile/canonicalRoomTypes');

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function validateBathFit(room) {
  const type = normalizeRoomType(room?.type);
  if (!['bathroom', 'primary_bathroom', 'powder_room'].includes(type)) return null;

  const width = num(room?.w);
  const height = num(room?.h);
  const shortSide = Math.min(width, height);
  const longSide = Math.max(width, height);
  const area = width * height;
  const ratio = longSide / Math.max(1, shortSide);

  if (type === 'primary_bathroom') {
    if (shortSide < 8 || area < 70) {
      return `Bath fit invalid: primary bathroom "${room?.label || room?.id}" is too small (${width}x${height})`;
    }
  } else if (type === 'bathroom') {
    if (shortSide < 6 || area < 48) {
      return `Bath fit invalid: shared bathroom "${room?.label || room?.id}" is too small (${width}x${height})`;
    }
  } else if (type === 'powder_room') {
    if (shortSide < 5 || area < 30) {
      return `Bath fit invalid: powder room "${room?.label || room?.id}" is too small (${width}x${height})`;
    }
  }

  if (ratio > 2.8) {
    return `Bath fit invalid: bathroom "${room?.label || room?.id}" has extreme aspect ratio ${ratio.toFixed(2)}:1`;
  }

  return null;
}

module.exports = {
  validateBathFit,
};
