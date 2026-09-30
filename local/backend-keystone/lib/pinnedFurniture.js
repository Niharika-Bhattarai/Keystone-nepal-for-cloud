'use strict';

/* Furniture a person arranged by hand in the Studio's edit mode.
 *
 * A room whose furniture was moved, turned or removed is marked
 * `room.furnitureEdited`. From then on the layout engine leaves its pieces
 * where the person put them (applyFurnitureLayout). When a wall later moves,
 * each piece is fitted back into the room: it stays put if it still fits,
 * shifts the least distance that makes it fit, or is taken out, and the edit
 * checks say so.
 *
 * Pieces that belong together move as one group: a kitchen run (its counter,
 * range and fridge share an `assemblyId`) and a dining table with its chairs.
 */

const { fitsRoom, clearPartsFor } = require('./furnitureGeometry');

const round = (n) => Math.round(n * 1000) / 1000;

/** Which group a piece belongs to; a lone piece is its own group. */
function groupKeyOf(item) {
  if (item?.assemblyId) return `a:${item.assemblyId}`;
  if (/^(dining_table|chair_\d+)$/.test(String(item?.kind))) return `d:${item.roomId}`;
  return `i:${item?.id}`;
}

// A bed carries the nightstands beside it, and a desk its chair, but each of
// those can still be moved on its own.
const COMPANIONS = [[/^bed_/, /^nightstand$/], [/^desk$/, /^desk_chair$/]];
const touching = (a, b, gap = 0.5) => a.x <= b.x + b.w + gap && b.x <= a.x + a.w + gap && a.y <= b.y + b.h + gap && b.y <= a.y + a.h + gap;

/** The pieces that move when `item` moves: its group and its companions. */
function membersOf(furniture, item) {
  const group = furniture.filter((f) => groupKeyOf(f) === groupKeyOf(item));
  const rule = COMPANIONS.find(([lead]) => lead.test(String(item.kind)));
  if (!rule) return group;
  return [...group, ...furniture.filter((f) => !group.includes(f) && String(f.roomId) === String(item.roomId) &&
    rule[1].test(String(f.kind)) && touching(f, item))];
}

function groupsOf(items) {
  const groups = new Map();
  for (const item of items) {
    const key = groupKeyOf(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.values()];
}

function boxOf(items) {
  const x = Math.min(...items.map((i) => Number(i.x))), y = Math.min(...items.map((i) => Number(i.y)));
  return { x, y, w: Math.max(...items.map((i) => Number(i.x) + Number(i.w))) - x, h: Math.max(...items.map((i) => Number(i.y) + Number(i.h))) - y };
}

const shift = (items, dx, dy) => items.map((i) => ({ ...i, x: round(Number(i.x) + dx), y: round(Number(i.y) + dy) }));

// Which wall a piece has its back to. Beds carry a clockwise rotation with
// the head at the top for 0; toilets say 90 for a tank on the left.
const CLOCKWISE = ['n', 'e', 's', 'w'];
function facingOf(item) {
  if (CLOCKWISE.includes(item.back)) return item.back;
  const kind = String(item.kind);
  if (/^bed_/.test(kind) && [0, 90, 180, 270].includes(item.rotation)) return { 0: 'n', 90: 'e', 180: 's', 270: 'w' }[item.rotation];
  if (kind === 'toilet') return item.rotation === 90 ? 'w' : 'n';
  return null;
}

/** A group turned a quarter clockwise about its middle. */
function turnGroup(items) {
  const box = boxOf(items);
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  return items.map((i) => {
    const x = Number(i.x), y = Number(i.y), w = Number(i.w), h = Number(i.h);
    const out = { ...i, x: round(cx - (y + h - cy)), y: round(cy + (x - cx)), w: h, h: w };
    const facing = facingOf(i);
    if (facing) out.back = CLOCKWISE[(CLOCKWISE.indexOf(facing) + 1) % 4];
    if (/^bed_/.test(String(i.kind))) out.rotation = ((Number(i.rotation) || 0) + 90) % 360;
    else if (String(i.kind) === 'toilet') out.rotation = { n: 0, w: 90, s: 180, e: 270 }[out.back];
    else if (i.rotation !== undefined) out.rotation = ((Number(i.rotation) || 0) + 90) % 360;
    return out;
  });
}

/**
 * The smallest shift, on a 3 in grid and no further than `reach` ft, that
 * puts the whole group inside the room. Returns { dx, dy } or null.
 */
function nearestFit(items, room, level, reach = 3) {
  const clearParts = clearPartsFor(level, room);
  const box = boxOf(items);
  const fits = (dx, dy) => fitsRoom({ x: box.x + dx, y: box.y + dy, w: box.w, h: box.h }, room, clearParts);
  if (fits(0, 0)) return { dx: 0, dy: 0 };
  const step = 0.25;
  const steps = Math.round(reach / step);
  let best = null;
  for (let i = -steps; i <= steps; i++) {
    for (let j = -steps; j <= steps; j++) {
      const dx = i * step, dy = j * step, d = Math.hypot(dx, dy);
      if (d > reach + 1e-9 || (best && d >= best.d)) continue;
      if (fits(dx, dy)) best = { dx, dy, d };
    }
  }
  return best ? { dx: best.dx, dy: best.dy } : null;
}

/**
 * Fit a hand-arranged room's pieces back into it after its walls moved.
 * Returns { placed, dropped }.
 */
function refitArranged(room, level, items) {
  const placed = [], dropped = [];
  // The reach grows with the room, so a piece in a much smaller room still
  // finds a place if there is one.
  const reach = Math.max(3, Math.min(12, Math.max(Number(room.w) || 0, Number(room.h) || 0) / 2));
  for (const group of groupsOf(items)) {
    const fit = nearestFit(group, room, level, reach);
    if (fit) placed.push(...(fit.dx || fit.dy ? shift(group, fit.dx, fit.dy) : group));
    else dropped.push(...group);
  }
  return { placed, dropped };
}

module.exports = { groupKeyOf, groupsOf, membersOf, boxOf, shift, facingOf, turnGroup, nearestFit, refitArranged };
