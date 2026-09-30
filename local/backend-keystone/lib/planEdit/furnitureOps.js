'use strict';

/* Hand edits to furniture in the Studio's edit mode.
 *
 *   { op: 'moveFurniture', itemId, dx, dy }   move a piece (with its group) by dx, dy ft
 *   { op: 'turnFurniture', itemId }            turn it a quarter clockwise
 *   { op: 'removeFurniture', itemId }          take it out
 *   { op: 'resetFurniture', roomId }           let the plan furnish the room again
 *
 * A piece lands in the room under its middle and is nudged the least
 * distance that keeps it clear of the walls; one that cannot fit there is
 * refused. Every room a piece leaves or enters is marked `furnitureEdited`,
 * so the layout engine keeps the arrangement (lib/pinnedFurniture.js).
 * Overlaps and blocked doors are the person's call; the checks report them.
 */

const { partListOf } = require('../planGeometry');
const { doorClearances, intersects, fitsRoom, clearPartsFor } = require('../furnitureGeometry');
const { membersOf: companionsAndGroup, boxOf, shift, turnGroup, nearestFit, facingOf } = require('../pinnedFurniture');

const round = (n) => Math.round(n * 1000) / 1000;
const block = (code, message, extra = {}) => ({ severity: 'block', code, message, ...extra });

const PIECE_NAMES = {
  bed_king: 'king bed', bed_queen: 'queen bed', bed_full: 'full bed', bed_twin: 'twin bed', nightstand: 'nightstand',
  dresser: 'dresser', sofa: 'sofa', coffee_table: 'coffee table', console: 'console', dining_table: 'dining table',
  counter: 'kitchen counter', stove: 'range', refrigerator: 'fridge', kitchen_island: 'island', washer: 'washer',
  dryer: 'dryer', stacked_washer_dryer: 'stacked washer and dryer', laundry_counter: 'laundry counter', shower: 'shower',
  tub: 'bathtub', toilet: 'toilet', vanity: 'vanity', desk: 'desk', desk_chair: 'desk chair', bookcase: 'bookcase',
  bench: 'bench', car: 'car', closet_storage: 'closet rod', play_mat: 'play mat', toy_storage: 'toy storage',
  exercise_mat: 'exercise mat', outdoor_table: 'outdoor table', outdoor_chair: 'outdoor chair',
};

function pieceName(kind) {
  const k = String(kind || '');
  if (PIECE_NAMES[k]) return PIECE_NAMES[k];
  if (/^chair_\d+$/.test(k)) return 'chair';
  return k.replace(/_/g, ' ') || 'piece';
}

/** What to call a group: "dining table and chairs", "kitchen counter", "sofa". */
function groupName(items) {
  if (items.some((i) => i.kind === 'dining_table') && items.length > 1) return 'dining table and chairs';
  if (items.some((i) => i.assemblyId) && items.some((i) => i.kind === 'counter')) return 'kitchen counter';
  return pieceName(items[0]?.kind);
}

// Where a piece may stand. Plumbing, the kitchen run and the car stay in
// rooms built for them; everything else goes anywhere but the stair.
const WET = new Set(['bathroom', 'primary_bathroom', 'powder_room']);
const PLACES = [
  { kinds: /^(toilet|shower|tub|vanity)$/, rooms: WET, where: 'in a bathroom' },
  { kinds: /^(counter|stove|refrigerator)$/, rooms: new Set(['kitchen']), where: 'in the kitchen' },
  { kinds: /^(washer|dryer|stacked_washer_dryer|laundry_counter)$/, rooms: new Set(['laundry', 'mudroom', 'garage']), where: 'in the laundry, mudroom or garage' },
  { kinds: /^closet_storage$/, rooms: new Set(['closet']), where: 'in a closet' },
  { kinds: /^car$/, rooms: new Set(['garage']), where: 'in the garage' },
];

function findItem(plan, itemId) {
  for (const level of plan.levels || []) {
    const item = (level.furniture || []).find((f) => String(f.id) === String(itemId));
    if (item) return { level, item };
  }
  return null;
}

const membersOf = (level, item) => companionsAndGroup(level.furniture || [], item);

function roomAt(level, x, y) {
  return (level.rooms || []).find((room) => partListOf(room).some((p) => x >= p.x && x <= p.x2 && y >= p.y && y <= p.y2)) || null;
}

function roomName(room) {
  return String(room?.label || String(room?.type || 'room').replace(/_/g, ' '));
}

// Put the group's new pieces in place of its old ones, marking both rooms.
function replaceGroup(level, before, after, rooms) {
  const ids = new Set(before.map((i) => String(i.id)));
  level.furniture = [...(level.furniture || []).filter((f) => !ids.has(String(f.id))), ...after];
  for (const room of rooms) if (room) room.furnitureEdited = true;
}

function place(level, group, moved, name) {
  const box = boxOf(moved);
  const target = roomAt(level, box.x + box.w / 2, box.y + box.h / 2);
  if (!target) return { issues: [block('furniture_outside', `Keep the ${name} inside the house.`)] };
  if (String(target.type) === 'stairs') return { issues: [block('furniture_on_stair', `The ${name} cannot stand on the stair.`)] };
  for (const rule of PLACES) {
    if (group.some((i) => rule.kinds.test(String(i.kind))) && !rule.rooms.has(String(target.type))) {
      return { issues: [block('furniture_wrong_room', `The ${name} stays ${rule.where}.`)] };
    }
  }
  const fit = nearestFit(moved, target, level, 2);
  if (!fit) return { issues: [block('furniture_no_fit', `The ${name} does not fit there. Try a spot in ${roomName(target)} with more room.`)] };
  const placed = shift(moved, fit.dx, fit.dy).map((i) => ({ ...i, roomId: String(target.id), pinned: true }));
  return { placed, target };
}

function moveFurniture(plan, op) {
  const found = findItem(plan, op.itemId);
  if (!found) return { issues: [block('item_not_found', 'That piece has changed since the plan was drawn. Try again on the updated plan.')] };
  const dx = Number(op.dx), dy = Number(op.dy);
  if (![dx, dy].every(Number.isFinite) || Math.abs(dx) > 400 || Math.abs(dy) > 400) return { issues: [block('bad_move', 'Move the piece by a distance in feet.')] };
  if (!dx && !dy) return { changed: [] };
  const { level, item } = found;
  const group = membersOf(level, item);
  const name = groupName(group);
  const source = (level.rooms || []).find((r) => String(r.id) === String(item.roomId));
  const result = place(level, group, shift(group, round(dx), round(dy)), name);
  if (result.issues) return result;
  replaceGroup(level, group, result.placed, [source, result.target]);
  return { changed: [] };
}

// How far a group's back is from the wall behind it, in the part of the
// room under its middle; null when it has no back.
function gapBehind(items, room) {
  const lead = items.find((i) => facingOf(i));
  if (!lead || !room) return null;
  const back = facingOf(lead);
  const box = boxOf(items);
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const part = partListOf(room).find((p) => cx >= p.x && cx <= p.x2 && cy >= p.y && cy <= p.y2);
  if (!part) return null;
  const gap = { n: box.y - part.y, s: part.y2 - (box.y + box.h), w: box.x - part.x, e: part.x2 - (box.x + box.w) }[back];
  return { back, gap };
}

function turnFurniture(plan, op) {
  const found = findItem(plan, op.itemId);
  if (!found) return { issues: [block('item_not_found', 'That piece has changed since the plan was drawn. Try again on the updated plan.')] };
  const { level, item } = found;
  const group = membersOf(level, item);
  const name = groupName(group);
  const room = (level.rooms || []).find((r) => String(r.id) === String(item.roomId));
  const turned = turnGroup(group);
  const fit = room ? nearestFit(turned, room, level, 3) : null;
  if (!fit) return { issues: [block('furniture_no_fit', `The ${name} does not fit turned here. Move it somewhere with more room first.`)] };
  let placed = shift(turned, fit.dx, fit.dy);
  // A bed whose head was against a wall goes back against the wall behind
  // its new head, rather than standing in the middle of the room.
  const before = gapBehind(group, room);
  const after = gapBehind(placed, room);
  if (before && after && before.gap <= 1 && after.gap > before.gap + 0.01) {
    const slide = after.gap - Math.max(0, before.gap);
    const [dx, dy] = { n: [0, -slide], s: [0, slide], w: [-slide, 0], e: [slide, 0] }[after.back];
    // Along that wall, the nearest place that fits and keeps every door
    // clear; failing that, the nearest place that fits, and the checks say
    // which door it is in the way of.
    const zones = doorClearances(room, level);
    const clear = (items) => !items.some((i) => zones.some((z) => intersects(i, z)));
    const clearParts = clearPartsFor(level, room);
    const along = after.back === 'n' || after.back === 's' ? [1, 0] : [0, 1];
    const offsets = [0];
    for (let k = 0.5; k <= Math.max(Number(room.w), Number(room.h)); k += 0.5) offsets.push(k, -k);
    const candidates = offsets.map((k) => shift(placed, dx + along[0] * k, dy + along[1] * k))
      .filter((c) => fitsRoom(boxOf(c), room, clearParts));
    placed = candidates.find(clear) || candidates[0] || placed;
  }
  replaceGroup(level, group, placed.map((i) => ({ ...i, pinned: true })), [room]);
  return { changed: [] };
}

function removeFurniture(plan, op) {
  const found = findItem(plan, op.itemId);
  if (!found) return { issues: [block('item_not_found', 'That piece has changed since the plan was drawn. Try again on the updated plan.')] };
  const { level, item } = found;
  const room = (level.rooms || []).find((r) => String(r.id) === String(item.roomId));
  replaceGroup(level, membersOf(level, item), [], [room]);
  return { changed: [] };
}

function resetFurniture(plan, op) {
  for (const level of plan.levels || []) {
    const room = (level.rooms || []).find((r) => String(r.id) === String(op.roomId));
    if (!room) continue;
    if (!room.furnitureEdited) return { changed: [] };
    delete room.furnitureEdited;
    level.furniture = (level.furniture || []).filter((f) => String(f.roomId) !== String(room.id));
    return { changed: [String(room.id)] };
  }
  return { issues: [block('room_not_found', 'That room is no longer in the plan.')] };
}

module.exports = { moveFurniture, turnFurniture, removeFurniture, resetFurniture, pieceName, groupName, PIECE_NAMES };
