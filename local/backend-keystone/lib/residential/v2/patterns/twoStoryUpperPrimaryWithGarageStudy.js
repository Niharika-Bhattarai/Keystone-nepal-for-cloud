'use strict';

const {
  rect,
  splitColumns,
  splitRows,
  placeRoom,
} = require('../fitRoomsToRealms');
const { bottomAlignedStairRect, landingAboveStairRect } = require('../stairStandards');

function pullFirst(rooms, type) {
  const index = rooms.findIndex((room) => String(room?.type) === type);
  if (index === -1) return null;
  return rooms.splice(index, 1)[0];
}

function makeSynthetic(id, type, level, label, zone) {
  return { id, type, level, label, zone };
}

function twoStoryUpperPrimaryWithGarageStudy({ footprint, program }) {
  const width = Number(footprint?.widthFt || 40);
  const height = Number(footprint?.heightFt || 32);
  if (width < 40) {
    throw new Error('twoStoryUpperPrimaryWithGarageStudy requires at least a 40 ft width');
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
  const study = pullFirst(level1Specs, 'study');
  const stairs1 = pullFirst(level1Specs, 'stairs');

  const serviceHeight = 12;
  const publicHeight = height - serviceHeight;
  const garageWidth = 14;
  const stairWidth = 6;
  const rightWingWidth = width - garageWidth - stairWidth;
  if (publicHeight < 18 || rightWingWidth < 18) {
    throw new Error('twoStoryUpperPrimaryWithGarageStudy requires a wider front/study wing');
  }

  const [publicBand, serviceBand] = splitRows(rect(0, 0, width, height), [publicHeight, serviceHeight]);
  const kitchenWidth = 10;
  const diningWidth = 10;
  const livingWidth = 10;
  const studyWidth = width - kitchenWidth - diningWidth - livingWidth;
  const [kitchenRect, diningRect, studyRect, livingRect] = splitColumns(publicBand, [kitchenWidth, diningWidth, studyWidth, livingWidth]);

  const [garageRect, centerServiceRect, rightServiceRect] = splitColumns(serviceBand, [garageWidth, stairWidth, rightWingWidth]);
  const stairsRect = bottomAlignedStairRect(centerServiceRect, { widthFt: stairWidth, runFt: 12 });
  const entryWidth = Math.max(10, rightWingWidth - 8);
  const serviceColumnWidth = rightWingWidth - entryWidth;
  if (serviceColumnWidth < 6) {
    throw new Error('twoStoryUpperPrimaryWithGarageStudy requires at least a 6 ft service column');
  }
  const [entryRect, serviceColumnRect] = splitColumns(rightServiceRect, [entryWidth, serviceColumnWidth]);
  const [laundryRect, mudroomRect] = splitRows(serviceColumnRect, [Math.floor(serviceColumnRect.h / 2), serviceColumnRect.h - Math.floor(serviceColumnRect.h / 2)]);

  const level1Rooms = [
    placeRoom(kitchen, kitchenRect, { openConcept: true }),
    placeRoom(dining, diningRect, { openConcept: true }),
    placeRoom(living, livingRect, { openConcept: true }),
    placeRoom(study, studyRect),
    placeRoom(garage, garageRect),
    placeRoom(stairs1, stairsRect),
    placeRoom(laundry, laundryRect),
    placeRoom(mudroom, mudroomRect),
    placeRoom(entry, entryRect),
  ];

  const stairs2 = pullFirst(level2Specs, 'stairs');
  pullFirst(level2Specs, 'hallway');
  const primaryBedroom = pullFirst(level2Specs, 'primary_bedroom');
  const primaryBath = pullFirst(level2Specs, 'primary_bathroom');
  const secondaryBedroom = pullFirst(level2Specs, 'bedroom');
  const sharedBath = pullFirst(level2Specs, 'bathroom');

  const [leftWing, centerWing, rightWing] = splitColumns(rect(0, 0, width, height), [garageWidth, stairWidth, width - garageWidth - stairWidth]);
  const stairs2Rect = bottomAlignedStairRect(centerWing, { widthFt: stairWidth, runFt: 12 });
  const centerLandingRect = landingAboveStairRect(stairs2Rect, { depthFt: 6 });
  if (centerLandingRect.y < 8) {
    throw new Error('twoStoryUpperPrimaryWithGarageStudy requires at least 8 ft above the upper landing');
  }
  const centerTopRect = rect(centerWing.x, 0, centerWing.w, centerLandingRect.y);

  const leftLowerStart = centerLandingRect.y + centerLandingRect.h;
  const leftLowerHeight = height - leftLowerStart;
  const sharedBathWidth = 8;
  const sharedBathHeight = 10;
  const bathTopY = centerLandingRect.y + centerLandingRect.h - sharedBathHeight;
  const leftTopStorageRect = rect(leftWing.x, 0, sharedBathWidth, bathTopY);
  const sharedBathRect = rect(leftWing.x, bathTopY, sharedBathWidth, sharedBathHeight);
  const leftTopSupportRect = rect(leftWing.x + sharedBathWidth, 0, leftWing.w - sharedBathWidth, centerLandingRect.y);
  const upperConnectorRect = rect(leftWing.x + sharedBathWidth, centerLandingRect.y, leftWing.w - sharedBathWidth, centerLandingRect.h);
  const secondaryBedroomRect = rect(leftWing.x, leftLowerStart, leftWing.w, leftLowerHeight);
  const primaryBathHeight = 10;
  const [primaryBedroomRect, primaryBathRect] = splitRows(rightWing, [height - primaryBathHeight, primaryBathHeight]);

  const upperLanding = makeSynthetic('architect_v2_hall_upper_study', 'hallway', 2, 'Landing Hall', 'circulation');
  const upperConnector = makeSynthetic('architect_v2_hall_upper_study_connector', 'hallway', 2, 'Bedroom Hall', 'circulation');

  const level2Rooms = [
    placeRoom(sharedBath, sharedBathRect),
    placeRoom(upperConnector, upperConnectorRect),
    placeRoom(secondaryBedroom, secondaryBedroomRect),
    placeRoom(upperLanding, centerLandingRect),
    placeRoom(stairs2, stairs2Rect),
    placeRoom(primaryBedroom, primaryBedroomRect),
    placeRoom(primaryBath, primaryBathRect),
  ];
  if (centerTopRect.h >= 4) {
    level2Rooms.push(placeRoom(makeSynthetic('architect_v2_study_upper_stair_buffer', 'storage', 2, 'Storage', 'service'), centerTopRect));
  }
  if (leftTopStorageRect.h >= 4) {
    level2Rooms.push(placeRoom(makeSynthetic('architect_v2_study_upper_bath_buffer', 'storage', 2, 'Storage', 'service'), leftTopStorageRect));
  }
  if (leftTopSupportRect.w >= 4) {
    level2Rooms.push(placeRoom(makeSynthetic('architect_v2_study_upper_linen', 'storage', 2, 'Linen', 'service'), leftTopSupportRect));
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
  twoStoryUpperPrimaryWithGarageStudy,
};
