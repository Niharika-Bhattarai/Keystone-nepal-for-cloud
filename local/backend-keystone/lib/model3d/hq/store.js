'use strict';

// Where bake jobs keep their status and outputs.
//
//   LocalStore  - a folder on disk; files are served by the API itself
//                 (development, or a single-machine deployment).
//   GcsStore    - the GCS bucket (GCS_BUCKET_NAME) under models/<id>/;
//                 files are handed to the browser as signed URLs.
//
// Both expose the same async interface:
//   readJson(id, name) -> object | null
//   writeJson(id, name, obj)
//   put(id, name, localPath, contentType)
//   url(id, name) -> string the browser can fetch
//   localPath(id, name) -> path | null   (LocalStore only)

const fs = require('fs');
const path = require('path');

const SAFE = /^[a-z0-9][a-z0-9._-]{0,80}$/i;
const safeName = (s) => {
  if (!SAFE.test(String(s)) || String(s).includes('..')) throw new Error(`unsafe name: ${s}`);
  return String(s);
};

class LocalStore {
  constructor(root) {
    this.root = path.resolve(root);
  }

  dir(id) {
    return path.join(this.root, safeName(id));
  }

  async readJson(id, name) {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.dir(id), safeName(name)), 'utf8'));
    } catch {
      return null;
    }
  }

  async writeJson(id, name, obj) {
    fs.mkdirSync(this.dir(id), { recursive: true });
    const p = path.join(this.dir(id), safeName(name));
    fs.writeFileSync(p + '.tmp', JSON.stringify(obj));
    fs.renameSync(p + '.tmp', p);
  }

  async put(id, name, src) {
    fs.mkdirSync(this.dir(id), { recursive: true });
    const dest = path.join(this.dir(id), safeName(name));
    if (path.resolve(src) !== dest) fs.copyFileSync(src, dest);
  }

  url(id, name) {
    return `/api/plan/model/hq/${safeName(id)}/files/${safeName(name)}`;
  }

  localPath(id, name) {
    const p = path.join(this.dir(id), safeName(name));
    return fs.existsSync(p) ? p : null;
  }
}

class GcsStore {
  constructor(bucketName, prefix = 'models') {
    const { Storage } = require('@google-cloud/storage');
    this.bucket = new Storage().bucket(bucketName);
    this.prefix = prefix;
  }

  key(id, name) {
    return `${this.prefix}/${safeName(id)}/${safeName(name)}`;
  }

  async readJson(id, name) {
    try {
      const [buf] = await this.bucket.file(this.key(id, name)).download();
      return JSON.parse(buf.toString('utf8'));
    } catch {
      return null;
    }
  }

  async writeJson(id, name, obj) {
    await this.bucket.file(this.key(id, name)).save(JSON.stringify(obj), { contentType: 'application/json', resumable: false });
  }

  async put(id, name, src, contentType) {
    await this.bucket.upload(src, { destination: this.key(id, name), resumable: false, contentType, metadata: { cacheControl: 'public, max-age=31536000, immutable' } });
  }

  async url(id, name) {
    const [u] = await this.bucket.file(this.key(id, name)).getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + 24 * 3600 * 1000 });
    return u;
  }

  localPath() {
    return null;
  }
}

function defaultStore() {
  if (process.env.HQ_STORE === 'gcs' || (process.env.K_SERVICE && process.env.GCS_BUCKET_NAME)) {
    return new GcsStore(process.env.GCS_BUCKET_NAME);
  }
  return new LocalStore(process.env.HQ_LOCAL_DIR || path.join(__dirname, '..', '..', '..', 'bake', 'out', 'jobs'));
}

module.exports = { LocalStore, GcsStore, defaultStore, safeName };
