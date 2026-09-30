'use strict';

const { placeRoom } = require('./fitRoomsToRealms');
const { isSocialFeaturePair } = require('./featurePairPolicy');
const { partListOf, boundingRectOf, shareWall } = require('../../planGeometry');

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function resolveGarageSlotWidth(rooms) {
  const targetArea = num(rooms?.garage?.targetAreaSqFt, 0);
  return targetArea >= 400 ? 20 : 14;
}

function placeVerticalStack(items, x, y, width, totalHeight) {
  const placed = [];
  let cursorY = y;
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (!item?.room) continue;
    const remainingHeight = Math.max(0, totalHeight - (cursorY - y));
    const fixedHeight = index === items.length - 1
      ? remainingHeight
      : Math.min(remainingHeight, Math.max(0, num(item.height)));
    if (fixedHeight <= 0) continue;
    placed.push(placeRoom(item.room, { x, y: cursorY, w: width, h: fixedHeight }));
    cursorY += fixedHeight;
  }
  return placed;
}

function resolveLowerFeatureRoom(rooms) {
  const candidates = [rooms.special_room, rooms.special_room_secondary]
    .filter((room) => room && Number(room?.level || 1) === 1);
  if (!candidates.length) return null;
  const rank = {
    gym: 0,
    movie_room: 1,
    gaming_room: 2,
    study: 3,
    library: 4,
    music_room: 5,
    guest_bedroom: 6,
    wine_cellar: 7,
  };
  return candidates.sort((a, b) => {
    const aType = String(a?.requestedFeatureKind || a?.type || '').trim().toLowerCase();
    const bType = String(b?.requestedFeatureKind || b?.type || '').trim().toLowerCase();
    return (rank[aType] ?? 9) - (rank[bType] ?? 9);
  })[0];
}

function carveFeatureFromCommonBand(commonRect, featureRoom) {
  if (!featureRoom) return { commonRect, featureRect: null };
  const featureKind = String(featureRoom?.requestedFeatureKind || featureRoom?.type || '').trim().toLowerCase();
  const minFeatureWidth = (
    featureKind === 'gym' ? 12 :
    featureKind === 'movie_room' ? 12 :
    featureKind === 'gaming_room' ? 12 :
    featureKind === 'music_room' ? 10 :
    featureKind === 'guest_bedroom' ? 12 :
    featureKind === 'wine_cellar' ? 8 :
    10
  );
  const quietRoom = ['study', 'home_office', 'library'].includes(featureKind);
  const minCommonWidth = quietRoom ? 10 : 6;
  if (commonRect.w < (minFeatureWidth + minCommonWidth)) {
    return { commonRect, featureRect: null };
  }
  const featureWidth = Math.max(minFeatureWidth, Math.min(14, commonRect.w - minCommonWidth));
  const commonWidth = commonRect.w - featureWidth;
  // The service stack starts immediately below this band. Give quiet rooms
  // a real three-foot public-space buffer, retaining every square foot as
  // connected living-room geometry instead of waiving service adjacency.
  const bufferDepth = quietRoom ? 3 : 0;
  const featureHeight = commonRect.h - bufferDepth;
  const mainCommon = { x: commonRect.x, y: commonRect.y, w: commonWidth, h: commonRect.h };
  return {
    commonRect: bufferDepth ? commonRect : mainCommon,
    commonParts: bufferDepth ? [mainCommon, { x: commonRect.x + commonWidth,
      y: commonRect.y + featureHeight, w: featureWidth, h: bufferDepth }] : null,
    featureRect: { x: commonRect.x + commonWidth, y: commonRect.y, w: featureWidth, h: featureHeight },
  };
}

function buildTwoBedLowerFloor(width, height, rooms, options = {}) {
  const garageWidth = resolveGarageSlotWidth(rooms);
  const stairRect = { x: garageWidth, y: 16, w: 7, h: height - 16 };
  const landingRect = { x: garageWidth + 7, y: 16, w: 5, h: height - 16 };
  const serviceX = garageWidth + 12;
  const serviceWidth = width - serviceX;
  const serviceY = 16;

  // Kitchen placement: 'central_anchor' puts kitchen in center, common area left
  const centralKitchen = String(options.kitchenIntent || '').toLowerCase() === 'central_anchor';
  const diningWidth = 12;
  const commonWidth = width - serviceX;
  const placedRooms = centralKitchen ? [
    placeRoom(rooms.common_area, { x: 0, y: 0, w: garageWidth, h: 10 }, { openConcept: true }),
    placeRoom(rooms.farmhouse_kitchen, { x: garageWidth, y: 0, w: diningWidth, h: 16 }, { openConcept: true }),
    placeRoom(rooms.dining_room, { x: serviceX, y: 0, w: commonWidth, h: 16 }, { openConcept: true }),
  ] : [
    placeRoom(rooms.farmhouse_kitchen, { x: 0, y: 0, w: garageWidth, h: 10 }, { openConcept: true }),
    placeRoom(rooms.dining_room, { x: garageWidth, y: 0, w: diningWidth, h: 16 }, { openConcept: true }),
    placeRoom(rooms.common_area, { x: serviceX, y: 0, w: commonWidth, h: 16 }, { openConcept: true }),
  ];
  placedRooms.push(
    placeRoom(rooms.garage, { x: 0, y: 10, w: garageWidth, h: height - 10 }),
    placeRoom(rooms.stair_core_lower, stairRect),
    placeRoom(rooms.lower_landing, landingRect),
  );
  const serviceHeight = height - serviceY;
  const hasLowerSharedBath = Boolean(rooms.lower_shared_bath);

  if (hasLowerSharedBath && serviceWidth >= 12) {
    const minServiceColumnWidth = 6;
    const bathWidth = Math.max(6, Math.min(10, serviceWidth - minServiceColumnWidth));
    const serviceColumnX = serviceX + bathWidth;
    const serviceColumnWidth = Math.max(minServiceColumnWidth, serviceWidth - bathWidth);
    const bathHeight = Math.max(6, Math.min(8, serviceHeight - 4));
    // Preserve depth for actual appliance footprints and the laundry doorway.
    // A 6x6 laundry at the compact two-car footprint loses both appliances to
    // its door approaches; the mudroom can use four feet of the same column.
    const compactTwoCar = garageWidth === 20 && serviceWidth <= 12;
    const mudroomHeight = compactTwoCar
      ? Math.min(4, Math.max(2, serviceHeight - 8))
      : Math.max(2, Math.floor(serviceHeight / 2));
    const laundryHeight = Math.max(2, serviceHeight - mudroomHeight);

    placedRooms.push(placeRoom(rooms.lower_shared_bath, {
      x: serviceX,
      y: serviceY,
      w: bathWidth,
      h: bathHeight,
    }));
    placedRooms.push(placeRoom(rooms.entrance_room, {
      x: serviceX,
      y: serviceY + bathHeight,
      w: bathWidth,
      h: serviceHeight - bathHeight,
    }));
    placedRooms.push(placeRoom(rooms.mudroom, {
      x: serviceColumnX,
      y: serviceY,
      w: serviceColumnWidth,
      h: mudroomHeight,
    }));
    placedRooms.push(placeRoom(rooms.laundry, {
      x: serviceColumnX,
      y: serviceY + mudroomHeight,
      w: serviceColumnWidth,
      h: laundryHeight,
    }));
  } else {
    const serviceItems = [];
    if (rooms.lower_shared_bath) serviceItems.push({ room: rooms.lower_shared_bath, height: 8 });
    serviceItems.push(
      { room: rooms.mudroom, height: 4 },
      { room: rooms.laundry, height: 4 },
      { room: rooms.entrance_room }
    );
    placedRooms.push(...placeVerticalStack(serviceItems, serviceX, serviceY, serviceWidth, serviceHeight));
  }

  return {
    rooms: placedRooms,
    stairCore: {
      x: stairRect.x,
      y: stairRect.y,
      w: stairRect.w,
      h: stairRect.h,
      roomId: rooms.stair_core_lower?.id || 'stairs_l1',
      hallRoomId: rooms.lower_landing?.id || 'architect_v2_lower_hall',
      landingRoomId: rooms.lower_landing?.id || 'architect_v2_lower_hall',
      landingOpen: true,
    },
  };
}

function buildFeatureLowerFloor(width, height, rooms, options = {}) {
  const featureRoom = rooms.special_room || rooms.study;
  const featureKind = String(featureRoom?.requestedFeatureKind || featureRoom?.type || '').trim().toLowerCase();
  const isGymFeature = featureKind === 'gym';
  const diningSeatCount = Number(rooms?.dining_room?.roomContract?.seatCount || 4);
  const lowerFeatures = [featureRoom, rooms.special_room_secondary].filter(Boolean);
  const socialPair = isSocialFeaturePair(lowerFeatures.map(room => room.type));
  // Reserve a wider west bay on the daylight profile. The garage and both
  // stair anchors move together, leaving usable bedroom/closet width above.
  const garageWidth = socialPair && options.profileHint === 'variant_b_daylight_wing'
    ? 16 : resolveGarageSlotWidth(rooms);
  const topBandHeight = isGymFeature || socialPair ? 12 : 10;
  const diningWidthFloor = diningSeatCount >= 8 ? 14 : (isGymFeature ? 9 : 12);
  const minimumWidths = lowerFeatures.map(room => Math.max(8, Math.ceil(Number(room.minFeatureAreaSqFt || 100) / topBandHeight)));
  const requiredFeatureWidth = minimumWidths.reduce((sum, value) => sum + value, 0);
  const kitchenWidth = isGymFeature ? 10 : Math.max(10, Math.min(14, width - diningWidthFloor - requiredFeatureWidth));
  const gymFeatureMinWidth = 15; // 15x12 = 180 sqft minimum gym area
  let diningWidth = Math.max(
    diningWidthFloor,
    Math.min(16, Math.max(isGymFeature ? 9 : 12, width - kitchenWidth - requiredFeatureWidth))
  );
  if (isGymFeature) {
    const maxDiningForGym = Math.max(diningWidthFloor, width - kitchenWidth - gymFeatureMinWidth);
    diningWidth = Math.max(diningWidthFloor, Math.min(16, maxDiningForGym));
  }
  const featureX = kitchenWidth + diningWidth;
  if (minimumWidths.reduce((sum, value) => sum + value, 0) > width - featureX) {
    throw new Error('Lower feature rooms need more frontage to retain their required areas and independent access');
  }
  let featureCursorX = featureX;
  const featurePlacements = lowerFeatures.map((room, index) => {
    const featureWidth = index === lowerFeatures.length - 1 ? width - featureCursorX : minimumWidths[index];
    const placed = placeRoom(room, { x: featureCursorX, y: 0, w: featureWidth, h: topBandHeight });
    featureCursorX += featureWidth;
    return placed;
  });
  const publicBandBottomY = socialPair ? 22 : featureKind === 'library' && width <= 38 ? 16 : 18;
  if (socialPair && (height < 34 || height > 38)) throw new Error('The social-room pair needs a 34–38 ft depth to preserve living space and a fitted stair reservation');
  const commonBandHeight = Math.max(4, publicBandBottomY - topBandHeight);
  const commonBandX = Math.max(garageWidth, kitchenWidth);
  const stairRect = { x: garageWidth, y: publicBandBottomY, w: 7, h: height - publicBandBottomY };
  const landingDepth = options.wideDoorways ? 6 : 4;
  const landingX = garageWidth + 7;
  const serviceBandX = garageWidth + 12;
  const landingWidth = rooms.lower_shared_bath ? 5 : Math.max(6, width - landingX);
  const landingRect = { x: landingX, y: publicBandBottomY, w: landingWidth, h: landingDepth };
  const placedRooms = [
    placeRoom(rooms.farmhouse_kitchen, { x: 0, y: 0, w: kitchenWidth, h: topBandHeight }, { openConcept: true }),
    placeRoom(rooms.dining_room, { x: kitchenWidth, y: 0, w: diningWidth, h: topBandHeight }, { openConcept: true,
      ...(socialPair ? { publicSpaceForFeaturePair: true } : {}) }),
    ...featurePlacements,
    placeRoom(rooms.common_area, { x: commonBandX, y: topBandHeight, w: width - commonBandX, h: commonBandHeight }, { openConcept: true,
      ...(socialPair ? { publicSpaceForFeaturePair: true } : {}) }),
    placeRoom(rooms.garage, { x: 0, y: topBandHeight, w: garageWidth, h: height - topBandHeight }),
    placeRoom(rooms.stair_core_lower, stairRect),
    placeRoom(rooms.lower_landing, landingRect),
  ];

  if (options.profileHint === 'variant_b_daylight_wing') {
    const kitchen = placedRooms.find(r=>r.type==='kitchen');
    const dining = placedRooms.find(r=>r.type==='dining_room');
    const kitchenGeometry = {x:kitchen.x,y:kitchen.y,w:kitchen.w,h:kitchen.h};
    Object.assign(kitchen,{x:dining.x,y:dining.y,w:dining.w,h:dining.h});
    Object.assign(dining,kitchenGeometry);
  }

  if (rooms.lower_shared_bath) {
    const serviceBandWidth = Math.max(8, width - serviceBandX);
    const serviceY = publicBandBottomY;
    const serviceHeight = Math.max(8, height - serviceY);
    const entryRect = {
      x: landingX,
      y: publicBandBottomY + landingDepth,
      w: 5,
      h: Math.max(2, height - (publicBandBottomY + landingDepth)),
    };

    if (serviceBandWidth < 14) {
      const bathHeight = Math.max(6, Math.ceil(48 / serviceBandWidth));
      const laundryHeight = serviceHeight - bathHeight;
      const arrivalDepth = height - (publicBandBottomY + landingDepth);
      if (laundryHeight < 6 || arrivalDepth < 8) throw new Error('Compact bath and laundry require usable service depth');
      const mudroomHeight = 4;
      placedRooms.push(placeRoom(rooms.lower_shared_bath, { x: serviceBandX, y: serviceY, w: serviceBandWidth, h: bathHeight }));
      placedRooms.push(placeRoom(rooms.laundry, { x: serviceBandX, y: serviceY + bathHeight, w: serviceBandWidth, h: laundryHeight }));
      placedRooms.push(placeRoom(rooms.mudroom, { ...entryRect, h: mudroomHeight }));
      placedRooms.push(placeRoom(rooms.entrance_room, { ...entryRect, y: entryRect.y + mudroomHeight, h: arrivalDepth - mudroomHeight }));
    } else {
      // Keep the shared bath full-depth in the service band so it never drops below 48 sqft.
      const bathWidth = Math.max(6, Math.min(8, serviceBandWidth - 2));
      const serviceColumnX = serviceBandX + bathWidth;
      const serviceColumnWidth = Math.max(2, serviceBandWidth - bathWidth);
      const mudroomHeight = Math.max(2, Math.min(4, serviceHeight - 2));
      const laundryHeight = Math.max(2, serviceHeight - mudroomHeight);

      placedRooms.push(placeRoom(rooms.lower_shared_bath, {
        x: serviceBandX,
        y: serviceY,
        w: bathWidth,
        h: serviceHeight,
      }));
      placedRooms.push(placeRoom(rooms.mudroom, {
        x: serviceColumnX,
        y: serviceY,
        w: serviceColumnWidth,
        h: mudroomHeight,
      }));
      placedRooms.push(placeRoom(rooms.laundry, {
        x: serviceColumnX,
        y: serviceY + mudroomHeight,
        w: serviceColumnWidth,
        h: laundryHeight,
      }));
      placedRooms.push(placeRoom(rooms.entrance_room, entryRect));
    }
  } else {
    const serviceLowerY = publicBandBottomY + landingDepth;
    const serviceDepth = height - serviceLowerY;
    const laundryWidth = 6;
    const mudroomWidth = Math.min(6, width - landingX - laundryWidth - 4);
    if (serviceDepth < 6 || mudroomWidth < 4) throw new Error('Service band needs room for appliances and independent landing access');
    // Full-depth columns keep each room accessible from the landing. Stacking
    // mudroom above laundry left only two feet for appliances in compact plans.
    placedRooms.push(placeRoom(rooms.laundry, { x: landingX, y: serviceLowerY, w: laundryWidth, h: serviceDepth }));
    placedRooms.push(placeRoom(rooms.mudroom, { x: landingX + laundryWidth, y: serviceLowerY, w: mudroomWidth, h: serviceDepth }));
    placedRooms.push(placeRoom(rooms.entrance_room, { x: landingX + laundryWidth + mudroomWidth, y: serviceLowerY, w: width - landingX - laundryWidth - mudroomWidth, h: serviceDepth }));
  }

  return {
    rooms: placedRooms,
    stairCore: {
      x: stairRect.x,
      y: stairRect.y,
      w: stairRect.w,
      h: stairRect.h,
      roomId: rooms.stair_core_lower?.id || 'stairs_l1',
      hallRoomId: rooms.lower_landing?.id || 'architect_v2_lower_hall',
      landingRoomId: rooms.lower_landing?.id || 'architect_v2_lower_hall',
      landingOpen: true,
    },
  };
}

function buildThreeBedLowerFloor(width, height, rooms, options = {}) {
  const garageWidth = resolveGarageSlotWidth(rooms);
  const lowerFeatureRoom = resolveLowerFeatureRoom(rooms);
  if (width < 40) {
    const stairRect = { x: garageWidth, y: 16, w: 6, h: height - 16 };
    const landingRect = { x: garageWidth + 6, y: 16, w: 4, h: height - 16 };
    const serviceX = garageWidth + 10;
    const serviceWidth = width - serviceX;
    const serviceY = 16;

    const baseCommonRect = { x: serviceX, y: 0, w: width - serviceX, h: 16 };
    const carvedCommon = carveFeatureFromCommonBand(baseCommonRect, lowerFeatureRoom);
    const placedRooms = [
      placeRoom(rooms.farmhouse_kitchen, { x: 0, y: 0, w: garageWidth, h: 10 }, { openConcept: true }),
      placeRoom(rooms.dining_room, { x: garageWidth, y: 0, w: 10, h: 16 }, { openConcept: true }),
      placeRoom(rooms.common_area, carvedCommon.commonRect, { openConcept: true,
        ...(carvedCommon.commonParts ? { parts: carvedCommon.commonParts, featureBufferDepthFt: 3 } : {}) }),
      placeRoom(rooms.garage, { x: 0, y: 10, w: garageWidth, h: height - 10 }),
      placeRoom(rooms.stair_core_lower, stairRect),
      placeRoom(rooms.lower_landing, landingRect),
    ];
    if (carvedCommon.featureRect) {
      placedRooms.push(placeRoom(lowerFeatureRoom, carvedCommon.featureRect));
    }

    const lowerSharedBathRoom = rooms.lower_shared_bath || rooms.shared_bath || null;
    // Bath and entry face the landing; the laundry gets a deep side bay.
    // The previous full-width stack allocated only two feet to laundry.
    // A wide doorway needs a five-foot wall: at four feet the mudroom had no
    // wall to take its door and the laundry opened through the bathroom.
    const sideBayWidth = options.wideDoorways && serviceWidth - 5 >= 6 ? 5 : 4;
    const wetWidth = serviceWidth - sideBayWidth;
    const bathHeight = lowerSharedBathRoom ? Math.max(6, Math.ceil(48 / wetWidth)) : 0;
    const serviceDepth = height - serviceY;
    const laundryDepth = serviceDepth - bathHeight;
    if (wetWidth < 6 || laundryDepth < 6) throw new Error('Compact service rooms cannot fit bath fixtures and laundry');
    if (lowerSharedBathRoom) placedRooms.push(placeRoom(lowerSharedBathRoom, { x: serviceX, y: serviceY, w: wetWidth, h: bathHeight }));
    placedRooms.push(placeRoom(rooms.entrance_room, { x: serviceX, y: serviceY + bathHeight, w: wetWidth, h: laundryDepth }));
    const mudroomHeight = 4;
    placedRooms.push(placeRoom(rooms.mudroom, { x: serviceX + wetWidth, y: serviceY, w: sideBayWidth, h: mudroomHeight }));
    placedRooms.push(placeRoom(rooms.laundry, { x: serviceX + wetWidth, y: serviceY + mudroomHeight, w: sideBayWidth, h: serviceDepth - mudroomHeight }));

    return {
      rooms: placedRooms,
      stairCore: {
        x: stairRect.x,
        y: stairRect.y,
        w: stairRect.w,
        h: stairRect.h,
        roomId: rooms.stair_core_lower?.id || 'stairs_l1',
        hallRoomId: rooms.lower_landing?.id || 'architect_v2_lower_hall',
        landingRoomId: rooms.lower_landing?.id || 'architect_v2_lower_hall',
        landingOpen: true,
      },
    };
  }

  const stairRect = { x: garageWidth, y: 16, w: 7, h: height - 16 };
  const landingRect = { x: garageWidth + 7, y: 16, w: 5, h: height - 16 };
  const serviceX = garageWidth + 12;
  const serviceWidth = width - serviceX;
  const serviceY = 16;
  // The 44-foot two-car footprint has only 12 feet beside the stair strip.
  // Six feet for the bath/entry leaves a six-foot appliance bay; reserving
  // eight for the bath made a four-foot laundry with no usable door approach.
  const compactService = garageWidth === 20 && serviceWidth < 14;
  const lowerSharedBathWidth = compactService ? 6 : 8;
  const lowerSharedBathHeight = Math.max(6, Math.min(8, height - serviceY - (options.wideDoorways ? 5 : 4)));
  const lowerSharedBathRoom = rooms.lower_shared_bath || rooms.shared_bath || null;
  const serviceStackWidth = serviceWidth - lowerSharedBathWidth;
  const serviceStackX = serviceX + lowerSharedBathWidth;
  const serviceStackHeight = height - serviceY;

  const baseCommonRect = { x: serviceX, y: 0, w: width - serviceX, h: 16 };
  const carvedCommon = carveFeatureFromCommonBand(baseCommonRect, lowerFeatureRoom);
  const placedRooms = [
    placeRoom(rooms.farmhouse_kitchen, { x: 0, y: 0, w: garageWidth, h: 10 }, { openConcept: true }),
    placeRoom(rooms.dining_room, { x: garageWidth, y: 0, w: 12, h: 16 }, { openConcept: true }),
    placeRoom(rooms.common_area, carvedCommon.commonRect, { openConcept: true,
      ...(carvedCommon.commonParts ? { parts: carvedCommon.commonParts, featureBufferDepthFt: 3 } : {}) }),
    placeRoom(rooms.garage, { x: 0, y: 10, w: garageWidth, h: height - 10 }),
    placeRoom(rooms.stair_core_lower, stairRect),
    placeRoom(rooms.lower_landing, landingRect),
  ];
  if (carvedCommon.featureRect) {
    placedRooms.push(placeRoom(lowerFeatureRoom, carvedCommon.featureRect));
  }

  if (lowerSharedBathRoom) {
    placedRooms.push(placeRoom(lowerSharedBathRoom, {
      x: serviceX,
      y: serviceY,
      w: lowerSharedBathWidth,
      h: lowerSharedBathHeight,
    }));
  }

  placedRooms.push(...placeVerticalStack([
    { room: rooms.mudroom, height: compactService ? 4 : 6 },
    { room: rooms.laundry, height: serviceStackHeight - (compactService ? 4 : 6) },
  ], serviceStackX, serviceY, serviceStackWidth, serviceStackHeight));

  const entryY = lowerSharedBathRoom ? (serviceY + lowerSharedBathHeight) : serviceY;
  const entryHeight = height - entryY;
  placedRooms.push(placeRoom(rooms.entrance_room, {
    x: serviceX,
    y: entryY,
    w: lowerSharedBathWidth,
    h: entryHeight,
  }));

  return {
    rooms: placedRooms,
    stairCore: {
      x: stairRect.x,
      y: stairRect.y,
      w: stairRect.w,
      h: stairRect.h,
      roomId: rooms.stair_core_lower?.id || 'stairs_l1',
      hallRoomId: rooms.lower_landing?.id || 'architect_v2_lower_hall',
      landingRoomId: rooms.lower_landing?.id || 'architect_v2_lower_hall',
      landingOpen: true,
    },
  };
}

/**
 * side_spine_daylight layout: stair stays in same column as default (for
 * upper-floor alignment), but public zone arrangement is reversed:
 * - Common area gets the widest east position for maximum daylight
 * - Kitchen moves to a wider central band
 * - Dining anchors the west side with garage adjacency
 * - Entry room goes in front (south) of service column for exterior access
 */
function buildSideSpineDaylightLowerFloor(width, height, rooms) {
  const garageWidth = resolveGarageSlotWidth(rooms);
  const stairRect = { x: garageWidth, y: 16, w: 7, h: height - 16 };
  const landingRect = { x: garageWidth + 7, y: 16, w: 5, h: height - 16 };
  const serviceX = garageWidth + 12;
  const serviceWidth = width - serviceX;
  const serviceY = 16;
  const serviceHeight = height - serviceY;

  // DIFFERENT from default: reverse public zone order (dining west, common east for daylight)
  const diningWidth = Math.max(8, Math.min(garageWidth, 12));
  const kitchenWidth = Math.max(10, Math.min(14, width - diningWidth - serviceWidth));
  const commonWidth = Math.max(8, width - diningWidth - kitchenWidth);

  const placedRooms = [
    placeRoom(rooms.dining_room, { x: 0, y: 0, w: diningWidth, h: 10 }, { openConcept: true }),
    placeRoom(rooms.farmhouse_kitchen, { x: diningWidth, y: 0, w: kitchenWidth, h: 16 }, { openConcept: true }),
    placeRoom(rooms.common_area, { x: diningWidth + kitchenWidth, y: 0, w: commonWidth, h: 16 }, { openConcept: true }),
    placeRoom(rooms.garage, { x: 0, y: 10, w: garageWidth, h: height - 10 }),
    placeRoom(rooms.stair_core_lower, stairRect),
    placeRoom(rooms.lower_landing, landingRect),
  ];

  // Service: entry at bottom of stack so it touches front edge
  const serviceItems = [];
  if (rooms.lower_shared_bath) serviceItems.push({ room: rooms.lower_shared_bath, height: 8 });
  serviceItems.push(
    { room: rooms.laundry, height: Math.max(4, Math.floor(serviceHeight / 3)) },
    { room: rooms.mudroom, height: Math.max(4, Math.floor(serviceHeight / 3)) },
    { room: rooms.entrance_room } // last → fills to bottom → touches front edge
  );
  placedRooms.push(...placeVerticalStack(serviceItems, serviceX, serviceY, serviceWidth, serviceHeight));

  return {
    rooms: placedRooms,
    stairCore: {
      x: stairRect.x,
      y: stairRect.y,
      w: stairRect.w,
      h: stairRect.h,
      roomId: rooms.stair_core_lower?.id || 'stairs_l1',
      hallRoomId: rooms.lower_landing?.id || 'architect_v2_lower_hall',
      landingRoomId: rooms.lower_landing?.id || 'architect_v2_lower_hall',
      landingOpen: true,
    },
  };
}

/**
 * rear_service_pivot layout: stair stays in same column (for upper-floor
 * alignment), but public zone gets deeper front band and service/garage
 * relationship is reorganized:
 * - Public band is 18ft deep (vs 16ft default) — more generous living space
 * - Kitchen spans wider for open-plan emphasis
 * - Service column reorganized: entrance at bottom (front edge)
 * - Garage and service form a compact rear cluster
 */
function buildRearServicePivotLowerFloor(width, height, rooms) {
  const garageWidth = resolveGarageSlotWidth(rooms);
  const publicBandHeight = 18;
  const stairRect = { x: garageWidth, y: publicBandHeight, w: 7, h: height - publicBandHeight };
  const landingRect = { x: garageWidth + 7, y: publicBandHeight, w: 5, h: height - publicBandHeight };
  const serviceX = garageWidth + 12;
  const serviceWidth = width - serviceX;
  const serviceY = publicBandHeight;
  const serviceHeight = height - serviceY;

  // DIFFERENT from default: wider kitchen, deeper public band, common east
  const kitchenWidth = Math.max(10, Math.min(garageWidth + 2, Math.floor(width * 0.35)));
  const diningWidth = Math.max(8, Math.min(14, Math.floor(width * 0.25)));
  const commonWidth = Math.max(8, width - kitchenWidth - diningWidth);

  const placedRooms = [
    placeRoom(rooms.farmhouse_kitchen, { x: 0, y: 0, w: kitchenWidth, h: publicBandHeight }, { openConcept: true }),
    placeRoom(rooms.dining_room, { x: kitchenWidth, y: 0, w: diningWidth, h: publicBandHeight }, { openConcept: true }),
    placeRoom(rooms.common_area, { x: kitchenWidth + diningWidth, y: 0, w: commonWidth, h: publicBandHeight }, { openConcept: true }),
    placeRoom(rooms.garage, { x: 0, y: publicBandHeight, w: garageWidth, h: height - publicBandHeight }),
    placeRoom(rooms.stair_core_lower, stairRect),
    placeRoom(rooms.lower_landing, landingRect),
  ];

  // Service: entrance at bottom for front-edge access
  const serviceItems = [];
  if (rooms.lower_shared_bath) serviceItems.push({ room: rooms.lower_shared_bath, height: 8 });
  serviceItems.push(
    { room: rooms.mudroom, height: Math.max(4, Math.floor(serviceHeight / 3)) },
    { room: rooms.laundry, height: Math.max(4, Math.floor(serviceHeight / 3)) },
    { room: rooms.entrance_room } // last → fills to bottom → touches front edge
  );
  placedRooms.push(...placeVerticalStack(serviceItems, serviceX, serviceY, serviceWidth, serviceHeight));

  return {
    rooms: placedRooms,
    stairCore: {
      x: stairRect.x,
      y: stairRect.y,
      w: stairRect.w,
      h: stairRect.h,
      roomId: rooms.stair_core_lower?.id || 'stairs_l1',
      hallRoomId: rooms.lower_landing?.id || 'architect_v2_lower_hall',
      landingRoomId: rooms.lower_landing?.id || 'architect_v2_lower_hall',
      landingOpen: true,
    },
  };
}

function buildFrontKitchenLowerFloor(width, height, rooms, profileHint, wideDoorways = false) {
  const garageWidth = resolveGarageSlotWidth(rooms);
  const serviceWidth = garageWidth - 4;
  const publicX = garageWidth + 12;
  if (width-publicX < 12 || height < 30) throw new Error('Front kitchen needs a twelve-foot kitchen wing and a thirty-foot house depth');
  const rearDepth = profileHint === 'variant_c_service_spine' ? 20 : 16;
  const stairRect = { x:garageWidth, y:rearDepth, w:7, h:height-rearDepth };
  const entryRect = { x:garageWidth+7, y:rearDepth, w:5, h:height-rearDepth };
  const bath = rooms.lower_shared_bath || rooms.shared_bath;
  // The service band holds the bath and, below it, the laundry. A wide
  // doorway needs a five-foot wall, so the laundry deepens to five feet to
  // open onto the mudroom; at four it opened through the bathroom, and the
  // bath's two wide doors left no room for its toilet and vanity.
  const band = bath && wideDoorways ? 11 : 10;
  // Keep the kitchen on the entrance facade while varying the rear public
  // arrangement. Previously every profile used exactly the same topology.
  const rearSplit = profileHint === 'variant_c_service_spine';
  const swapRear = profileHint === 'variant_b_daylight_wing';
  const livingRect = rearSplit
    ? { x:garageWidth, y:0, w:width-garageWidth, h:10 }
    : { x:garageWidth, y:0, w:12, h:16 };
  const diningRect = rearSplit
    ? { x:garageWidth, y:10, w:width-garageWidth, h:10 }
    : { x:publicX, y:0, w:width-publicX, h:16 };
  const placed = [
    placeRoom(rooms.garage,{x:0,y:band,w:garageWidth,h:height-band}),
    placeRoom(rooms.mudroom,{x:serviceWidth,y:0,w:4,h:band}),
    placeRoom(rooms.laundry,{x:0,y:bath?6:0,w:serviceWidth,h:bath?band-6:band}),
    placeRoom(rooms.common_area,swapRear ? { ...diningRect, h:12 } : livingRect),
    placeRoom(rooms.dining_room,swapRear ? livingRect : diningRect),
    placeRoom(rooms.farmhouse_kitchen,{x:publicX,y:rearDepth,w:width-publicX,h:height-rearDepth}),
    placeRoom(rooms.stair_core_lower,stairRect),
    placeRoom(rooms.entrance_room,entryRect),
  ];
  if (swapRear) {
    const dining = placed.find(r => r.type === 'dining_room');
    dining.parts = [livingRect, { x:publicX, y:12, w:width-publicX, h:4 }];
    Object.assign(dining, boundingRectOf(dining));
  }
  if (bath) placed.push(placeRoom(bath,{x:0,y:0,w:serviceWidth,h:6}));
  return {rooms:placed,stairCore:{...stairRect,roomId:rooms.stair_core_lower.id,
    hallRoomId:rooms.entrance_room.id,landingRoomId:rooms.entrance_room.id,landingOpen:true}};
}

function varyPublicRooms(layout, profileHint) {
  const types = ['kitchen','dining_room','living_room'];
  const publicRooms = types.map(type=>layout.rooms.find(r=>r.type===type));
  if (publicRooms.some(r=>!r || r.parts?.length)) return layout;
  const order = profileHint === 'variant_b_daylight_wing' ? [1,0,2]
    : profileHint === 'variant_c_service_spine' ? [2,1,0] : [0,1,2];
  const geometry = publicRooms.map(r=>({x:r.x,y:r.y,w:r.w,h:r.h}));
  publicRooms.forEach((room,i)=>Object.assign(room,geometry[order[i]]));
  return layout;
}

// Scalable envelopes used to pour their entire extra width into mud/laundry
// strips (sometimes sixty feet wide). Keep a usable service wing and give the
// adjoining public room that floor area before openings/furniture are placed.
function rebalanceOversizedServiceRooms(layout) {
  const donors = layout.rooms.filter(r => ['mudroom', 'laundry', 'bathroom', 'entry', 'hallway'].includes(r.type) && !r.parts?.length && r.w >= 24)
    .sort((a, b) => a.y - b.y);
  for (const donor of donors) {
    const retainedWidth = donor.type === 'hallway' ? 20 : 12;
    const addition = { x: donor.x + retainedWidth, y: donor.y, w: donor.w - retainedWidth, h: donor.h };
    const receiver = layout.rooms.find(r => ['living_room', 'dining_room', 'kitchen'].includes(r.type) && shareWall(r, addition, 4));
    if (!receiver) continue;
    receiver.parts = [...partListOf(receiver), addition].map(({ x, y, w, h }) => ({ x, y, w, h }));
    Object.assign(receiver, boundingRectOf(receiver));
    donor.w = retainedWidth;
  }
  for (const bath of layout.rooms.filter(r => r.type === 'bathroom' && !r.attachedTo && !r.parts?.length && r.h > 20)) {
    const addition = { x: bath.x, y: bath.y + 12, w: bath.w, h: bath.h - 12 };
    const entry = layout.rooms.find(r => r.type === 'entry' && shareWall(r, addition, 4));
    if (!entry) continue;
    entry.parts = [...partListOf(entry), addition].map(({x,y,w,h})=>({x,y,w,h}));
    Object.assign(entry, boundingRectOf(entry));
    bath.h = 12;
  }
  return layout;
}

function buildLowerFloorGarageCluster({ variant = 'two_bed', width, height, rooms, profileHint = null, kitchenIntent = null, wideDoorways = false }) {
  if (kitchenIntent === 'front_anchor' && !resolveLowerFeatureRoom(rooms)) return buildFrontKitchenLowerFloor(width,height,rooms,profileHint,wideDoorways);
  if (variant === 'study' || variant === 'feature_room') return rebalanceOversizedServiceRooms(buildFeatureLowerFloor(width, height, rooms, { wideDoorways, profileHint }));
  if (variant === 'three_bed') return rebalanceOversizedServiceRooms(varyPublicRooms(buildThreeBedLowerFloor(width, height, rooms, { wideDoorways }), profileHint));
  return rebalanceOversizedServiceRooms(varyPublicRooms(buildTwoBedLowerFloor(width, height, rooms, { kitchenIntent }), profileHint));
}

module.exports = {
  buildLowerFloorGarageCluster,
  rebalanceOversizedServiceRooms,
};
