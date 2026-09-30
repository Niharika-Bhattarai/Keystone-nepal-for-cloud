'use strict';

const { placeRoom } = require('./fitRoomsToRealms');
const { classifyUpperCirculationRoom, classifyUpperSupportRoom } = require('./patterns/upperLandingRooms');
const { getResidentialStairStandards } = require('./stairStandards');

const SHARED_UPPER_CIRCULATION_ENGINE_ID = 'shared_two_story_garage_upper_circulation_v1';

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function even(value, fallback = 2) {
  const n = Math.max(fallback, Math.round(num(value, fallback) / 2) * 2);
  return Number.isFinite(n) ? n : fallback;
}

function sideRank(side) {
  switch (String(side || '').toLowerCase()) {
    case 'west':
    case 'northwest':
      return 0;
    case 'north':
    case 'center':
      return 1;
    case 'east':
    case 'northeast':
      return 2;
    case 'south':
    case 'southeast':
      return 3;
    default:
      return 1;
  }
}

function desiredSpan(entry, fixedSpan, minSpan = 6) {
  const targetAreaSqFt = num(entry?.targetAreaSqFt, num(entry?.room?.targetAreaSqFt, minSpan * fixedSpan));
  return Math.max(minSpan, even(targetAreaSqFt / Math.max(2, fixedSpan), minSpan));
}

function allocateLinearSpans(entries, totalSpan, fixedSpan, minSpan = 6) {
  const safeEntries = entries.filter((entry) => entry?.room);
  if (!safeEntries.length) return [];

  const spans = safeEntries.map((entry) => desiredSpan(entry, fixedSpan, minSpan));
  let delta = totalSpan - spans.reduce((sum, span) => sum + span, 0);

  if (delta > 0) {
    const flexible = [...safeEntries.keys()].sort((a, b) => {
      return num(safeEntries[b]?.targetAreaSqFt, 0) - num(safeEntries[a]?.targetAreaSqFt, 0);
    });
    let index = 0;
    while (delta > 0 && flexible.length) {
      spans[flexible[index % flexible.length]] += 2;
      delta -= 2;
      index += 1;
    }
  } else if (delta < 0) {
    const shrinkable = [...safeEntries.keys()].sort((a, b) => spans[b] - spans[a]);
    let index = 0;
    while (delta < 0 && shrinkable.length) {
      const targetIndex = shrinkable[index % shrinkable.length];
      if (spans[targetIndex] > minSpan) {
        spans[targetIndex] -= 2;
        delta += 2;
      } else {
        index += 1;
        if (index > shrinkable.length * 3) break;
        continue;
      }
      index += 1;
    }
  }

  return spans;
}

function buildHorizontalBand(entries, options = {}) {
  const x = num(options.x, 0);
  const y = num(options.y, 0);
  const totalWidth = num(options.totalWidth, 0);
  const height = num(options.height, 0);
  const minWidth = num(options.minWidth, 6);
  const ordered = options.preserveOrder
    ? entries.filter((entry) => entry?.room)
    : [...entries.filter((entry) => entry?.room)].sort((a, b) => {
      return sideRank(a?.preferredSide) - sideRank(b?.preferredSide);
    });

  const widths = allocateLinearSpans(ordered, totalWidth, height, minWidth);
  let cursor = x;

  return ordered.map((entry, index) => {
    const width = widths[index];
    const rect = {
      x: cursor,
      y,
      w: width,
      h: height,
    };
    cursor += width;
    return placeRoom(entry.room, rect, entry.placeExtras || {});
  });
}

function buildSharedUpperGarageCirculationCore(options = {}) {
  const standards = getResidentialStairStandards(options);
  const width = num(options.width, 40);
  const height = num(options.height, 30);
  const stairAnchor = options.stairAnchor || null;

  const stairWidth = stairAnchor
    ? num(stairAnchor.w)
    : num(options.stairWidth, 6);
  const stairRun = stairAnchor
    ? num(stairAnchor.h)
    : num(options.stairRun, Math.max(12, Math.min(16, height - 16)));
  const stairX = stairAnchor
    ? num(stairAnchor.x)
    : num(options.leftWingWidth, 14);
  const stairY = stairAnchor
    ? num(stairAnchor.y)
    : height - stairRun;

  // The lower core is a shared vertical reservation, not a sizing hint. Clamping
  // only its upper copy breaks the floor opening and prevents any fitted flight.
  if (stairAnchor && (!(stairWidth > 0 && stairRun > 0) || stairX < 0 || stairY < 0 ||
    stairX + stairWidth > width || stairY + stairRun > height)) {
    throw new Error('The shared stair reservation must fit both floor envelopes.');
  }

  const leftWingWidth = stairX;
  const rightWingX = stairX + stairWidth;
  const rightWingWidth = Math.max(12, width - rightWingX);

  const landingX = Math.max(8, stairX - (options.wideDoorways ? 6 : 4));
  const requestedLandingWidth = options.wideDoorways
    ? rightWingX - landingX
    : Math.max(num(options.landingWidth, 10), rightWingX - landingX);
  const maxLandingWidthFromEnvelope = Math.max(6, rightWingX - landingX);
  const minLandingDepth = num(standards?.minLandingDepthFt, 6);
  const maxLandingDepth = Math.max(4, Math.min(num(standards?.maxLandingDepthFt, 8), stairY - 10));
  const maxLandingAreaSqFt = num(standards?.maxLandingAreaSqFt, 64);

  let landingWidth = Math.max(6, Math.min(requestedLandingWidth, maxLandingWidthFromEnvelope));
  let maxDepthFromArea = Math.floor(maxLandingAreaSqFt / Math.max(1, landingWidth));
  if (maxDepthFromArea < minLandingDepth) {
    const maxWidthAtMinDepth = Math.max(6, Math.floor(maxLandingAreaSqFt / Math.max(1, minLandingDepth)));
    landingWidth = Math.max(6, Math.min(landingWidth, maxWidthAtMinDepth));
    maxDepthFromArea = Math.floor(maxLandingAreaSqFt / Math.max(1, landingWidth));
  }

  const requestedLandingDepth = num(options.landingDepth, minLandingDepth);
  const landingDepth = Math.max(
    minLandingDepth,
    Math.min(requestedLandingDepth, maxLandingDepth, Math.max(minLandingDepth, maxDepthFromArea))
  );
  const landingY = stairY - landingDepth;

  const stairsRoom = options.stairsRoom || { id: 'stairs_l2', type: 'stairs', level: 2 };
  const landingRoom = options.landingRoom || { id: 'landing_l2', type: 'hallway', level: 2, label: 'Landing Hall' };

  const landingRect = {
    x: landingX,
    y: landingY,
    w: landingWidth,
    h: landingDepth,
  };
  const stairsRect = {
    x: stairX,
    y: stairY,
    w: stairWidth,
    h: stairRun,
  };

  const placedLanding = placeRoom(classifyUpperCirculationRoom(landingRect, {
    id: landingRoom.id,
    level: landingRoom.level,
    label: landingRoom.label || 'Landing Hall',
  }), landingRect);
  const placedStairs = placeRoom(stairsRoom, stairsRect);

  return {
    engineId: SHARED_UPPER_CIRCULATION_ENGINE_ID,
    leftWingWidth,
    stairWidth,
    stairRun,
    stairX,
    stairY,
    rightWingX,
    rightWingWidth,
    landingX,
    landingY,
    landingRect,
    stairsRect,
    landingRoom: placedLanding,
    stairRoom: placedStairs,
    stairCore: {
      x: stairsRect.x,
      y: stairsRect.y,
      w: stairsRect.w,
      h: stairsRect.h,
      roomId: placedStairs?.id || stairsRoom.id || 'stairs_l2',
      hallRoomId: placedLanding?.id || landingRoom.id || 'landing_l2',
      landingRoomId: placedLanding?.id || landingRoom.id || 'landing_l2',
      landingOpen: true,
      wideDoorways: Boolean(options.wideDoorways),
      graphEngineId: SHARED_UPPER_CIRCULATION_ENGINE_ID,
    },
  };
}

function placeGraphSupportRoom(room, rect, fallbackId, fallbackLabel = 'Storage') {
  return placeRoom(classifyUpperSupportRoom(rect, {
    id: room?.id || fallbackId,
    level: room?.level || 2,
    fallbackType: room?.type || 'storage',
    fallbackLabel: room?.label || fallbackLabel,
  }), rect);
}

module.exports = {
  buildHorizontalBand,
  buildSharedUpperGarageCirculationCore,
  placeGraphSupportRoom,
  SHARED_UPPER_CIRCULATION_ENGINE_ID,
};
