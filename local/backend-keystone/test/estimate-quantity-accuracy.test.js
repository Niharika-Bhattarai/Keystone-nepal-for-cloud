'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeTakeoff } = require('../lib/estimate/computeTakeoff');
const { computeMaterialEstimate } = require('../lib/estimate/materialCostEngine');

const room = (id, type, x, y, w, h) => ({ id, type, x, y, w, h });
const plan = rooms => ({ levels: [{ level: 1, width: 20, height: 10, rooms, doors: [], windows: [] }] });

test('fractional-foot takeoff is independent of generator grid resolution', () => {
  const p = plan([room('a', 'bedroom', 0, 0, 10.25, 8.75)]);
  for (const tileSizeFt of [1, 2, 4]) {
    const q = computeTakeoff({ ...p, tileSizeFt }, {}).raw;
    assert.equal(q.exteriorWallLengthFt, 38); // 2 * (10.25 + 8.75)
    assert.equal(q.baseboardLengthFt, 38);
    assert.equal(q.roofPlanAreaSqFt, 89.7); // 10.25 * 8.75 rounded to 0.1
  }
});

test('window quantities preserve saved dimensions, including a recessed exterior edge', () => {
  const p = plan([room('a', 'bedroom', 0, 0, 10, 10), room('b', 'bedroom', 10, 0, 10, 5)]);
  p.levels[0].windows = [
    { roomId: 'a', x: 5, y: 0, dir: 'horizontal', width: 6, sillHeightFt: 2, headHeightFt: 7 },
    { roomId: 'b', x: 15, y: 5, dir: 'horizontal', width: 2, sillHeightFt: 4, headHeightFt: 6 },
  ];
  const q = computeTakeoff(p, {});
  assert.equal(q.raw.roughGlazingAreaSqFt, 34); // 6*5 + 2*2, not 2*12
  assert.equal(q.windowSchedule.reduce((s, w) => s + w.areaSqFt, 0), 34);
  assert.deepEqual(q.windowSchedule.map(w => w.widthFt), [6, 2]);
});

test('wide saved door openings reduce baseboard on each adjoining room', () => {
  const p = plan([room('a', 'bedroom', 0, 0, 10, 10), room('b', 'bedroom', 10, 0, 10, 10)]);
  p.levels[0].doors = [{ a: 'a', b: 'b', x: 10, y: 5, dir: 'vertical', width: 6 }];
  const q = computeTakeoff(p, {}).raw;
  assert.equal(q.baseboardLengthFt, 68); // 40 + 40 - 6 - 6
  assert.equal(q.interiorWallLengthFt, 10);
  assert.equal(q.exteriorWallLengthFt, 60);
});

test('foundation footprint counts overlapping composite parts once', () => {
  const r = room('a', 'bedroom', 0, 0, 10, 10);
  r.parts = [{ x: 0, y: 0, w: 10, h: 6 }, { x: 0, y: 4, w: 6, h: 6 }];
  const q = computeTakeoff(plan([r]), {}).raw;
  assert.equal(q.footprintAreaSqFt, 84); // 60 + 36 - 12
  assert.equal(q.conditionedAreaSqFt, 84);
  assert.equal(q.finishedFlooringAreaSqFt, 84);
});

test('priced flooring includes hallways, closets and study as well as bedrooms and wet rooms', () => {
  const p = plan([
    room('a', 'bedroom', 0, 0, 10, 10), room('b', 'hallway', 10, 0, 2, 10),
    room('c', 'study', 12, 0, 8, 5), room('d', 'bathroom', 12, 5, 4, 5),
    room('e', 'closet', 16, 5, 4, 5),
  ]);
  const q = computeTakeoff(p, {});
  const priced = computeMaterialEstimate(q, {}, {});
  assert.equal(priced.filter(l => l.key.startsWith('flooring_')).reduce((s, l) => s + l.quantity, 0), 200);
  assert.equal(priced.find(l => l.key === 'kitchen_cabinets').quantity, 0);
  assert.equal(priced.find(l => l.key === 'kitchen_appliances').quantity, 0);
});

test('explicit zero measured quantities never activate heuristic allowances', () => {
  const lines = computeMaterialEstimate({ raw: { conditionedAreaSqFt: 100, footprintAreaSqFt: 0,
    baseboardLengthFt: 0, estimatedRoofSurfaceAreaSqFt: 0, roofPlanAreaSqFt: 100 } }, {}, {});
  for (const key of ['foundation_system', 'interior_trim_millwork', 'roofing']) {
    assert.equal(lines.find(l => l.key === key).quantity, 0, key);
  }
});
