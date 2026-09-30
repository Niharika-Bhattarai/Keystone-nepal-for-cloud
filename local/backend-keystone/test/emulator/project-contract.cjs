'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const { emulatorConfig } = require('../../lib/accounts/emulatorConfig');
const config = emulatorConfig(); // Fail BEFORE creating any SDK clients.
const { Firestore } = require('@google-cloud/firestore');
const { FirestoreStore } = require('../../lib/accounts/store');
const { resumeDeletion } = require('../../lib/accounts/lifecycle');
const db = new Firestore(config), store = new FirestoreStore(db);
const uid = `contract-${Date.now()}`;
test.after(async () => { await db.terminate(); });

test('real SDK: Unicode chunks, parallel revisions, retry, owner boundary, corruption, shrink and tombstone', async () => {
  await store.ensureUser(uid, 'emulator@example.test');
  const input = { name: 'Emulator house', survey: { notes: '庭'.repeat(400000) }, svg: '<svg/>', planSpec: { levels: [] } };
  const a = await store.saveProject(uid, null, input, { mutationId: 'create' });
  assert.deepEqual(await store.getProject(uid, a.id), a);
  assert.deepEqual(await store.saveProject(uid, null, input, { mutationId: 'create' }), a);
  assert.equal((await store.listProjects(uid))[0].planSpec, undefined);
  assert.equal(await store.getProject('other', a.id), null);
  const result = await Promise.allSettled(['one', 'two'].map(name => store.saveProject(uid, a.id, { name }, { expectedRevision: 1, mutationId: name })));
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(result.find(r => r.status === 'rejected').reason.code, 'PROJECT_CONFLICT');
  const chunk = db.doc(`projects/${a.id}/payload/0`), original = (await chunk.get()).data();
  await chunk.set({ data: 'broken' });
  await assert.rejects(store.getProject(uid, a.id), { code: 'PROJECT_CORRUPT' });
  await chunk.delete(); await assert.rejects(store.getProject(uid, a.id), { code: 'PROJECT_CORRUPT' });
  await chunk.set(original);
  const before = await store.getProject(uid, a.id);
  await assert.rejects(store.saveProject(uid, a.id, { svg: 'x'.repeat(1500000) }, { expectedRevision: 2, mutationId: 'large' }), { code: 'PROJECT_TOO_LARGE' });
  assert.deepEqual(await store.getProject(uid, a.id), before);
  const small = await store.saveProject(uid, a.id, { survey: { notes: 'small' } }, { expectedRevision: 2, mutationId: 'shrink' });
  assert.equal((await db.collection(`projects/${a.id}/payload`).get()).size, 1);
  await assert.rejects(store.deleteProject(uid, a.id, 1), { code: 'PROJECT_CONFLICT' });
  await store.deleteProject(uid, a.id, small.revision);
  assert.equal((await db.collection(`projects/${a.id}/payload`).get()).size, 0);
  await assert.rejects(store.saveProject(uid, null, input, { mutationId: 'create' }), { code: 'PROJECT_DELETED' });
});

test('real SDK: legacy migration and a late transaction write failure leave the old revision readable', async () => {
  const id = `${uid}-legacy`, ref = db.doc(`projects/${id}`);
  await ref.set({ id, ownerUid: uid, name: 'Legacy', planSpec: { levels: [] }, updatedAt: new Date().toISOString() });
  assert.equal((await store.getProject(uid, id)).revision, 0);
  const migrated = await store.saveProject(uid, id, { name: 'Migrated' }, { expectedRevision: 0, mutationId: 'migrate' });
  assert.equal((await ref.get()).data().planSpec, undefined);
  // Exercise real server rollback after writes have been queued: update a
  // nonexistent document last, causing the whole commit to fail.
  await assert.rejects(db.runTransaction(async tx => { const old = await tx.get(ref); tx.set(ref, { ...old.data(), name: 'must roll back' }); tx.update(db.doc(`missing/${uid}`), { value: 1 }); }));
  assert.deepEqual(await store.getProject(uid, id), migrated);
});

test('real SDK: deletion fences concurrent writes, pages 505 ledger records and retries identity cleanup', async () => {
  const ledger = db.collection(`users/${uid}/ledger`);
  for (let start = 0; start < 505; start += 150) { const batch = db.batch(); for (let i = start; i < Math.min(start + 150, 505); i++) batch.set(ledger.doc(String(i)), { at: 'test', delta: 0 }); await batch.commit(); }
  await Promise.allSettled([store.beginDeletion(uid), store.saveProject(uid, null, { name: 'racing' }, { mutationId: 'race' })]);
  await assert.rejects(store.saveProject(uid, null, {}, { mutationId: 'late' }), { code: 'ACCOUNT_DELETING' });
  await assert.rejects(store.ensureUser(uid), { code: 'ACCOUNT_DELETING' });
  const pending = await resumeDeletion(store, uid, async () => { throw new Error('provider unavailable'); });
  assert.equal(pending.state, 'pending');
  assert.equal((await db.collection('projects').where('ownerUid', '==', uid).get()).size, 0);
  assert.equal((await ledger.get()).size, 0);
  assert.equal(await store.getUser(uid), null);
  assert.ok((await store.listPendingDeletions()).some(j => j.uid === uid));
  // Resume from a separate process, proving the persisted fence/job is enough
  // after the initiating request or process has gone away.
  const worker = await promisify(execFile)(process.execPath, [path.resolve(__dirname, '../../scripts/resume-account-deletions.js')], {
    env: { ...process.env, KEYSTONE_EMULATOR_FAKE_IDENTITY: '1' }, windowsHide: true,
  });
  assert.equal(JSON.parse(worker.stdout).mode, 'demo-emulator');
  assert.equal((await store.getDeletion(uid)).state, 'complete');
  await assert.rejects(store.ensureUser(uid), { code: 'ACCOUNT_DELETING' });
});
