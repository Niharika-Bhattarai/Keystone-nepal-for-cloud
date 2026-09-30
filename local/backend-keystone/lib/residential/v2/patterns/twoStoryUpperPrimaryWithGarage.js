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

function twoStoryUpperPrimaryWithGarage({ footprint, program }) {
  const width = Number(footprint?.widthFt || 40);
  const height = Number(footprint?.heightFt || 30);
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
  const garageWidth = Math.max(12, Math.min(14, width - 24));
  const stairWidth = 6;
  const serviceRightWidth = width - garageWidth - stairWidth;
  if (serviceRightWidth < 16) {
    throw new Error('twoStoryUpperPrimaryWithGarage requires at least a 16 ft right arrival wing');
  }

  const publicHeight = height - serviceHeight;
  if (publicHeight < 16) {
    throw new Error('twoStoryUpperPrimaryWithGarage requires at least a 16 ft public depth');
  }

  const [publicBand, serviceBand] = splitRows(rect(0, 0, width, height), [publicHeight, serviceHeight]);
  const livingWidth = Math.max(12, width - garageWidth - 12);
  const diningWidth = 12;
  const kitchenWidth = width - diningWidth - livingWidth;
  if (kitchenWidth < 10) {
    throw new Error('twoStoryUpperPrimaryWithGarage requires at least a 10 ft kitchen span');
  }

  const [kitchenRect, diningRect, livingRect] = splitColumns(publicBand, [kitchenWidth, diningWidth, livingWidth]);
  const [garageRect, centerServiceRect, rightServiceRect] = splitColumns(serviceBand, [garageWidth, stairWidth, serviceRightWidth]);
  const stairsRect = bottomAlignedStairRect(centerServiceRect, { widthFt: stairWidth, runFt: 12 });
  const entryWidth = Math.max(10, serviceRightWidth - 8);
  const serviceColumnWidth = serviceRightWidth - entryWidth;
  if (serviceColumnWidth < 6) {
    throw new Error('twoStoryUpperPrimaryWithGarage requires at least a 6 ft service column');
  }
  const [entryRect, serviceColumnRect] = splitColumns(rightServiceRect, [entryWidth, serviceColumnWidth]);
  let laundryRect = null;
  let mudroomRect = null;
  let level1BathRect = null;
  if (level1Bath) {
    const serviceBathHeight = 4;
    const serviceRemainingHeight = serviceColumnRect.h - serviceBathHeight;
    if (serviceRemainingHeight < 8) {
      throw new Error('twoStoryUpperPrimaryWithGarage requires at least 8 ft for laundry and mudroom below the bath');
    }
    const [bathSlice, serviceBelowBath] = splitRows(serviceColumnRect, [serviceBathHeight, serviceRemainingHeight]);
    [laundryRect, mudroomRect] = splitRows(serviceBelowBath, [Math.floor(serviceBelowBath.h / 2), serviceBelowBath.h - Math.floor(serviceBelowBath.h / 2)]);
    level1BathRect = bathSlice;
  } else {
    [laundryRect, mudroomRect] = splitRows(serviceColumnRect, [Math.floor(serviceColumnRect.h / 2), serviceColumnRect.h - Math.floor(serviceColumnRect.h / 2)]);
  }

  const level1Rooms = [
    placeRoom(kitchen, kitchenRect, { openConcept: true }),
    placeRoom(dining, diningRect, { openConcept: true }),
    placeRoom(living, livingRect, { openConcept: true }),
    placeRoom(garage, garageRect),
    placeRoom(stairs1, stairsRect),
    placeRoom(entry, entryRect),
  ];
  if (level1BathRect) level1Rooms.push(placeRoom(level1Bath, level1BathRect));
  level1Rooms.push(placeRoom(laundry, laundryRect));
  level1Rooms.push(placeRoom(mudroom, mudroomRect));

  const level1LandingRoomId = entry.id;

  const stairs2 = pullFirst(level2Specs, 'stairs');
  pullFirst(level2Specs, 'hallway');
  const primaryBedroom = pullFirst(level2Specs, 'primary_bedroom');
  const primaryBath = pullFirst(level2Specs, 'primary_bathroom');
  const secondaryBedroom = pullFirst(level2Specs, 'bedroom');
  const sharedBath = pullFirst(level2Specs, 'bathroom');

  const [leftWing, centerWing, rightWing] = splitColumns(rect(0, 0, width, height), [garageWidth, stairWidth, width - garageWidth - stairWidth]);
  const stairs2Rect = bottomAlignedStairRect(centerWing, { widthFt: stairWidth, runFt: 12 });
  const centerLandingRect = landingAboveStairRect(stairs2Rect, { depthFt: Math.min(8, Math.max(6, stairs2Rect.y)) });
  if (centerLandingRect.y < 6) {
    throw new Error('twoStoryUpperPrimaryWithGarage requires at least 6 ft above the upper landing');
  }
  const centerTopRect = rect(centerWing.x, 0, centerWing.w, centerLandingRect.y);

  const upperTopHeight = centerLandingRect.y + 4;
  const leftTopRect = rect(leftWing.x, 0, leftWing.w, upperTopHeight);
  const leftBottomRect = rect(leftWing.x, upperTopHeight, leftWing.w, height - upperTopHeight);
  if (leftBottomRect.h < 12) {
    throw new Error('twoStoryUpperPrimaryWithGarage requires at least a 12 ft secondary bedroom depth');
  }

  const sharedBathWidth = Math.min(8, leftWing.w);
  const [leftTopStorageRect, leftBathRect] = splitColumns(leftTopRect, [Math.max(0, leftTopRect.w - sharedBathWidth), sharedBathWidth]);
  const secondaryBedroomRect = leftBottomRect;
  const primaryBathHeight = 10;
  const [primaryBedroomRect, primaryBathRect] = splitRows(rightWing, [height - primaryBathHeight, primaryBathHeight]);

  const upperLanding = classifyUpperCirculationRoom(centerLandingRect, {
    id: 'architect_v2_hall_upper',
    level: 2,
    label: 'Landing Hall',
  });

  const level2Rooms = [
    placeRoom(sharedBath, leftBathRect),
    placeRoom(secondaryBedroom, secondaryBedroomRect),
    placeRoom(upperLanding, centerLandingRect),
    placeRoom(stairs2, stairs2Rect),
    placeRoom(primaryBedroom, primaryBedroomRect),
    placeRoom(primaryBath, primaryBathRect),
  ];
  if (centerTopRect.h >= 4) {
    level2Rooms.push(placeRoom(classifyUpperSupportRoom(centerTopRect, {
      id: 'architect_v2_upper_stair_buffer',
      level: 2,
      fallbackType: 'storage',
      fallbackLabel: 'Storage',
    }), centerTopRect));
  }
  if (leftTopStorageRect.w >= 4 && leftTopStorageRect.h >= 4) {
    level2Rooms.push(placeRoom(classifyUpperSupportRoom(leftTopStorageRect, {
      id: 'architect_v2_upper_linen',
      level: 2,
      fallbackType: 'storage',
      fallbackLabel: 'Linen',
    }), leftTopStorageRect));
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
          hallRoomId: level1LandingRoomId,
          landingRoomId: level1LandingRoomId,
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
  twoStoryUpperPrimaryWithGarage,
};
