'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { emulatorConfig } = require('../../lib/accounts/emulatorConfig');
const config = emulatorConfig();
const { Firestore } = require('@google-cloud/firestore');
const { FirestoreStore } = require('../../lib/accounts/store');
const { RenderJobs, LEASE_MS, WRITE_GRACE_MS } = require('../../lib/accounts/renderJobs');
const { register, files } = require('../helpers/render-job-contract.cjs');
const db = new Firestore(config), prefix = `jobs-${Date.now()}`; let sequence = 0;
test.after(async () => db.terminate());
register(test, async () => ({ store: new FirestoreStore(db), uid: `${prefix}-${sequence++}` }));
test('real SDK: failed commit cannot reserve credit without a job and immutable input', async () => {
  const uid = `${prefix}-rollback`, store = new FirestoreStore(db);
  await store.ensureUser(uid); await store.updateUser(uid, { devAccess: {} });
  await store.credit(uid, { kind: 'grant_extra', amount: 1 }, 'test');
  const project = await store.saveProject(uid, null, { planSpec: { levels: [{}] } });
  let fail = true;
  const failing = { collection: n => db.collection(n), runTransaction: fn => db.runTransaction(async tx => { const result = await fn(tx); if (fail) tx.update(db.doc(`missing/${uid}`), { fail: true }); return result; }) };
  const jobs = new RenderJobs(new FirestoreStore(failing)), input = { requestId: 'once', projectId: project.id, revision: 1 };
  await assert.rejects(jobs.create(uid, input));
  assert.equal((await store.getUser(uid)).credits.extra, 1);
  assert.equal((await store.renderJobs.where('ownerUid', '==', uid).get()).size, 0);
  assert.equal((await store.listLedger(uid)).filter(e => e.reason === 'bake_reserve').length, 0);
  fail = false;
  const result = await jobs.create(uid, input);
  assert.equal(result.state, 'queued'); assert.equal((await store.getUser(uid)).credits.extra, 0);
  assert.equal((await store.renderJobs.doc(result.id).collection('payload').get()).size, 1);
  const claim = await jobs.claim(uid, result.id);
  fail = true;
  await assert.rejects(jobs.complete(uid, result.id, claim.token, [...files, { name: 'exterior_front.jpg', contentType: 'image/jpeg', size: 8, sha256: '3'.repeat(64) }]));
  assert.equal((await jobs.get(uid, result.id).catch(() => null)), null, 'the injected transaction failure also affects reads');
  assert.equal((await store.renderJobs.doc(result.id).get()).data().state, 'running');
  assert.equal((await store.listLedger(uid)).filter(e => e.reason === 'bake_spend').length, 0);
  fail = false;
  await jobs.complete(uid, result.id, claim.token, [...files, { name: 'exterior_front.jpg', contentType: 'image/jpeg', size: 8, sha256: '3'.repeat(64) }]);
  assert.equal((await store.listLedger(uid)).filter(e => e.reason === 'bake_spend').length, 1);
});

test('real SDK: large immutable inputs survive project deletion and a separate worker process', async () => {
  const { execFile } = require('node:child_process'), { promisify } = require('node:util'), path = require('node:path');
  const uid = `${prefix}-process`, store = new FirestoreStore(db), jobs = new RenderJobs(store);
  await store.ensureUser(uid); await store.updateUser(uid, { devAccess: {} });
  await store.credit(uid, { kind: 'grant_extra', amount: 1 }, 'test');
  const planSpec = { levels: [{}], notes: '庭'.repeat(400000) };
  const project = await store.saveProject(uid, null, { planSpec });
  const job = await jobs.create(uid, { requestId: 'frozen', projectId: project.id, revision: 1, options: { stills: false } });
  assert.ok((await store.renderJobs.doc(job.id).collection('payload').get()).size > 1);
  assert.ok(Buffer.byteLength(JSON.stringify((await store.renderJobs.doc(job.id).get()).data())) < 10000);
  await store.deleteProject(uid, project.id, 1);
  const child = await promisify(execFile)(process.execPath, [path.join(__dirname, 'render-job-child.cjs'), uid, job.id], {
    env: { ...process.env, KEYSTONE_EMULATOR_FAKE_RENDER: '1' }, windowsHide: true,
  });
  const result = JSON.parse(child.stdout);
  assert.equal(result.mode, 'demo-fake-render'); assert.equal(result.result.state, 'done');
  assert.equal((await jobs.get(uid, job.id)).state, 'done');
  assert.equal((await store.getUser(uid)).credits.extra, 0);
});

test('real SDK: a failed cleanup record after storage removal is repeated safely; concurrent deletion workers agree', async () => {
  const uid = `${prefix}-cleanup`, store = new FirestoreStore(db); let now = Date.now();
  await store.ensureUser(uid); await store.updateUser(uid, { devAccess: {} });
  await store.credit(uid, { kind: 'grant_extra', amount: 1 }, 'test');
  const project = await store.saveProject(uid, null, { planSpec: { levels: [{}] } });
  const job = await new RenderJobs(store, { clock: () => now }).create(uid, { requestId: 'cleanup', projectId: project.id, revision: 1 });
  const claim = await new RenderJobs(store, { clock: () => now }).claim(uid, job.id);
  await store.beginDeletion(uid); now += LEASE_MS + WRITE_GRACE_MS + 1;
  // Fail only the recording transaction, at the server, after storage removal.
  let calls = 0; const removed = [];
  const failing = { collection: n => db.collection(n), runTransaction: fn => db.runTransaction(async tx => { const result = await fn(tx); if (++calls === 2) tx.update(db.doc(`missing/${uid}`), { fail: true }); return result; }) };
  const artifacts = { remove: async id => { removed.push(id); return { removed: 1 }; } };
  await assert.rejects(new RenderJobs(new FirestoreStore(failing), { clock: () => now }).cleanupAttempts(uid, job.id, artifacts, { deleting: true }));
  assert.deepEqual(removed, [claim.artifactId]);
  assert.equal((await store.renderJobs.doc(job.id).get()).data().removedAttempts, undefined, 'nothing was recorded by the failed commit');
  await assert.rejects(store.purgeAccountData(uid), { code: 'RENDER_CLEANUP_REQUIRED' });
  const workers = [1, 2].map(() => new RenderJobs(store, { clock: () => now }).cleanupOwner(uid, artifacts));
  assert.deepEqual(await Promise.all(workers), [{ pending: 0 }, { pending: 0 }]);
  assert.ok(removed.length >= 2 && removed.every(id => id === claim.artifactId), 'repeated removal is idempotent, never another attempt');
  assert.equal((await store.renderJobs.doc(job.id).get()).exists, false);
  assert.equal((await store.renderJobs.doc(job.id).collection('payload').get()).size, 0);
  await store.purgeAccountData(uid); assert.equal(await store.getUser(uid), null);
});
