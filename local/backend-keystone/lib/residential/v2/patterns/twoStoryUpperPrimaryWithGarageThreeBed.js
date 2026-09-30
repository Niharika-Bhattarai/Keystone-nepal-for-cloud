'use strict';

const {
  rect,
  splitColumns,
  splitRows,
  placeRoom,
} = require('../fitRoomsToRealms');
const { bottomAlignedStairRect, landingAboveStairRect } = require('../stairStandards');
const { classifyUpperCirculationRoom, classifyUpperSupportRoom } = require('./upperLandingRooms');

function pullFirst(rooms, type) {
  const index = rooms.findIndex((room) => String(room?.type) === type);
  if (index === -1) return null;
  return rooms.splice(index, 1)[0];
}

function makeSynthetic(id, type, level, label, zone) {
  return { id, type, level, label, zone };
}

function twoStoryUpperPrimaryWithGarageThreeBed({ footprint, program }) {
  const width = Number(footprint?.widthFt || 40);
  const height = Number(footprint?.heightFt || 26);
  if (width < 40 || height < 26) {
    throw new Error('twoStoryUpperPrimaryWithGarageThreeBed requires at least a 40x26 ft envelope');
  }

  const level1Specs = [...(program?.levels?.find((level) => level.level === 1)?.rooms || [])];
  const level2Specs = [...(program?.levels?.find((level) => level.level === 2)?.rooms || [])];

  const garage = pullFirst(level1Specs, 'garage');
  const kitchen = pullFirst(level1Specs, 'kitchen');
  const dining = pullFirst(level1Specs, 'dining_room');
  const living = pullFirst(level1Specs, 'living_room');
  const entry = pullFirst(level1Specs, 'entry');
  const laundry = pullFirst(level1Specs, 'laundry');
  const mudroom = pullFirst(level1Specs, 'mudroom');
  const level1Bath = pullFirst(level1Specs, 'bathroom');
  const stairs1 = pullFirst(level1Specs, 'stairs');

  const serviceHeight = 12;
  const publicHeight = height - serviceHeight;
  const garageWidth = 12;
  const stairWidth = 6;
  const rightServiceWidth = width - garageWidth - stairWidth;
  if (publicHeight < 14 || rightServiceWidth < 20) {
    throw new Error('twoStoryUpperPrimaryWithGarageThreeBed requires a deeper right service wing');
  }

  const [publicBand, serviceBand] = splitRows(rect(0, 0, width, height), [publicHeight, serviceHeight]);
  const kitchenWidth = 12;
  const diningWidth = 10;
  const livingWidth = width - kitchenWidth - diningWidth;
  const [kitchenRect, diningRect, livingRect] = splitColumns(publicBand, [kitchenWidth, diningWidth, livingWidth]);

  const [garageRect, centerServiceRect, rightServiceRect] = splitColumns(serviceBand, [garageWidth, stairWidth, rightServiceWidth]);
  const stairsRect = bottomAlignedStairRect(centerServiceRect, { widthFt: stairWidth, runFt: 12 });
  const entryWidth = 14;
  const serviceColumnWidth = rightServiceRect.w - entryWidth;
  if (serviceColumnWidth < 8) {
    throw new Error('twoStoryUpperPrimaryWithGarageThreeBed requires at least an 8 ft service column');
  }
  const [entryRect, serviceColumnRect] = splitColumns(rightServiceRect, [entryWidth, serviceColumnWidth]);
  const [lowerBathRect, serviceBelowBath] = splitRows(serviceColumnRect, [6, serviceColumnRect.h - 6]);
  const [laundryRect, mudroomRect] = splitColumns(serviceBelowBath, [Math.floor(serviceBelowBath.w / 2), serviceBelowBath.w - Math.floor(serviceBelowBath.w / 2)]);

  const level1Rooms = [
    placeRoom(kitchen, kitchenRect, { openConcept: true }),
    placeRoom(dining, diningRect, { openConcept: true }),
    placeRoom(living, livingRect, { openConcept: true }),
    placeRoom(garage, garageRect),
    placeRoom(stairs1, stairsRect),
    placeRoom(level1Bath, lowerBathRect),
    placeRoom(laundry, laundryRect),
    placeRoom(mudroom, mudroomRect),
    placeRoom(entry, entryRect),
  ];

  const stairs2 = pullFirst(level2Specs, 'stairs');
  pullFirst(level2Specs, 'hallway');
  const primaryBedroom = pullFirst(level2Specs, 'primary_bedroom');
  const primaryBath = pullFirst(level2Specs, 'primary_bathroom');
  const secondaryBedroomA = pullFirst(level2Specs, 'bedroom');
  const secondaryBedroomB = pullFirst(level2Specs, 'bedroom');
  const sharedBath = pullFirst(level2Specs, 'bathroom');

  const upperLeftWidth = garageWidth;
  const upperCenterWidth = stairWidth;
  const upperRightWidth = width - upperLeftWidth - upperCenterWidth;
  if (upperRightWidth < 22) {
    throw new Error('twoStoryUpperPrimaryWithGarageThreeBed requires a 22 ft right bedroom wing');
  }

  const [leftWing, centerWing, rightWing] = splitColumns(rect(0, 0, width, height), [upperLeftWidth, upperCenterWidth, upperRightWidth]);
  const stairs2Rect = bottomAlignedStairRect(centerWing, { widthFt: upperCenterWidth, runFt: 12 });
  const landingDepth = Math.min(8, Math.max(6, stairs2Rect.y));
  const landingRect = landingAboveStairRect(stairs2Rect, { depthFt: landingDepth });
  if (landingRect.y < 6) {
    throw new Error('twoStoryUpperPrimaryWithGarageThreeBed requires at least 6 ft above the upper landing');
  }
  const centerTopRect = rect(centerWing.x, 0, centerWing.w, landingRect.y);

  const upperTopHeight = landingRect.y + 4;
  if (height - upperTopHeight < 14) {
    throw new Error('twoStoryUpperPrimaryWithGarageThreeBed requires at least 14 ft below the upper bedroom band');
  }

  const leftTopRect = rect(leftWing.x, 0, leftWing.w, upperTopHeight);
  const leftBottomRect = rect(leftWing.x, upperTopHeight, leftWing.w, height - upperTopHeight);
  const rightTopRect = rect(rightWing.x, 0, rightWing.w, upperTopHeight);
  const rightBottomRect = rect(rightWing.x, upperTopHeight, rightWing.w, height - upperTopHeight);

  const [leftSupportRect, sharedBathRect] = splitColumns(leftTopRect, [Math.max(0, leftTopRect.w - 6), 6]);
  const bedroomARect = leftBottomRect;
  const bedroomBRect = rightTopRect;
  const primaryBathWidth = 10;
  if (rightBottomRect.w - primaryBathWidth < 12) {
    throw new Error('twoStoryUpperPrimaryWithGarageThreeBed requires at least a 12 ft primary bedroom width');
  }
  const [primaryBedroomRect, primaryBathRect] = splitColumns(rightBottomRect, [rightBottomRect.w - primaryBathWidth, primaryBathWidth]);

  const upperLanding = classifyUpperCirculationRoom(landingRect, {
    id: 'architect_v2_hall_upper_three_bed',
    level: 2,
    label: 'Landing Hall',
  });

  const level2Rooms = [
    placeRoom(sharedBath, sharedBathRect),
    placeRoom(secondaryBedroomA, bedroomARect),
    placeRoom(upperLanding, landingRect),
    placeRoom(stairs2, stairs2Rect),
    placeRoom(secondaryBedroomB, bedroomBRect),
    placeRoom(primaryBedroom, primaryBedroomRect),
    placeRoom(primaryBath, primaryBathRect),
  ];
  if (leftSupportRect.w >= 4 && leftSupportRect.h >= 4) {
    level2Rooms.push(placeRoom(classifyUpperSupportRoom(leftSupportRect, {
      id: 'architect_v2_upper_three_bed_left_support',
      level: 2,
      fallbackType: 'storage',
      fallbackLabel: 'Linen',
    }), leftSupportRect));
  }
  if (centerTopRect.w >= 4 && centerTopRect.h >= 4) {
    level2Rooms.push(placeRoom(classifyUpperSupportRoom(centerTopRect, {
      id: 'architect_v2_upper_three_bed_center_support',
      level: 2,
      fallbackType: 'storage',
      fallbackLabel: 'Storage',
    }), centerTopRect));
  }

  return {
    levels: [
      {
        level: 1,
        width,
        height,
        rooms: level1Rooms,
        stairCore: {
          x: stairsRect.x,
          y: stairsRect.y,
          w: stairsRect.w,
          h: stairsRect.h,
          roomId: stairs1.id,
          hallRoomId: entry.id,
          landingRoomId: entry.id,
          landingOpen: true,
        },
      },
      {
        level: 2,
        width,
        height,
        rooms: level2Rooms,
        stairCore: {
          x: stairs2Rect.x,
          y: stairs2Rect.y,
          w: stairs2Rect.w,
          h: stairs2Rect.h,
          roomId: stairs2.id,
          hallRoomId: upperLanding.id,
          landingRoomId: upperLanding.id,
          landingOpen: true,
        },
      },
    ],
  };
}

module.exports = {
  twoStoryUpperPrimaryWithGarageThreeBed,
};
