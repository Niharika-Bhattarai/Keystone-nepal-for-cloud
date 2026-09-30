'use strict';

const {
  rect,
  splitColumns,
  splitRows,
  placeRoom,
} = require('../fitRoomsToRealms');

function clamp(value, minValue, maxValue) {
  return Math.min(Math.max(Number(value || 0), minValue), maxValue);
}

function pullFirstByType(rooms, type) {
  const index = rooms.findIndex((room) => String(room?.type) === String(type));
  if (index === -1) return null;
  return rooms.splice(index, 1)[0];
}

function pullAllByType(rooms, type) {
  const found = [];
  for (let index = rooms.length - 1; index >= 0; index--) {
    if (String(rooms[index]?.type) !== String(type)) continue;
    found.push(rooms[index]);
    rooms.splice(index, 1);
  }
  return found.reverse();
}

function placeIfRoom(room, roomRect, extras = {}) {
  if (!room) return null;
  return placeRoom(room, roomRect, extras);
}

function placeStack(rooms, container) {
  const filtered = (rooms || []).filter(Boolean);
  if (!filtered.length || !container) return [];
  let cursorY = Number(container.y || 0);
  const out = [];
  const slotHeight = Math.max(2, Math.floor(Number(container.h || 0) / filtered.length));

  filtered.forEach((room, index) => {
    const isLast = index === filtered.length - 1;
    const height = isLast
      ? Math.max(2, Number(container.y || 0) + Number(container.h || 0) - cursorY)
      : slotHeight;
    out.push(placeRoom(room, {
      x: Number(container.x || 0),
      y: cursorY,
      w: Number(container.w || 0),
      h: height,
    }));
    cursorY += height;
  });

  return out;
}

function placeSharedBathStack(sharedBaths, container) {
  const baths = (sharedBaths || []).filter(Boolean);
  if (!baths.length || !container) return [];

  const totalHeight = Number(container.h || 0);
  const targetHeight = Math.max(6, Math.floor(totalHeight / baths.length));
  let cursorY = Number(container.y || 0);
  const out = [];

  baths.forEach((bath, index) => {
    const isLast = index === baths.length - 1;
    const height = isLast
      ? Math.max(6, Number(container.y || 0) + totalHeight - cursorY)
      : targetHeight;
    out.push(placeRoom(bath, {
      x: Number(container.x || 0),
      y: cursorY,
      w: Number(container.w || 0),
      h: height,
    }));
    cursorY += height;
  });

  return out;
}

function resolveGarageWidth(brief, width) {
  const garageType = String(brief?.garageType || '').toUpperCase();
  const preferred = garageType === 'TWO_CAR' ? 20 : 14;
  return clamp(preferred, 12, Math.max(12, Number(width || 0) - 24));
}

function splitServiceColumn(serviceRect, mudroom, laundry, overflowBath = null) {
  if (!serviceRect) return [];
  const extraBaths = Array.isArray(overflowBath)
    ? overflowBath.filter(Boolean)
    : [overflowBath].filter(Boolean);
  const rooms = [mudroom, laundry].filter(Boolean);
  if (!rooms.length && !extraBaths.length) return [];

  if (!extraBaths.length) {
    return placeStack(rooms, serviceRect);
  }

  if (extraBaths.length === 1) {
    const bathHeight = clamp(Math.floor(Number(serviceRect.h || 0) * 0.42), 6, Math.max(6, Number(serviceRect.h || 0) - 6));
    const [serviceTop, serviceBottom] = splitRows(serviceRect, [Number(serviceRect.h || 0) - bathHeight, bathHeight]);
    return [
      ...placeStack(rooms, serviceTop),
      placeRoom(extraBaths[0], serviceBottom),
    ];
  }

  return placeStack([...rooms, ...extraBaths], serviceRect);
}

function buildCentralWithGarage({ brief, footprint, specs }) {
  const width = Number(footprint?.widthFt || (String(brief?.garageType || '').toUpperCase() === 'TWO_CAR' ? 46 : 40));
  const height = Number(footprint?.heightFt || 34);
  const garageWidth = resolveGarageWidth(brief, width);
  const [garageCol, mainCol] = splitColumns(rect(0, 0, width, height), [garageWidth, width - garageWidth]);
  const garageHeight = clamp(Math.floor(height * 0.52), 16, Math.max(16, height - 12));
  const [garageRect, serviceRect] = splitRows(garageCol, [garageHeight, height - garageHeight]);

  const kitchen = pullFirstByType(specs, 'kitchen');
  const dining = pullFirstByType(specs, 'dining_room');
  const living = pullFirstByType(specs, 'living_room');
  const entry = pullFirstByType(specs, 'entry');
  const laundry = pullFirstByType(specs, 'laundry');
  const garage = pullFirstByType(specs, 'garage');
  const mudroom = pullFirstByType(specs, 'mudroom');
  const primaryBedroom = pullFirstByType(specs, 'primary_bedroom');
  const primaryBath = pullFirstByType(specs, 'primary_bathroom');
  const secondaryBedroom = pullFirstByType(specs, 'bedroom');
  const sharedBaths = pullAllByType(specs, 'bathroom');
  const serviceSharedBath = sharedBaths.length ? sharedBaths.shift() : null;
  const overflowServiceBath = sharedBaths.length ? sharedBaths.shift() : null;
  const study = pullFirstByType(specs, 'study');

  // Reserve usable living depth before allocating the private band. The old
  // percentage split could leave a five-foot-deep living room behind the entry.
  const livingWidth = Math.ceil(mainCol.w / 2);
  const publicHeight = 8 + 4 + Math.max(8, Math.ceil(120 / livingWidth));
  if (height - publicHeight < 15) throw new Error('Central garage pattern needs more depth for living and sleeping rooms');
  const [publicRect, privateRect] = splitRows(mainCol, [publicHeight, height - publicHeight]);
  const kitchenHeight = 8;
  const [kitchenBand, socialRect] = splitRows(publicRect, [kitchenHeight, publicRect.h - kitchenHeight]);
  const studyWidth = study ? Math.max(10, Math.ceil(Number(study.minFeatureAreaSqFt || 100) / kitchenHeight)) : 0;
  if (study && (kitchenBand.w - studyWidth) * kitchenHeight < 96) throw new Error('Study would leave insufficient kitchen area');
  const kitchenRect = { ...kitchenBand, w: kitchenBand.w - studyWidth };
  const studyRect = study ? { x: kitchenRect.x + kitchenRect.w, y: kitchenRect.y, w: studyWidth, h: kitchenHeight } : null;
  const [diningRect, livingZoneRect] = splitColumns(socialRect, [Math.floor(socialRect.w / 2), socialRect.w - Math.floor(socialRect.w / 2)]);
  const entryHeight = 4;
  const [livingRect, entryRect] = splitRows(livingZoneRect, [livingZoneRect.h - entryHeight, entryHeight]);

  const [privateLeft, privateRight] = splitColumns(privateRect, [Math.floor(privateRect.w / 2), privateRect.w - Math.floor(privateRect.w / 2)]);
  const primaryBathHeight = clamp(Math.floor(privateLeft.h * 0.4), 8, 10);
  const [primaryBedRect, primaryBathRect] = splitRows(privateLeft, [privateLeft.h - primaryBathHeight, primaryBathHeight]);
  const secondaryBedRect = privateRight;

  const rooms = [
    placeIfRoom(garage, garageRect),
    ...splitServiceColumn(serviceRect, mudroom, laundry, [serviceSharedBath, overflowServiceBath]),
    placeIfRoom(kitchen, kitchenRect, { openConcept: true }),
    placeIfRoom(study, studyRect),
    placeIfRoom(dining, diningRect, { openConcept: true }),
    placeIfRoom(living, livingRect, { openConcept: true }),
    placeIfRoom(entry, entryRect),
    placeIfRoom(primaryBedroom, primaryBedRect),
    placeIfRoom(primaryBath, primaryBathRect),
    placeIfRoom(secondaryBedroom, secondaryBedRect),
  ].filter(Boolean);

  if (overflowServiceBath) {
    // The rear service bath used to be sealed behind the primary suite.
    // Reserve an independent route alongside the service column instead of
    // asking door placement to route through a bedroom or another bathroom.
    const hallX = mainCol.x, hallY = kitchenHeight, hallWidth = 4;
    for (const room of rooms) {
      if (room.x !== hallX || room.y < hallY) continue;
      room.x += hallWidth;
      room.w -= hallWidth;
    }
    rooms.push(placeRoom({ id: 'architect_v2_service_hall', type: 'hallway', level: 1, label: 'Service hall' },
      rect(hallX, hallY, hallWidth, height - hallY)));
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

function buildSplitWithGarage({ brief, footprint, specs }) {
  const width = Number(footprint?.widthFt || (String(brief?.garageType || '').toUpperCase() === 'TWO_CAR' ? 56 : 50));
  const height = Number(footprint?.heightFt || 36);
  const garageWidth = resolveGarageWidth(brief, width);
  const [garageCol, mainCol] = splitColumns(rect(0, 0, width, height), [garageWidth, width - garageWidth]);
  const garageHeight = clamp(Math.floor(height * 0.52), 16, Math.max(16, height - 12));
  const [garageRect, serviceRect] = splitRows(garageCol, [garageHeight, height - garageHeight]);

  const kitchen = pullFirstByType(specs, 'kitchen');
  const dining = pullFirstByType(specs, 'dining_room');
  const living = pullFirstByType(specs, 'living_room');
  const entry = pullFirstByType(specs, 'entry');
  const laundry = pullFirstByType(specs, 'laundry');
  const garage = pullFirstByType(specs, 'garage');
  const mudroom = pullFirstByType(specs, 'mudroom');
  const primaryBedroom = pullFirstByType(specs, 'primary_bedroom');
  const primaryBath = pullFirstByType(specs, 'primary_bathroom');
  const secondaryBedrooms = pullAllByType(specs, 'bedroom');
  const bedroomA = secondaryBedrooms[0] || null;
  const bedroomB = secondaryBedrooms[1] || null;
  const sharedBaths = pullAllByType(specs, 'bathroom');
  const overflowServiceBath = sharedBaths.length > 1 ? sharedBaths.pop() : null;

  const leftPrivateWidth = clamp(Math.floor(mainCol.w * 0.34), 12, Math.max(12, mainCol.w - 24));
  const rightPrivateWidth = clamp(Math.floor(mainCol.w * 0.34), 12, Math.max(12, mainCol.w - leftPrivateWidth - 8));
  const centerWidth = mainCol.w - leftPrivateWidth - rightPrivateWidth;
  const [leftCol, centerCol, rightCol] = splitColumns(mainCol, [leftPrivateWidth, centerWidth, rightPrivateWidth]);

  const primaryBathHeight = clamp(
    Math.ceil(leftCol.w / 2.6),
    8,
    Math.max(8, height - 10)
  );
  const [primaryBedRect, primaryBathRect] = splitRows(leftCol, [height - primaryBathHeight, primaryBathHeight]);

  const kitchenHeight = clamp(Math.floor(height * 0.34), 10, 12);
  const diningHeight = clamp(Math.floor(height * 0.24), 9, 10);
  const [kitchenRect, centerBelowKitchen] = splitRows(centerCol, [kitchenHeight, height - kitchenHeight]);
  const [diningRect, centerLivingZone] = splitRows(centerBelowKitchen, [diningHeight, centerBelowKitchen.h - diningHeight]);
  const entryHeight = clamp(Math.floor(centerLivingZone.h * 0.33), 5, Math.max(5, centerLivingZone.h - 8));
  const [livingRect, entryRect] = splitRows(centerLivingZone, [centerLivingZone.h - entryHeight, entryHeight]);

  const rightBathCount = sharedBaths.length;
  const rightBathMinHeight = rightBathCount * 6;
  const rightBathMaxHeight = Math.max(rightBathMinHeight, rightCol.h - (bedroomB ? 16 : 10));
  const rightBathHeight = rightBathCount
    ? clamp(Math.ceil((rightCol.w / 2.6) * rightBathCount), rightBathMinHeight, rightBathMaxHeight)
    : 0;
  let bedroomARect = rightCol;
  let bedroomBRect = null;
  let bathRect = null;

  if (bedroomB && rightBathHeight > 0) {
    const topBedroomHeight = Math.max(9, Math.floor((rightCol.h - rightBathHeight) / 2));
    const splitHeights = [
      topBedroomHeight,
      rightBathHeight,
      rightCol.h - topBedroomHeight - rightBathHeight,
    ];
    const rightRows = splitRows(rightCol, splitHeights);
    bedroomARect = rightRows[0];
    bathRect = rightRows[1];
    bedroomBRect = rightRows[2];
  } else if (bedroomB) {
    const topBedroomHeight = Math.max(8, Math.floor(rightCol.h / 2));
    const rightRows = splitRows(rightCol, [topBedroomHeight, rightCol.h - topBedroomHeight]);
    bedroomARect = rightRows[0];
    bedroomBRect = rightRows[1];
  } else if (rightBathHeight > 0) {
    const rightRows = splitRows(rightCol, [rightBathHeight, rightCol.h - rightBathHeight]);
    bathRect = rightRows[0];
    bedroomARect = rightRows[1];
  }

  const rooms = [
    placeIfRoom(garage, garageRect),
    ...splitServiceColumn(serviceRect, mudroom, laundry, [overflowServiceBath]),
    placeIfRoom(primaryBedroom, primaryBedRect),
    placeIfRoom(primaryBath, primaryBathRect),
    placeIfRoom(kitchen, kitchenRect, { openConcept: true }),
    placeIfRoom(dining, diningRect, { openConcept: true }),
    placeIfRoom(living, livingRect, { openConcept: true }),
    placeIfRoom(entry, entryRect),
    placeIfRoom(bedroomA, bedroomARect),
    placeIfRoom(bedroomB, bedroomBRect),
    ...placeSharedBathStack(sharedBaths, bathRect),
  ].filter(Boolean);

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

function oneStoryCentralCoreWithGarage({ brief, footprint, program }) {
  const specs = [...(program?.levels?.find((level) => level.level === 1)?.rooms || [])];
  const variationId = String(footprint?.variationId || 'variant_d_wide_front_living');
  // variant_e uses split layout (bedrooms separated), variant_d/f use central layout
  if (variationId === 'variant_e_deep_garden_spine' && specs.filter((r) => r?.type === 'bedroom').length >= 2) {
    return buildSplitWithGarage({ brief, footprint, specs });
  }
  return buildCentralWithGarage({ brief, footprint, specs });
}

function oneStorySplitBedroomWithGarage({ brief, footprint, program }) {
  const specs = [...(program?.levels?.find((level) => level.level === 1)?.rooms || [])];
  const variationId = String(footprint?.variationId || 'variant_d_wide_front_living');
  // variant_f uses central hub layout, variant_d/e use split layout
  if (variationId === 'variant_f_central_hub') {
    return buildCentralWithGarage({ brief, footprint, specs });
  }
  return buildSplitWithGarage({ brief, footprint, specs });
}

module.exports = {
  oneStoryCentralCoreWithGarage,
  oneStorySplitBedroomWithGarage,
};
