'use strict';
// Bathrooms, laundry rooms and studies (lib/serviceRoomPlacement.js through
// planFurniture): every piece on a wall and out of the door swing, each piece's use
// space free of the others, toilets only where the plan symbol can draw their tank,
// and the simple placement kept when a planned layout would lose a required piece.
const test = require('node:test');
const assert = require('node:assert/strict');
const { furnitureForRoom, applyFurnitureLayout } = require('../lib/planFurniture');
const { doorClearances, intersects } = require('../lib/furnitureGeometry');

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
function front(q, side, depth, width = null) {
  const horizontal = side === 'n' || side === 's', len = horizontal ? q.w : q.h, wid = width ?? len, a = (horizontal ? q.x : q.y) + (len - wid) / 2;
  return side === 'n' ? { x: a, y: q.y + q.h, w: wid, h: depth } : side === 's' ? { x: a, y: q.y - depth, w: wid, h: depth }
    : side === 'w' ? { x: q.x + q.w, y: a, w: depth, h: wid } : { x: q.x - depth, y: a, w: depth, h: wid };
}
const flush = (it, r) => ({ n: it.y - r.y, s: r.y + r.h - it.y - it.h, w: it.x - r.x, e: r.x + r.w - it.x - it.w })[it.back];

test('a primary bathroom gets tub, shower, vanity and toilet, all on walls, out of the door swing, use spaces clear', () => {
  const room = { id: 'pb', type: 'primary_bathroom', x: 0, y: 0, w: 8, h: 10 };
  const level = { level: 1, rooms: [room, { id: 'pr', type: 'primary_bedroom', x: 0, y: -12, w: 14, h: 12 }],
    doors: [{ id: 'd', x: 2.5, y: 0, dir: 'horizontal', width: 3, a: 'pr', b: 'pb' }], windows: [] };
  const items = furnitureForRoom(room, level);
  const kinds = items.map((i) => i.kind).sort();
  for (const k of ['shower', 'toilet', 'vanity']) assert.ok(kinds.includes(k), `has a ${k}`);
  const zones = doorClearances(room, level);
  const use = { toilet: [2, 2.5], vanity: [2, null], shower: [2, 2.5], tub: [2, null] };
  for (const it of items) {
    assert.ok(flush(it, room) < 0.5, `${it.kind} is on its wall`);
    assert.ok(!zones.some((z) => intersects(it, z, 0)), `${it.kind} is out of the door swing`);
    const u = front(it, it.back, ...use[it.kind]);
    for (const o of items) if (o !== it) assert.ok(!overlaps(u, o), `${it.kind}'s use space is clear of the ${o.kind}`);
  }
  const toilet = items.find((i) => i.kind === 'toilet');
  assert.ok(['n', 'w'].includes(toilet.back) && toilet.rotation === (toilet.back === 'w' ? 90 : 0), 'the tank is on a side the plan symbol draws');
});

test('laundry: washer and dryer side by side on a wall with 3.5 ft in front, out of the door swing', () => {
  const room = { id: 'l', type: 'laundry', x: 0, y: 0, w: 10, h: 8 };
  const level = { level: 1, rooms: [room], doors: [{ id: 'd', x: 0, y: 5.5, dir: 'vertical', width: 3, a: 'h', b: 'l' }], windows: [] };
  const items = furnitureForRoom(room, level);
  const washer = items.find((i) => i.kind === 'washer'), dryer = items.find((i) => i.kind === 'dryer');
  assert.ok(washer && dryer, 'both appliances');
  assert.equal(washer.back, dryer.back, 'on the same wall');
  const zones = doorClearances(room, level);
  for (const it of items) assert.ok(!zones.some((z) => intersects(it, z, 0)), `${it.kind} is out of the door swing`);
  for (const it of [washer, dryer]) for (const o of items) if (o !== washer && o !== dryer) assert.ok(!overlaps(front(it, it.back, 3.5), o), `${it.kind} can be opened`);
});

test('study: a desk on a wall (not the door wall) with its chair in front, facing it', () => {
  const room = { id: 's', type: 'study', x: 0, y: 0, w: 11, h: 10 };
  const level = { level: 1, rooms: [room], doors: [{ id: 'd', x: 5, y: 10, dir: 'horizontal', width: 3, a: 'h', b: 's' }], windows: [] };
  const items = furnitureForRoom(room, level);
  const desk = items.find((i) => i.kind === 'desk'), chair = items.find((i) => i.kind === 'desk_chair');
  assert.ok(desk && chair);
  assert.notEqual(desk.back, 's', 'not on the door wall');
  assert.ok(overlaps(chair, front(desk, desk.back, 3, desk.back === 'n' || desk.back === 's' ? desk.w : desk.h)), 'the chair is in front of the desk');
  assert.equal(chair.back, { n: 's', s: 'n', e: 'w', w: 'e' }[desk.back], 'the chair faces the desk');
});

test('a planned layout that would lose a required piece falls back to the simple placement', () => {
  // A 4.5 x 5 bath: tight enough that some layouts lose a fixture in the collision pass.
  const plan = { levels: [{ level: 1, rooms: [{ id: 'b', type: 'bathroom', x: 0, y: 0, w: 4.5, h: 5 }, { id: 'h', type: 'hallway', x: 4.5, y: 0, w: 4, h: 5 }],
    doors: [{ id: 'd', x: 4.5, y: 2.5, dir: 'vertical', width: 2.5, a: 'h', b: 'b' }], windows: [] }] };
  applyFurnitureLayout(plan);
  const kinds = plan.levels[0].furniture.filter((i) => i.roomId === 'b').map((i) => i.kind);
  const missing = ['shower', 'toilet', 'vanity'].filter((k) => !kinds.includes(k));
  const omitted = plan.furnitureDiagnostics.omitted.filter((o) => o.roomId === 'b').map((o) => o.kind);
  // Either every fixture is placed, or what is missing is exactly what the simple placement also cannot place.
  assert.deepEqual(missing.sort(), omitted.filter((k) => ['shower', 'toilet', 'vanity'].includes(k)).sort());
});
