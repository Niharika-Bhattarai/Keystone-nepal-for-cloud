'use strict';
// Private output of one owned render attempt. Every location is derived from a
// server-issued attempt ID and a manifest-allowlisted file name, and both are
// checked before any storage call. Descriptors (size, SHA-256, type, pinned
// generation) are derived from the stored bytes, never from the worker's claims.
//
//   LocalArtifacts - a private folder (development, single machine)
//   GcsArtifacts   - private objects under owned-renders/<attemptId>/
//
// Neither is mounted by the application yet; HQ remains disabled.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
const { error } = require('../../accounts/creditRecords');

const ATTEMPT = /^rj_[a-f0-9]{40}_[a-f0-9]{32}$/;
const FILE = /^(?:house\.glb|lm_[a-zA-Z0-9_-]{1,70}\.jpg|(?:exterior|interior)_[a-zA-Z0-9_-]{1,64}\.jpg)$/;
const MAX_FILE = 500_000_000, MAX_URL_MS = 15 * 60_000;
const typeOf = name => (name.endsWith('.glb') ? 'model/gltf-binary' : 'image/jpeg');
function names(attemptId, name) {
  if (typeof attemptId !== 'string' || !ATTEMPT.test(attemptId)) throw error('ARTIFACT_INVALID', 'Invalid render attempt');
  if (name !== undefined && (typeof name !== 'string' || !FILE.test(name))) throw error('ARTIFACT_INVALID', 'Invalid render artifact name');
  return name;
}
// A writer belongs to one attempt. It stops accepting output once the attempt is
// cancelled (lost lease, deletion) or past the last time its lease was valid.
function open(signal, closed) {
  if (signal?.aborted || closed?.()) throw error('ARTIFACT_WRITER_CLOSED', 'This render attempt can no longer write output');
}

// Streams bytes once: hashes, measures and checks the container format.
// Header kept for the format checks: a GLB's entire JSON chunk (its declared
// length, at most 64 MB), or the first 256 KB of a JPEG, where its frame header is.
const MAX_JSON = 64 << 20, JPEG_HEAD = 256 << 10;
async function describe(stream, name, expectedSize) {
  const glb = name.endsWith('.glb'), hash = crypto.createHash('sha256'), parts = [];
  let size = 0, kept = 0, need = glb ? 20 : JPEG_HEAD, tail = Buffer.alloc(0);
  await pipeline(stream, async function (source) {
    for await (const chunk of source) {
      size += chunk.length;
      if (size > MAX_FILE) throw error('ARTIFACT_CONTENT_INVALID', 'Render artifact is too large');
      hash.update(chunk);
      for (let at = 0; kept < need && at < chunk.length;) {
        const take = chunk.subarray(at, at + need - kept);
        parts.push(take); kept += take.length; at += take.length;
        if (glb && need === 20 && kept === 20) need = 20 + Math.min(Buffer.concat(parts).readUInt32LE(12), MAX_JSON);
      }
      tail = chunk.length >= 2 ? chunk.subarray(-2) : Buffer.concat([tail, chunk]).subarray(-2);
    }
  });
  const head = Buffer.concat(parts);
  if (expectedSize !== undefined && size !== expectedSize) throw error('ARTIFACT_CHANGED', 'Render artifact changed while it was read');
  if (name.endsWith('.glb') ? !validGlb(head, size) : !validJpeg(head, tail, size)) throw error('ARTIFACT_CONTENT_INVALID', 'Render artifact is not a valid file of its type');
  return { name, contentType: typeOf(name), size, sha256: hash.digest('hex') };
}
// glTF 2.0 binary: magic, version 2, declared length equal to the stored size,
// and a first JSON chunk that parses to a 2.0 asset and lies inside the file.
function validGlb(b, size) {
  if (size < 28 || b.length < 20 || b.readUInt32LE(0) !== 0x46546c67 || b.readUInt32LE(4) !== 2 || b.readUInt32LE(8) !== size) return false;
  const length = b.readUInt32LE(12);
  if (b.readUInt32LE(16) !== 0x4e4f534a || length === 0 || length % 4 || 20 + length > size || 20 + length > b.length) return false;
  try { return JSON.parse(b.subarray(20, 20 + length).toString('utf8')).asset?.version === '2.0'; } catch { return false; }
}
// JPEG: start-of-image, a frame header before the scan, end-of-image last.
function validJpeg(b, tail, size) {
  if (size < 32 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff || tail[0] !== 0xff || tail[1] !== 0xd9) return false;
  for (let i = 2; i + 3 < b.length;) {
    if (b[i] !== 0xff) return false;
    const marker = b[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return true;
    if (marker === 0xda || marker === 0xd9) return false;
    i += 2 + b.readUInt16BE(i + 2);
  }
  return false;
}
const same = (a, b) => a.size === b.size && a.sha256 === b.sha256 && a.contentType === b.contentType;

class LocalArtifacts {
  constructor(root) { this.root = path.resolve(root); }
  file(attemptId, name) { names(attemptId, name); return path.join(this.root, attemptId, name); }
  writer(attemptId, { signal, closed } = {}) {
    names(attemptId);
    return { put: async (name, src) => {
      const target = this.file(attemptId, name); open(signal, closed);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      const partial = `${target}.${crypto.randomBytes(6).toString('hex')}.partial`;
      try { await fsp.copyFile(src, partial); open(signal, closed); await fsp.rename(partial, target); }
      finally { await fsp.rm(partial, { force: true }); }
    } };
  }
  async inspect(attemptId, name) {
    const target = this.file(attemptId, name);
    const stat = await fsp.lstat(target).catch(() => null);
    if (!stat?.isFile()) throw error('ARTIFACT_MISSING', 'Render artifact is missing');
    return { ...(await describe(fs.createReadStream(target), name, stat.size)), generation: null };
  }
  // Local files cannot be pinned, so the published bytes are re-verified on read.
  async read(attemptId, descriptor) {
    const target = this.file(attemptId, descriptor.name), bytes = await fsp.readFile(target).catch(() => null);
    if (!bytes) throw error('ARTIFACT_MISSING', 'Render artifact is missing');
    const found = await describe(Readable.from([bytes]), descriptor.name);
    if (!same(found, descriptor)) throw error('ARTIFACT_CHANGED', 'Render artifact no longer matches its manifest');
    return bytes;
  }
  async list(attemptId) {
    names(attemptId);
    return (await fsp.readdir(path.join(this.root, attemptId)).catch(() => [])).filter(n => FILE.test(n)).sort();
  }
  async remove(attemptId) {
    names(attemptId);
    const dir = path.join(this.root, attemptId), entries = await fsp.readdir(dir).catch(() => []);
    await fsp.rm(dir, { recursive: true, force: true });
    if (fs.existsSync(dir)) throw error('ARTIFACT_CLEANUP_FAILED', 'Render output could not be removed');
    return { removed: entries.length };
  }
}

class GcsArtifacts {
  constructor({ bucket, prefix = 'owned-renders', clock = Date.now } = {}) {
    if (!bucket) throw error('ARTIFACT_INVALID', 'A private bucket is required');
    if (!/^[a-z0-9-]{1,40}$/.test(prefix)) throw error('ARTIFACT_INVALID', 'Invalid artifact prefix');
    Object.assign(this, { bucket, prefix, clock });
  }
  key(attemptId, name) { names(attemptId, name); return `${this.prefix}/${attemptId}/${name}`; }
  writer(attemptId, { signal, closed } = {}) {
    names(attemptId);
    return { put: async (name, src) => {
      const destination = this.key(attemptId, name); open(signal, closed);
      try {
        // Create-only: an object can never be replaced after it was written, so a
        // late or duplicate writer cannot change what inspection measured.
        await this.bucket.upload(src, { destination, resumable: false, contentType: typeOf(name),
          metadata: { cacheControl: 'private, no-store' }, preconditionOpts: { ifGenerationMatch: 0 } });
      } catch (e) {
        if (Number(e.code) === 412) throw error('ARTIFACT_EXISTS', 'Render artifact was already written');
        throw e;
      }
    } };
  }
  async inspect(attemptId, name) {
    const key = this.key(attemptId, name);
    const [meta] = await this.bucket.file(key).getMetadata().catch(e => { if (Number(e.code) === 404) throw error('ARTIFACT_MISSING', 'Render artifact is missing'); throw e; });
    const generation = String(meta.generation), size = Number(meta.size);
    if (!/^[0-9]{1,30}$/.test(generation) || !Number.isSafeInteger(size)) throw error('ARTIFACT_CONTENT_INVALID', 'Invalid stored artifact metadata');
    // Read the exact generation measured above; a newer object is not this artifact.
    return { ...(await describe(this.bucket.file(key, { generation }).createReadStream(), name, size)), generation };
  }
  async url(attemptId, descriptor, { ttlMs = 5 * 60_000, download = false } = {}) {
    if (!Number.isInteger(ttlMs) || ttlMs < 1000 || ttlMs > MAX_URL_MS) throw error('ARTIFACT_INVALID', 'Invalid download lifetime');
    // Sign only the generation that was inspected, and only while it is still the live object.
    const key = this.key(attemptId, descriptor.name), [live] = await this.bucket.file(key).getMetadata().catch(() => [null]);
    if (!live || String(live.generation) !== descriptor.generation || Number(live.size) !== descriptor.size) throw error('ARTIFACT_CHANGED', 'Render artifact no longer matches its manifest');
    const [url] = await this.bucket.file(key, { generation: descriptor.generation }).getSignedUrl({ version: 'v4', action: 'read',
      expires: this.clock() + ttlMs, queryParams: { generation: descriptor.generation },
      ...(download ? { responseDisposition: `attachment; filename="keystone-${descriptor.name}"` } : {}) });
    return url;
  }
  async list(attemptId) {
    names(attemptId);
    const [files] = await this.bucket.getFiles({ prefix: `${this.prefix}/${attemptId}/` });
    return files.map(f => f.name.split('/').pop()).filter(n => FILE.test(n)).sort();
  }
  async remove(attemptId) {
    names(attemptId);
    const prefix = `${this.prefix}/${attemptId}/`, [before] = await this.bucket.getFiles({ prefix, versions: true });
    await this.bucket.deleteFiles({ prefix, versions: true, force: true });
    const [after] = await this.bucket.getFiles({ prefix, versions: true });
    if (after.length) throw error('ARTIFACT_CLEANUP_FAILED', 'Render output could not be removed');
    return { removed: before.length };
  }
}
module.exports = { LocalArtifacts, GcsArtifacts, validGlb, validJpeg, ARTIFACT_NAME: FILE, ATTEMPT_ID: ATTEMPT };
