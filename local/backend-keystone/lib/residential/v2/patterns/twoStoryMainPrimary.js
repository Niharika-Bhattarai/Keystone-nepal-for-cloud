'use strict';
const { placeRoom } = require('../fitRoomsToRealms');
const { buildSharedUpperGarageCirculationCore } = require('../clusterBuilders');

/* Two storeys with the primary suite on the main floor, beside a one- or
 * two-car garage, or a flex room where there is no garage. The garden is at
 * y = 0, the street at y = height.
 *
 * Ground floor: the suite behind the garage; public rooms across the garden
 * side; a front band with the stair, its hall, a bathroom and the entry.
 *
 *   +------+-----+---------+---------+
 *   | prim.| ens.| kitchen | dining  |
 *   |    +-+-----+---------+---------+
 *   |    | access|   living          |
 *   +----+--+----+                   |
 *   | garage| mud|                   |
 *   |       +----+--+----+-----+-----+
 *   |       | stair |hall| bath|entry|
 *   +-------+-------+----+-----+-----+
 *
 * Upper floor: the other bedrooms around the landing above the stair. A left
 * column (bedroom, bath, bedroom) sits over the suite and garage, with a
 * laundry or store behind the landing. Over the public rooms the upper floor
 * is, by need: nothing (a storey and a half, when the area asks for less); a
 * loft; the deep option's bedroom wrapped round a branch hall; or a wing of
 * bedrooms and baths off that branch hall (four and five bedrooms).
 *
 * A two-car garage is the one-car plan with an eight-foot strip on the
 * garage side: the garage widens, the suite's bedroom strip widens, and the
 * strip behind the suite is its walk-in closet. The upper floor keeps to the
 * one-car plan, so the strip is a single storey.
 */
const STAIR_X = 14, STAIR_W = 7, COLUMN_W = 14, RIGHT_X = STAIR_X + STAIR_W, BRANCH_W = 4;

// The area the upper floor adds in each extent, for the footprint search and
// the layout to agree on.
function upperExtentAreas(width, height) {
  return { compact: RIGHT_X * height, full: width * height };
}

// Upper extents that can hold the upstairs program: the compact floor has
// two bedroom slots, a bath slot and the slot behind the landing.
function upperExtentsFor({ bedrooms, baths, laundry }) {
  const compactFits = bedrooms <= 2 && baths <= (laundry ? 1 : 2);
  const full = ['full'];
  return bedrooms >= 3 ? full : compactFits ? ['compact', ...full] : full;
}

// The strip a two-car garage adds on the garage side.
const garageStrip = (brief) => brief.garageType === 'TWO_CAR' ? 8 : 0;

// The extent whose total area is nearest the target (ground floor full;
// `width` is the one-car plan's, `strip` the two-car garage's addition).
function chooseUpperExtent({ width, height, strip = 0, target, bedrooms, baths, laundry }) {
  const areas = upperExtentAreas(width, height);
  return upperExtentsFor({ bedrooms, baths, laundry })
    .map((extent) => ({ extent, delta: Math.abs((width + strip) * height + areas[extent] - target) }))
    .sort((a, b) => a.delta - b.delta)[0].extent;
}

function assembleLayout({ brief, footprint, program }) {
  // The plan is drawn one-car wide and the two-car strip added at the end.
  const strip = garageStrip(brief);
  const width = footprint.widthFt - strip, height = footprint.heightFt;
  if (width < 40 || height < 34) throw new Error('The main-floor suite needs a forty-foot width (plus the two-car strip) and thirty-four-foot depth.');
  const source = program.levels.map(level => [...level.rooms]);
  const take = (level, type) => {
    const index = source[level - 1].findIndex(r => r.type === type);
    return index < 0 ? null : source[level - 1].splice(index, 1)[0];
  };
  const levels = [1, 2].map(level => ({ level, width, height, rooms: [] }));
  const put = (level, room, x, y, w, h) => {
    if (!room) throw new Error('The main-floor suite program is missing a required room.');
    const placed = placeRoom(room, { x, y, w, h });
    levels[level - 1].rooms.push(placed);
    return placed;
  };
  const support = (id, type, level, label) => ({ id, type, level, label, requestedFeature: false });
  const suiteDepth = height - 20, stairY = height - 12;

  const swap = footprint.variationId === 'variant_b_daylight_wing';
  const deepPublic = footprint.variationId === 'variant_c_service_spine';

  // Ground floor. The suite: the bedroom on the side wall and the bath by
  // the kitchen, or (the deep option) mirrored, the bath on the side wall and
  // the bedroom by the kitchen.
  const primary = take(1, 'primary_bedroom'), ensuite = take(1, 'primary_bathroom');
  const placedPrimary = put(1, primary, 0, 0, deepPublic ? 22 : 14, suiteDepth);
  const bedroomX = deepPublic ? 10 : 0, ensuiteX = deepPublic ? 0 : 12;
  placedPrimary.parts = [{ x: bedroomX, y: 0, w: 12, h: suiteDepth - 6 }, { x: 0, y: suiteDepth - 6, w: 14, h: 6 }];
  put(1, ensuite, ensuiteX, 0, 10, suiteDepth - 6);
  put(1, support('main_primary_access', 'hallway', 1, 'Suite access'), 14, suiteDepth - 6, 8, 6);
  if (brief.hasGarage) {
    put(1, take(1, 'garage'), 0, suiteDepth, 14, 20);
    put(1, take(1, 'mudroom'), 14, suiteDepth, 8, 8);
  } else {
    // Without a garage its bay and the mudroom's are a flex room at the
    // front, off the suite hall and the living room.
    const flex = put(1, support('main_primary_flex', 'loft', 1, 'Flex room'), 0, suiteDepth, 22, 20);
    flex.parts = [{ x: 0, y: suiteDepth, w: 14, h: 20 }, { x: 14, y: suiteDepth, w: 8, h: 8 }];
  }
  const lowerStairs = put(1, take(1, 'stairs'), STAIR_X, stairY, STAIR_W, 12);
  const lowerHall = put(1, take(1, 'hallway'), 21, stairY, 5, 12);
  // The front band's bath and laundry slots. With two bathrooms the only
  // shared bath is upstairs: the laundry takes the bath slot, or the entry
  // widens into both slots when the laundry is upstairs too.
  const lowerBath = take(1, 'bathroom'), lowerLaundry = take(1, 'laundry');
  const entry = take(1, 'entry');
  // A wide house would make the entry a hall along the whole front: past
  // twenty feet it keeps fourteen and the living room takes the rest.
  const entryX = lowerBath || lowerLaundry ? 34 : 26;
  const entryW = width - entryX > 20 ? 14 : width - entryX;
  if (lowerBath) {
    put(1, lowerBath, 26, stairY, 8, 8);
    put(1, lowerLaundry || support('main_primary_lower_store', 'storage', 1, 'Storage'), 26, stairY + 8, 8, 4);
    put(1, entry, 34, stairY, entryW, 12);
  } else if (lowerLaundry) {
    put(1, lowerLaundry, 26, stairY, 8, 8);
    const placedEntry = put(1, entry, 26, stairY, entryX + entryW - 26, 12);
    placedEntry.parts = [{ x: 34, y: stairY, w: entryW, h: 12 }, { x: 26, y: stairY + 8, w: 8, h: 4 }];
  } else {
    put(1, entry, 26, stairY, entryW, 12);
  }
  const publicWidth = width - 22;
  // Four or more bedrooms seat eight at the table, which needs fourteen feet.
  const publicDepth = Number(brief.totalAreaSqFt) >= 3000 || Number(brief.bedrooms) >= 4 ? 14 : 12;
  const firstWidth = deepPublic ? 9 : Math.floor(publicWidth / 2);
  put(1, take(1, swap ? 'dining_room' : 'kitchen'), 22, 0, firstWidth, publicDepth);
  put(1, take(1, swap ? 'kitchen' : 'dining_room'), 22 + firstWidth, 0, publicWidth - firstWidth, publicDepth);
  const living = put(1, take(1, 'living_room'), 22, publicDepth, publicWidth, stairY - publicDepth);
  if (entryX + entryW < width) {
    living.parts = [{ x: 22, y: publicDepth, w: publicWidth, h: stairY - publicDepth },
      { x: entryX + entryW, y: stairY, w: width - entryX - entryW, h: 12 }];
    living.h = height - publicDepth;
  }
  const anchor = { x: lowerStairs.x, y: lowerStairs.y, w: lowerStairs.w, h: lowerStairs.h };
  levels[0].stairCore = { ...anchor, roomId: lowerStairs.id, hallRoomId: lowerHall.id, landingRoomId: lowerHall.id, landingOpen: true };

  // Upper floor.
  const upper = buildSharedUpperGarageCirculationCore({ width, height, stairAnchor: anchor,
    stairsRoom: take(2, 'stairs'), landingRoom: take(2, 'hallway') });
  levels[1].rooms.push(upper.stairRoom, upper.landingRoom);
  levels[1].stairCore = upper.stairCore;
  const landingY = upper.landingY;
  const beds = source[1].filter(r => r.type === 'bedroom');
  const baths = source[1].filter(r => r.type === 'bathroom');
  const upperLaundry = take(2, 'laundry');
  const extent = chooseUpperExtent({ width, height, strip, target: Number(brief.footprintAreaSqFtTarget || brief.totalAreaSqFt),
    bedrooms: beds.length, baths: baths.length, laundry: Boolean(upperLaundry) });
  const nextBed = () => take(2, 'bedroom');
  const nextBath = () => take(2, 'bathroom');
  const loft = (id, label) => support(id, 'loft', 2, label);
  // The slot behind the landing: laundry, a second bath (while it stays in
  // proportion), or a store.
  const behindLanding = () => upperLaundry || (baths.length > 1 && landingY / STAIR_W <= 2.8 ? nextBath() : null) ||
    support('main_primary_upper_store', 'storage', 2, 'Storage');

  // Over the public rooms of a wide house a single loft or bedroom would be
  // a hall-sized room; there the bedroom-hall layout divides it.
  const wideUpper = extent === 'full' && width - RIGHT_X > 24;
  if (beds.length <= 2 && baths.length === 1 && extent === 'full' && deepPublic && !wideUpper) {
    // The deep option: a second private wing gives this option a different
    // bedroom/circulation arrangement, with a real public hall to the
    // remaining rear loft.
    const firstUpperBedroom = nextBed();
    put(2, loft('main_primary_front_loft', 'Front loft'), 0, 0, COLUMN_W, landingY);
    put(2, nextBed() || loft('main_primary_bonus_loft', 'Bonus room'), 0, stairY, COLUMN_W, 12);
    put(2, nextBath(), 0, landingY, upper.landingX, upper.landingRect.h);
    put(2, behindLanding(), STAIR_X, 0, STAIR_W, landingY);
    const bedroom = put(2, firstUpperBedroom, RIGHT_X, 0, width - RIGHT_X, stairY);
    bedroom.parts = [{ x: RIGHT_X, y: 0, w: width - RIGHT_X, h: landingY },
      { x: RIGHT_X + BRANCH_W, y: landingY, w: width - RIGHT_X - BRANCH_W, h: stairY - landingY }];
    put(2, support('main_primary_upper_branch', 'hallway', 2, 'Loft access'), RIGHT_X, landingY, BRANCH_W, height - landingY);
    put(2, loft('main_primary_upper_loft', 'Rear loft'), RIGHT_X + BRANCH_W, stairY, width - RIGHT_X - BRANCH_W, 12);
  } else if (beds.length <= 2 && (extent === 'compact' || baths.length === 1) && !wideUpper) {
    // The left column, and a loft over the public rooms unless the area asks
    // for a storey and a half.
    put(2, nextBed(), 0, 0, COLUMN_W, landingY);
    put(2, nextBed() || loft('main_primary_bonus_loft', 'Bonus room'), 0, stairY, COLUMN_W, 12);
    put(2, nextBath(), 0, landingY, upper.landingX, upper.landingRect.h);
    put(2, behindLanding(), STAIR_X, 0, STAIR_W, landingY);
    if (extent === 'full') put(2, loft('main_primary_upper_loft', 'Loft'), RIGHT_X, 0, width - RIGHT_X, height);
  } else {
    // Four and five bedrooms, or more baths than the left column holds: a
    // bedroom hall runs from the landing to the side wall, level with the
    // stair's head. Bedrooms over the garden behind
    // it; baths and any further bedroom over the entry in front of it, beside
    // the stair; a loft takes what is left. The deep option reverses both rows.
    const rightW = width - RIGHT_X, hallY = stairY - 4, rearD = hallY, frontD = height - stairY;
    if (rightW >= width * 0.7) throw new Error('The upper bedroom hall would span the house.');
    put(2, nextBed(), 0, 0, COLUMN_W, landingY);
    put(2, nextBed() || loft('main_primary_bonus_loft', 'Bonus room'), 0, stairY, COLUMN_W, 12);
    put(2, nextBath(), 0, landingY, upper.landingX, upper.landingRect.h);
    // Behind the landing: the laundry, else a bath while it stays in
    // proportion, else a store.
    const behindBath = !upperLaundry && baths.length > 2 && landingY / STAIR_W <= 2.8 ? nextBath() : null;
    put(2, upperLaundry || behindBath || support('main_primary_upper_store', 'storage', 2, 'Storage'), STAIR_X, 0, STAIR_W, landingY);
    put(2, support('main_primary_upper_hall', 'hallway', 2, 'Bedroom hall'), RIGHT_X, hallY, rightW, 4);
    const rightBeds = source[1].filter(r => r.type === 'bedroom');
    const rightBaths = source[1].filter(r => r.type === 'bathroom');
    const bathW = 7;
    // Bedrooms over the garden; the deep option puts them by the street first.
    const frontRoom = Math.floor((rightW - rightBaths.length * bathW) / 11);
    const frontBeds = deepPublic ? Math.min(rightBeds.length, frontRoom) : Math.max(0, rightBeds.length - Math.floor(rightW / 11));
    const rearBeds = rightBeds.length - frontBeds;
    if (frontBeds > frontRoom || rearBeds * 11 > rightW) throw new Error('The upper bedroom hall has no room for every bedroom and bath.');
    // A row of rooms along the hall: fixed widths first, then lofts (from six
    // feet, none wider than twenty-four) take the rest, or the last room does.
    const row = (items, y, d, loftId) => {
      const fixed = items.reduce((sum, item) => sum + item.w, 0);
      const rest = rightW - fixed;
      const count = Math.ceil(rest / 24);
      const lofts = Array.from({ length: count }, (_, i) => ({ room: loft(i ? `${loftId}_${i + 1}` : loftId, i ? 'Bonus room' : 'Loft'),
        w: i === count - 1 ? rest - Math.floor(rest / count) * (count - 1) : Math.floor(rest / count) }));
      const all = rest >= 6 ? [...items, ...lofts] : items.map((item, i) => i === items.length - 1 ? { ...item, w: item.w + rest } : item);
      let x = RIGHT_X;
      for (const item of deepPublic ? [...all].reverse() : all) { put(2, item.room, x, y, item.w, d); x += item.w; }
    };
    const rearBedW = rearBeds ? Math.min(16, Math.floor(rightW / rearBeds)) : 0;
    row(Array.from({ length: rearBeds }, () => ({ room: nextBed(), w: rearBedW })), 0, rearD, 'main_primary_rear_loft');
    const frontBedW = frontBeds ? Math.min(16, Math.floor((rightW - rightBaths.length * bathW) / frontBeds)) : 0;
    row([...Array.from({ length: rightBaths.length }, () => ({ room: nextBath(), w: bathW })),
      ...Array.from({ length: frontBeds }, () => ({ room: nextBed(), w: frontBedW }))], stairY, frontD, 'main_primary_front_loft');
  }
  if (source.some(rooms => rooms.length)) throw new Error('The main-floor suite cannot yet place every additional program room.');
  if (strip) addGarageStrip(levels, strip, suiteDepth, placedPrimary);
  return { levels };
}

// Shift the one-car plan along and fill the strip: the garage and the suite's
// bedroom strip widen, and the walk-in closet slot sits behind the suite.
function addGarageStrip(levels, strip, suiteDepth, primary) {
  const shift = (r) => {
    r.x += strip;
    if (r.parts) r.parts = r.parts.map(p => ({ ...p, x: p.x + strip }));
  };
  for (const level of levels) {
    level.width += strip;
    level.rooms.forEach(shift);
    if (level.stairCore) level.stairCore = { ...level.stairCore, x: level.stairCore.x + strip };
  }
  const ground = levels[0];
  const garage = ground.rooms.find(r => r.type === 'garage');
  garage.x = 0; garage.w += strip;
  const bedroomStrip = primary.parts.find(p => p.y === suiteDepth - 6);
  bedroomStrip.x = 0; bedroomStrip.w += strip;
  primary.x = 0; primary.w = Math.max(...primary.parts.map(p => p.x + p.w));
  ground.rooms.push(placeRoom({ id: 'architect_v2_primary_closet_slot', type: 'storage', level: 1, label: 'Closet', zone: 'private', requestedFeature: false },
    { x: 0, y: 0, w: strip, h: suiteDepth - 6 }));
}
module.exports = { assembleLayout, upperExtentAreas, upperExtentsFor, chooseUpperExtent, garageStrip };
