'use strict';

// GLB (binary glTF 2.0) and OBJ/MTL writers for a MeshBuilder. Both write
// meters, the unit glTF and most modelling tools expect.

const { hexToRgb, srgbToLinear } = require('./materials');

const FT = 0.3048;

function toGlb(model, { name = 'Keystone AI house', withSolids = false } = {}) {
  const { builder, palette, meta } = model;
  const matNames = [];
  const matIndex = new Map();
  const nodes = [], meshes = [], accessors = [], bufferViews = [];
  const chunks = [];
  let byteLength = 0;

  const push = (typed, target) => {
    const pad = (4 - (byteLength % 4)) % 4;
    if (pad) { chunks.push(Buffer.alloc(pad)); byteLength += pad; }
    const buf = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: buf.length, target });
    chunks.push(buf); byteLength += buf.length;
    return bufferViews.length - 1;
  };

  for (const [nodeName, byMat] of builder.nodes) {
    const primitives = [];
    for (const [mat, b] of byMat) {
      if (!b.indices.length) continue;
      if (!matIndex.has(mat)) { matIndex.set(mat, matNames.length); matNames.push(mat); }
      const pos = new Float32Array(b.positions.length);
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < b.positions.length; i++) {
        const v = b.positions[i] * FT; pos[i] = v;
        const c = i % 3; if (v < min[c]) min[c] = v; if (v > max[c]) max[c] = v;
      }
      const nor = Float32Array.from(b.normals);
      const uv = Float32Array.from(b.uvs || [], (v, i) => (i % 2 ? -v : v)); // glTF V runs down the image
      const idx = Uint32Array.from(b.indices);
      const sid = Float32Array.from(b.solids || []);
      const pv = push(pos, 34962), nv = push(nor, 34962), tv = push(uv, 34962), iv = push(idx, 34963);
      accessors.push({ bufferView: pv, componentType: 5126, count: pos.length / 3, type: 'VEC3', min, max });
      accessors.push({ bufferView: nv, componentType: 5126, count: nor.length / 3, type: 'VEC3' });
      accessors.push({ bufferView: tv, componentType: 5126, count: uv.length / 2, type: 'VEC2' });
      accessors.push({ bufferView: iv, componentType: 5125, count: idx.length, type: 'SCALAR' });
      const attributes = { POSITION: accessors.length - 4, NORMAL: accessors.length - 3, TEXCOORD_0: accessors.length - 2 };
      if (withSolids && sid.length === pos.length / 3) {
        // application-specific attribute (leading underscore per the glTF spec)
        accessors.push({ bufferView: push(sid, 34962), componentType: 5126, count: sid.length, type: 'SCALAR' });
        attributes._SOLID = accessors.length - 1;
      }
      primitives.push({ attributes, indices: accessors.length - (attributes._SOLID != null ? 2 : 1), material: matIndex.get(mat) });
    }
    if (!primitives.length) continue;
    meshes.push({ name: nodeName, primitives });
    nodes.push({ name: nodeName, mesh: meshes.length - 1, extras: builder.nodeExtras.get(nodeName) || undefined });
  }

  const materials = matNames.map((m) => {
    const def = palette[m] || { color: '#CCCCCC', roughness: 0.8, metallic: 0 };
    const [r, g, b] = hexToRgb(def.color).map(srgbToLinear);
    const out = { name: m, pbrMetallicRoughness: { baseColorFactor: [r, g, b, def.alpha ?? 1], metallicFactor: def.metallic, roughnessFactor: def.roughness } };
    if (def.alpha != null && def.alpha < 1) { out.alphaMode = 'BLEND'; out.doubleSided = true; }
    if (def.emissive) out.emissiveFactor = hexToRgb(def.emissive).map(srgbToLinear);
    return out;
  });

  const json = {
    asset: { version: '2.0', generator: 'Keystone AI model3d' },
    scene: 0,
    scenes: [{ name, nodes: nodes.map((_, i) => i), extras: toMeters(meta) }],
    nodes, meshes, materials, accessors, bufferViews,
    buffers: [{ byteLength }],
  };

  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const jpad = (4 - (jsonBuf.length % 4)) % 4;
  if (jpad) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jpad, 0x20)]);
  let bin = Buffer.concat(chunks);
  const bpad = (4 - (bin.length % 4)) % 4;
  if (bpad) bin = Buffer.concat([bin, Buffer.alloc(bpad)]);

  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // 'glTF'
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(jsonBuf.length, 0); jh.writeUInt32LE(0x4e4f534a, 4); // JSON
  const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4); // BIN
  return Buffer.concat([header, jh, jsonBuf, bh, bin]);
}

// Metadata in meters for viewers (walkthrough start, level heights, rooms).
function toMeters(meta) {
  const m = (v) => (Array.isArray(v) ? v.map((x) => +(x * FT).toFixed(4)) : +(v * FT).toFixed(4));
  return {
    units: 'meters',
    footprint: { width: m(meta.footprint.width), depth: m(meta.footprint.depth) },
    levels: meta.levels.map((l) => ({ ...l, floorY: m(l.floorY), ceilingY: m(l.ceilingY) })),
    rooms: meta.rooms.map((r) => ({ ...r, center: m(r.center), floorY: m(r.floorY) })),
    entry: meta.entry ? { ...meta.entry, position: m(meta.entry.position), floorY: m(meta.entry.floorY) } : null,
    stairPath: meta.stairPath.map((s) => ({ from: m(s.from), to: m(s.to) })),
    roof: meta.roof,
    // Footprints for the viewer's walkthrough (solid furniture): centre [x, floorY, z], size [w, d].
    furniture: (meta.furniture || []).map((f) => ({ kind: f.kind, level: f.level, center: m(f.center), size: m(f.size) })),
  };
}

function toObj(model, { mtlName = 'house.mtl' } = {}) {
  const { builder, palette } = model;
  const obj = ['# Keystone AI house model (meters)', `mtllib ${mtlName}`];
  const used = new Set();
  let vBase = 1;
  for (const [nodeName, byMat] of builder.nodes) {
    obj.push(`o ${nodeName.replace(/\s+/g, '_')}`);
    for (const [mat, b] of byMat) {
      used.add(mat);
      const n = b.positions.length / 3;
      for (let i = 0; i < n; i++) obj.push(`v ${(b.positions[i * 3] * FT).toFixed(4)} ${(b.positions[i * 3 + 1] * FT).toFixed(4)} ${(b.positions[i * 3 + 2] * FT).toFixed(4)}`);
      for (let i = 0; i < n; i++) obj.push(`vn ${b.normals[i * 3].toFixed(4)} ${b.normals[i * 3 + 1].toFixed(4)} ${b.normals[i * 3 + 2].toFixed(4)}`);
      for (let i = 0; i < n; i++) obj.push(`vt ${(b.uvs?.[i * 2] ?? 0).toFixed(4)} ${(b.uvs?.[i * 2 + 1] ?? 0).toFixed(4)}`);
      obj.push(`usemtl ${mat}`);
      for (let i = 0; i < b.indices.length; i += 3) {
        const [a, c, d] = [b.indices[i] + vBase, b.indices[i + 1] + vBase, b.indices[i + 2] + vBase];
        obj.push(`f ${a}/${a}/${a} ${c}/${c}/${c} ${d}/${d}/${d}`);
      }
      vBase += n;
    }
  }
  const mtl = ['# Keystone AI materials'];
  for (const m of used) {
    const def = palette[m] || { color: '#CCCCCC', roughness: 0.8 };
    const [r, g, b] = hexToRgb(def.color);
    mtl.push(`newmtl ${m}`, `Kd ${r.toFixed(4)} ${g.toFixed(4)} ${b.toFixed(4)}`, `Ns ${Math.round((1 - def.roughness) * 200)}`, `d ${def.alpha ?? 1}`, '');
  }
  return { obj: obj.join('\n') + '\n', mtl: mtl.join('\n') };
}

module.exports = { toGlb, toObj, toMeters };
