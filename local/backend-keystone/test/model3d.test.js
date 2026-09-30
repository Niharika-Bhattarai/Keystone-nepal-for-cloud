'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildModel, toGlb, toObj } = require('../lib/model3d');
const plan = require('./fixtures/model3d-plan.json');

function readGlb(buf) {
  assert.equal(buf.readUInt32LE(0), 0x46546c67, 'GLB magic');
  assert.equal(buf.readUInt32LE(4), 2, 'glTF version 2');
  assert.equal(buf.readUInt32LE(8), buf.length, 'declared length');
  const jsonLen = buf.readUInt32LE(12);
  assert.equal(buf.readUInt32LE(16), 0x4e4f534a, 'JSON chunk');
  const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
  const binLen = buf.readUInt32LE(20 + jsonLen);
  return { json, binLen };
}

test('builds a two-level house with roof and furniture from a real plan', () => {
  const m = buildModel(plan);
  assert.deepEqual([...m.builder.nodes.keys()].sort(), ['Ceiling 1', 'Ceiling 2', 'Furniture 1', 'Furniture 2', 'Level 1', 'Level 2', 'Roof', 'Site']);
  assert.ok(m.stats.triangles > 2000 && m.stats.triangles < 80000, `triangles ${m.stats.triangles}`);
  assert.equal(m.meta.levels.length, 2);
  assert.equal(m.meta.stairPath.length, 2, 'stairs are built once, from the lower level');
  assert.ok(m.meta.entry, 'main entry found');
  assert.equal(m.meta.roof.type, 'gable');
});

test('GLB is valid glTF 2.0 with consistent buffers and linear materials', () => {
  const glb = toGlb(buildModel(plan));
  const { json, binLen } = readGlb(glb);
  assert.equal(json.asset.version, '2.0');
  assert.equal(json.buffers[0].byteLength <= binLen, true);
  for (const bv of json.bufferViews) assert.ok(bv.byteOffset + bv.byteLength <= json.buffers[0].byteLength);
  for (const acc of json.accessors) assert.ok(acc.count > 0);
  for (const mesh of json.meshes) for (const p of mesh.primitives) {
    assert.equal(json.accessors[p.indices].count % 3, 0);
    assert.ok(json.materials[p.material]);
  }
  const glass = json.materials.find((m) => m.name === 'glass');
  assert.equal(glass.alphaMode, 'BLEND');
  const extras = json.scenes[0].extras;
  assert.equal(extras.units, 'meters');
  assert.ok(extras.rooms.length > 10);
});

test('every triangle has an outward-facing normal on a closed box', () => {
  const { MeshBuilder } = require('../lib/model3d/meshBuilder');
  const mb = new MeshBuilder();
  mb.addBox('n', [0, 0, 0], [1, 2, 3], 'm');
  const b = mb.nodes.get('n').get('m');
  for (let i = 0; i < b.indices.length; i += 3) {
    const [a, c, d] = [b.indices[i], b.indices[i + 1], b.indices[i + 2]].map((k) => b.positions.slice(k * 3, k * 3 + 3));
    const e1 = c.map((v, j) => v - a[j]), e2 = d.map((v, j) => v - a[j]);
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const centre = [0.5, 1, 1.5], fc = [0, 1, 2].map((j) => (a[j] + c[j] + d[j]) / 3 - centre[j]);
    assert.ok(n[0] * fc[0] + n[1] * fc[1] + n[2] * fc[2] > 0, 'winding points outward');
  }
});

test('finish selections change the materials', () => {
  const brick = buildModel({ ...plan, finishSpec: { ...plan.finishSpec, exterior: { primaryCladding: { material: 'brick' } }, roofing: { material: 'clay_tile' } } });
  assert.equal(brick.palette.cladding.color, '#9A4E3A');
  assert.equal(brick.palette.roof.color, '#A5543A');
});

test('hostile strings in the plan never reach the output', () => {
  const bad = JSON.parse(JSON.stringify(plan));
  bad.levels[0].rooms[0].x = '"><script>';
  bad.levels[0].rooms[0].label = '<img src=x onerror=alert(1)>';
  const glb = toGlb(buildModel(bad));
  assert.ok(!glb.includes(Buffer.from('<script>')));
  const { obj } = toObj(buildModel(bad));
  assert.ok(!obj.includes('<script>'));
});

test('flat and hip roofs build', () => {
  assert.equal(buildModel(plan, { roofKind: 'flat_modern' }).meta.roof.type, 'flat');
  assert.equal(buildModel(plan, { roofKind: 'hip' }).meta.roof.type, 'hip');
});

test('rejects a plan without levels', () => {
  assert.throws(() => buildModel({ levels: [] }));
});

test('open-concept rooms share no wall; stairwell edges get rails, not walls', () => {
  const { boundaryKind } = require('../lib/model3d/buildModel');
  const k = (a, b, ctx = {}) => boundaryKind({ type: a }, { type: b }, { openConcept: true, stairMode: 'none', ...ctx });
  assert.equal(k('kitchen', 'dining_room'), 'open');
  assert.equal(k('living_room', 'dining_room'), 'open');
  assert.equal(k('kitchen', 'dining_room', { openConcept: false }), 'wall');
  assert.equal(k('loft', 'hallway'), 'open');
  assert.equal(k('stairs', 'hallway', { stairMode: 'opening' }), 'rail');
  assert.equal(k('stairs', 'hallway', { stairMode: 'flights' }), 'stringer');
  assert.equal(k('stairs', 'bedroom', { stairMode: 'opening' }), 'wall');
  assert.equal(k('bedroom', 'bathroom'), 'wall');
  const m = buildModel(plan);
  const l2 = m.builder.nodes.get('Level 2');
  assert.ok(l2.get('handrail') && l2.get('handrail').indices.length > 0, 'upper floor has a guard rail');
  assert.ok(m.builder.nodes.get('Level 1').get('handrail'), 'stair side has a sloped rail');
});

test('every vertex has a UV; lights and furniture slots are exported', () => {
  const m = buildModel(plan);
  for (const byMat of m.builder.nodes.values()) for (const b of byMat.values()) assert.equal(b.uvs.length / 2, b.positions.length / 3);
  const rooms = plan.levels.reduce((n, l) => n + l.rooms.length, 0);
  assert.ok(m.meta.lights.filter((l) => l.room !== 'exterior').length >= rooms - 2, 'a light in (nearly) every room');
  assert.ok(m.meta.lights.some((l) => l.kind === 'sconce'), 'porch lights');
  assert.ok(m.meta.furniture.length > 10 && m.meta.furniture.every((f) => f.kind && f.size[0] > 0));
  const { json } = readGlb(toGlb(m));
  assert.ok(json.meshes.every((me) => me.primitives.every((p) => p.attributes.TEXCOORD_0 != null)));
  assert.ok(json.materials.find((x) => x.name === 'fixture').emissiveFactor);
});

test('an L-shaped storey is roofed as intersecting pieces, not one bounding box', () => {
  const { coverRects } = require('../lib/model3d/buildModel');
  // 40 x 20 main block plus a 16 x 14 wing below its left end
  const L = [{ x0: 0, x1: 40, y0: 0, y1: 20 }, { x0: 0, x1: 16, y0: 20, y1: 34 }];
  const parts = coverRects(L, 40);
  assert.equal(parts.length, 2);
  const area = parts.reduce((a, r) => a + (r.x1 - r.x0) * (r.y1 - r.y0), 0);
  assert.ok(area >= 40 * 20 + 16 * 14, 'pieces cover the whole footprint');
  for (const r of parts) assert.ok(L.some((q) => r.x0 >= q.x0 && r.x1 <= q.x1) || r.x1 <= 16, 'no piece over empty ground');
  assert.equal(coverRects([{ x0: 0, x1: 30, y0: 0, y1: 20 }]).length, 1);
});

test('plans without a stair layout still get stairs', () => {
  const { synthStairLayout } = require('../lib/model3d/buildModel');
  const long = synthStairLayout({ rooms: [{ id: 's', type: 'stairs', x: 0, y: 0, w: 4, h: 18 }] }, { f2f: 10 });
  assert.equal(long.flights.length, 1, 'long room: one straight flight');
  assert.equal(long.flights[0].toZFt, 10);
  const short = synthStairLayout({ rooms: [{ id: 's', type: 'stairs', x: 0, y: 0, w: 8, h: 11 }] }, { f2f: 10 });
  assert.equal(short.flights.length, 2, 'short room: two flights and a landing');
  assert.equal(short.landings.length, 1);
  assert.equal(short.flights[1].toZFt, 10);
  const plan2 = JSON.parse(JSON.stringify(plan));
  delete plan2.levels[0].stairCore;
  const m = buildModel(plan2);
  assert.ok(m.meta.stairPath.length >= 1, 'stairs built from the stairs room');
});
