'use strict';
// The instant 3D model's dressing and front entrance (lib/model3d): sidelights only
// where the wall allows, the bake still told the real door width, art never across a
// window or an opening, a TV on living-room consoles only, the sink clear of appliances.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildModel, toGlb } = require('../lib/model3d');

const options = { include: { site: false, roof: false } };
const verts = (b) => { const out = []; for (let i = 0; i < (b?.positions.length || 0); i += 3) out.push(b.positions.slice(i, i + 3)); return out; };
const mat = (m, name, node = 'Furniture 1') => m.builder.nodes.get(node)?.get(name);

function entryPlan(entryWidth) {
  // A 30 x 24 house; the entry hall is `entryWidth` wide on the south wall (y = 24).
  return { levels: [{ level: 1, width: 30, height: 24, rooms: [
    { id: 'living', type: 'living_room', x: 0, y: 0, w: 30, h: 14 },
    { id: 'entry', type: 'entry', x: 12, y: 14, w: entryWidth, h: 10 },
    { id: 'west', type: 'study', x: 0, y: 14, w: 12, h: 10 },
    { id: 'east', type: 'study', x: 12 + entryWidth, y: 14, w: 18 - entryWidth, h: 10 },
  ], doors: [
    { id: 'front', x: 12 + entryWidth / 2, y: 24, dir: 'horizontal', width: 3, a: 'entry', b: '__exterior__', isMainEntry: true },
    { id: 'in', x: 12 + entryWidth / 2, y: 14, dir: 'horizontal', width: 3, a: 'entry', b: 'living', openThreshold: true },
  ], windows: [], furniture: [] }] };
}

test('a wide entry hall gets sidelights; the bake still gets the 3 ft door', () => {
  const m = buildModel(entryPlan(8), options);
  const door = m.meta.exteriorDoors.find((d) => d.main);
  assert.equal(door.width, 3, 'the photoreal bake is told the door itself');
  // Glass in the wall line beside the door (sidelights), on the level node.
  const glass = verts(mat(m, 'glass', 'Level 1')).filter((v) => Math.abs(v[2] - 12) < 0.2);
  const xs = glass.map((v) => v[0] + 15);
  assert.ok(xs.some((x) => x < 16 - 1.5 + 0.1) && xs.some((x) => x > 16 + 1.5 - 0.1), 'glass on both sides of the door');
});

test('a narrow entry hall keeps the plain opening width but still gets its surround', () => {
  const m = buildModel(entryPlan(4.5), options);
  assert.equal(m.meta.exteriorDoors.find((d) => d.main).width, 3);
  const glass = verts(mat(m, 'glass', 'Level 1')).filter((v) => Math.abs(v[2] - 12) < 0.2).map((v) => v[0] + 15);
  assert.ok(glass.every((x) => x > 12 + 0.7 && x < 12 + 3.8), 'no sidelights cut into the neighbouring rooms');
  assert.ok(glass.length, 'the transom is glazed');
});

function livingPlan(windowOnSofaWall) {
  return { levels: [{ level: 1, width: 20, height: 16, rooms: [{ id: 'lr', type: 'living_room', x: 0, y: 0, w: 20, h: 16 }],
    doors: [], windows: windowOnSofaWall ? [{ roomId: 'lr', x: 10, y: 16, dir: 'horizontal', width: 4 }] : [],
    furniture: [
      { id: 'sofa', roomId: 'lr', kind: 'sofa', x: 6, y: 11.75, w: 8, h: 3 },
      { id: 'tv', roomId: 'lr', kind: 'console', x: 7, y: 1, w: 6, h: 1.5 },
      { id: 'ct', roomId: 'lr', kind: 'coffee_table', x: 8, y: 7, w: 4, h: 2 },
    ] }] };
}

test('living room: a TV on the media console, art over the sofa only on a solid wall', () => {
  const solid = buildModel(livingPlan(false), options), glazed = buildModel(livingPlan(true), options);
  assert.ok(mat(solid, 'tv-screen'), 'a TV on the living-room console');
  assert.ok(mat(solid, 'rug-living'), 'a rug under the coffee table');
  const artOnSouth = (m) => verts(mat(m, 'art-frame')).some((v) => v[2] > 8 - 0.5);
  assert.ok(artOnSouth(solid), 'art over the sofa');
  assert.ok(!artOnSouth(glazed), 'no art across the window');
  assert.ok(!toGlb(solid).equals(toGlb(glazed)));
});

test('a hall console gets a lamp and a mirror, not a TV', () => {
  const p = { levels: [{ level: 1, width: 12, height: 10, rooms: [{ id: 'e', type: 'entry', x: 0, y: 0, w: 12, h: 10 }], doors: [], windows: [],
    furniture: [{ id: 'c', roomId: 'e', kind: 'console', x: 3, y: 1, w: 6, h: 1.5 }] }] };
  const m = buildModel(p, options);
  assert.ok(!mat(m, 'tv-screen'));
  assert.ok(mat(m, 'mirror') && mat(m, 'lamp-shade'));
});

test('kitchen: the sink sits in the counter run clear of the range and the fridge', () => {
  const p = { levels: [{ level: 1, width: 16, height: 12, rooms: [{ id: 'k', type: 'kitchen', x: 0, y: 0, w: 16, h: 12 }], doors: [], windows: [],
    furniture: [
      { id: 'run', roomId: 'k', kind: 'counter', x: 0.75, y: 0.75, w: 12, h: 2 },
      { id: 'range', roomId: 'k', kind: 'stove', x: 2.25, y: 0.75, w: 2.5, h: 2.5 },
      { id: 'fridge', roomId: 'k', kind: 'refrigerator', x: 10.25, y: 0.75, w: 2.5, h: 2.5 },
    ] }] };
  const m = buildModel(p, options);
  const sink = verts(mat(m, 'sink')).map((v) => v[0] + 8);
  assert.ok(sink.length, 'a sink');
  assert.ok(sink.every((x) => x >= 4.75 && x <= 10.25), `the sink is between the range and the fridge (${Math.min(...sink)}..${Math.max(...sink)})`);
  assert.ok(mat(m, 'backsplash'), 'a backsplash on the solid wall behind the run');
});

test('a car is car-sized inside its slot', () => {
  const p = { levels: [{ level: 1, width: 12, height: 22, rooms: [{ id: 'g', type: 'garage', x: 0, y: 0, w: 12, h: 22 }], doors: [], windows: [],
    furniture: [{ id: 'car', roomId: 'g', kind: 'car', x: 2, y: 3, w: 8, h: 16 }] }] };
  const m = buildModel(p, options);
  const body = verts(mat(m, 'car'));
  const xs = body.map((v) => v[0]), zs = body.map((v) => v[2]);
  assert.ok(Math.max(...xs) - Math.min(...xs) < 7.2, 'about 6.3 ft wide with mirrors');
  assert.ok(Math.max(...zs) - Math.min(...zs) <= 15.6, 'about 15.5 ft long');
  assert.ok(mat(m, 'tire') && mat(m, 'car-glass') && mat(m, 'headlight'));
});
