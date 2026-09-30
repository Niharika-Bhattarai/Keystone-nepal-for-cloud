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

function makeSynthetic(id, type, level, label, zone) {
  return { id, type, level, label, zone };
}

function twoStoryUpperPrimaryCompact({ footprint, program }) {
  const width = Number(footprint?.widthFt || 34);
  const height = Number(footprint?.heightFt || 26);
  const level1Specs = [...(program?.levels?.find((level) => level.level === 1)?.rooms || [])];
  const level2Specs = [...(program?.levels?.find((level) => level.level === 2)?.rooms || [])];

  const kitchen = pullFirst(level1Specs, 'kitchen');
  const dining = pullFirst(level1Specs, 'dining_room');
  const living = pullFirst(level1Specs, 'living_room');
  const entry = pullFirst(level1Specs, 'entry');
  const laundry = pullFirst(level1Specs, 'laundry');
  const level1Bath = pullFirst(level1Specs, 'bathroom');
  const stairs1 = pullFirst(level1Specs, 'stairs');

  const leftWidth = 12;
  const centerWidth = 10;
  const rightWidth = width - leftWidth - centerWidth;
  if (rightWidth < 10) {
    throw new Error('twoStoryUpperPrimaryCompact requires at least a 10 ft living wing');
  }

  const [leftCol, centerCol, rightCol] = splitColumns(rect(0, 0, width, height), [leftWidth, centerWidth, rightWidth]);
  const [kitchenRect, leftBottom] = splitRows(leftCol, [12, height - 12]);
  const lowerBathHeight = level1Bath ? 8 : 0;
  const [laundryRect, leftBottomRemainder] = splitRows(leftBottom, [Math.max(6, leftBottom.h - 8), 8]);
  const [diningRect, centerBottom] = splitRows(centerCol, [10, height - 10]);
  const [hallRect, stairsRect] = splitRows(centerBottom, [Math.max(4, centerBottom.h - 12), 12]);

  const [livingRect, rightBottom] = splitRows(rightCol, [height - 8, 8]);
  const level1Rooms = [
    placeRoom(kitchen, kitchenRect, { openConcept: true }),
    placeRoom(laundry, laundryRect),
    placeRoom(dining, diningRect, { openConcept: true }),
    placeRoom(stairs1, stairsRect),
    placeRoom(living, livingRect, { openConcept: true }),
  ];
  const hall = makeSynthetic('architect_v2_hall_lower', 'hallway', 1, 'Hallway', 'circulation');
  level1Rooms.push(placeRoom(hall, hallRect));

  let level1LandingRoomId = hall.id;
  if (level1Bath) {
    const [bathRect, entryRect] = splitColumns(rightBottom, [Math.min(6, rightBottom.w - 4), rightBottom.w - Math.min(6, rightBottom.w - 4)]);
    level1Rooms.push(placeRoom(level1Bath, bathRect));
    level1Rooms.push(placeRoom(entry, entryRect));
  } else {
    level1Rooms.push(placeRoom(entry, rightBottom));
  }

  const stairs2 = pullFirst(level2Specs, 'stairs');
  pullFirst(level2Specs, 'hallway');
  const primaryBedroom = pullFirst(level2Specs, 'primary_bedroom');
  const primaryBath = pullFirst(level2Specs, 'primary_bathroom');
  const secondaryBedroom = pullFirst(level2Specs, 'bedroom');
  const sharedBath = pullFirst(level2Specs, 'bathroom');

  const centerUpperWidth = 8;
  const sideWidth = Math.floor((width - centerUpperWidth) / 2);
  const [leftWing, centerWing, rightWing] = splitColumns(rect(0, 0, width, height), [sideWidth, centerUpperWidth, width - sideWidth - centerUpperWidth]);
  const [leftTopRect, leftBottomRect] = splitRows(leftWing, [8, height - 8]);
  const [centerHallRect, centerStairsRect] = splitRows(centerWing, [6, height - 6]);
  const [primaryBedroomRect, primaryBathRect] = splitRows(rightWing, [height - 10, 10]);
  const [sharedBathRect, secondaryBedroomRect] = splitRows(leftBottomRect, [8, leftBottomRect.h - 8]);

  const upperLanding = makeSynthetic('architect_v2_upper_landing', 'hallway', 2, 'Landing Hall', 'circulation');
  const level2Rooms = [
    placeRoom(sharedBath, sharedBathRect),
    placeRoom(secondaryBedroom, secondaryBedroomRect),
    placeRoom(upperLanding, centerHallRect),
    placeRoom(stairs2, centerStairsRect),
    placeRoom(primaryBedroom, primaryBedroomRect),
    placeRoom(primaryBath, primaryBathRect),
  ];
  if (leftTopRect.h > 0) {
    const linen = makeSynthetic('architect_v2_upper_storage', 'storage', 2, 'Storage', 'service');
    level2Rooms.push(placeRoom(linen, leftTopRect));
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
          x: centerStairsRect.x,
          y: centerStairsRect.y,
          w: centerStairsRect.w,
          h: centerStairsRect.h,
          hallRoomId: upperLanding.id,
          landingRoomId: upperLanding.id,
          landingOpen: true,
        },
      },
    ],
  };
}

module.exports = {
  twoStoryUpperPrimaryCompact,
};
