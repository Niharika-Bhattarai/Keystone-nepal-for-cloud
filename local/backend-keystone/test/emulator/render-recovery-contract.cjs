'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { emulatorConfig } = require('../../lib/accounts/emulatorConfig');
const { Firestore } = require('@google-cloud/firestore');
const { FirestoreStore } = require('../../lib/accounts/store');
const { RenderJobs } = require('../../lib/accounts/renderJobs');
const db = new Firestore(emulatorConfig()), prefix = `recovery-${Date.now()}`; let sequence = 0;
test.after(async () => db.terminate());
require('../helpers/render-recovery-contract.cjs').register(test, async () => ({ store: new FirestoreStore(db), uid: `${prefix}-${sequence++}` }));

test('real SDK: capacity admission and terminal release roll back with their job transition', async () => {
  const uid = `${prefix}-rollback`, store = new FirestoreStore(db);
  await store.ensureUser(uid); await store.updateUser(uid, { devAccess: {} });
  await store.credit(uid, { kind: 'grant_extra', amount: 1 }, 'test');
  const p = await store.saveProject(uid, null, { planSpec: { levels: [{}] } });
  let fail = false;
  const faulty = { collection: n => db.collection(n), runTransaction: fn => db.runTransaction(async tx => {
    const result = await fn(tx); if (fail) tx.update(db.doc(`missing/${uid}`), { fail: true }); return result;
  }) };
  const jobs = new RenderJobs(new FirestoreStore(faulty), { pool: uid });
  const job = await jobs.create(uid, { requestId: 'one', projectId: p.id, revision: 1 });
  fail = true; await assert.rejects(jobs.markDispatched(uid, job.id, 60000));
  assert.equal((await store.renderPools.doc(uid).get()).data().slots[job.id], undefined);
  assert.equal((await store.renderJobs.doc(job.id).get()).data().dispatch, undefined);
  fail = false; await jobs.markDispatched(uid, job.id, 60000); const c = await jobs.claim(uid, job.id);
  fail = true; await assert.rejects(jobs.fail(uid, job.id, c.token));
  assert.ok((await store.renderPools.doc(uid).get()).data().slots[job.id]);
  assert.equal((await store.renderJobs.doc(job.id).get()).data().state, 'running');
  assert.equal((await store.getUser(uid)).credits.extra, 0);
  fail = false; await jobs.fail(uid, job.id, c.token);
  assert.equal((await store.renderPools.doc(uid).get()).data().slots[job.id], undefined);
  assert.equal((await store.getUser(uid)).credits.extra, 1);
});
