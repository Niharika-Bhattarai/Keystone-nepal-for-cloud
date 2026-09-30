'use strict';

const { normalizeRoomType } = require('../../../tile/canonicalRoomTypes');
const { shareWall, roomArea, touchesExterior } = require('../../../planGeometry');
const { getResidentialStairStandards } = require('../stairStandards');

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isShortConnector(room) {
  const width = num(room?.w);
  const height = num(room?.h);
  const longSide = Math.max(width, height);
  const shortSide = Math.min(width, height);
  const area = roomArea(room);
  return shortSide <= 4 && longSide <= 10 && area <= 40;
}

function analyzeHallGraph(level, brief = null) {
  const standards = getResidentialStairStandards({ wideDoorways: level?.stairCore?.wideDoorways });
  const stories = Math.max(1, num(brief?.stories, 1));
  const levelNumber = num(level?.level, 1);
  const rooms = Array.isArray(level?.rooms) ? level.rooms : [];
  const roomById = new Map(rooms.map((room) => [String(room?.id), room]));
  const hallRooms = (level?.rooms || []).filter((room) => normalizeRoomType(room?.type) === 'hallway');
  const landingRoomId = String(level?.stairCore?.hallRoomId || level?.stairCore?.landingRoomId || '');
  const landingHall = roomById.get(landingRoomId) || hallRooms[0] || null;
  const landingType = normalizeRoomType(landingHall?.type);
  const neighborHalls = landingHall
    ? hallRooms.filter((room) => String(room?.id) !== String(landingHall?.id) && shareWall(landingHall, room, 2))
    : [];
  const levelArea = Math.max(1, num(level?.width) * num(level?.height));
  const hallArea = hallRooms.reduce((sum, room) => sum + roomArea(room), 0);
  const hallRatio = hallArea / levelArea;
  const compactUpper = stories === 2 && levelNumber === 2 && levelArea <= 1200;
  const touchesDaylight = landingHall ? touchesExterior(landingHall, num(level?.width), num(level?.height)) : false;
  const loftCandidate = Boolean(landingHall) &&
    hallRooms.length === 1 &&
    hallArea > standards.maxLandingAreaSqFt &&
    touchesDaylight;

  let topology = hallRooms.length ? 'single_landing' : 'no_hall';
  const failures = [];

  if (landingType === 'loft') {
    topology = 'loft_landing';
    if (compactUpper && neighborHalls.length > standards.compactUpperMaxConnectorCount) {
      failures.push(`Upper landing topology invalid: compact level ${levelNumber} has fragmented loft-connected circulation (${neighborHalls.length} hall connectors)`);
    }
  } else if (neighborHalls.length > 1) {
    topology = 'two_sided_bar';
    failures.push(`Upper landing topology invalid: level ${levelNumber} has two-sided hall bars from the stair landing`);
  } else if (compactUpper && hallRooms.length === 2 && neighborHalls.length === 1) {
    const connector = hallRooms.find((room) => String(room?.id) !== String(landingHall?.id));
    if (connector && isShortConnector(connector)) {
      topology = 'landing_with_short_connector';
    } else {
      topology = 'fragmented';
      failures.push(`Upper landing topology invalid: compact level ${levelNumber} has fragmented hall circulation (${hallRooms.length} hall rooms)`);
    }
  } else if (compactUpper && hallRooms.length > 1) {
    topology = 'fragmented';
    failures.push(`Upper landing topology invalid: compact level ${levelNumber} has fragmented hall circulation (${hallRooms.length} hall rooms)`);
  } else if (loftCandidate) {
    topology = 'loft_candidate';
  }

  return {
    topology,
    failures,
    hallRooms,
    landingHall,
    neighborHalls,
    hallArea,
    hallRatio,
    compactUpper,
    isLoftCandidate: loftCandidate,
    landingType,
  };
}

module.exports = {
  analyzeHallGraph,
};
