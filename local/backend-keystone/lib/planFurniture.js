'use strict';

const { normalizeRoomType, isOutdoorType } = require('./tile/canonicalRoomTypes');
const { CHECKED_ROOM_TYPES, placeFurnitureWithoutCollisions, clearPartsFor, doorClearances, fitsRoom, bedClearanceEnvelope } = require('./furnitureGeometry');
const { chooseBed, companions } = require('./bedPlacement');
const { roomContext, planLiving, planDining, planKitchen } = require('./publicRoomPlacement');
const { planBathroom, planLaundry, planStudy } = require('./serviceRoomPlacement');
const { BED_GEOMETRIES } = require('./residential/contractGeometry');
const { closetLayout } = require('./closetGeometry');
const { refitArranged } = require('./pinnedFurniture');

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function rectOf(room) {
  return {
    x: num(room?.x),
    y: num(room?.y),
    w: num(room?.w),
    h: num(room?.h),
  };
}

function partListOf(room) {
  if (Array.isArray(room?.parts) && room.parts.length) {
    return room.parts.map((part) => ({
      x: num(part?.x),
      y: num(part?.y),
      w: num(part?.w),
      h: num(part?.h),
    }));
  }
  return [rectOf(room)];
}

function largestPartOf(room) {
  const parts = partListOf(room);
  return parts.reduce((best, part) => (
    (part.w * part.h) > (best.w * best.h) ? part : best
  ), parts[0] || rectOf(room));
}

function roomDoors(room, level) {
  const id = String(room?.id || '');
  return (level?.doors || []).filter((door) => String(door?.a) === id || String(door?.b) === id);
}

function doorSideForRoom(room, level, anchor = largestPartOf(room)) {
  const doors = roomDoors(room, level).filter((door) => !door?.garageDoor);
  if (!doors.length) return null;
  const x = num(anchor?.x);
  const y = num(anchor?.y);
  const w = num(anchor?.w);
  const h = num(anchor?.h);
  const tol = 1.25;

  for (const door of doors) {
    const dx = num(door?.x);
    const dy = num(door?.y);
    if (String(door?.dir) === 'vertical') {
      if (Math.abs(dx - x) <= tol && dy >= y - tol && dy <= y + h + tol) return 'left';
      if (Math.abs(dx - (x + w)) <= tol && dy >= y - tol && dy <= y + h + tol) return 'right';
    } else {
      if (Math.abs(dy - y) <= tol && dx >= x - tol && dx <= x + w + tol) return 'top';
      if (Math.abs(dy - (y + h)) <= tol && dx >= x - tol && dx <= x + w + tol) return 'bottom';
    }
  }

  return null;
}

function clampRect(anchor, x, y, w, h, inset = 0.75) {
  const aw = num(anchor?.w);
  const ah = num(anchor?.h);
  const ax = num(anchor?.x);
  const ay = num(anchor?.y);
  const width = Math.min(w, Math.max(1, aw - inset * 2));
  const height = Math.min(h, Math.max(1, ah - inset * 2));
  const minX = ax + inset;
  const maxX = ax + aw - inset - width;
  const minY = ay + inset;
  const maxY = ay + ah - inset - height;
  return {
    x: Math.max(minX, Math.min(x, maxX)),
    y: Math.max(minY, Math.min(y, maxY)),
    w: width,
    h: height,
  };
}

function centeredRect(anchor, w, h, inset = 0.75) {
  const ax = num(anchor?.x);
  const ay = num(anchor?.y);
  const aw = num(anchor?.w);
  const ah = num(anchor?.h);
  return clampRect(anchor, ax + (aw - w) / 2, ay + (ah - h) / 2, w, h, inset);
}

function makeItem(room, kind, rect, extra = {}) {
  return {
    id: `${room.id}_${kind}_${Math.round(rect.x * 10)}_${Math.round(rect.y * 10)}`,
    roomId: String(room.id),
    kind,
    shape: 'rect',
    x: num(rect?.x),
    y: num(rect?.y),
    w: num(rect?.w),
    h: num(rect?.h),
    ...extra,
  };
}

/* The bedroom as a whole: every wall, rotation and position is tried for the bed
   against all of the room's doorways, windows and paths (lib/bedPlacement.js);
   nightstands and a dresser follow. Returns null when the level is not known,
   and the simple placement below is used instead. */
function planBedroom(room, level, bedType, dims, large, opts = {}) {
  if (!level || opts.legacy) return null;
  const clearParts = clearPartsFor(level, room);
  if (Array.isArray(clearParts) && !clearParts.length) return null;
  const parts = clearParts || partListOf(room);
  const inset = clearParts ? 0.02 : 0.27; // flush with the finished face, or the nominal 0.25 ft inset
  const id = String(room.id);
  const others = new Map((level.rooms || []).map((r) => [String(r.id), r]));
  const doors = (level.doors || []).filter((d) => !d.garageDoor && [d.a, d.b].map(String).includes(id));
  const reach = (level.rooms || []).filter((c) => String(c.ownerBedroomId) === id && c.closetType === 'reach_in')
    .map((c) => closetLayout(c)?.access).filter(Boolean);
  const entry = doors.find((d) => !/closet|bath|powder/.test(String(others.get(String(String(d.a) === id ? d.b : d.a))?.type || ''))) || doors[0] || null;
  const context = {
    parts, inset, doors, reach, entry, large,
    dims: { width: dims.widthFt, length: dims.lengthFt },
    windows: (level.windows || []).filter((w) => String(w.roomId) === id),
    zones: doorClearances(room, level),
    fits: (q) => fitsRoom(q, room, clearParts),
    envelopeFits: (bed) => fitsRoom(bedClearanceEnvelope(bed, room), room, clearParts),
    clearance: { side: Number(room.roomContract?.sideClearanceFt || 2.5), foot: Number(room.roomContract?.footClearanceFt || 2) },
  };
  const bed = chooseBed(context);
  if (!bed) return null;
  const hasCloset = (level.rooms || []).some((r) => r.type === 'closet' && String(r.ownerBedroomId) === id);
  const items = [makeItem(room, `bed_${bedType}`, bed, { rotation: bed.rotation, planned: true, placement: { rules: bed.rules, broken: bed.broken } })];
  for (const extra of companions(bed, { ...context, envelope: hasCloset ? bedClearanceEnvelope(bed, room) : null })) {
    items.push(makeItem(room, extra.kind, extra));
  }
  return items;
}

function addBedroomFurniture(room, list, large = false, level = null, opts = {}) {
  const bedType = room.roomContract?.bedType || (large ? 'queen' : 'full');
  const dimensions = BED_GEOMETRIES[bedType] || BED_GEOMETRIES.queen;
  const planned = planBedroom(room, level, bedType, dimensions, large, opts);
  if (planned) { list.push(...planned); return; }
  const anchor = rectOf(room);
  const entrySide = doorSideForRoom(room, level, anchor);
  const preferVertical = anchor.h > anchor.w && anchor.w < 11;
  let bedW = dimensions.widthFt;
  let bedH = dimensions.lengthFt;
  if (preferVertical) {
    const tmp = bedW;
    bedW = bedH;
    bedH = tmp;
  }
  const inset = 0.75;
  const bed = centeredRect(anchor, bedW, bedH, 1);

  if (preferVertical) {
    bed.y = anchor.y + (anchor.h - bed.h) / 2;
    if (entrySide === 'left') bed.x = anchor.x + anchor.w - bed.w - inset;
    else bed.x = anchor.x + inset;
  } else {
    bed.x = anchor.x + (anchor.w - bed.w) / 2;
    if (entrySide === 'top') bed.y = anchor.y + anchor.h - bed.h - inset;
    else bed.y = anchor.y + inset;
  }
  const clampedBed = { ...bed, w: bedW, h: bedH };
  // Rotation names the headboard wall (0 N, 90 E, 180 S, 270 W): the wall the bed is against.
  const rotation = preferVertical ? (entrySide === 'left' ? 90 : 270) : (entrySide === 'top' ? 180 : 0);
  list.push(makeItem(room, `bed_${bedType}`, clampedBed, { rotation }));

  const nightW = 1.5;
  const nightH = 1.5;
  if (!preferVertical) {
    const leftNight = clampRect(anchor, clampedBed.x - nightW - 0.35, clampedBed.y + 0.5, nightW, nightH, 0.5);
    const rightNight = clampRect(anchor, clampedBed.x + clampedBed.w + 0.35, clampedBed.y + 0.5, nightW, nightH, 0.5);
    if (leftNight.x + leftNight.w <= clampedBed.x - 0.1) list.push(makeItem(room, 'nightstand', leftNight));
    if (rightNight.x >= clampedBed.x + clampedBed.w + 0.1) list.push(makeItem(room, 'nightstand', rightNight));
  }

  if (anchor.w >= 11) {
    const dresser = clampRect(anchor, anchor.x + 1, anchor.y + 1, Math.min(5, anchor.w - 2), 2, 0.5);
    list.push(makeItem(room, 'dresser', dresser));
  }
}

// Living rooms, dining rooms and kitchens choose from every wall and position
// (lib/publicRoomPlacement.js) when the level is known; the simple rules below
// remain the fallback.
// The same room recurs across the candidate plans of one request: results are
// remembered by the room's geometry, doorways, windows and open sides.
const PUBLIC_MEMO = new Map();
function plannedPublic(room, level, opts, planner, tag = planner.name) {
  if (!level || opts?.legacy) return null;
  const clearParts = clearPartsFor(level, room);
  if (Array.isArray(clearParts) && !clearParts.length) return null;
  const zones = doorClearances(room, level);
  const ctx = roomContext(room, level, { openConcept: Boolean(opts?.openConcept), fits: (q) => fitsRoom(q, room, clearParts), zones });
  const r2 = (v) => Math.round(num(v) * 100) / 100;
  const box = (q) => [r2(q.x), r2(q.y), r2(q.w), r2(q.h)];
  const key = JSON.stringify([tag, clearParts ? clearParts.map(box) : null, ctx.parts.map(box), ctx.doors.map((d) => [r2(d.x), r2(d.y), d.dir, r2(d.width), Boolean(d.openThreshold)]),
    (level.windows || []).filter((w) => String(w.roomId) === String(room.id)).map((w) => [r2(w.x), r2(w.y), w.dir, r2(w.width)]), ctx.opens, zones.map(box)]);
  let items = PUBLIC_MEMO.get(key);
  if (items === undefined) {
    items = planner(ctx);
    if (PUBLIC_MEMO.size >= 2000) PUBLIC_MEMO.delete(PUBLIC_MEMO.keys().next().value);
    PUBLIC_MEMO.set(key, items);
  }
  return items ? items.map(({ kind, back, rotation, stacked, ...q }) => makeItem(room, kind, q, {
    planned: true, ...(back ? { back } : {}), ...(rotation !== undefined ? { rotation } : {}), ...(stacked ? { stacked } : {}) })) : null;
}

function addLivingFurniture(room, list, level = null, opts = {}) {
  const planned = plannedPublic(room, level, opts, planLiving);
  if (planned) { list.push(...planned); return; }
  const anchor = largestPartOf(room);
  if (anchor.w < 10 || anchor.h < 10) return;
  const sofaHorizontal = anchor.w >= anchor.h;
  const sofa = sofaHorizontal
    ? clampRect(anchor, anchor.x + (anchor.w - 8) / 2, anchor.y + anchor.h - 4.25, 8, 3, 1)
    : clampRect(anchor, anchor.x + anchor.w - 4.25, anchor.y + (anchor.h - 8) / 2, 3, 8, 1);
  list.push(makeItem(room, 'sofa', sofa));
  const coffee = centeredRect(anchor, sofaHorizontal ? 4 : 3, sofaHorizontal ? 2 : 4, 1.25);
  list.push(makeItem(room, 'coffee_table', coffee));
  const console = sofaHorizontal
    ? clampRect(anchor, anchor.x + (anchor.w - 6) / 2, anchor.y + 1, 6, 1.5, 0.75)
    : clampRect(anchor, anchor.x + 1, anchor.y + (anchor.h - 6) / 2, 1.5, 6, 0.75);
  list.push(makeItem(room, 'console', console));
}

function addDiningFurniture(room, list, level = null, opts = {}) {
  const anchor = largestPartOf(room);
  if (anchor.w < 8 || anchor.h < 8) return;
  const planned = room.publicSpaceForFeaturePair ? null : plannedPublic(room, level, opts, planDining);
  if (planned) { list.push(...planned); return; }
  if (room.publicSpaceForFeaturePair) {
    // Keep all eight seats around one full-size table. The whole arrangement
    // is fitted as an assembly below, rather than scattering chairs to fit.
    const horizontal = anchor.w >= anchor.h;
    const cx = anchor.x + anchor.w / 2, cy = anchor.y + anchor.h / 2;
    list.push(makeItem(room, 'dining_table', {
      x: cx - (horizontal ? 4 : 2), y: cy - (horizontal ? 2 : 4),
      w: horizontal ? 8 : 4, h: horizontal ? 4 : 8,
    }));
    const seats = [-3, 0, 3].flatMap(u => [[u, -3.1], [u, 3.1]]);
    seats.push([-5.1, 0], [5.1, 0]);
    seats.forEach(([u, v], index) => list.push(makeItem(room, `chair_${index + 1}`, {
      x: cx + (horizontal ? u : v) - 0.75,
      y: cy + (horizontal ? v : u) - 0.75, w: 1.5, h: 1.5,
    })));
    return;
  }
  const table = anchor.w >= anchor.h
    ? centeredRect(anchor, Math.min(7, anchor.w - 2), 3.5, 1)
    : centeredRect(anchor, 4.5, 4.5, 1);
  list.push(makeItem(room, 'dining_table', table));

  const chairW = 1.5;
  const chairH = 1.5;
  const chairs = [
    clampRect(anchor, table.x + 0.35, table.y - chairH - 0.35, chairW, chairH, 0.5),
    clampRect(anchor, table.x + table.w - chairW - 0.35, table.y - chairH - 0.35, chairW, chairH, 0.5),
    clampRect(anchor, table.x + 0.35, table.y + table.h + 0.35, chairW, chairH, 0.5),
    clampRect(anchor, table.x + table.w - chairW - 0.35, table.y + table.h + 0.35, chairW, chairH, 0.5),
  ];
  chairs.forEach((chair, index) => list.push(makeItem(room, `chair_${index + 1}`, chair)));
}

function addKitchenFurniture(room, list, level = null, opts = {}) {
  const planned = plannedPublic(room, level, opts, planKitchen);
  if (planned) { list.push(...planned); return; }
  const anchor = largestPartOf(room);
  if (anchor.w < 8 || anchor.h < 8) return;
  const counterHorizontal = anchor.w >= anchor.h;
  const counter = counterHorizontal
    ? clampRect(anchor, anchor.x + 0.75, anchor.y + 0.75, Math.min(anchor.w - 1.5, 8), 2, 0.5)
    : clampRect(anchor, anchor.x + 0.75, anchor.y + 0.75, 2, Math.min(anchor.h - 1.5, 8), 0.5);
  list.push(makeItem(room, 'counter', counter));

  // Appliances along the counter: fridge at one end, stove partway along.
  const appSize = 2.5; // ft — standard appliance width footprint
  if (counterHorizontal) {
    if (counter.w >= 5) {
      const fridge = clampRect(anchor,
        counter.x + counter.w - appSize, counter.y, appSize, 2.5, 0.25);
      list.push(makeItem(room, 'refrigerator', fridge));
    }
    if (counter.w >= 7) {
      const stove = clampRect(anchor,
        counter.x + 1.5, counter.y, 2.5, 2.5, 0.25);
      list.push(makeItem(room, 'stove', stove));
    }
  } else {
    if (counter.h >= 5) {
      const fridge = clampRect(anchor,
        counter.x, counter.y + counter.h - appSize, 2.5, appSize, 0.25);
      list.push(makeItem(room, 'refrigerator', fridge));
    }
    if (counter.h >= 7) {
      const stove = clampRect(anchor,
        counter.x, counter.y + 1.5, 2.5, 2.5, 0.25);
      list.push(makeItem(room, 'stove', stove));
    }
  }

  if (anchor.w >= 10 && anchor.h >= 10) {
    const island = centeredRect(anchor, Math.min(6, anchor.w - 3), 3, 1.25);
    list.push(makeItem(room, 'kitchen_island', island));
  }
}

function addOfficeFurniture(room, list, level = null, opts = {}) {
  const planned = plannedPublic(room, level, opts, planStudy);
  if (planned) { list.push(...planned); return; }
  const anchor = largestPartOf(room);
  if (anchor.w < 7 || anchor.h < 7) return;
  const desk = clampRect(anchor, anchor.x + 1, anchor.y + 1, Math.min(6, anchor.w - 2), 2.5, 0.75);
  list.push(makeItem(room, 'desk', desk));
  const chair = clampRect(anchor, desk.x + 1.5, desk.y + desk.h + 0.35, 2, 2, 0.5);
  list.push(makeItem(room, 'desk_chair', chair));
  const shelf = clampRect(anchor, anchor.x + anchor.w - 1.75, anchor.y + 1, 1, Math.min(anchor.h - 2, 6), 0.5);
  list.push(makeItem(room, 'bookcase', shelf));
}

function addGymFurniture(room, list) {
  const anchor = largestPartOf(room);
  if (anchor.w < 8 || anchor.h < 8) return;
  const treadmill = clampRect(anchor, anchor.x + 1, anchor.y + 1, 6, 3, 0.75);
  const mat = clampRect(anchor, anchor.x + anchor.w - 7, anchor.y + anchor.h - 3, 6, 2, 0.75);
  list.push(makeItem(room, 'treadmill', treadmill));
  list.push(makeItem(room, 'exercise_mat', mat));
}

function addPlayroomFurniture(room, list) {
  const anchor = largestPartOf(room);
  if (anchor.w < 8 || anchor.h < 8) return;
  list.push(makeItem(room, 'play_mat', centeredRect(anchor, 6, 6)));
  list.push(makeItem(room, 'toy_storage', { x: anchor.x + 0.75,
    y: anchor.y + 0.75, w: 4, h: 1.5 }));
}

function addLaundryFurniture(room, list, level = null, opts = {}) {
  const planned = plannedPublic(room, level, opts, planLaundry);
  if (planned) { list.push(...planned); return; }
  const anchor = largestPartOf(room);
  if (anchor.w < 4 || anchor.h < 4) return;
  list.push(makeItem(room, 'washer', clampRect(anchor, anchor.x + 0.75, anchor.y + 0.75, 3, 3, 0.5)));
  list.push(makeItem(room, 'dryer', clampRect(anchor, anchor.x + 3.95, anchor.y + 0.75, 3, 3, 0.5)));
  if (anchor.w >= 8) {
    list.push(makeItem(room, 'laundry_counter', clampRect(anchor, anchor.x + 0.75, anchor.y + anchor.h - 2.5, Math.min(6, anchor.w - 1.5), 1.5, 0.5)));
  }
}

function addBathroomFurniture(room, list, primary = false, level = null, opts = {}) {
  const anchor = largestPartOf(room);
  if (anchor.w < 4 || anchor.h < 4) return;
  const powder = normalizeRoomType(room.type) === 'powder_room';
  const planned = plannedPublic(room, level, opts, (ctx) => planBathroom(ctx, { primary, powder }), `bath:${primary}:${powder}`);
  if (planned) { list.push(...planned); return; }
  const entrySide = doorSideForRoom(room, level, anchor);
  if (normalizeRoomType(room.type) !== 'powder_room') {
    list.push(makeItem(room, 'shower', { x: anchor.x + anchor.w - 3.5, y: anchor.y + 0.5, w: 3, h: 3 }));
  }
  list.push(makeItem(room, 'toilet', { x: anchor.x + anchor.w - 2.5, y: anchor.y + anchor.h - 3, w: 2, h: 2.5 }));
  list.push(makeItem(room, 'vanity', { x: anchor.x + 0.5, y: anchor.y + 0.5, w: 2, h: 1.75 }));
  if (primary && anchor.w >= 7 && anchor.h >= 8) {
    const tubW = Math.min(anchor.w - 1.5, 6);
    const tubH = 2.5;
    let tubX = anchor.x + 0.75;
    let tubY = anchor.y + anchor.h - tubH - 0.75;
    if (entrySide === 'left') tubX = anchor.x + anchor.w - tubW - 0.75;
    else if (entrySide === 'right') tubX = anchor.x + 0.75;
    else if (entrySide === 'top') tubY = anchor.y + anchor.h - tubH - 0.75;
    else if (entrySide === 'bottom') tubY = anchor.y + 0.75;
    list.push(makeItem(room, 'tub', clampRect(anchor, tubX, tubY, tubW, tubH, 0.5)));
  }
}

function addEntryFurniture(room, list) {
  const anchor = largestPartOf(room);
  if (anchor.w < 7 || anchor.h < 5) return;
  list.push(makeItem(room, 'console', clampRect(anchor, anchor.x + 1, anchor.y + 1, Math.min(6, anchor.w - 2), 1.5, 0.5)));
}

function addMudroomFurniture(room, list) {
  const anchor = largestPartOf(room);
  if (anchor.w < 5 || anchor.h < 4) return;
  list.push(makeItem(room, 'bench', clampRect(anchor, anchor.x + 0.75, anchor.y + anchor.h - 2.25, Math.min(anchor.w - 1.5, 5), 1.5, 0.5)));
}

function addGarageFurniture(room, list) {
  const anchor = largestPartOf(room);
  // Require a plausible single-bay minimum (9 ft × 14 ft) to place a car.
  if (anchor.w < 9 || anchor.h < 14) return;

  // Car is narrower than it is long. Orient the long axis along the room's
  // long dimension.
  const longIsH = anchor.h >= anchor.w;
  const carW = longIsH
    ? Math.min(anchor.w - 2, 8)
    : Math.min(anchor.w - 2, 16);
  const carH = longIsH
    ? Math.min(anchor.h - 2, 16)
    : Math.min(anchor.h - 2, 8);

  // Minimum plausible car shape: ~6 ft wide × 12 ft long.
  if (carW < 6 || carH < 10) return;

  const car = centeredRect(anchor, carW, carH, 1);
  list.push(makeItem(room, 'car', car));
}

function addOutdoorFurniture(room, list) {
  const anchor = rectOf(room);
  if (anchor.w < 6 || anchor.h < 6) return;
  // Outdoor table (centered)
  const tableW = Math.min(6, anchor.w - 4);
  const tableH = Math.min(4, anchor.h - 4);
  const tableX = anchor.x + (anchor.w - tableW) / 2;
  const tableY = anchor.y + (anchor.h - tableH) / 2;
  list.push(makeItem(room, 'outdoor_table', { x: tableX, y: tableY, w: tableW, h: tableH }));
  // Two chairs on short sides
  if (anchor.w >= 10) {
    list.push(makeItem(room, 'outdoor_chair', { x: tableX - 2, y: tableY + tableH / 2 - 1, w: 2, h: 2 }));
    list.push(makeItem(room, 'outdoor_chair', { x: tableX + tableW, y: tableY + tableH / 2 - 1, w: 2, h: 2 }));
  }
}

function furnitureForRoom(room, level, opts = {}) {
  const type = normalizeRoomType(room?.type);
  const items = [];

  if (type === 'living_room') addLivingFurniture(room, items, level, opts);
  else if (type === 'dining_room') addDiningFurniture(room, items, level, opts);
  else if (type === 'kitchen') addKitchenFurniture(room, items, level, opts);
  else if (type === 'primary_bedroom') addBedroomFurniture(room, items, true, level, opts);
  else if (type === 'bedroom' || type === 'guest_bedroom') addBedroomFurniture(room, items, false, level, opts);
  else if (type === 'study' || type === 'library') addOfficeFurniture(room, items, level, opts);
  else if (type === 'gaming_room') addOfficeFurniture(room, items, level, opts);
  else if (type === 'playroom') addPlayroomFurniture(room, items);
  else if (type === 'gym') addGymFurniture(room, items);
  else if (type === 'laundry') addLaundryFurniture(room, items, level, opts);
  else if (type === 'primary_bathroom') addBathroomFurniture(room, items, true, level, opts);
  else if (type === 'bathroom' || type === 'powder_room') addBathroomFurniture(room, items, false, level, opts);
  else if (type === 'entry') addEntryFurniture(room, items);
  else if (type === 'mudroom') addMudroomFurniture(room, items);
  else if (type === 'garage') addGarageFurniture(room, items);
  else if (type === 'closet' && closetLayout(room)) items.push(makeItem(room, 'closet_storage', closetLayout(room).storage));
  else if (isOutdoorType(type)) addOutdoorFurniture(room, items);

  return items;
}

// Pieces the plan cannot pass without (validatePlan's required furnishings).
function requiredKind(room, kind) {
  const type = normalizeRoomType(room.type);
  if (/^bed_/.test(kind)) return true;
  if (kind === 'kitchen_run' || kind === 'dining_assembly') return true;
  const need = {
    bathroom: ['shower', 'toilet', 'vanity'], primary_bathroom: ['shower', 'toilet', 'vanity'], powder_room: ['toilet', 'vanity'],
    kitchen: ['counter', 'stove', 'refrigerator'], study: ['desk', 'desk_chair'], library: ['desk', 'desk_chair'], gaming_room: ['desk', 'desk_chair'],
    playroom: ['play_mat', 'toy_storage'], living_room: ['sofa', 'coffee_table'], laundry: ['washer', 'dryer', 'stacked_washer_dryer'],
  }[type] || [];
  return need.includes(kind);
}

function applyFurnitureLayout(planSpec) {
  if (!planSpec || !Array.isArray(planSpec.levels)) return planSpec;

  const allFurniture = [];
  const omitted = [];
  // A hand edit keeps the furniture of the rooms it did not change
  // (lib/planEdit/recomputeEditedPlan.js), so the plan does not reshuffle.
  const keep = Array.isArray(planSpec.editFurnitureKeep) ? new Set(planSpec.editFurnitureKeep.map(String)) : null;
  if (keep) omitted.push(...(planSpec.furnitureDiagnostics?.omitted || []).filter((o) => keep.has(String(o.roomId)) || o.userPlaced));
  // Open-plan public rooms have open sides instead of walls (as the 3D model draws them).
  const opts = { openConcept: planSpec.openConcept === true || /open/i.test(String(planSpec.openConcept || planSpec.designSurvey?.openConcept || '')) };
  for (const level of planSpec.levels) {
    const levelFurniture = [];
    // One room: fit its pieces (kitchen runs and the feature-pair dining set as assemblies).
    const placeRoom = (room, items) => {
      const out = { placed: [], omitted: [] };
      if (room.type === 'dining_room' && room.publicSpaceForFeaturePair && items.length) {
        const x = Math.min(...items.map(item => item.x));
        const y = Math.min(...items.map(item => item.y));
        const assembly = { id: `${room.id}_dining_assembly`, roomId: room.id,
          kind: 'dining_assembly', x, y,
          w: Math.max(...items.map(item => item.x + item.w)) - x,
          h: Math.max(...items.map(item => item.y + item.h)) - y };
        const fitted = placeFurnitureWithoutCollisions(room, level, [assembly]);
        if (fitted.items.length) {
          const placed = fitted.items[0];
          out.placed.push(...items.map(item => ({ ...item,
            x: item.x + placed.x - x, y: item.y + placed.y - y, assemblyId: assembly.id })));
        }
        out.omitted.push(...fitted.omitted);
        return out;
      }
      if (normalizeRoomType(room.type) === 'kitchen') {
        // Move the counter and its integrated appliances as one assembly, so
        // clearing a door never separates the cooktop/fridge from the run.
        const members = items.filter(item => ['counter', 'stove', 'refrigerator'].includes(item.kind));
        if (members.length) {
          const x = Math.min(...members.map(item => item.x));
          const y = Math.min(...members.map(item => item.y));
          const run = { id: `${room.id}_kitchen_run`, roomId: room.id, kind: 'kitchen_run', x, y,
            w: Math.max(...members.map(item => item.x + item.w)) - x,
            h: Math.max(...members.map(item => item.y + item.h)) - y };
          const extras = items.filter(item => !members.includes(item));
          const fitted = placeFurnitureWithoutCollisions(room, level, [run, ...extras]);
          const placedRun = fitted.items.find(item => item.kind === 'kitchen_run');
          if (placedRun) {
            out.placed.push(...members.map(item => ({ ...item,
              x: item.x + placedRun.x - x, y: item.y + placedRun.y - y, assemblyId: run.id })));
          }
          out.placed.push(...fitted.items.filter(item => item.kind !== 'kitchen_run'));
          out.omitted.push(...fitted.omitted);
          return out;
        }
      }
      if (CHECKED_ROOM_TYPES.includes(normalizeRoomType(room.type))) {
        const fitted = placeFurnitureWithoutCollisions(room, level, items);
        // Use an explicit stacked unit when two full-size appliance footprints
        // cannot coexist. Never shrink or overlap the washer and dryer symbols.
        if (room.type === 'laundry' && fitted.omitted.some(item => item.kind === 'dryer')) {
          const washer = fitted.items.find(item => item.kind === 'washer');
          if (washer) {
            washer.kind = 'stacked_washer_dryer';
            washer.stacked = true;
            fitted.omitted = fitted.omitted.filter(item => item.kind !== 'dryer');
          }
        }
        out.placed.push(...fitted.items);
        out.omitted.push(...fitted.omitted);
      } else {
        out.placed.push(...items);
      }
      return out;
    };
    const previous = level.furniture || [];
    for (const room of Array.isArray(level?.rooms) ? level.rooms : []) {
      // A room a person furnished by hand keeps their pieces, fitted back
      // inside if its walls moved (lib/pinnedFurniture.js).
      if (room.furnitureEdited) {
        const { placed, dropped } = refitArranged(room, level, previous.filter((item) => String(item.roomId) === String(room.id)));
        levelFurniture.push(...placed);
        omitted.push(...dropped.map((item) => ({ roomId: room.id, kind: item.kind, itemId: item.id, userPlaced: true,
          reason: 'A piece placed by hand no longer fits in the room.' })));
        continue;
      }
      const kept = keep?.has(String(room.id)) ? previous.filter((item) => String(item.roomId) === String(room.id)) : [];
      if (kept.length) { levelFurniture.push(...kept); continue; }
      let items = furnitureForRoom(room, level, opts);
      let out = placeRoom(room, items);
      // A planned layout that would lose a required piece to the collision pass
      // keeps the simple placement instead, so which plans pass never changes.
      if (items.some((item) => item.planned) && out.omitted.some((o) => requiredKind(room, o.kind))) {
        items = furnitureForRoom(room, level, { ...opts, legacy: true });
        out = placeRoom(room, items);
      }
      levelFurniture.push(...out.placed);
      omitted.push(...out.omitted);
    }
    level.furniture = levelFurniture;
    allFurniture.push({
      level: num(level?.level, 1),
      items: levelFurniture,
    });
  }

  planSpec.furniture = allFurniture;
  planSpec.furnitureDiagnostics = { omitted };
  return planSpec;
}

module.exports = {
  applyFurnitureLayout,
  furnitureForRoom,
};
