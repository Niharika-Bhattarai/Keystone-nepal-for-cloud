'use strict';

const { normalizeRoomType } = require('../../../tile/canonicalRoomTypes');
const { getResidentialStairStandards } = require('../stairStandards');

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function roomMap(level) {
  return new Map((Array.isArray(level?.rooms) ? level.rooms : []).map((room) => [String(room.id), room]));
}

function stairRoom(level) {
  const rooms = Array.isArray(level?.rooms) ? level.rooms : [];
  const stairCore = level?.stairCore || null;
  return stairCore?.roomId
    ? rooms.find((room) => String(room?.id) === String(stairCore.roomId)) || rooms.find((room) => normalizeRoomType(room?.type) === 'stairs')
    : rooms.find((room) => normalizeRoomType(room?.type) === 'stairs');
}

function connectedRooms(level, sourceId) {
  const byId = roomMap(level);
  return (Array.isArray(level?.doors) ? level.doors : [])
    .filter((door) => String(door?.a) === String(sourceId) || String(door?.b) === String(sourceId))
    .map((door) => {
      const otherId = String(door?.a) === String(sourceId) ? String(door?.b || '') : String(door?.a || '');
      return byId.get(otherId) || null;
    })
    .filter(Boolean);
}

function analyzeStairGraph(level, brief = null) {
  const standards = getResidentialStairStandards();
  const stairCore = level?.stairCore || null;
  const stair = stairRoom(level);
  const landing = stairCore?.landingRoomId ? roomMap(level).get(String(stairCore.landingRoomId)) || null : null;
  const neighbors = stair ? connectedRooms(level, stair.id) : [];
  const directNeighborTypes = [...new Set(neighbors.map((room) => normalizeRoomType(room?.type)).filter(Boolean))].sort();
  const levelRole = num(level?.level, 1) === 1 ? 'lower' : 'upper';
  const landingType = normalizeRoomType(landing?.type);
  const stories = Math.max(1, num(brief?.stories, 1));
  const topologyFailures = [];

  if (!stair) {
    if (stories <= 1) {
      return {
        stairRoomId: null,
        landingRoomId: null,
        landingType: null,
        levelRole,
        directNeighborTypes: [],
        hasEntrySequenceAccess: true,
        topologyFailures: [],
      };
    }

    if (levelRole === 'upper') {
      topologyFailures.push(`Upper stair must terminate at one of: ${standards.allowedUpperLandingTypes.join(', ')}`);
    } else {
      topologyFailures.push('Lower stair must connect to the entry sequence or common core');
    }

    return {
      stairRoomId: null,
      landingRoomId: null,
      landingType: null,
      levelRole,
      directNeighborTypes: [],
      hasEntrySequenceAccess: false,
      topologyFailures,
    };
  }

  const privateNeighborTypes = directNeighborTypes.filter((type) =>
    ['bedroom', 'primary_bedroom', 'study', 'bathroom', 'primary_bathroom', 'powder_room', 'garage'].includes(type)
  );

  if (levelRole === 'upper') {
    if (!landingType || !standards.allowedUpperLandingTypes.includes(landingType)) {
      topologyFailures.push(`Upper stair must terminate at one of: ${standards.allowedUpperLandingTypes.join(', ')}`);
    }
    if (privateNeighborTypes.length) {
      topologyFailures.push(`Upper stairs must not open directly into private rooms (${privateNeighborTypes.join(', ')})`);
    }
  }

  const hasEntrySequenceAccess = levelRole === 'lower' && (
    directNeighborTypes.includes('entry') ||
    directNeighborTypes.includes('hallway') ||
    directNeighborTypes.includes('living_room') ||
    directNeighborTypes.includes('dining_room') ||
    directNeighborTypes.includes('kitchen')
  );

  if (levelRole === 'lower' && !hasEntrySequenceAccess) {
    topologyFailures.push('Lower stair must connect to the entry sequence or common core');
  }

  return {
    stairRoomId: stair ? String(stair.id) : null,
    landingRoomId: landing ? String(landing.id) : null,
    landingType,
    levelRole,
    directNeighborTypes,
    hasEntrySequenceAccess,
    topologyFailures,
  };
}

module.exports = {
  analyzeStairGraph,
};
