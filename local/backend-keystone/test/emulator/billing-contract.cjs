'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { emulatorConfig } = require('../../lib/accounts/emulatorConfig');
const config = emulatorConfig();
const { Firestore } = require('@google-cloud/firestore');
const { FirestoreStore } = require('../../lib/accounts/store');
const { creditContract } = require('../helpers/credit-contract.cjs');
const { fixture } = require('../helpers/billing-fixture.cjs');
const billing = require('../../lib/accounts/billing');
const db = new Firestore(config);
let sequence = 0;
const prefix = `billing-${Date.now()}`;
test.after(async () => db.terminate());
creditContract(test, async () => ({ store: new FirestoreStore(db), uid: `${prefix}-${sequence++}` }));

test('real SDK: failed commit rolls back event, subscription, binding, ledger and balance; retry succeeds', async () => {
  const uid = `${prefix}-rollback`, store = new FirestoreStore(db), f = fixture();
  f.subscription.metadata.uid = uid;
  f.subscription.customer = f.invoice.customer = `cus_${uid}`;
  f.event.id = `evt_${uid}`;
  process.env.STRIPE_PRICE_PRO = 'price_pro'; billing.setStripe(f.client);
  await store.ensureUser(uid);
  let fail = true;
  const failingDb = { collection: name => db.collection(name), runTransaction: fn => db.runTransaction(async tx => {
    const result = await fn(tx);
    // An update of a nonexistent document makes the real server reject all
    // queued writes, including the processed-event receipt written last.
    if (fail) tx.update(db.doc(`missing/${uid}`), { fail: true });
    return result;
  }) };
  const failingStore = new FirestoreStore(failingDb);
  await assert.rejects(billing.handleEvent(f.event, failingStore));
  assert.equal((await db.doc(`stripeEvents/${f.event.id}`).get()).exists, false);
  assert.equal((await db.doc(`billingCustomers/cus_${uid}`).get()).exists, false);
  assert.equal((await store.getUser(uid)).subscription, null);
  assert.deepEqual(await store.listLedger(uid), []);
  assert.equal((await db.collection(`users/${uid}/creditOps`).get()).size, 0);
  fail = false;
  await billing.handleEvent(f.event, failingStore);
  assert.deepEqual((await store.getUser(uid)).credits, { monthly: 3, extra: 0 });
  assert.equal((await db.doc(`stripeEvents/${f.event.id}`).get()).exists, true);
});

test('real SDK: customer binding is exclusive under concurrent first subscriptions', async () => {
  const store = new FirestoreStore(db), customer = `cus_${prefix}_exclusive`;
  const uids = [`${prefix}-owner-a`, `${prefix}-owner-b`];
  await Promise.all(uids.map(uid => store.ensureUser(uid)));
  const results = await Promise.all(uids.map(uid => store.atomicAccount(uid, [], () => ({ patch: { stripeCustomerId: customer }, result: 'linked' }), `evt_${uid}`, customer)));
  assert.deepEqual(results.sort(), ['customer ownership mismatch', 'linked']);
});
