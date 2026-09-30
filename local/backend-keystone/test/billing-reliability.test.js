'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { MemoryStore } = require('../lib/accounts/store');
const billing = require('../lib/accounts/billing');

const { fixture } = require('./helpers/billing-fixture.cjs');
const { creditContract } = require('./helpers/credit-contract.cjs');
creditContract(test, async () => ({ store: new MemoryStore(), uid: 'contract' }));

test('a failed grant leaves the verified event retryable', async () => {
  class FailOnce extends MemoryStore {
    fail = true;
    async credit(...args) { if (this.fail) { this.fail = false; throw new Error('injected failure'); } return super.credit(...args); }
    async atomicAccount(...args) { if (this.fail) { this.fail = false; throw new Error('injected failure'); } return super.atomicAccount(...args); }
  }
  const store = new FailOnce(), f = fixture();
  await store.ensureUser('alice'); process.env.STRIPE_PRICE_PRO = 'price_pro'; billing.setStripe(f.client);
  await assert.rejects(billing.handleEvent(f.event, store), /injected failure/);
  await billing.handleEvent(f.event, store);
  assert.deepEqual((await store.getUser('alice')).credits, { monthly: 3, extra: 0 });
});

test('retrying a reservation for the same job charges only once', async () => {
  const store = new MemoryStore(); await store.ensureUser('alice');
  await store.credit('alice', { kind: 'reset_monthly', amount: 3 }, 'plan_grant', 'in_old');
  const [a, b] = await Promise.all([1, 2].map(() => store.credit('alice', { kind: 'reserve' }, 'bake_reserve', 'same-job')));
  assert.equal(a.entry.id, b.entry.id);
  assert.equal((await store.getUser('alice')).credits.monthly, 2);
});

test('late monthly refund restores an extra credit without inflating the renewed allowance', async () => {
  const store = new MemoryStore(); await store.ensureUser('alice');
  await store.credit('alice', { kind: 'reset_monthly', amount: 3 }, 'plan_grant', 'in_old');
  const r = await store.credit('alice', { kind: 'reserve' }, 'bake_reserve', 'old-job');
  await store.credit('alice', { kind: 'reset_monthly', amount: 3 }, 'plan_grant', 'in_new');
  await store.settle('alice', r.entry.id, 'refunded');
  assert.deepEqual((await store.getUser('alice')).credits, { monthly: 3, extra: 1 });
});

test('Basil invoice fields grant credits without the removed paid boolean', async () => {
  const store = new MemoryStore(), f = fixture(); await store.ensureUser('alice');
  delete f.invoice.paid; delete f.invoice.subscription;
  f.invoice.parent = { type: 'subscription_details', subscription_details: { subscription: f.subscription.id } };
  const line = f.invoice.lines.data[0];
  line.parent = { type: 'subscription_item_details', subscription_item_details: { subscription: f.subscription.id, subscription_item: 'si_one', proration: false } };
  line.pricing = { type: 'price_details', price_details: { price: 'price_pro' } };
  delete line.price; delete line.subscription; delete line.subscription_item; delete line.proration;
  process.env.STRIPE_PRICE_PRO = 'price_pro'; billing.setStripe(f.client);
  await billing.handleEvent(f.event, store);
  assert.equal((await store.getUser('alice')).credits.monthly, 3);
});

test('unapproved prices, unpaid/one-off/proration invoices and mismatched identities never grant', async t => {
  const variants = {
    price: f => { f.subscription.items.data[0].price.id = 'price_other'; },
    quantity: f => { f.subscription.items.data[0].quantity = 2; },
    annual: f => { f.subscription.items.data[0].price.recurring.interval = 'year'; },
    currency: f => { f.subscription.items.data[0].price.currency = 'eur'; },
    amount: f => { f.subscription.items.data[0].price.unit_amount = 100; },
    unpaid: f => { f.invoice.status = 'open'; },
    remaining: f => { f.invoice.amount_remaining = 100; },
    manual: f => { f.invoice.billing_reason = 'manual'; },
    proration: f => { f.invoice.lines.data[0].proration = true; },
    customer: f => { f.invoice.customer = 'cus_wrong'; },
    item: f => { f.invoice.lines.data[0].subscription_item = 'si_wrong'; },
    period: f => { f.invoice.lines.data[0].period.start--; },
    truncated: f => { f.invoice.lines.has_more = true; },
    missingPeriod: f => { delete f.subscription.items.data[0].current_period_end; },
  };
  for (const [name, change] of Object.entries(variants)) await t.test(name, async () => {
    const store = new MemoryStore(), f = fixture(); await store.ensureUser('alice');
    change(f); billing.setStripe(f.client); process.env.STRIPE_PRICE_PRO = 'price_pro';
    await billing.handleEvent(f.event, store);
    assert.deepEqual((await store.getUser('alice')).credits, { monthly: 0, extra: 0 });
  });
});

test('allowance periods prevent old grants and convert expired refunds even before renewal', async () => {
  const store = new MemoryStore(); await store.ensureUser('alice');
  const start = Math.floor(Date.now() / 1000) - 10;
  const period = { id: 'current', start, end: start + 1000, source: 'stripe' };
  await store.credit('alice', { kind: 'reset_monthly', amount: 3, period }, 'plan_grant', 'invoice');
  const reserve = await store.credit('alice', { kind: 'reserve' }, 'bake_reserve', 'job');
  await store.credit('alice', { kind: 'reset_monthly', amount: 3, period: { ...period, id: 'old', start: start - 2000, end: start - 1000 } }, 'plan_grant', 'invoice_old');
  assert.equal((await store.getUser('alice')).credits.monthly, 2);
  const records = require('../lib/accounts/creditRecords');
  const future = new Date((period.end + 1) * 1000).toISOString();
  await store.atomicAccount('alice', [reserve.entry.id], (user, ops) => records.settle(user, ops, reserve.entry.id, 'refunded', future));
  assert.deepEqual((await store.getUser('alice')).credits, { monthly: 2, extra: 1 });
});

test('billing ownership binding rejects two accounts claiming one Stripe customer', async () => {
  const store = new MemoryStore(); await store.ensureUser('alice'); await store.ensureUser('bob');
  const results = await Promise.all(['alice', 'bob'].map(uid => store.atomicAccount(uid, [], () => ({ patch: { stripeCustomerId: 'cus_shared' }, result: 'linked' }), `evt_${uid}`, 'cus_shared')));
  assert.deepEqual(results.sort(), ['customer ownership mismatch', 'linked']);
});

test('entitlements require verified approved unexpired subscription data', () => {
  const { tierOf } = require('../lib/accounts/entitlements');
  process.env.STRIPE_PRICE_PRO = 'price_pro';
  const subscription = { verified: true, approved: true, priceId: 'price_pro', status: 'active', currentPeriodEnd: new Date(Date.now() + 100000).toISOString() };
  assert.equal(tierOf({ subscription }), 'pro');
  for (const patch of [{ verified: false }, { approved: false }, { priceId: 'wrong' }, { currentPeriodEnd: null }, { currentPeriodEnd: new Date(Date.now() - 1).toISOString() }, { status: 'past_due' }]) assert.equal(tierOf({ subscription: { ...subscription, ...patch } }), 'free');
});

test('provider outage is retryable and does not acknowledge a grant', async () => {
  const store = new MemoryStore(), f = fixture(); await store.ensureUser('alice');
  billing.setStripe(f.client); process.env.STRIPE_PRICE_PRO = 'price_pro';
  const retrieve = f.client.subscriptions.retrieve;
  f.client.subscriptions.retrieve = async () => { throw new Error('provider unavailable'); };
  await assert.rejects(billing.handleEvent(f.event, store), /provider unavailable/);
  assert.equal(store.events.size, 0);
  f.client.subscriptions.retrieve = retrieve;
  await billing.handleEvent(f.event, store);
  assert.equal((await store.getUser('alice')).credits.monthly, 3);
});

test('developer grants cannot refill a paid allowance, including a repeated key', async () => {
  const store = new MemoryStore(), f = fixture(); await store.ensureUser('alice');
  billing.setStripe(f.client); process.env.STRIPE_PRICE_PRO = 'price_pro';
  await billing.handleEvent(f.event, store);
  await store.credit('alice', { kind: 'reserve' }, 'bake_reserve', 'paid-job');
  const start = Math.floor(Date.now() / 1000), period = { id: 'developer:test', start, end: start + 86400, source: 'developer' };
  for (let i = 0; i < 2; i++) await store.credit('alice', { kind: 'reset_monthly', amount: 3, period }, 'admin', period.id);
  assert.equal((await store.getUser('alice')).credits.monthly, 2);
  assert.equal((await store.getUser('alice')).allowance.source, 'stripe');
});
