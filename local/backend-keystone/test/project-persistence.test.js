'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { MemoryStore, FirestoreStore, setStore } = require('../lib/accounts/store');
const records = require('../lib/accounts/projectRecords');
const { createApp } = require('../app');
const { setVerifier } = require('../lib/accounts/auth');
const { once } = require('node:events');

// Transaction contract double, not a Firestore emulator. Serializes transactions,
// rolls back failed writes, and rejects reads after writes / oversized documents.
class Database {
  constructor() { this.docs = new Map(); this.tail = Promise.resolve(); this.failWrite = false; }
  collection(path) { return new Collection(this, path); }
  async runTransaction(fn) {
    const operation = this.tail.then(async () => {
      const staged = new Map(this.docs); let writing = false;
      const tx = {
        get: async ref => { assert.equal(writing, false, 'all reads precede writes'); return ref.snapshot(staged); },
        set: (ref, data) => { writing = true; if (this.failWrite) throw new Error('disk unavailable'); assert.ok(Buffer.byteLength(JSON.stringify(data)) < 1_000_000); staged.set(ref.path, structuredClone(data)); },
        delete: ref => { writing = true; staged.delete(ref.path); },
      };
      const result = await fn(tx); this.docs = staged; return result;
    });
    this.tail = operation.catch(() => {}); return operation;
  }
}
class Reference {
  constructor(db, path) { this.db = db; this.path = path; this.id = path.split('/').at(-1); }
  collection(name) { return new Collection(this.db, `${this.path}/${name}`); }
  snapshot(map) { const value = map.get(this.path); return { exists: value !== undefined, id: this.id, ref: this, data: () => value === undefined ? undefined : structuredClone(value) }; }
}
class Collection {
  constructor(db, path) { this.db = db; this.path = path; }
  doc(id) { return new Reference(this.db, `${this.path}/${id}`); }
  snapshot(map) { return { docs: [...map.keys()].filter(k => k.startsWith(this.path + '/') && k.split('/').length === this.path.split('/').length + 1).map(k => new Reference(this.db, k).snapshot(map)) }; }
}

for (const kind of ['memory', 'firestore-contract']) test(`${kind}: revisions, retries, ownership, concurrent changes and deletion`, async () => {
  const store = kind === 'memory' ? new MemoryStore() : new FirestoreStore(new Database());
  const payload = { name: 'Courtyard', survey: { bedrooms: '3', notes: '庭'.repeat(400000) }, planSpec: { measurementBook: { version: 1 } }, svg: '<svg/>', studioState: { refinementsLeft: 4 } };
  const a = await store.saveProject('alice', null, payload, { mutationId: 'create-one' });
  assert.equal(a.revision, 1);
  assert.deepEqual(await store.getProject('alice', a.id), a);
  assert.deepEqual(await store.saveProject('alice', null, payload, { mutationId: 'create-one' }), a);
  assert.equal(await store.getProject('bob', a.id), null);
  assert.equal(await store.saveProject('bob', a.id, { name: 'stolen' }, { expectedRevision: 1 }), null);
  assert.equal(await store.deleteProject('bob', a.id, 1), false);
  const writes = await Promise.allSettled(['first', 'second'].map(name => store.saveProject('alice', a.id, { name }, { expectedRevision: 1, mutationId: name })));
  assert.equal(writes.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(writes.find(r => r.status === 'rejected').reason.code, 'PROJECT_CONFLICT');
  const b = await store.getProject('alice', a.id);
  assert.equal(b.revision, 2); assert.deepEqual(b.survey, payload.survey);
  const shrunk = await store.saveProject('alice', a.id, { survey: { notes: 'small' } }, { expectedRevision: 2, mutationId: 'shrink' });
  assert.equal(shrunk.revision, 3);
  if (store.db) assert.equal([...store.db.docs.keys()].filter(k => k.startsWith('projects/')).length, 2, 'shrinking removes obsolete chunks');
  await assert.rejects(store.deleteProject('alice', a.id, 1), { code: 'PROJECT_CONFLICT' });
  assert.equal(await store.deleteProject('alice', a.id, 3), true);
  assert.equal(await store.saveProject('alice', a.id, { name: 'resurrected' }, { expectedRevision: 3 }), null);
  if (store.db) assert.equal([...store.db.docs.keys()].filter(k => k.startsWith('projects/')).length, 0, 'delete removes payload chunks');
  await assert.rejects(store.saveProject('alice', null, payload, { mutationId: 'create-one' }), { code: 'PROJECT_DELETED' });
});

test('chunk codec detects corruption, enforces complete merged size and migrates legacy records', async () => {
  const p = records.applyProject(null, 'u', 'p', { survey: { notes: '🌳'.repeat(200000) } }, { mutationId: 'a' });
  const encoded = records.encode(p);
  assert.deepEqual(records.decode(encoded.metadata, encoded.chunks), p);
  assert.throws(() => records.decode(encoded.metadata, encoded.chunks.slice(1)), { code: 'PROJECT_CORRUPT' });
  const damaged = [...encoded.chunks]; damaged[0] = 'aGVsbG8=';
  assert.throws(() => records.decode(encoded.metadata, damaged), { code: 'PROJECT_CORRUPT' });
  assert.throws(() => records.applyProject(p, 'u', 'p', { svg: 'x'.repeat(1500000) }, { expectedRevision: 1, mutationId: 'b' }), { code: 'PROJECT_TOO_LARGE' });
  const db = new Database(), store = new FirestoreStore(db);
  db.docs.set('projects/old', { id: 'old', ownerUid: 'u', name: 'Legacy', planSpec: { levels: [] } });
  assert.equal((await store.getProject('u', 'old')).revision, 0);
  const next = await store.saveProject('u', 'old', { name: 'Migrated' }, { expectedRevision: 0, mutationId: 'migrate' });
  assert.equal(next.revision, 1); assert.deepEqual(next.planSpec, { levels: [] });
  assert.ok(db.docs.get('projects/old').payload); assert.equal(db.docs.get('projects/old').planSpec, undefined);
  db.failWrite = true;
  await assert.rejects(store.saveProject('u', 'old', { name: 'Lost' }, { expectedRevision: 1, mutationId: 'retry' }));
  assert.equal((await store.getProject('u', 'old')).name, 'Migrated');
  db.failWrite = false;
  assert.equal((await store.saveProject('u', 'old', { name: 'Retried' }, { expectedRevision: 1, mutationId: 'retry' })).revision, 2);
});

test('real project API requires revisions, protects saved elevations and retries creation once', async t => {
  const store = new MemoryStore(); setStore(store);
  setVerifier(async uid => ({ uid }));
  const server = createApp().listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const call = async (method, path, body, uid = 'alice') => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/projects${path}`, { method, headers: { Authorization: `Bearer ${uid}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, data: await r.json() };
  };
  const body = { mutationId: 'same-create', name: 'House', planSpec: { elevations: { frontSvg: 'paid-drawing', meta: { roof: 'hip' } } } };
  const a = await call('POST', '', body), id = a.data.project.id;
  assert.equal(a.status, 201); assert.equal(a.data.project.revision, 1);
  assert.equal(JSON.stringify(a).includes('paid-drawing'), false);
  assert.equal((await call('POST', '', body)).data.project.id, id);
  assert.equal((await store.listProjects('alice')).length, 1);
  assert.equal((await call('PUT', '/' + id, { name: 'no version' })).status, 428);
  assert.equal((await call('PUT', '/' + id, { revision: 1, mutationId: 'rename', name: 'Renamed' })).status, 200);
  assert.equal((await call('PUT', '/' + id, { revision: 1, mutationId: 'stale', name: 'Stale' })).status, 409);
  assert.equal((await call('GET', '/' + id, undefined, 'bob')).status, 404);
  await store.updateUser('alice', { devAccess: { grantedAt: 'test' } });
  assert.equal((await call('GET', '/' + id)).data.project.planSpec.elevations.frontSvg, 'paid-drawing');
  assert.equal((await call('DELETE', '/' + id, { revision: 2 })).status, 200);
});
