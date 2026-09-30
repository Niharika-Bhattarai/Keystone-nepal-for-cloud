'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { buildModel } = require('../lib/model3d');
const { closetLayout } = require('../lib/closetGeometry');

function vertices(bucket) {
  const p = [];
  for (let i = 0; i < bucket.positions.length; i += 3) p.push(bucket.positions.slice(i, i + 3));
  return p;
}
test('toilet tanks follow saved SVG convention even when another wall is closer', () => {
  for (const rotation of [undefined, 0, 90, 180]) {
    const sideways = rotation === 90, item = { kind: 'toilet', roomId: 'bath', x: 7, y: 7, w: sideways ? 2.5 : 2, h: sideways ? 2 : 2.5, rotation };
    const m = buildModel({ levels: [{ level: 1, width: 10, height: 10, rooms: [{ id: 'bath', type: 'bathroom', x: 0, y: 0, w: 10, h: 10 }], furniture: [item] }] });
    assert.equal(m.meta.furniture[0].against, sideways ? 'w' : 'n');
    const tank = vertices(m.builder.nodes.get('Furniture 1').get('porcelain')).filter(v => v[1] > 2);
    const axis = sideways ? 0 : 2, low = (sideways ? item.x : item.y) - 5;
    assert.ok(tank.length && tank.every(v => v[axis] >= low + 0.2 - 1e-6 && v[axis] <= low + 0.8 + 1e-6));
  }
});
for (const type of ['walk_in', 'reach_in']) for (const [front, rear] of [['top', 's'], ['bottom', 'n'], ['left', 'e'], ['right', 'w']]) {
  test(`${type} closet ${front}: backing, rail and shelves stay in the planned storage run`, () => {
    const horizontal = ['top', 'bottom'].includes(front), depth = type === 'walk_in' ? 6 : 2.5;
    const room = { id: 'closet', type: 'closet', ownerBedroomId: 'bed', closetType: type, closetFront: front, x: 2, y: 2, w: horizontal ? 7 : depth, h: horizontal ? depth : 7 };
    const layout = closetLayout(room), item = { ...layout.storage, kind: 'closet_storage', roomId: room.id };
    const m = buildModel({ levels: [{ level: 1, width: 12, height: 12, rooms: [room], furniture: [item] }] });
    const slot = m.meta.furniture[0]; assert.equal(slot.against, rear);
    assert.deepEqual(slot.size, [item.w, item.h]);
    const wood = m.builder.nodes.get('Furniture 1').get('wood'), metal = m.builder.nodes.get('Furniture 1').get('metal');
    assert.ok(metal, 'a hanging rail is modeled');
    const points = [...vertices(wood), ...vertices(metal)];
    assert.ok(points.every(v => v[0] >= item.x - 6 - 1e-6 && v[0] <= item.x + item.w - 6 + 1e-6 && v[2] >= item.y - 6 - 1e-6 && v[2] <= item.y + item.h - 6 + 1e-6), 'no storage extends into the access aisle');
    assert.ok(Math.abs(Math.max(...points.map(v => v[1])) - 6) < 1e-6);
    const solids = new Map();
    vertices(wood).forEach((v, i) => { const id = wood.solids[i]; if (!solids.has(id)) solids.set(id, []); solids.get(id).push(v); });
    const cx = item.x + item.w / 2 - 6, cz = item.y + item.h / 2 - 6, y = 2;
    assert.ok([...solids.values()].every(vs => ![cx, y, cz].every((v, axis) => v >= Math.min(...vs.map(p => p[axis])) && v <= Math.max(...vs.map(p => p[axis])))), 'front center between shelves is open, not a filled box');
  });
}
