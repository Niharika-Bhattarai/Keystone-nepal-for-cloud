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

function oneStoryCentralCoreCompact({ footprint, program }) {
  const width = Number(footprint?.widthFt || 36);
  const height = Number(footprint?.heightFt || 32);
  const variationId = String(footprint?.variationId || 'variant_d_wide_front_living');
  const specs = [...(program?.levels?.find((level) => level.level === 1)?.rooms || [])];

  const primaryBedroom = pullFirst(specs, 'primary_bedroom');
  const primaryBath = pullFirst(specs, 'primary_bathroom');
  const secondaryBedroom = pullFirst(specs, 'bedroom');
  const sharedBath = pullFirst(specs, 'bathroom');
  const kitchen = pullFirst(specs, 'kitchen');
  const dining = pullFirst(specs, 'dining_room');
  const living = pullFirst(specs, 'living_room');
  const entry = pullFirst(specs, 'entry');
  const laundry = pullFirst(specs, 'laundry');

  if (variationId === 'variant_e_deep_garden_spine') {
    return buildDeepGardenSpine(width, height, {
      primaryBedroom, primaryBath, secondaryBedroom, sharedBath,
      kitchen, dining, living, entry, laundry,
    });
  }
  if (variationId === 'variant_f_central_hub') {
    return buildCentralHub(width, height, {
      primaryBedroom, primaryBath, secondaryBedroom, sharedBath,
      kitchen, dining, living, entry, laundry,
    });
  }
  return buildWideFrontLiving(width, height, {
    primaryBedroom, primaryBath, secondaryBedroom, sharedBath,
    kitchen, dining, living, entry, laundry,
  });
}

// variant_d: wide front living — bedrooms on sides, wide public center, living spans bottom
function buildWideFrontLiving(width, height, rooms) {
  const sideWidth = Math.floor((width - 14) / 2);
  const centerWidth = width - sideWidth * 2;
  const [leftCol, , rightCol] = splitColumns(rect(0, 0, width, height), [sideWidth, centerWidth, sideWidth]);

  const topBandH = 12;
  const midBandH = 10;
  const bottomH = height - topBandH - midBandH;

  return {
    levels: [{
      level: 1, width, height,
      rooms: [
        placeRoom(rooms.primaryBedroom, rect(leftCol.x, 0, leftCol.w, topBandH)),
        placeRoom(rooms.kitchen, rect(sideWidth, 0, centerWidth, topBandH), { openConcept: true }),
        placeRoom(rooms.secondaryBedroom, rect(rightCol.x, 0, rightCol.w, topBandH)),
        placeRoom(rooms.primaryBath, rect(leftCol.x, topBandH, leftCol.w, midBandH)),
        placeRoom(rooms.dining, rect(sideWidth, topBandH, centerWidth, midBandH), { openConcept: true }),
        placeRoom(rooms.sharedBath, rect(rightCol.x, topBandH, rightCol.w, midBandH)),
        placeRoom(rooms.living, rect(0, topBandH + midBandH, sideWidth + centerWidth, bottomH), { openConcept: true }),
        placeRoom(rooms.entry, rect(sideWidth + centerWidth, topBandH + midBandH, sideWidth, Math.max(5, Math.floor(bottomH / 2)))),
        placeRoom(rooms.laundry, rect(sideWidth + centerWidth, topBandH + midBandH + Math.max(5, Math.floor(bottomH / 2)), sideWidth, bottomH - Math.max(5, Math.floor(bottomH / 2)))),
      ],
    }],
  };
}

// variant_e: deep garden spine — public zone at rear (garden-facing), bedrooms at front
function buildDeepGardenSpine(width, height, rooms) {
  const sideWidth = Math.floor((width - 12) / 2);
  const centerWidth = width - sideWidth * 2;

  const bedroomBandH = 12;
  const bathBandH = 8;
  const publicH = height - bedroomBandH - bathBandH;
  const kitchenWidth = Math.floor(width * 0.35);
  const diningWidth = Math.max(10, Math.floor(width * 0.25));

  return {
    levels: [{
      level: 1, width, height,
      rooms: [
        placeRoom(rooms.primaryBedroom, rect(0, 0, sideWidth, bedroomBandH)),
        placeRoom(rooms.entry, rect(sideWidth, 0, centerWidth, bedroomBandH + bathBandH), {
          parts: [rect(sideWidth, 0, centerWidth, bedroomBandH), rect(sideWidth, bedroomBandH, 4, bathBandH)],
        }),
        placeRoom(rooms.secondaryBedroom, rect(sideWidth + centerWidth, 0, sideWidth, bedroomBandH)),
        placeRoom(rooms.primaryBath, rect(0, bedroomBandH, sideWidth, bathBandH)),
        placeRoom(rooms.laundry, rect(sideWidth + 4, bedroomBandH, centerWidth - 4, bathBandH)),
        placeRoom(rooms.sharedBath, rect(sideWidth + centerWidth, bedroomBandH, sideWidth, bathBandH)),
        placeRoom(rooms.kitchen, rect(0, bedroomBandH + bathBandH, kitchenWidth, publicH), { openConcept: true }),
        placeRoom(rooms.dining, rect(kitchenWidth, bedroomBandH + bathBandH, diningWidth, publicH), { openConcept: true }),
        placeRoom(rooms.living, rect(kitchenWidth + diningWidth, bedroomBandH + bathBandH, width - kitchenWidth - diningWidth, publicH), { openConcept: true }),
      ],
    }],
  };
}

// variant_f: central hub — centered public core with symmetric bedroom wings
function buildCentralHub(width, height, rooms) {
  const wingWidth = Math.floor(width * 0.3);
  const coreWidth = width - wingWidth * 2;

  // The public core contains a kitchen and a furnished dining room in series.
  // Percentage-only sizing left both at 7–8 ft deep in compact envelopes.
  const topH = Math.max(20, Math.floor(height * 0.55));
  const bottomH = height - topH;

  const leftBathH = Math.min(8, Math.floor(topH * 0.4));
  const rightBathH = Math.min(8, Math.floor(topH * 0.4));

  return {
    levels: [{
      level: 1, width, height,
      rooms: [
        placeRoom(rooms.primaryBedroom, rect(0, 0, wingWidth, topH - leftBathH)),
        placeRoom(rooms.primaryBath, rect(0, topH - leftBathH, wingWidth, leftBathH)),
        placeRoom(rooms.kitchen, rect(wingWidth, 0, coreWidth, Math.floor(topH * 0.5)), { openConcept: true }),
        placeRoom(rooms.dining, rect(wingWidth, Math.floor(topH * 0.5), coreWidth, topH - Math.floor(topH * 0.5)), { openConcept: true }),
        placeRoom(rooms.secondaryBedroom, rect(wingWidth + coreWidth, 0, wingWidth, topH - rightBathH)),
        placeRoom(rooms.sharedBath, rect(wingWidth + coreWidth, topH - rightBathH, wingWidth, rightBathH)),
        placeRoom(rooms.living, rect(0, topH, Math.floor(width * 0.6), bottomH), { openConcept: true }),
        placeRoom(rooms.entry, rect(Math.floor(width * 0.6), topH, Math.floor(width * 0.2), bottomH)),
        placeRoom(rooms.laundry, rect(Math.floor(width * 0.8), topH, width - Math.floor(width * 0.8), bottomH)),
      ],
    }],
  };
}

module.exports = {
  oneStoryCentralCoreCompact,
};
