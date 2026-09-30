'use strict';

const { normalizeRoomType } = require('../tile/canonicalRoomTypes');

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function diningSeatCountFromBrief(brief = {}) {
  const bedrooms = Math.max(1, num(brief?.bedrooms, num(brief?.bedroomCount, 3)));
  const area = Math.max(0, num(brief?.totalAreaSqFt, num(brief?.conditionedAreaSqFt, 0)));
  if (bedrooms >= 4 || area >= 2800) return 8;
  if (bedrooms >= 3 || area >= 1500) return 6;
  return 4;
}

function buildRoomContract(roomLike, brief = null) {
  const type = normalizeRoomType(roomLike?.type);
  if (!type) return null;

  if (type === 'primary_bedroom') {
    return {
      contractType: 'bedroom',
      bedType: 'queen',
      sideClearanceFt: 2.5,
      footClearanceFt: 2,
    };
  }

  if (type === 'guest_bedroom') {
    return {
      contractType: 'bedroom',
      bedType: 'queen',
      sideClearanceFt: 2.5,
      footClearanceFt: 2,
    };
  }

  if (type === 'bedroom') {
    return {
      contractType: 'bedroom',
      bedType: 'full',
      sideClearanceFt: 2.5,
      footClearanceFt: 2,
    };
  }

  if (type === 'dining_room') {
    return {
      contractType: 'dining',
      seatCount: diningSeatCountFromBrief(brief),
      circulationClearanceFt: 3,
    };
  }

  if (type === 'kitchen') {
    return {
      contractType: 'kitchen',
      minTriangleTotalFt: 12,
      maxTriangleTotalFt: 22,
      minLegFt: 4,
      maxLegFt: 9,
      aisleMinFt: 3,
    };
  }

  if (type === 'primary_bathroom' || type === 'bathroom' || type === 'powder_room') {
    return {
      contractType: 'bathroom',
      bathroomType: type,
      bathroomUse: String(roomLike?.bathroomUse || ''),
      attachedTo: roomLike?.attachedTo || null,
    };
  }

  return null;
}

function attachRoomContracts(levels, brief = null) {
  for (const level of Array.isArray(levels) ? levels : []) {
    for (const room of Array.isArray(level?.rooms) ? level.rooms : []) {
      if (!room?.roomContract) {
        const contract = buildRoomContract(room, brief);
        if (contract) room.roomContract = contract;
      }
    }
  }
  return levels;
}

module.exports = {
  buildRoomContract,
  attachRoomContracts,
};
