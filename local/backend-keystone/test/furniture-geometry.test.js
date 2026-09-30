'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { applyFurnitureLayout } = require('../lib/planFurniture');
const { intersects, fitsRoom, validateFurnitureGeometry, validateRequiredFurniture } = require('../lib/furnitureGeometry');
const { renderPlanSvg } = require('../lib/renderPlanSvg');

function planFor(room, doors = []) {
  return { levels: [{ level: 1, width: room.w, height: room.h, rooms: [room], doors, windows: [] }] };
}

test('small bathroom retains all essential fixtures outside a four-foot door swing', () => {
  const plan = planFor({ id: 'bath', type: 'bathroom', x: 0, y: 0, w: 8, h: 6 },
    [{ a: 'bath', b: '__exterior__', x: 8, y: 2.5, dir: 'vertical', width: 4 }]);
  applyFurnitureLayout(plan);
  assert.deepEqual(validateRequiredFurniture(plan), []);
  assert.deepEqual(validateFurnitureGeometry(plan.levels[0]), []);
  assert.deepEqual(new Set(plan.levels[0].furniture.map(item => item.kind)), new Set(['shower', 'toilet', 'vanity']));
});

test('bedroom dresser cannot overlap the bed or doorway', () => {
  const plan = planFor({ id: 'bed', type: 'bedroom', x: 0, y: 0, w: 14, h: 10 },
    [{ a: 'bed', b: '__exterior__', x: 12, y: 10, dir: 'horizontal', width: 3 }]);
  applyFurnitureLayout(plan);
  assert.deepEqual(validateRequiredFurniture(plan), []);
  assert.deepEqual(validateFurnitureGeometry(plan.levels[0]), []);
});

test('compact laundry uses a labelled full-size stacked unit instead of overlapping appliances', () => {
  const plan = planFor({ id: 'laundry', type: 'laundry', x: 0, y: 0, w: 6, h: 8 },
    [{ a: 'laundry', b: '__exterior__', x: 3, y: 8, dir: 'horizontal', width: 3 }]);
  applyFurnitureLayout(plan);
  assert.deepEqual(validateRequiredFurniture(plan), []);
  assert.ok(plan.levels[0].furniture.some(item => item.kind === 'stacked_washer_dryer' && item.w === 3 && item.h === 3));
  assert.match(renderPlanSvg(plan), /W\/D STACK/);
});

test('a missing essential fixture fails validation, while optional furniture can be omitted', () => {
  const plan = planFor({ id: 'bath', type: 'bathroom', x: 0, y: 0, w: 4, h: 4 });
  applyFurnitureLayout(plan);
  assert.ok(validateRequiredFurniture(plan).some(error => error.includes('needs')));
});

test('six-foot laundry reserves a full-size stack outside the actual entry swing', () => {
  const plan = planFor({ id: 'laundry', type: 'laundry', x: 0, y: 0, w: 6, h: 6 },
    [{ a: 'laundry', b: '__exterior__', x: 3, y: 0, dir: 'horizontal', width: 3 }]);
  applyFurnitureLayout(plan);
  assert.deepEqual(validateRequiredFurniture(plan), []);
  assert.deepEqual(validateFurnitureGeometry(plan.levels[0]), []);
  assert.ok(plan.levels[0].furniture.some(item => item.kind === 'stacked_washer_dryer'));
});

test('entry consoles and mudroom benches leave the arrival door sweep clear', () => {
  for (const type of ['entry', 'mudroom']) {
    const plan = planFor({ id: 'arrival', type, x: 0, y: 0, w: 11, h: 15 },
      [{ a: 'arrival', b: '__exterior__', x: 5.5, y: 0, dir: 'horizontal', width: 3 }]);
    applyFurnitureLayout(plan);
    assert.deepEqual(validateFurnitureGeometry(plan.levels[0]), []);
    assert.deepEqual(validateRequiredFurniture(plan), []);
  }
});

test('kitchen appliances move with their counter run to clear an entry door', () => {
  const plan = planFor({ id: 'kitchen', type: 'kitchen', x: 0, y: 0, w: 15, h: 15 },
    [{ a: 'kitchen', b: '__exterior__', x: 0, y: 2.5, dir: 'vertical', width: 3 }]);
  applyFurnitureLayout(plan);
  assert.deepEqual(validateFurnitureGeometry(plan.levels[0]), []);
  assert.deepEqual(validateRequiredFurniture(plan), []);
  const run = plan.levels[0].furniture.filter(item => item.assemblyId);
  assert.equal(run.length, 3);
  assert.equal(new Set(run.map(item => item.assemblyId)).size, 1);
  const counter = run.find(item => item.kind === 'counter');
  assert.equal(run.find(item => item.kind === 'stove').x - counter.x, 1.5);
});

test('swing collision uses the quarter circle rather than the whole bounding square', () => {
  const sector = { x: 0, y: 0, w: 4, h: 4, sector: { x: 0, y: 0, radius: 4 } };
  assert.equal(intersects({ x: 3, y: 3, w: 0.5, h: 0.5 }, sector), false);
  assert.equal(intersects({ x: 1, y: 1, w: 0.5, h: 0.5 }, sector), true);
});

test('a bed can cross an internal composite seam but cannot occupy a notch', () => {
  const room = { x: 0, y: 0, w: 12, h: 12, parts: [
    { x: 0, y: 0, w: 6, h: 12 }, { x: 6, y: 0, w: 6, h: 8 },
  ] };
  assert.equal(fitsRoom({ x: 3, y: 0.5, w: 5, h: 7 }, room), true);
  assert.equal(fitsRoom({ x: 7, y: 7, w: 4, h: 4 }, room), false);
});

test('bed symbols use the room contract without silently enlarging or shrinking the bed', () => {
  const plan = planFor({ id: 'bed', type: 'bedroom', x: 0, y: 0, w: 12, h: 9,
    roomContract: { contractType: 'bedroom', bedType: 'full' } });
  applyFurnitureLayout(plan);
  const bed = plan.levels[0].furniture.find(item => item.kind === 'bed_full');
  assert.ok(bed);
  assert.deepEqual([bed.w, bed.h].sort(), [4.5, 6.25]);
  assert.deepEqual(validateRequiredFurniture(plan), []);
});
