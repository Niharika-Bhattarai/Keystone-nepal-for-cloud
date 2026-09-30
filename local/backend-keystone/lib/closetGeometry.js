'use strict';

const { partListOf } = require('./planGeometry');
const { containsRect, intersection } = require('./geometry/rectBoolean');
const { hostSegments, openingSpan } = require('./openingGeometry');

// Concept dimensions in feet, measured in the existing nominal room model.
// A 3 in perimeter allowance leaves 24 in hanging depth; walk-ins reserve
// at least 36 in beyond the storage. This is not a finished-wall certification.
const INSET = 0.25;
const STORAGE_DEPTH = 2;
const AISLE = 3;
const BEDROOM_TYPES = ['bedroom', 'primary_bedroom'];
function closetType(value) {
  if (['Walk-in', 'walk_in'].includes(value)) return 'walk_in';
  if (['Standard', 'Small', 'reach_in'].includes(value)) return 'reach_in';
  return null;
}

function closetLayout(room) {
  if (room?.type !== 'closet' || !room.ownerBedroomId || !['walk_in', 'reach_in'].includes(room.closetType)) return null;
  const { x, y, w, h } = room;
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0 || room.parts?.length) return null;
  const front = room.closetFront;
  if (!['top', 'bottom', 'left', 'right'].includes(front)) return null;
  const horizontal = front === 'top' || front === 'bottom';
  const along = (horizontal ? w : h) - INSET * 2;
  const depth = (horizontal ? h : w) - INSET * 2;
  const storage = { x: x + INSET, y: y + INSET, w: w - INSET * 2, h: h - INSET * 2 };
  if (horizontal) { storage.h = STORAGE_DEPTH; if (front === 'top') storage.y = y + h - INSET - STORAGE_DEPTH; }
  else { storage.w = STORAGE_DEPTH; if (front === 'left') storage.x = x + w - INSET - STORAGE_DEPTH; }
  const walk = room.closetType === 'walk_in';
  let access;
  if (walk) {
    access = { x: x + INSET, y: y + INSET, w: w - INSET * 2, h: h - INSET * 2 };
    if (horizontal) { access.h -= STORAGE_DEPTH; if (front === 'bottom') access.y += STORAGE_DEPTH; }
    else { access.w -= STORAGE_DEPTH; if (front === 'right') access.x += STORAGE_DEPTH; }
  } else {
    access = horizontal
      ? { x: x + INSET, y: front === 'top' ? y - AISLE : y + h, w: along, h: AISLE }
      : { x: front === 'left' ? x - AISLE : x + w, y: y + INSET, w: AISLE, h: along };
  }
  const door = { a: room.id, b: room.ownerBedroomId, dir: horizontal ? 'horizontal' : 'vertical',
    x: horizontal ? x + w / 2 : (front === 'left' ? x : x + w),
    y: horizontal ? (front === 'top' ? y : y + h) : y + h / 2,
    width: room.closetDoorWidth || 3, closetDoor: true };
  return { storage, access, door, along, depth, aisleDepth: walk ? depth - STORAGE_DEPTH : AISLE };
}

function closetDoorSwing(room, door = closetLayout(room)?.door) {
  if (!door) return null;
  const width = door.width;
  return door.dir === 'vertical'
    ? { x: door.x - (room.closetFront === 'left' ? width : 0), y: door.y - width / 2, w: width, h: width }
    : { x: door.x - width / 2, y: door.y - (room.closetFront === 'top' ? width : 0), w: width, h: width };
}

function validateCloset(level, room, expectedType = room.closetType) {
  const errors = [], prefix = `Closet ${room.id}: `;
  const owner = level.rooms.find(r => r.id === room.ownerBedroomId && BEDROOM_TYPES.includes(r.type));
  const layout = closetLayout(room);
  if (!owner || !layout) return [prefix + 'missing bedroom ownership or rectangular closet geometry.'];
  if (room.closetType !== expectedType) errors.push(prefix + 'type differs from the bedroom survey selection.');
  if (layout.along < 5 || layout.depth < STORAGE_DEPTH || (room.closetType === 'walk_in' && layout.aisleDepth < AISLE) ||
    (room.closetType === 'reach_in' && layout.depth > 2.5)) {
    errors.push(prefix + 'insufficient storage depth, hanging length or walk-in aisle.');
  }
  if (!containsRect(partListOf(room), layout.storage) || !containsRect(partListOf(room.closetType === 'walk_in' ? room : owner), layout.access)) {
    errors.push(prefix + 'storage or access space falls outside its room.');
  }
  const doors = (level.doors || []).filter(d => d.a === room.id || d.b === room.id);
  if (doors.length !== 1 || doors[0].a !== room.id || doors[0].b !== owner.id || doors[0].slidingDoor || doors[0].openThreshold) {
    errors.push(prefix + 'requires one outward-swinging door to its own bedroom, with no passage to another room.');
  } else {
    const d = doors[0], wanted = layout.door, span = openingSpan(d);
    if (![d.x, d.y, d.width, wanted.width].every(Number.isFinite) || wanted.width < 3 ||
      d.dir !== wanted.dir || Math.abs(d.x - wanted.x) > 1e-6 || Math.abs(d.y - wanted.y) > 1e-6 || d.width < wanted.width ||
      !hostSegments(level, d, 'door').some(s => s.dir === span.dir && Math.abs(s.fixed - span.fixed) < 1e-6 && span.start >= s.start + 0.5 - 1e-6 && span.end <= s.end - 0.5 + 1e-6)) {
      errors.push(prefix + 'door does not fit the closet front and jambs.');
    }
    const swing = closetDoorSwing(room, d);
    if (!swing || !containsRect(partListOf(owner), swing)) errors.push(prefix + 'outward door swing crosses a bedroom partition or exterior boundary.');
  }
  // The independently rebuilt storage and aisle must survive saved-plan edits.
  const expected = { ...layout.storage, kind: 'closet_storage' };
  const storage = (level.furniture || []).filter(f => f.roomId === room.id && f.kind === expected.kind);
  if (storage.length !== 1 || ['x', 'y', 'w', 'h'].some(k => !Number.isFinite(storage[0][k]) || Math.abs(storage[0][k] - expected[k]) > 1e-6)) errors.push(prefix + 'missing or altered physical hanging/storage run.');
  for (const f of level.furniture || []) {
    if (f.roomId === (room.closetType === 'walk_in' ? room.id : owner.id) && intersection(f, layout.access)) errors.push(prefix + 'furnishing obstructs closet access.');
  }
  return errors;
}

function measureBedroomClosets(plan, survey = {}) {
  return (survey.bedroomConfigs || []).map((config, index) => {
    const programId = index === 0 ? 'primary' : `bedroom_${index + 1}`, requested = closetType(config.closet);
    const matches = (plan.levels || []).flatMap(level => level.rooms.filter(r => BEDROOM_TYPES.includes(r.type) && r.programId === programId).map(room => ({ level, room })));
    if (!requested) return { programId, requested: config.closet, status: 'needs_project_input', roomIds: [], errors: [] };
    const { level, room: bedroom } = matches[0] || {};
    const closets = level?.rooms.filter(r => r.type === 'closet' && r.ownerBedroomId === bedroom.id) || [];
    const errors = matches.length !== 1 || closets.length !== 1
      ? [`Closet ${programId}: expected one physical ${requested} closet for this bedroom; delivered ${closets.length}.`]
      : validateCloset(level, closets[0], requested);
    return { programId, requested: config.closet, actual: closets[0]?.closetType || null, status: errors.length ? 'conflict' : 'satisfied',
      roomIds: closets.map(r => r.id), level: level?.level, errors };
  });
}

function validateBedroomClosets(plan, survey = {}) {
  return [...new Set([
    ...measureBedroomClosets(plan, survey).flatMap(r => r.errors),
    ...(plan.levels || []).flatMap(level => level.rooms.filter(r => r.type === 'closet' && r.ownerBedroomId).flatMap(r => validateCloset(level, r))),
  ])];
}

module.exports = { closetType, closetLayout, closetDoorSwing, validateCloset, measureBedroomClosets, validateBedroomClosets };
