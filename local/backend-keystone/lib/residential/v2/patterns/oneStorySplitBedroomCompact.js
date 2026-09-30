'use strict';

const {
  rect,
  splitColumns,
  splitRows,
  placeRoom,
} = require('../fitRoomsToRealms');

function pullFirst(rooms, type) {
  const index = rooms.findIndex((room) => String(room?.type) === type);
  if (index === -1) return null;
  return rooms.splice(index, 1)[0];
}

function oneStorySplitBedroomCompact({ footprint, program }) {
  const width = Number(footprint?.widthFt || 44);
  const height = Number(footprint?.heightFt || 34);
  const variationId = String(footprint?.variationId || 'variant_d_wide_front_living');
  const specs = [...(program?.levels?.find((level) => level.level === 1)?.rooms || [])];

  const primaryBedroom = pullFirst(specs, 'primary_bedroom');
  const primaryBath = pullFirst(specs, 'primary_bathroom');
  const bedroomA = pullFirst(specs, 'bedroom');
  const bedroomB = pullFirst(specs, 'bedroom');
  const sharedBath = pullFirst(specs, 'bathroom');
  const kitchen = pullFirst(specs, 'kitchen');
  const dining = pullFirst(specs, 'dining_room');
  const living = pullFirst(specs, 'living_room');
  const entry = pullFirst(specs, 'entry');
  const laundry = pullFirst(specs, 'laundry');

  const r = { primaryBedroom, primaryBath, bedroomA, bedroomB, sharedBath, kitchen, dining, living, entry, laundry };

  if (variationId === 'variant_e_deep_garden_spine') {
    return buildSplitDeepGarden(width, height, r);
  }
  if (variationId === 'variant_f_central_hub') {
    return buildSplitCentralHub(width, height, r);
  }
  return buildSplitWideFront(width, height, r);
}

// variant_d: wide front living — primary left, secondary right, wide public center
function buildSplitWideFront(width, height, r) {
  const leftWidth = 14;
  const rightWidth = 14;
  const centerWidth = width - leftWidth - rightWidth;
  const primaryBathHeight = 10;

  const [primaryBedroomRect, primaryBathRect] = splitRows(rect(0, 0, leftWidth, height), [height - primaryBathHeight, primaryBathHeight]);
  const kitchenRect = rect(leftWidth, 0, centerWidth, 12);
  const diningRect = rect(leftWidth, 12, centerWidth, 8);
  const livingH = Math.max(6, height - 26);
  const livingRect = rect(leftWidth, 20, centerWidth, livingH);
  const entryRect = rect(leftWidth, 20 + livingH, centerWidth, height - 20 - livingH);

  const bedroomARect = rect(leftWidth + centerWidth, 0, rightWidth, 12);
  const sharedBathRect = rect(leftWidth + centerWidth, 12, 8, 8);
  const laundryRect = rect(leftWidth + centerWidth + 8, 12, rightWidth - 8, 8);
  const bedroomBRect = rect(leftWidth + centerWidth, 20, rightWidth, height - 20);

  return {
    levels: [{
      level: 1, width, height,
      rooms: [
        placeRoom(r.primaryBedroom, primaryBedroomRect),
        placeRoom(r.primaryBath, primaryBathRect),
        placeRoom(r.kitchen, kitchenRect, { openConcept: true }),
        placeRoom(r.dining, diningRect, { openConcept: true }),
        placeRoom(r.living, livingRect, { openConcept: true }),
        placeRoom(r.entry, entryRect),
        placeRoom(r.bedroomA, bedroomARect),
        placeRoom(r.sharedBath, sharedBathRect),
        placeRoom(r.laundry, laundryRect),
        placeRoom(r.bedroomB, bedroomBRect),
      ],
    }],
  };
}

// variant_e: deep garden spine — primary rear-left, public center spine, secondary beds front-right
function buildSplitDeepGarden(width, height, r) {
  const leftWidth = Math.floor(width * 0.35);
  const centerWidth = Math.floor(width * 0.3);
  const rightWidth = width - leftWidth - centerWidth;

  const primaryBathH = 10;
  const topBedH = 12;
  const midH = 8;
  const bottomBedH = height - topBedH - midH;

  return {
    levels: [{
      level: 1, width, height,
      rooms: [
        placeRoom(r.entry, rect(0, 0, leftWidth, topBedH)),
        placeRoom(r.kitchen, rect(leftWidth, 0, centerWidth, topBedH), { openConcept: true }),
        placeRoom(r.bedroomA, rect(leftWidth + centerWidth, 0, rightWidth, topBedH)),
        placeRoom(r.laundry, rect(0, topBedH, leftWidth, midH)),
        placeRoom(r.dining, rect(leftWidth, topBedH, centerWidth, midH), { openConcept: true }),
        placeRoom(r.sharedBath, rect(leftWidth + centerWidth, topBedH, rightWidth, midH)),
        placeRoom(r.primaryBedroom, rect(0, topBedH + midH, leftWidth, bottomBedH - primaryBathH)),
        placeRoom(r.primaryBath, rect(0, height - primaryBathH, leftWidth, primaryBathH)),
        placeRoom(r.living, rect(leftWidth, topBedH + midH, centerWidth + rightWidth, bottomBedH), { openConcept: true }),
        placeRoom(r.bedroomB, rect(leftWidth + centerWidth, topBedH + midH, rightWidth, bottomBedH)),
      ].filter((room) => room !== null),
    }],
  };
}

// variant_f: central hub — symmetric wings, centered kitchen/dining core
function buildSplitCentralHub(width, height, r) {
  const wingWidth = Math.floor(width * 0.3);
  const coreWidth = width - wingWidth * 2;

  const topH = Math.floor(height * 0.55);
  const bottomH = height - topH;
  const bathH = Math.min(8, Math.floor(topH * 0.4));

  return {
    levels: [{
      level: 1, width, height,
      rooms: [
        placeRoom(r.primaryBedroom, rect(0, 0, wingWidth, topH - bathH)),
        placeRoom(r.primaryBath, rect(0, topH - bathH, wingWidth, bathH)),
        placeRoom(r.kitchen, rect(wingWidth, 0, coreWidth, Math.floor(topH * 0.55)), { openConcept: true }),
        placeRoom(r.dining, rect(wingWidth, Math.floor(topH * 0.55), coreWidth, topH - Math.floor(topH * 0.55)), { openConcept: true }),
        placeRoom(r.bedroomA, rect(wingWidth + coreWidth, 0, wingWidth, topH - bathH)),
        placeRoom(r.sharedBath, rect(wingWidth + coreWidth, topH - bathH, wingWidth, bathH)),
        placeRoom(r.living, rect(0, topH, Math.floor(width * 0.5), bottomH), { openConcept: true }),
        placeRoom(r.bedroomB, rect(Math.floor(width * 0.5), topH, Math.floor(width * 0.25), bottomH)),
        placeRoom(r.entry, rect(Math.floor(width * 0.75), topH, Math.ceil(width * 0.15), bottomH)),
        placeRoom(r.laundry, rect(Math.floor(width * 0.9), topH, width - Math.floor(width * 0.9), bottomH)),
      ],
    }],
  };
}

module.exports = {
  oneStorySplitBedroomCompact,
};
