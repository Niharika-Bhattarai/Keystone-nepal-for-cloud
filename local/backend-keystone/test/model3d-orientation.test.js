'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildModel, toGlb } = require('../lib/model3d');

function plan(rotation) {
  const sideways = rotation === 90 || rotation === 270;
  const item = { id: 'bed', roomId: 'room', kind: 'bed_queen', x: 7, y: 7, w: sideways ? 7 : 5, h: sideways ? 5 : 7 };
  if (rotation !== undefined) item.rotation = rotation;
  return { levels: [{ level: 1, width: 24, height: 24, rooms: [{ id: 'room', type: 'bedroom', x: 0, y: 0, w: 24, h: 24 }], furniture: [item] }] };
}
const options = { include: { site: false, roof: false } };
for (const [rotation, side] of [[0, 'n'], [90, 'e'], [180, 's'], [270, 'w']]) {
  test(`bed ${rotation}: headboard vertices and HQ placement agree with the plan`, () => {
    const p = plan(rotation), item = p.levels[0].furniture[0], m = buildModel(p, options);
    assert.equal(m.meta.furniture[0].against, side);
    assert.deepEqual(m.meta.furniture[0].size, [item.w, item.h], 'footprint was already rotated by the plan');
    const wood = m.builder.nodes.get('Furniture 1').get('wood'), points = [];
    for (let i = 0; i < wood.positions.length; i += 3) {
      const v = wood.positions.slice(i, i + 3); if (v[1] > 3) points.push(v);
    }
    assert.ok(points.length, 'measured tall headboard vertices, not only metadata');
    const bounds = [0, 2].map(axis => [Math.min(...points.map(p => p[axis])), Math.max(...points.map(p => p[axis]))]);
    const x = item.x - 12, z = item.y - 12;
    const expected = side === 'n' ? [[x, x + item.w], [z, z + 0.3]] : side === 's' ? [[x, x + item.w], [z + item.h - 0.3, z + item.h]] :
      side === 'e' ? [[x + item.w - 0.3, x + item.w], [z, z + item.h]] : [[x, x + 0.3], [z, z + item.h]];
    bounds.flat().forEach((v, i) => assert.ok(Math.abs(v - expected.flat()[i]) < 1e-6));
  });
}
test('explicit zero overrides nearest wall; absent and unsupported rotations retain legacy inference', () => {
  for (const rotation of [0, undefined, 45, null, '180']) {
    const p = plan(rotation); p.levels[0].furniture[0].y = 16;
    const m = buildModel(p, options);
    assert.equal(m.meta.furniture[0].against, rotation === 0 ? 'n' : 's');
  }
});
test('rotating a bed 180 degrees changes GLB geometry without changing its footprint', () => {
  const a = buildModel(plan(0), options), b = buildModel(plan(180), options);
  assert.deepEqual(a.meta.furniture[0].center, b.meta.furniture[0].center);
  assert.notDeepEqual(a.builder.nodes.get('Furniture 1').get('wood').positions, b.builder.nodes.get('Furniture 1').get('wood').positions);
  assert.ok(!toGlb(a).equals(toGlb(b)));
});
