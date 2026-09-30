'use strict';
// Living rooms, dining rooms and kitchens (lib/publicRoomPlacement.js through
// planFurniture): nothing in a doorway, the TV on a solid wall and never over a
// window, a kitchen that always keeps its counter, range and fridge, pieces that
// record which way they face, and a 3D model that follows those facings and lists
// its dressing for the photoreal bake.
const test = require('node:test');
const assert = require('node:assert/strict');
const { furnitureForRoom } = require('../lib/planFurniture');
const { landingIn } = require('../lib/bedPlacement');
const { buildModel } = require('../lib/model3d');

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const kinds = (items) => items.map((i) => i.kind);

test('living room: TV console on a solid wall (not the window wall), sofa facing it, doorways clear', () => {
  // 16 x 14; windows on the north wall, the doorway on the west wall.
  const room = { id: 'lr', type: 'living_room', x: 0, y: 0, w: 16, h: 14 };
  const level = { level: 1, rooms: [room, { id: 'h', type: 'hallway', x: -4, y: 0, w: 4, h: 14 }],
    doors: [{ id: 'd', x: 0, y: 3, dir: 'vertical', width: 3, a: 'h', b: 'lr' }],
    windows: [{ roomId: 'lr', x: 8, y: 0, dir: 'horizontal', width: 5 }] };
  const items = furnitureForRoom(room, level);
  const tv = items.find((i) => i.kind === 'console'), sofa = items.find((i) => i.kind === 'sofa');
  assert.ok(tv && sofa && items.some((i) => i.kind === 'coffee_table'));
  assert.notEqual(tv.back, 'n', 'not in front of the windows');
  assert.equal(sofa.back, { n: 's', s: 'n', e: 'w', w: 'e' }[tv.back], 'the sofa faces the TV');
  const landing = landingIn(level.doors[0], [room]);
  for (const it of items) assert.ok(!overlaps(it, landing), `${it.kind} clear of the doorway landing`);
});

test('dining room: table and chairs keep doorways clear and every chair faces the table', () => {
  const room = { id: 'dr', type: 'dining_room', x: 0, y: 0, w: 14, h: 12 };
  const level = { level: 1, rooms: [room], doors: [{ id: 'd', x: 7, y: 12, dir: 'horizontal', width: 3, a: 'dr', b: 'k' }], windows: [] };
  const items = furnitureForRoom(room, level);
  const table = items.find((i) => i.kind === 'dining_table');
  const chairs = items.filter((i) => /^chair_\d+$/.test(i.kind));
  assert.equal(chairs.length, 4);
  for (const c of chairs) {
    const cx = c.x + c.w / 2, cy = c.y + c.h / 2, tx = table.x + table.w / 2, ty = table.y + table.h / 2;
    const away = Math.abs(cx - tx) / table.w > Math.abs(cy - ty) / table.h ? (cx < tx ? 'w' : 'e') : (cy < ty ? 'n' : 's');
    assert.equal(c.back, away, 'the chair back is away from the table');
  }
  const landing = landingIn(level.doors[0], [room]);
  for (const it of items) assert.ok(!overlaps(it, landing), `${it.kind} clear of the doorway landing`);
});

test('kitchen: the run is on a wall, clear of the doorway, and always has its counter, range and fridge', () => {
  for (const [w, h] of [[20, 8], [8, 20], [18, 16], [12, 10]]) {
    const room = { id: 'k', type: 'kitchen', x: 0, y: 0, w, h };
    const level = { level: 1, rooms: [room], doors: [{ id: 'd', x: 0, y: 2.5, dir: 'vertical', width: 3, a: 'h', b: 'k' }], windows: [] };
    const items = furnitureForRoom(room, level);
    for (const k of ['counter', 'stove', 'refrigerator']) assert.ok(kinds(items).includes(k), `${w}x${h} has a ${k}`);
    const counter = items.find((i) => i.kind === 'counter');
    const flush = { n: counter.y, s: h - counter.y - counter.h, w: counter.x, e: w - counter.x - counter.w }[counter.back];
    assert.ok(flush < 0.5, `${w}x${h}: the run is flush with its wall (${flush})`);
    const landing = landingIn(level.doors[0], [room]);
    for (const it of items) assert.ok(!overlaps(it, landing), `${w}x${h}: ${it.kind} clear of the doorway landing`);
  }
});

test('the 3D model faces pieces the way the plan says, and lists its dressing for the photoreal bake', () => {
  const plan = { levels: [{ level: 1, width: 20, height: 16, rooms: [{ id: 'lr', type: 'living_room', x: 0, y: 0, w: 20, h: 16 }], doors: [], windows: [],
    furniture: [
      // A floating sofa: its back is east (towards the open room), though the west wall is nearer.
      { id: 's', roomId: 'lr', kind: 'sofa', x: 4, y: 4, w: 3, h: 8, back: 'e' },
      { id: 't', roomId: 'lr', kind: 'console', x: 0.3, y: 5, w: 1.5, h: 6, back: 'w' },
      { id: 'c', roomId: 'lr', kind: 'coffee_table', x: 2.2, y: 6, w: 1.6, h: 4 },
    ] }] };
  const m = buildModel(plan, { include: { site: false, roof: false } });
  const against = Object.fromEntries(m.meta.furniture.map((f) => [f.kind, f.against]));
  assert.equal(against.sofa, 'e');
  assert.equal(against.console, 'w');
  const dressed = new Set(m.meta.dressing.map((d) => d.kind));
  for (const k of ['tv', 'rug', 'art']) assert.ok(dressed.has(k), `the bake is told about the ${k}`);
  for (const d of m.meta.dressing) assert.equal(d.level, 1);
});
