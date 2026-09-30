'use strict';
const assert = require('node:assert/strict');
const billing = require('../../lib/accounts/billing');
const { tierOf } = require('../../lib/accounts/entitlements');
const { fixture } = require('./billing-fixture.cjs');

// The identical contract is registered against memory and the actual SDK/emulator.
function creditContract(test, factory) {
  async function account() {
    const { store, uid, close = async () => {} } = await factory();
    await store.ensureUser(uid);
    const f = fixture(); f.subscription.metadata.uid = uid;
    f.subscription.customer = f.invoice.customer = `cus_${uid}`;
    f.event.id = `evt_${uid}`;
    process.env.STRIPE_PRICE_PRO = 'price_pro'; billing.setStripe(f.client);
    return { store, uid, close, f };
  }
  test('credit contract: parallel duplicate invoice/events preserve spent credits', async () => {
    const { store, uid, close, f } = await account();
    try {
      await Promise.all([1, 2, 3].map(() => billing.handleEvent(f.event, store)));
      await store.credit(uid, { kind: 'reserve' }, 'bake_reserve', 'render');
      await billing.handleEvent({ ...f.event, id: `${f.event.id}_other` }, store);
      f.invoice.id = 'in_same_period';
      await billing.handleEvent({ ...f.event, id: `${f.event.id}_another_invoice` }, store);
      assert.deepEqual((await store.getUser(uid)).credits, { monthly: 2, extra: 0 });
      const ledger = await store.listLedger(uid);
      assert.equal(ledger.filter(e => e.reason === 'plan_grant' && !e.skipped).length, 1);
      assert.equal(ledger.reduce((n, e) => n + e.delta, 0), 2);
    } finally { await close(); }
  });
  test('credit contract: last-credit race, owner scoping, immutable settlement and job retries', async () => {
    const { store, uid, close } = await account();
    try {
      await store.credit(uid, { kind: 'grant_extra', amount: 1 }, 'test', 'initial');
      const results = await Promise.allSettled(['a', 'b'].map(ref => store.credit(uid, { kind: 'reserve' }, 'bake_reserve', ref)));
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal(results.find(r => r.status === 'rejected').reason.code, 'NO_CREDITS');
      const winner = results.find(r => r.status === 'fulfilled').value;
      const before = await store.listLedger(uid);
      assert.equal(await store.settle(`${uid}_other`, winner.entry.id, 'refunded').catch(e => e.message), 'no such user');
      await assert.rejects(store.settle(uid, winner.entry.id, 'typo'), { code: 'CREDIT_INVALID' });
      const settled = await Promise.all([1, 2].map(() => store.settle(uid, winner.entry.id, 'refunded')));
      assert.equal(settled.filter(Boolean).length, 1);
      const retry = await store.credit(uid, { kind: 'reserve' }, 'bake_reserve', winner.entry.ref);
      assert.equal(retry.state, 'refunded'); assert.equal(retry.entry.id, winner.entry.id);
      assert.deepEqual((await store.listLedger(uid)).find(e => e.id === winner.entry.id), before.find(e => e.id === winner.entry.id));
      assert.deepEqual((await store.getUser(uid)).credits, { monthly: 0, extra: 1 });
    } finally { await close(); }
  });
  test('credit contract: one reservation across concurrent retries and renewal refunds', async () => {
    const { store, uid, close } = await account();
    try {
      await store.credit(uid, { kind: 'reset_monthly', amount: 3 }, 'test', 'old');
      const reservations = await Promise.all([1, 2, 3].map(() => store.credit(uid, { kind: 'reserve' }, 'bake_reserve', 'job')));
      assert.equal(new Set(reservations.map(r => r.entry.id)).size, 1);
      await store.credit(uid, { kind: 'reset_monthly', amount: 3 }, 'test', 'new');
      await Promise.all([1, 2].map(() => store.settle(uid, reservations[0].entry.id, 'refunded')));
      assert.deepEqual((await store.getUser(uid)).credits, { monthly: 3, extra: 1 });
      assert.equal((await store.listLedger(uid)).reduce((n, e) => n + e.delta, 0), 4);
      await assert.rejects(store.credit(uid, { kind: 'grant_extra', amount: -1 }, 'test'), { code: 'CREDIT_INVALID' });
      await assert.rejects(store.credit(uid, { kind: 'reserve' }, 'bake_reserve'), { code: 'CREDIT_INVALID' });
      await assert.rejects(store.credit(uid, { kind: 'reset_monthly', amount: 9 }, 'test', 'new'), { code: 'CREDIT_CONFLICT' });
    } finally { await close(); }
  });
  test('credit contract: canonical cancellation beats old snapshots and concurrent stale fetch', async () => {
    const { store, uid, close, f } = await account();
    try {
      await billing.handleEvent(f.event, store);
      const stale = structuredClone(f.subscription);
      let release, fetched;
      const paused = new Promise(r => { fetched = r; });
      const gate = new Promise(r => { release = r; });
      let calls = 0;
      f.client.subscriptions.retrieve = async () => {
        calls++;
        if (calls === 2) { fetched(); await gate; return stale; }
        return structuredClone(f.subscription);
      };
      const old = billing.handleEvent({ id: `${f.event.id}_old`, type: 'customer.subscription.updated', data: { object: stale } }, store);
      await paused;
      f.subscription.status = 'canceled';
      await billing.handleEvent({ id: `${f.event.id}_cancel`, type: 'customer.subscription.deleted', data: { object: f.subscription } }, store);
      release(); await old;
      const user = await store.getUser(uid);
      assert.equal(user.subscription.status, 'canceled'); assert.equal(tierOf(user), 'free');
      assert.ok(calls >= 5, 'stale reconciliation fetched Stripe again after revision conflict');
    } finally { await close(); }
  });
  test('credit contract: deletion blocks webhook resurrection and removes credit receipts', async () => {
    const { store, uid, close, f } = await account();
    try {
      await billing.handleEvent(f.event, store);
      f.subscription.status = 'canceled';
      await billing.handleEvent({ id: `${f.event.id}_cancel`, type: 'customer.subscription.deleted', data: { object: f.subscription } }, store);
      await store.deleteUser(uid);
      f.subscription.status = 'active';
      assert.equal(await billing.handleEvent({ ...f.event, id: `${f.event.id}_late` }, store), 'account unavailable');
      assert.equal(await store.getUser(uid), null); assert.deepEqual(await store.listLedger(uid), []);
      await assert.rejects(store.credit(uid, { kind: 'grant_extra', amount: 1 }, 'test'), { code: 'ACCOUNT_DELETING' });
      if (store.db) {
        assert.equal((await store.db.collection(`users/${uid}/creditOps`).get()).size, 0);
        assert.equal((await store.db.collection('billingCustomers').where('ownerUid', '==', uid).get()).size, 0);
      } else { assert.equal(store.creditOps.has(uid), false); }
    } finally { await close(); }
  });
}
module.exports = { creditContract };
