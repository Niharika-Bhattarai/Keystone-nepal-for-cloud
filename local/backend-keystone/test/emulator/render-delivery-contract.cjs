'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { emulatorConfig } = require('../../lib/accounts/emulatorConfig');
const config = emulatorConfig();
const { Firestore } = require('@google-cloud/firestore');
const { FirestoreStore } = require('../../lib/accounts/store');
const { RenderJobs } = require('../../lib/accounts/renderJobs');
const db = new Firestore(config), prefix = `delivery-${Date.now()}`; let sequence = 0;
test.after(async () => db.terminate());
require('../helpers/render-delivery-contract.cjs').register(test, async () => ({ store: new FirestoreStore(db), uid: `${prefix}-${sequence++}` }));

test('real SDK: a notification intent exists only if the terminal job commit does', async () => {
  const uid = `${prefix}-outbox`, store = new FirestoreStore(db);
  await store.ensureUser(uid, 'o@example.test'); await store.updateUser(uid, { devAccess: {} });
  await store.credit(uid, { kind: 'grant_extra', amount: 1 }, 'test');
  const project = await store.saveProject(uid, null, { planSpec: { levels: [{}] } });
  let fail = false;
  const failing = { collection: n => db.collection(n), runTransaction: fn => db.runTransaction(async tx => { const result = await fn(tx); if (fail) tx.update(db.doc(`missing/${uid}`), { fail: true }); return result; }) };
  const jobs = new RenderJobs(new FirestoreStore(failing)), job = await jobs.create(uid, { requestId: 'n', projectId: project.id, revision: 1, options: { stills: false } });
  const claim = await jobs.claim(uid, job.id);
  fail = true; await assert.rejects(jobs.fail(uid, job.id, claim.token));
  const intents = async () => (await store.outbox.where('ownerUid', '==', uid).get()).size;
  assert.equal(await intents(), 0); assert.equal((await store.renderJobs.doc(job.id).get()).data().state, 'running');
  fail = false; await jobs.fail(uid, job.id, claim.token);
  assert.equal(await intents(), 1);
  assert.equal((await store.getUser(uid)).credits.extra, 1, 'refund and intent committed together');
});
