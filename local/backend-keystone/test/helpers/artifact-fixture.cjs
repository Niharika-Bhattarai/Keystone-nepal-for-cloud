'use strict';
// Minimal valid render artifacts and an in-memory Cloud Storage double. The
// bucket models generations, create-only preconditions and versioned deletion;
// it is not evidence of behavior against the real service.
const fs = require('node:fs');
const { Readable } = require('node:stream');

// glTF 2.0 binary container: 12-byte header, one padded JSON chunk, a BIN chunk.
function glb(binBytes = 16) {
  let json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, buffers: [{ byteLength: binBytes }] }));
  json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
  const bin = Buffer.alloc(Math.ceil(binBytes / 4) * 4, 7);
  const out = Buffer.alloc(12 + 8 + json.length + 8 + bin.length);
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(json.length, 12); out.writeUInt32LE(0x4e4f534a, 16); json.copy(out, 20);
  const b = 20 + json.length; out.writeUInt32LE(bin.length, b); out.writeUInt32LE(0x004e4942, b + 4); bin.copy(out, b + 8);
  return out;
}
// Baseline JPEG markers: SOI, APP0, a 1x1 SOF0 frame, filler scan data, EOI.
function jpeg(fill = 16) {
  const sof = [0xff, 0xc0, 0, 11, 8, 0, 1, 0, 1, 1, 1, 0x11, 0];
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, ...sof, ...Array(fill).fill(0x11), 0xff, 0xd9]);
}

class FakeBucket {
  constructor() { this.objects = new Map(); this.generation = 1000; }
  history(key) { if (!this.objects.has(key)) this.objects.set(key, []); return this.objects.get(key); }
  current(key) { return (this.objects.get(key) || []).find(o => o.live) || null; }
  all() { return [...this.objects.values()].flat(); }
  overwrite(key, bytes) { this.history(key).forEach(o => { o.live = false; }); this.history(key).push({ key, bytes, generation: ++this.generation, live: true, metadata: {}, contentType: 'model/gltf-binary' }); }
  async upload(src, { destination, contentType, metadata = {}, preconditionOpts = {} }) {
    if (preconditionOpts.ifGenerationMatch === 0 && this.current(destination)) throw Object.assign(new Error('precondition'), { code: 412 });
    this.history(destination).forEach(o => { o.live = false; });
    this.history(destination).push({ key: destination, bytes: fs.readFileSync(src), generation: ++this.generation, live: true, metadata, contentType });
  }
  file(key, { generation } = {}) {
    const pick = () => generation == null ? this.current(key) : this.history(key).find(o => String(o.generation) === String(generation));
    const need = () => { const o = pick(); if (!o) throw Object.assign(new Error('not found'), { code: 404 }); return o; };
    return {
      getMetadata: async () => { const o = need(); return [{ size: String(o.bytes.length), generation: String(o.generation), contentType: o.contentType, cacheControl: o.metadata.cacheControl }]; },
      createReadStream: () => { try { return Readable.from([need().bytes]); } catch (e) { return new Readable({ read() { this.destroy(e); } }); } },
      getSignedUrl: async config => { need(); return [{ key, generation, config }]; },
    };
  }
  async getFiles({ prefix, versions }) {
    return [this.all().filter(o => o.key.startsWith(prefix) && (versions || o.live)).map(o => ({ name: o.key, generation: o.generation }))];
  }
  async deleteFiles({ prefix, versions }) {
    for (const [key, list] of this.objects) if (key.startsWith(prefix)) { const keep = versions ? [] : list.filter(o => !o.live); if (keep.length) this.objects.set(key, keep); else this.objects.delete(key); }
  }
}
module.exports = { glb, jpeg, FakeBucket };
