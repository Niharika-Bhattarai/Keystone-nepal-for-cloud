'use strict';

const {
  rect,
  splitColumns,
  splitRows,
  placeRoom,
} = require('../fitRoomsToRealms');

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, minValue, maxValue) {
  return Math.min(Math.max(num(value), minValue), maxValue);
}

function buildTypeBuckets(rooms) {
  const buckets = new Map();
  for (const room of rooms || []) {
    const type = String(room?.type || '').trim().toLowerCase();
    if (!type) continue;
    const list = buckets.get(type) || [];
    list.push(room);
    buckets.set(type, list);
  }
  return buckets;
}

function takeOneByType(buckets, type) {
  const key = String(type || '').trim().toLowerCase();
  const list = buckets.get(key) || [];
  if (!list.length) return null;
  const room = list.shift() || null;
  buckets.set(key, list);
  return room;
}

function takeAllByType(buckets, type) {
  const key = String(type || '').trim().toLowerCase();
  const list = buckets.get(key) || [];
  buckets.set(key, []);
  return [...list];
}

function placeIfRoom(room, roomRect, extras = {}) {
  if (!room || !roomRect) return null;
  return placeRoom(room, roomRect, extras);
}

function resolveGarageWidth(brief, widthFt) {
  const garageType = String(brief?.garageType || '').toUpperCase();
  const preferred = garageType === 'TWO_CAR' ? 20 : 14;
  return clamp(preferred, 12, Math.max(12, num(widthFt) - 36));
}

function allocateWidths(totalWidth, entries, minFloor = 6) {
  const specs = (entries || []).filter((entry) =>
    Boolean(entry) && (entry.room || entry.minWidth !== undefined || entry.flex !== undefined)
  );
  if (!specs.length) return [];

  const total = Math.max(0, Math.floor(num(totalWidth)));
  if (total <= 0) return specs.map(() => minFloor);

  const minimums = specs.map((entry) => Math.max(minFloor, Math.floor(num(entry?.minWidth, minFloor))));
  const flexes = specs.map((entry) => Math.max(0, num(entry?.flex, 1)));
  const minSum = minimums.reduce((sum, value) => sum + value, 0);

  let widths;
  if (minSum >= total) {
    const ratio = total / Math.max(1, minSum);
    widths = minimums.map((value) => Math.max(minFloor, Math.floor(value * ratio)));
  } else {
    widths = [...minimums];
    let remaining = total - minSum;
    const flexSum = flexes.reduce((sum, value) => sum + value, 0);
    if (flexSum > 0 && remaining > 0) {
      for (let index = 0; index < widths.length; index++) {
        const add = Math.floor((remaining * flexes[index]) / flexSum);
        widths[index] += add;
      }
    }
  }

  let delta = total - widths.reduce((sum, value) => sum + value, 0);
  if (delta > 0) {
    let cursor = 0;
    while (delta > 0) {
      widths[cursor % widths.length] += 1;
      cursor += 1;
      delta -= 1;
    }
  } else if (delta < 0) {
    let cursor = widths.length - 1;
    while (delta < 0) {
      if (widths[cursor] > minFloor) {
        widths[cursor] -= 1;
        delta += 1;
      }
      cursor = cursor === 0 ? widths.length - 1 : cursor - 1;
      if (!widths.some((value) => value > minFloor)) break;
    }
  }

  const finalDelta = total - widths.reduce((sum, value) => sum + value, 0);
  widths[widths.length - 1] += finalDelta;
  return widths;
}

function sliceBandColumns(bandRect, entries) {
  const specs = (entries || []).filter((entry) => entry?.room);
  if (!specs.length) return [];
  const widths = allocateWidths(bandRect.w, specs);
  let cursorX = num(bandRect.x);
  return specs.map((entry, index) => {
    const width = Math.max(1, num(widths[index], 1));
    const roomRect = {
      x: cursorX,
      y: num(bandRect.y),
      w: width,
      h: num(bandRect.h),
    };
    cursorX += width;
    return { room: entry.room, roomRect, extras: entry.extras || {} };
  });
}

function splitRowIntoCells(rowRect, count) {
  if (!rowRect || count <= 0) return [];
  if (count === 1) return [rowRect];
  const widths = allocateWidths(rowRect.w, Array.from({ length: count }, () => ({ minWidth: 10, flex: 1 })), 8);
  let cursorX = num(rowRect.x);
  return widths.map((width, index) => {
    const resolvedWidth = index === widths.length - 1
      ? Math.max(1, num(rowRect.x) + num(rowRect.w) - cursorX)
      : Math.max(1, num(width, 1));
    const cell = {
      x: cursorX,
      y: num(rowRect.y),
      w: resolvedWidth,
      h: num(rowRect.h),
    };
    cursorX += resolvedWidth;
    return cell;
  });
}

function buildBedroomCells(privateRect, bedroomCount) {
  if (!privateRect || bedroomCount <= 0) return [];
  if (bedroomCount === 1) return [privateRect];

  const topCount = Math.ceil(bedroomCount / 2);
  const bottomCount = bedroomCount - topCount;
  if (bottomCount <= 0) return splitRowIntoCells(privateRect, topCount);

  const topHeight = clamp(Math.floor(num(privateRect.h) * 0.52), 9, Math.max(9, num(privateRect.h) - 9));
  const [topRow, bottomRow] = splitRows(privateRect, [topHeight, num(privateRect.h) - topHeight]);
  return [
    ...splitRowIntoCells(topRow, topCount),
    ...splitRowIntoCells(bottomRow, bottomCount),
  ];
}

function splitPrimarySuiteCell(primaryCell) {
  if (!primaryCell) return { bedroomRect: null, bathRect: null };
  const preferredBathDepth = clamp(Math.ceil(num(primaryCell.w) / 2.6), 8, Math.max(8, num(primaryCell.h) - 9));
  const remainingDepth = num(primaryCell.h) - preferredBathDepth;
  if (remainingDepth >= 9) {
    const [bedroomRect, bathRect] = splitRows(primaryCell, [remainingDepth, preferredBathDepth]);
    return { bedroomRect, bathRect };
  }

  const preferredBathWidth = clamp(Math.ceil(num(primaryCell.h) / 2.6), 8, Math.max(8, num(primaryCell.w) - 10));
  const [bedroomRect, bathRect] = splitColumns(primaryCell, [num(primaryCell.w) - preferredBathWidth, preferredBathWidth]);
  return { bedroomRect, bathRect };
}

function placeStackVertical(rooms, containerRect) {
  const filtered = (rooms || []).filter(Boolean);
  if (!filtered.length || !containerRect) return [];

  const heights = [];
  const minHeight = 6;
  const available = Math.max(filtered.length * minHeight, Math.floor(num(containerRect.h)));
  const slot = Math.max(minHeight, Math.floor(available / filtered.length));
  let used = 0;
  for (let index = 0; index < filtered.length; index++) {
    const isLast = index === filtered.length - 1;
    const h = isLast
      ? Math.max(minHeight, num(containerRect.h) - used)
      : slot;
    heights.push(h);
    used += h;
  }

  const out = [];
  let cursorY = num(containerRect.y);
  for (let index = 0; index < filtered.length; index++) {
    const isLast = index === filtered.length - 1;
    const height = isLast
      ? Math.max(minHeight, num(containerRect.y) + num(containerRect.h) - cursorY)
      : heights[index];
    out.push(placeRoom(filtered[index], {
      x: num(containerRect.x),
      y: cursorY,
      w: num(containerRect.w),
      h: height,
    }));
    cursorY += height;
  }

  return out;
}

function buildOneStoryLargeSplit({ brief, footprint, program, withGarage = false }) {
  const width = num(footprint?.widthFt, withGarage ? 60 : 54);
  const height = num(footprint?.heightFt, withGarage ? 42 : 40);
  const levelRooms = [...(program?.levels?.find((level) => Number(level?.level) === 1)?.rooms || [])];
  const typeBuckets = buildTypeBuckets(levelRooms);

  const kitchen = takeOneByType(typeBuckets, 'kitchen');
  const dining = takeOneByType(typeBuckets, 'dining_room');
  const living = takeOneByType(typeBuckets, 'living_room');
  const entry = takeOneByType(typeBuckets, 'entry');
  const laundry = takeOneByType(typeBuckets, 'laundry');
  const mudroom = takeOneByType(typeBuckets, 'mudroom');
  const garage = takeOneByType(typeBuckets, 'garage');
  const primaryBedroom = takeOneByType(typeBuckets, 'primary_bedroom');
  const primaryBath = takeOneByType(typeBuckets, 'primary_bathroom');
  const secondaryBedrooms = takeAllByType(typeBuckets, 'bedroom');
  const sharedBaths = takeAllByType(typeBuckets, 'bathroom');

  const rootRect = rect(0, 0, width, height);
  const garageWidth = withGarage ? resolveGarageWidth(brief, width) : 0;
  const [garageCol, mainCol] = withGarage
    ? splitColumns(rootRect, [garageWidth, width - garageWidth])
    : [null, rootRect];

  const garageRect = withGarage && garageCol
    ? splitRows(garageCol, [clamp(Math.floor(height * 0.56), 18, Math.max(18, height - 10)), height - clamp(Math.floor(height * 0.56), 18, Math.max(18, height - 10))])[0]
    : null;
  const garageServiceRect = withGarage && garageCol
    ? splitRows(garageCol, [clamp(Math.floor(height * 0.56), 18, Math.max(18, height - 10)), height - clamp(Math.floor(height * 0.56), 18, Math.max(18, height - 10))])[1]
    : null;

  let serviceHeight = clamp(Math.floor(height * 0.2), 8, 10);
  let publicHeight = clamp(Math.floor(height * 0.34), 12, 16);
  let privateHeight = height - publicHeight - serviceHeight;
  if (privateHeight < 18) {
    let deficit = 18 - privateHeight;
    const publicSlack = Math.max(0, publicHeight - 12);
    const reducePublic = Math.min(deficit, publicSlack);
    publicHeight -= reducePublic;
    deficit -= reducePublic;
    const serviceSlack = Math.max(0, serviceHeight - 8);
    const reduceService = Math.min(deficit, serviceSlack);
    serviceHeight -= reduceService;
    privateHeight = height - publicHeight - serviceHeight;
  }

  const [topBand, serviceBand] = splitRows(mainCol, [height - serviceHeight, serviceHeight]);
  const [publicBand, privateBand] = splitRows(topBand, [publicHeight, topBand.h - publicHeight]);
  let entryRect = null;
  let publicCoreBand = publicBand;
  if (entry && num(publicBand?.w) >= 22 && !brief.kitchenRear) {
    const entryWidth = clamp(Math.floor(num(publicBand.w) * 0.22), 10, 14);
    const [entrySlice, coreSlice] = splitColumns(publicBand, [entryWidth, num(publicBand.w) - entryWidth]);
    entryRect = entrySlice;
    publicCoreBand = coreSlice;
  }

  const variationId = String(footprint?.variationId || 'variant_d_wide_front_living');
  // variant_e: living gets the most space and is first (garden-facing left edge)
  // variant_f: dining centered with equal kitchen/living flanks
  // variant_d (default): kitchen-dining-living left-to-right
  const publicSlices = variationId === 'variant_e_deep_garden_spine'
    ? [
      { room: living, minWidth: 12, flex: 1.4, extras: { openConcept: true } },
      { room: kitchen, minWidth: 12, flex: 1, extras: { openConcept: true } },
      { room: dining, minWidth: 10, flex: 0.9, extras: { openConcept: true } },
    ]
    : variationId === 'variant_f_central_hub'
    ? [
      { room: kitchen, minWidth: 12, flex: 1.1, extras: { openConcept: true } },
      { room: dining, minWidth: 10, flex: 1.1, extras: { openConcept: true } },
      { room: living, minWidth: 12, flex: 1.3, extras: { openConcept: true } },
    ]
    : [
      { room: kitchen, minWidth: 12, flex: 1, extras: { openConcept: true } },
      { room: dining, minWidth: 10, flex: 1, extras: { openConcept: true } },
      { room: living, minWidth: 12, flex: 1.2, extras: { openConcept: true } },
    ];
  const publicPlacements = sliceBandColumns(publicCoreBand, publicSlices);

  const allBedrooms = [primaryBedroom, ...secondaryBedrooms].filter(Boolean);
  const reservePrivateHall = allBedrooms.length >= 4;
  const hallWidth = 4;
  const hallX = privateBand.x + Math.floor((privateBand.w - hallWidth) / 2);
  const sleepingBand = reservePrivateHall ? { ...privateBand, h: privateBand.h - hallWidth } : privateBand;
  if (reservePrivateHall && sleepingBand.h < 18) throw new Error('Bedroom rows need nine feet of depth plus the service hall');
  const rawBedroomCells = reservePrivateHall && allBedrooms.length === 5
    ? [
      ...Array.from({ length: 2 }, (_, i) => ({ x: sleepingBand.x, y: sleepingBand.y + i * sleepingBand.h / 2,
        w: hallX - sleepingBand.x, h: sleepingBand.h / 2 })),
      ...Array.from({ length: 3 }, (_, i) => ({ x: hallX + hallWidth, y: sleepingBand.y + i * sleepingBand.h / 3,
        w: sleepingBand.x + sleepingBand.w - hallX - hallWidth, h: sleepingBand.h / 3 })),
    ]
    : buildBedroomCells(sleepingBand, allBedrooms.length);
  const bedroomCells = rawBedroomCells.map(cell => {
    if (!reservePrivateHall) return cell;
    return cell.x < hallX ? { ...cell, w: hallX - cell.x }
      : { ...cell, x: hallX + hallWidth, w: cell.x + cell.w - hallX - hallWidth };
  });
  // Move the complete suite between private-wing positions. Public-band
  // width changes alone left compact garage homes with one topology.
  if (withGarage && allBedrooms.length === 4) {
    const primaryIndex = variationId === 'variant_e_deep_garden_spine' ? 3
      : variationId === 'variant_f_central_hub' ? 2 : 0;
    [bedroomCells[0], bedroomCells[primaryIndex]] = [bedroomCells[primaryIndex], bedroomCells[0]];
  } else if (withGarage && allBedrooms.length === 5 && variationId !== 'variant_d_wide_front_living') {
    [bedroomCells[0], bedroomCells[1]] = [bedroomCells[1], bedroomCells[0]];
  }
  const primaryCell = bedroomCells[0] || privateBand;
  const { bedroomRect: primaryBedroomRect, bathRect: primaryBathRect } = splitPrimarySuiteCell(primaryCell);
  const secondaryBedroomCells = bedroomCells.slice(1);

  const serviceRoomsMain = [];
  if (sharedBaths[0]) serviceRoomsMain.push({ room: sharedBaths[0], minWidth: 7, flex: 1 });
  if (laundry) serviceRoomsMain.push({ room: laundry, minWidth: 8, flex: 1.1 });
  sharedBaths.slice(1).forEach((bath) => {
    serviceRoomsMain.push({ room: bath, minWidth: 7, flex: 1 });
  });
  if (!withGarage && mudroom) {
    serviceRoomsMain.push({ room: mudroom, minWidth: 8, flex: 1 });
  }
  if (!entryRect && entry) {
    serviceRoomsMain.unshift({ room: entry, minWidth: 12, flex: 1.3 });
  }
  const servicePlacements = sliceBandColumns(serviceBand, serviceRoomsMain);

  const garageServiceRooms = withGarage ? [mudroom].filter(Boolean) : [];

  const rooms = [
    placeIfRoom(garage, garageRect),
    ...placeStackVertical(garageServiceRooms, garageServiceRect),
    placeIfRoom(entry, entryRect),
    ...publicPlacements.map((placement) => placeIfRoom(placement.room, placement.roomRect, placement.extras)),
    placeIfRoom(primaryBedroom, primaryBedroomRect),
    placeIfRoom(primaryBath, primaryBathRect),
    ...secondaryBedrooms.map((bedroom, index) => placeIfRoom(bedroom, secondaryBedroomCells[index] || null)),
    ...servicePlacements.map((placement) => placeIfRoom(placement.room, placement.roomRect, placement.extras)),
  ].filter(Boolean);

  if (reservePrivateHall) {
    // A bedroom row must never seal the rear bedrooms and shared baths off
    // from the public core. Use a central path and a short service crossbar.
    const firstService = servicePlacements[0].roomRect;
    const lastService = servicePlacements[servicePlacements.length - 1].roomRect;
    const hallLeft = Math.min(hallX, firstService.x + firstService.w - 5);
    const hallRight = Math.max(hallX + hallWidth, lastService.x + 5);
    const crossbarY = privateBand.y + sleepingBand.h;
    const hallParts = [
      { x: hallX, y: privateBand.y, w: hallWidth, h: sleepingBand.h },
      { x: hallLeft, y: crossbarY, w: hallRight - hallLeft, h: hallWidth },
    ];
    rooms.push(placeRoom({ id: 'architect_v2_private_hall', type: 'hallway', level: 1, label: 'Bedroom hall' },
      { x: hallLeft, y: privateBand.y, w: hallRight - hallLeft, h: privateBand.h }, { parts: hallParts }));
    for (const room of rooms.filter(room => room.type === 'bedroom' && room.y + room.h === crossbarY)) {
      const extra = room.x < hallX
        ? { x: privateBand.x, y: crossbarY, w: hallLeft - privateBand.x, h: hallWidth }
        : { x: hallRight, y: crossbarY, w: privateBand.x + privateBand.w - hallRight, h: hallWidth };
      if (extra.w > 0) {
        room.parts = [{ x: room.x, y: room.y, w: room.w, h: room.h }, extra];
        room.h += hallWidth;
      }
    }
  }

  if (withGarage && brief.kitchenRear) {
    // The garage and arrival stay on the street side. The public band faces
    // the garden, reached by the bedroom hall rather than through bedrooms.
    for (const room of rooms.filter(r => r.x >= mainCol.x)) {
      room.y = height - room.y - room.h;
      if (room.parts?.length) room.parts = room.parts.map(p => ({ ...p, y: height - p.y - p.h }));
    }
  }

  return {
    levels: [
      {
        level: 1,
        width,
        height,
        rooms,
      },
    ],
  };
}

function oneStoryLargeSplitBedroomCompact({ brief, footprint, program }) {
  if (brief.primaryEnsuiteRequested === false || (Number(brief.bedrooms) === 4 && Number(brief.totalAreaSqFt) < 2200) || (Number(brief.bedrooms) === 5 && Number(brief.totalAreaSqFt) < 2800)) {
    return require('./oneStoryPublicSpine').oneStoryPublicSpine({ brief, footprint, program });
  }
  return buildOneStoryLargeSplit({
    brief,
    footprint,
    program,
    withGarage: false,
  });
}

function oneStoryLargeSplitBedroomWithGarage({ brief, footprint, program }) {
  return buildOneStoryLargeSplit({
    brief,
    footprint,
    program,
    withGarage: true,
  });
}

module.exports = {
  oneStoryLargeSplitBedroomCompact,
  oneStoryLargeSplitBedroomWithGarage,
};
