'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const Stripe = require('stripe');
const { MemoryStore, setStore, NoCreditsError } = require('../lib/accounts/store');
const { setVerifier, attachUser } = require('../lib/accounts/auth');
const { tierOf, featuresFor, requireFeature, withoutElevationDrawings, PLAN } = require('../lib/accounts/entitlements');
const billing = require('../lib/accounts/billing');
const { fixture } = require('./helpers/billing-fixture.cjs');

// test tokens: "dev:<uid>:<email>"
setVerifier(async (t) => {
  const m = /^dev:(\w+):(.+)$/.exec(t);
  if (!m) throw new Error('bad token');
  return { uid: m[1], email: m[2], email_verified: true };
});

function server(store) {
  setStore(store);
  const app = express();
  app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), billing.webhook);
  app.use(express.json());
  app.use('/api', attachUser);
  app.use('/api', require('../api/account'));
  app.post('/api/render', requireFeature('render'), (req, res) => res.json({ success: true, rendered: true }));
  return new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
}

async function call(s, method, path, { token, body, headers = {} } = {}) {
  const isRaw = typeof body === 'string';
  const res = await fetch(`http://127.0.0.1:${s.address().port}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined && !isRaw ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : isRaw ? body : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

test('tiers unlock what the owner decided', () => {
  process.env.STRIPE_PRICE_PRO = 'price_pro';
  assert.equal(tierOf(null), 'anonymous');
  assert.equal(tierOf({ subscription: null }), 'free');
  assert.equal(tierOf({ subscription: { status: 'active', verified: true, approved: true, priceId: 'price_pro', currentPeriodEnd: new Date(Date.now() + 864e5).toISOString() } }), 'pro');
  assert.equal(tierOf({ subscription: { status: 'canceled' } }), 'free');
  assert.deepEqual(featuresFor('anonymous'), { plan: true, saveProjects: false, quick3d: false, edit: false, elevations: false, render: false, refine: false, estimate: false, downloads: false, photoreal: false });
  assert.equal(featuresFor('free').quick3d, true);
  // Hand edits need no language model: every account has them.
  assert.equal(featuresFor('free').edit, true);
  assert.equal(featuresFor('pro').edit, true);
  assert.equal(featuresFor('free').downloads, false);
  assert.equal(featuresFor('pro').photoreal, true);
  assert.equal(PLAN.priceUsd, 49);
  assert.equal(PLAN.photorealPerMonth, 3);
});

test('elevation drawings are stripped, their meta kept', () => {
  const out = withoutElevationDrawings({ a: 1, elevations: { frontSvg: '<svg/>', meta: { roofKind: 'hip' } } });
  assert.deepEqual(out, { a: 1, elevations: { meta: { roofKind: 'hip' } } });
});

test('credits: monthly first, reserve then spend or refund, never below zero', async () => {
  const st = new MemoryStore();
  await st.ensureUser('u1', 'a@b.c');
  await st.credit('u1', { kind: 'reset_monthly', amount: 3 }, 'plan_grant', 'in_1');
  await st.credit('u1', { kind: 'grant_extra', amount: 1 }, 'purchase', 'cs_1');
  const r1 = await st.credit('u1', { kind: 'reserve' }, 'bake_reserve', 'hq_1');
  assert.equal(r1.entry.bucket, 'monthly');
  assert.deepEqual(r1.credits, { monthly: 2, extra: 1 });
  await st.settle('u1', r1.entry.id, 'spent');
  const r2 = await st.credit('u1', { kind: 'reserve' }, 'bake_reserve', 'hq_2');
  await st.settle('u1', r2.entry.id, 'refunded');
  assert.equal(await st.settle('u1', r2.entry.id, 'refunded'), null, 'settling twice does nothing');
  assert.deepEqual((await st.getUser('u1')).credits, { monthly: 2, extra: 1 });
  // a new billing month resets the allowance and keeps bought credits
  await st.credit('u1', { kind: 'reset_monthly', amount: 3 }, 'plan_grant', 'in_2');
  assert.deepEqual((await st.getUser('u1')).credits, { monthly: 3, extra: 1 });
  for (let i = 0; i < 4; i++) await st.credit('u1', { kind: 'reserve' }, 'bake_reserve', `x${i}`);
  await assert.rejects(st.credit('u1', { kind: 'reserve' }, 'bake_reserve', 'x9'), NoCreditsError);
  const sum = (await st.listLedger('u1')).reduce((a, e) => a + e.delta, 0);
  assert.equal(sum, 0, 'the ledger explains the balance');
});

test('account routes: sign-in, tiers and projects', async () => {
  const s = await server(new MemoryStore());
  try {
    const anon = await call(s, 'GET', '/api/me');
    assert.equal(anon.body.tier, 'anonymous');
    assert.equal((await call(s, 'GET', '/api/projects')).status, 401);
    assert.equal((await call(s, 'POST', '/api/render', { body: {} })).body.code, 'SIGN_IN_REQUIRED');

    const tok = 'dev:alice:alice@example.com';
    const me = await call(s, 'GET', '/api/me', { token: tok });
    assert.equal(me.body.tier, 'free');
    assert.equal(me.body.user.email, 'alice@example.com');
    assert.equal(me.body.features.quick3d, true);
    const up = await call(s, 'POST', '/api/render', { token: tok, body: {} });
    assert.equal(up.status, 402);
    assert.equal(up.body.code, 'UPGRADE_REQUIRED');

    const created = await call(s, 'POST', '/api/projects', { token: tok, body: { name: 'Lake <house>', survey: { stories: '2 Stories' }, planSpec: { levels: [1] } } });
    assert.equal(created.status, 201);
    assert.equal(created.body.project.name, 'Lake house');
    const id = created.body.project.id;
    const list = await call(s, 'GET', '/api/projects', { token: tok });
    assert.equal(list.body.projects.length, 1);
    assert.equal(list.body.projects[0].planSpec, undefined, 'lists stay light');
    assert.equal((await call(s, 'GET', `/api/projects/${id}`, { token: 'dev:mallory:m@x.com' })).status, 404, 'no access to other accounts');
    assert.equal((await call(s, 'PUT', `/api/projects/${id}`, { token: tok, body: { name: 'Lake house v2', revision: 1 } })).body.project.name, 'Lake house v2');
    assert.equal((await call(s, 'DELETE', `/api/projects/${id}`, { token: tok, body: { revision: 2 } })).status, 200);
    assert.equal((await call(s, 'GET', '/api/me', { token: 'not-a-token' })).body.tier, 'anonymous', 'bad tokens are ignored, not trusted');
    assert.equal((await call(s, 'POST', '/api/billing/checkout', { token: tok })).status, 503, 'no Stripe key: a clear message');
  } finally { s.close(); }
});

test('Stripe webhook: subscribe, monthly credits, duplicates, cancel', async () => {
  const store = new MemoryStore();
  const s = await server(store);
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
  const f = fixture();
  f.subscription.metadata.uid = 'bob';
  process.env.STRIPE_PRICE_PRO = 'price_pro';
  await store.ensureUser('bob', 'bob@example.com');
  billing.setStripe({ ...f.client, webhooks: new Stripe('sk_test_dummy').webhooks,
    checkout: { sessions: { retrieve: async () => ({ mode: 'subscription', status: 'complete', subscription: 'sub_one', customer: 'cus_one', client_reference_id: 'bob' }) } } });
  const signer = new Stripe('sk_test_dummy');
  const send = (event) => {
    const payload = JSON.stringify(event);
    const header = signer.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
    return call(s, 'POST', '/api/stripe/webhook', { body: payload, headers: { 'Content-Type': 'application/json', 'Stripe-Signature': header } });
  };
  try {
    const forged = await call(s, 'POST', '/api/stripe/webhook', { body: '{}', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': 't=1,v1=forged' } });
    assert.equal(forged.status, 400, 'unsigned events are rejected');
    await send({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_one' } } });
    await send({ id: 'evt_2', type: 'customer.subscription.created', data: { object: f.subscription } });
    const invoice = f.event;
    assert.equal((await send(invoice)).status, 200);
    assert.equal((await send(invoice)).status, 200, 'retries are accepted');
    let bob = await store.getUser('bob');
    assert.equal(tierOf(bob), 'pro');
    assert.deepEqual(bob.credits, { monthly: 3, extra: 0 }, 'a retried invoice grants once');
    const me = await call(s, 'GET', '/api/me', { token: 'dev:bob:bob@example.com' });
    assert.equal(me.body.tier, 'pro');
    assert.equal(me.body.credits.total, 3);
    assert.equal((await call(s, 'POST', '/api/render', { token: 'dev:bob:bob@example.com', body: {} })).body.rendered, true);
    f.subscription.status = 'canceled';
    await send({ id: 'evt_4', type: 'customer.subscription.deleted', data: { object: f.subscription } });
    bob = await store.getUser('bob');
    assert.equal(tierOf(bob), 'free');
  } finally { s.close(); billing.setStripe(null); delete process.env.STRIPE_WEBHOOK_SECRET; }
});

test('open testing: until OPEN_PRO_UNTIL every account with an email has Pro, with no photoreal credits', async () => {
  const store = new MemoryStore();
  const s = await server(store);
  const tok = 'dev:tess:tess@example.com';
  try {
    delete process.env.OPEN_PRO_UNTIL;
    assert.equal((await call(s, 'GET', '/api/me', { token: tok })).body.tier, 'free', 'off when unset');
    assert.equal((await call(s, 'GET', '/api/me')).body.openTesting, null);
    process.env.OPEN_PRO_UNTIL = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    const me = await call(s, 'GET', '/api/me', { token: tok });
    assert.equal(me.body.tier, 'pro');
    assert.equal(me.body.plan.testing, true);
    assert.equal(me.body.features.edit, true);
    assert.equal(me.body.features.estimate, true);
    assert.equal(me.body.credits.total, 0, 'no photoreal houses come with testing');
    assert.ok(me.body.openTesting.until.endsWith('T23:59:59.000Z'), 'a date lasts to the end of that day');
    assert.ok((await call(s, 'GET', '/api/me')).body.openTesting, 'signed-out visitors are told too');
    assert.equal((await call(s, 'GET', '/api/me')).body.tier, 'anonymous', 'but they need an account');
    assert.equal(tierOf({ email: '' }), 'free', 'an account without an email stays free');
    process.env.OPEN_PRO_UNTIL = '2020-01-01';
    assert.equal((await call(s, 'GET', '/api/me', { token: tok })).body.tier, 'free', 'a past date ends it');
  } finally { s.close(); delete process.env.OPEN_PRO_UNTIL; }
});

test('developer key: off by default, wrong keys refused, right key gives Pro and credits', async () => {
  const store = new MemoryStore();
  const s = await server(store);
  const tok = 'dev:devon:devon@example.com';
  try {
    delete process.env.DEV_ACCESS_KEYS;
    assert.equal((await call(s, 'POST', '/api/me/devkey', { token: tok, body: { key: 'anything-at-all' } })).status, 404, 'off when unset');
    process.env.DEV_ACCESS_KEYS = 'keystone-dev-key-one, short';
    assert.equal((await call(s, 'POST', '/api/me/devkey', { body: { key: 'keystone-dev-key-one' } })).status, 401, 'needs an account');
    assert.equal((await call(s, 'POST', '/api/me/devkey', { token: tok, body: { key: 'short' } })).status, 403, 'keys under 8 characters never work');
    assert.equal((await call(s, 'POST', '/api/me/devkey', { token: tok, body: { key: 'wrong-key-here' } })).body.code, 'BAD_KEY');
    const ok = await call(s, 'POST', '/api/me/devkey', { token: tok, body: { key: 'keystone-dev-key-one' } });
    assert.equal(ok.body.tier, 'pro');
    assert.equal(ok.body.plan.developer, true);
    assert.equal(ok.body.credits.monthly, 3);
    await store.credit('devon', { kind: 'reserve' }, 'bake_reserve', 'dev-render');
    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await call(s, 'POST', '/api/me/devkey', { token: tok, body: { key: 'keystone-dev-key-one' } })).status);
    assert.deepEqual(statuses, [200, 200, 429], 'five attempts a minute; entering it again is harmless');
    assert.equal((await store.getUser('devon')).credits.monthly, 2, 're-entering the key does not refill a spent credit');
    const off = await call(s, 'DELETE', '/api/me/devkey', { token: tok });
    assert.equal(off.body.tier, 'free');
  } finally { s.close(); delete process.env.DEV_ACCESS_KEYS; }
});
