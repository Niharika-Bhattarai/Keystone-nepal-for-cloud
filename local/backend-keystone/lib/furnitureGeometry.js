'use strict';

const { wallModelForLevel } = require('./geometry/wallModel');
const { closetLayout } = require('./closetGeometry');
const { BED_GEOMETRIES } = require('./residential/contractGeometry');

const EPS = 1e-6;
const GAP = 0.25;

/* Finished clear space per room (execution plan P04, item 4).
 *
 * Furniture used to be fitted inside the nominal room rectangle inset by a flat
 * 0.25 ft on every side - a stand-in for wall thickness that is wrong in both
 * directions. A 2x4 partition takes 0.19 ft per side and a 2x6 exterior wall
 * takes 0.30 ft, so the old figure gave away space against interior walls and
 * borrowed it against exterior ones. A bed that "fits" against a line with no
 * thickness is not a bed that fits.
 *
 * The wall model is built once per level and cached: it is quadratic in room
 * count, and every room on the level asks for it.
 *
 * Unversioned nominal plans keep their original inset. Explicitly migrated
 * levels fail closed when their clear geometry is missing or collapsed.
 */
function clearPartsFor(level, room) {
  if (!level || typeof level !== 'object' || !room) return null;
  // Existing generated plans use nominal geometry. Enable enforcement only
  // for an explicitly migrated model, after openings/stairs/rendering agree.
  // Missing or collapsed clear geometry on such a model fails closed.
  if (level.finishedFaceGeometryVersion !== 1) return null;
  const model = wallModelForLevel(level);
  if (model.errors.length) return [];
  const entry = (model.roomClear || []).find((r) => String(r.roomId) === String(room.id));
  return entry ? entry.parts : [];
}

function intersects(a, b, gap = 0) {
  // Door zones already include the approach space. Keep the actual leaf sweep
  // unobstructed without adding furniture-to-furniture spacing to its radius.
  if (b.doorClearance) gap = 0;
  if (b.sector) {
    if (!intersects(a, { x: b.x, y: b.y, w: b.w, h: b.h }, gap)) return false;
    const x = Math.max(a.x - gap, Math.min(a.x + a.w + gap, b.sector.x));
    const y = Math.max(a.y - gap, Math.min(a.y + a.h + gap, b.sector.y));
    return (x - b.sector.x) ** 2 + (y - b.sector.y) ** 2 < b.sector.radius ** 2 - EPS;
  }
  return a.x < b.x + b.w + gap - EPS && a.x + a.w > b.x - gap + EPS &&
    a.y < b.y + b.h + gap - EPS && a.y + a.h > b.y - gap + EPS;
}

function partsOf(room) {
  return room.parts?.length ? room.parts : [room];
}

// Keep the doorway throat clear on both sides and the actual quarter-circle
// swing clear in the receiving room, matching the SVG's hinge/swing convention.
function doorClearances(room, level) {
  const boxes = [];
  for (const closet of level.rooms || []) {
    if (closet.ownerBedroomId === room.id && closet.closetType === 'reach_in') {
      const layout = closetLayout(closet);
      if (layout) boxes.push({ ...layout.access, doorClearance: true });
    }
  }
  for (const door of level.doors || []) {
    if (![door.a, door.b].map(String).includes(String(room.id)) || door.garageDoor) continue;
    const width = Number(door.width || 3);
    const depth = door.openThreshold ? Math.min(width, 3) : 1.5;
    if (door.dir === 'vertical') {
      boxes.push({ x: door.x - depth, y: door.y - width / 2, w: depth * 2, h: width });
    } else {
      boxes.push({ x: door.x - width / 2, y: door.y - depth, w: width, h: depth * 2 });
    }
    if (door.openThreshold || door.slidingDoor || door.sliding) continue;
    const a = level.rooms.find(r => String(r.id) === String(door.a));
    const b = level.rooms.find(r => String(r.id) === String(door.b));
    const privateRoom = r => /bedroom|bathroom|study|powder|garage/.test(r?.type || '');
    const target = privateRoom(a) && !privateRoom(b) ? a : (b || a);
    const closetFront = a?.type === 'closet' && a.ownerBedroomId === b?.id ? a.closetFront : null;
    if (String(target?.id) !== String(room.id)) continue;
    if (door.dir === 'vertical') {
      const right = closetFront ? closetFront === 'right' : room.x + room.w / 2 > door.x;
      boxes.push({ x: right ? door.x : door.x - width, y: door.y - width / 2, w: width, h: width,
        sector: { x: door.x, y: door.y - width / 2, radius: width } });
    } else {
      const down = closetFront ? closetFront === 'bottom' : room.y + room.h / 2 > door.y;
      boxes.push({ x: door.x - width / 2, y: down ? door.y : door.y - width, w: width, h: width,
        sector: { x: door.x - width / 2, y: door.y, radius: width } });
    }
  }
  return boxes.map(box => ({ ...box, doorClearance: true }));
}

function fitsRoom(item, room, clearParts = null) {
  if (![item.x, item.y, item.w, item.h].every(Number.isFinite) || item.w <= 0 || item.h <= 0) return false;
  /* With finished geometry the walls are already subtracted, so the item is
     tested against the clear polygon directly. Without it, fall back to the
     old flat inset. */
  const useClear = Array.isArray(clearParts);
  if (useClear && !clearParts.length) return false;
  const parts = useClear ? clearParts : partsOf(room);
  const inset = useClear ? 0 : 0.25;
  if (parts.some(p => item.x >= p.x + inset - EPS && item.y >= p.y + inset - EPS &&
    item.x + item.w <= p.x + p.w - inset + EPS && item.y + item.h <= p.y + p.h - inset + EPS)) return true;
  if (parts.length === 1) return false;
  const left = item.x - inset, right = item.x + item.w + inset;
  const top = item.y - inset, bottom = item.y + item.h + inset;
  const cuts = [...new Set([left, right, ...parts.flatMap(p => [p.x, p.x + p.w]).filter(x => x > left && x < right)])].sort((a,b)=>a-b);
  for (let i = 1; i < cuts.length; i++) {
    const mid = (cuts[i-1] + cuts[i]) / 2;
    const intervals = parts.filter(p => mid >= p.x && mid <= p.x + p.w)
      .map(p => [Math.max(top,p.y),Math.min(bottom,p.y+p.h)]).filter(([a,b])=>b>a).sort((a,b)=>a[0]-b[0]);
    let coveredTo = top;
    for (const [start,end] of intervals) {
      if (start > coveredTo + EPS) return false;
      coveredTo = Math.max(coveredTo,end);
    }
    if (coveredTo < bottom - EPS) return false;
  }
  return true;
}

/* Coarse scan is 6 in. With finished faces the usable rectangle is offset by
   the wall half-thickness - about 2 to 4 in, and different on each side - so a
   position that was valid against the nominal rectangle can shift out of reach
   of a 6 in grid while a legal one sits between its steps. `step` allows the
   2 in refinement pass the caller makes when the coarse scan finds nothing. */
function candidatePositions(item, room, obstacles, clearParts = null, step = 0.5) {
  const result = [{ ...item }];
  /* Scan the finished clear polygon when one is available; the walls are
     already removed from it, so no further inset applies. */
  const scanParts = Array.isArray(clearParts) ? clearParts : partsOf(room);
  const scanInset = Array.isArray(clearParts) ? 0 : 0.25;
  for (const part of scanParts.length > 1 ? [...scanParts, ...(clearParts ? [] : [room])] : scanParts) {
    const xs = new Set([item.x, part.x + scanInset, part.x + part.w - item.w - scanInset,
      part.x + scanInset + 0.25, part.x + part.w - item.w - scanInset - 0.25,
      part.x + (part.w - item.w) / 2]);
    const ys = new Set([item.y, part.y + scanInset, part.y + part.h - item.h - scanInset,
      part.y + scanInset + 0.25, part.y + part.h - item.h - scanInset - 0.25,
      part.y + (part.h - item.h) / 2]);
    if (/bathroom|powder/.test(room.type)) {
      for (let x = part.x + scanInset; x + item.w <= part.x + part.w - scanInset; x += step) xs.add(x);
      for (let y = part.y + scanInset; y + item.h <= part.y + part.h - scanInset; y += step) ys.add(y);
    }
    for (const obstacle of obstacles) {
      xs.add(obstacle.x - item.w - GAP); xs.add(obstacle.x + obstacle.w + GAP);
      ys.add(obstacle.y - item.h - GAP); ys.add(obstacle.y + obstacle.h + GAP);
    }
    for (const x of xs) for (const y of ys) result.push({ ...item, x, y });
  }
  return result.filter(candidate => fitsRoom(candidate, room, clearParts))
    .sort((a, b) => Math.abs(a.x - item.x) + Math.abs(a.y - item.y) -
      Math.abs(b.x - item.x) - Math.abs(b.y - item.y));
}

function bedClearanceEnvelope(item, room) {
  const side = Number(room.roomContract?.sideClearanceFt || 2.5), foot = Number(room.roomContract?.footClearanceFt || 2);
  if (item.rotation === 90 || item.rotation === 270) return { ...item,
    x: item.x - (item.rotation === 90 ? foot : 0), y: item.y - side, w: item.w + foot, h: item.h + side * 2 };
  return { ...item, x: item.x - side, y: item.y - (item.rotation === 180 ? foot : 0), w: item.w + side * 2, h: item.h + foot };
}

function bedroomHasCloset(room, level) {
  return (level.rooms || []).some(r => r.type === 'closet' && r.ownerBedroomId === room.id);
}

function placeFurnitureWithoutCollisions(room, level, items, tryAlternatives = true) {
  const doorZones = doorClearances(room, level);
  const clearParts = clearPartsFor(level, room);
  const placed = [];
  const omitted = [];
  for (const item of items) {
    const obstacles = [...doorZones, ...placed];
    if (item.kind !== 'nightstand' && bedroomHasCloset(room, level)) {
      obstacles.push(...placed.filter(f => f.kind.startsWith('bed_')).map(f => bedClearanceEnvelope(f, room)));
    }
    const checkBed = item.kind.startsWith('bed_') && bedroomHasCloset(room, level);
    const usable = candidate => !checkBed || fitsRoom(bedClearanceEnvelope(candidate, room), room, clearParts);
    if (fitsRoom(item, room, clearParts) && usable(item) && !obstacles.some(obstacle => intersects(item, obstacle, GAP))) {
      placed.push(item);
      continue;
    }
    const scan = (stepFt) => {
      if (checkBed) {
        // Search the full bed-and-clearance envelope inside the remaining
        // composite bedroom, then test the actual bed against door swings.
        const sideways = item.rotation === 90 || item.rotation === 270;
        const width = sideways ? item.h : item.w, length = sideways ? item.w : item.h;
        return [0, 90, 180, 270].flatMap(rotation => {
          const bed = { ...item, rotation, w: rotation % 180 ? length : width, h: rotation % 180 ? width : length };
          const envelope = bedClearanceEnvelope(bed, room);
          return candidatePositions(envelope, room, [], clearParts, stepFt).map(p => ({ ...bed,
            x: p.x + bed.x - envelope.x, y: p.y + bed.y - envelope.y }));
        });
      }
      const found = candidatePositions(item, room, obstacles, clearParts, stepFt);
      if (item.kind === 'toilet' || item.kind.startsWith('bed_')) {
        found.push(...candidatePositions(
          { ...item, w: item.h, h: item.w, rotation: item.rotation === 90 ? 0 : 90 },
          room, obstacles, clearParts, stepFt,
        ));
      }
      return found;
    };
    const positions = scan(0.5);
    let fitted = positions
      .find(candidate => usable(candidate) && !obstacles.some(obstacle => intersects(candidate, obstacle, GAP)));
    /* Two-inch refinement, only where the coarse grid failed. Confined to the
       rooms whose fixtures are genuinely tight; running it everywhere would
       multiply the search for no benefit. */
    if (!fitted && clearParts && /bathroom|powder|laundry|mudroom|entry/.test(String(room.type))) {
      fitted = scan(1 / 6)
        .find(candidate => !obstacles.some(obstacle => intersects(candidate, obstacle, GAP)));
    }
    if (fitted) placed.push(fitted);
    else omitted.push({ roomId: room.id, kind: item.kind, reason: 'No placement clears room boundaries, doors, and other furniture.' });
  }
  let result = { items: placed, omitted };
  const essential = item => ['shower', 'toilet', 'vanity'].includes(item.kind);
  if (tryAlternatives && /bathroom|powder/.test(room.type) && omitted.some(essential)) {
    const fixtures = items.filter(essential);
    const extras = items.filter(item => !essential(item));
    /* The backtracking packer has to search the same geometry the placement
       validates against. It used to generate candidates against the nominal
       rectangle and hand them to a pass that checks finished faces, so every
       proposal was rejected and a bathroom with over a thousand legal toilet
       positions reported that none existed. */
    const choices = fixtures.map(item => {
      const candidates = candidatePositions(item, room, doorZones, clearParts);
      if (item.kind === 'toilet') candidates.push(...candidatePositions({ ...item, w: item.h, h: item.w, rotation: 90 }, room, doorZones, clearParts));
      if (clearParts && candidates.length < 8) {
        candidates.push(...candidatePositions(item, room, doorZones, clearParts, 1 / 6));
      }
      return candidates.filter(candidate => !doorZones.some(zone => intersects(candidate, zone, GAP)));
    }).sort((a, b) => a.length - b.length);
    /* Budget for the backtracking search. Finished-face geometry and the 2 in
       refinement produce far longer candidate lists than the nominal 6 in grid
       did, and the old 10,000 was exhausted before a legal set was reached -
       which is reported as "cannot fit" and is indistinguishable from a room
       that genuinely has no arrangement. Exhaustion is still possible; it is a
       search limit, not proof of impossibility. */
    let remaining = clearParts ? 50000 : 10000;
    function pack(index, selected) {
      if (index === choices.length) return selected;
      for (const candidate of choices[index]) {
        if (--remaining < 0) return null;
        if (selected.some(previous => intersects(candidate, previous, GAP))) continue;
        const solution = pack(index + 1, [...selected, candidate]);
        if (solution) return solution;
      }
      return null;
    }
    const packed = pack(0, []);
    if (packed) result = placeFurnitureWithoutCollisions(room, level, [...packed, ...extras], false);
  }
  return result;
}

function validateFurnitureGeometry(level, roomTypes = null) {
  const errors = [];
  for (const room of level.rooms || []) {
    if (roomTypes && !roomTypes.includes(room.type)) continue;
    const furniture = (level.furniture || []).filter(item => String(item.roomId) === String(room.id));
    const zones = doorClearances(room, level);
    // Validate against the same finished geometry the placement used, or the
    // two disagree and a legally placed item is reported as outside its room.
    const clearParts = clearPartsFor(level, room);
    for (const [index, item] of furniture.entries()) {
      if (!fitsRoom(item, room, clearParts)) errors.push(`Furniture outside room: ${item.id}`);
      if (item.kind.startsWith('bed_') && bedroomHasCloset(room, level)) {
        const bed = BED_GEOMETRIES[item.kind.slice(4)];
        const expected = item.rotation === 90 || item.rotation === 270 ? [bed?.lengthFt, bed?.widthFt] : [bed?.widthFt, bed?.lengthFt];
        if (!bed || Math.abs(item.w - expected[0]) > EPS || Math.abs(item.h - expected[1]) > EPS ||
          !fitsRoom(bedClearanceEnvelope(item, room), room, clearParts)) errors.push(`Bedroom closet leaves inadequate bed clearances: ${room.id}`);
        const envelope = bedClearanceEnvelope(item, room);
        if (furniture.some(other => other !== item && other.kind !== 'nightstand' && intersects(other, envelope))) {
          errors.push(`Furniture obstructs bed access beside closet: ${room.id}`);
        }
      }
      if (zones.some(zone => intersects(item, zone))) errors.push(`Furniture blocks doorway: ${item.id}`);
      for (const previous of furniture.slice(0, index)) {
        // Counter runs include appliance cutouts. Their shared assembly is
        // fitted as a whole; the appliance symbols intentionally overlay it.
        if (item.assemblyId && item.assemblyId === previous.assemblyId &&
          (item.kind === 'counter' || previous.kind === 'counter')) continue;
        if (intersects(item, previous)) errors.push(`Furniture overlaps: ${previous.id} and ${item.id}`);
      }
    }
  }
  return errors;
}

const CHECKED_ROOM_TYPES = ['bedroom', 'primary_bedroom', 'guest_bedroom', 'bathroom', 'primary_bathroom', 'powder_room', 'laundry', 'entry', 'mudroom', 'kitchen', 'study', 'library', 'gaming_room', 'playroom', 'living_room'];

function validateRequiredFurniture(plan) {
  if (!plan.furnitureDiagnostics) return [];
  const errors = [];
  for (const level of plan.levels || []) {
    errors.push(...validateFurnitureGeometry(level, CHECKED_ROOM_TYPES));
    for (const room of level.rooms || []) {
      const kinds = new Set((level.furniture || []).filter(item => String(item.roomId) === String(room.id)).map(item => item.kind));
      let required = [];
      if (['bathroom', 'primary_bathroom'].includes(room.type)) required = ['shower', 'toilet', 'vanity'];
      else if (room.type === 'kitchen') required = ['counter', 'stove', 'refrigerator'];
      else if (room.type === 'powder_room') required = ['toilet', 'vanity'];
      else if (['study', 'library', 'gaming_room'].includes(room.type)) required = ['desk', 'desk_chair'];
      else if (room.type === 'playroom') required = ['play_mat', 'toy_storage'];
      else if (room.type === 'living_room' && room.featureBufferDepthFt) required = ['sofa'];
      else if (room.type === 'laundry' && !kinds.has('stacked_washer_dryer')) required = ['washer', 'dryer'];
      else if (['bedroom', 'primary_bedroom', 'guest_bedroom'].includes(room.type) && ![...kinds].some(kind => kind.startsWith('bed_'))) required = ['bed'];
      for (const kind of required) if (!kinds.has(kind)) errors.push(`Required furnishing cannot fit: ${room.id} needs ${kind}`);
    }
  }
  return errors;
}

module.exports = { CHECKED_ROOM_TYPES, clearPartsFor, doorClearances, intersects, fitsRoom, bedClearanceEnvelope, placeFurnitureWithoutCollisions, validateFurnitureGeometry, validateRequiredFurniture };
