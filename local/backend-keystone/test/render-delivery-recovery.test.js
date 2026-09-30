'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { MemoryStore } = require('../lib/accounts/store');
const { RenderJobs } = require('../lib/accounts/renderJobs');
const { RenderDispatcher } = require('../lib/model3d/hq/dispatcher');
const { deliverOutbox, OUTBOX_LEASE_MS } = require('../lib/accounts/outbox');
let sequence = 0;
require('./helpers/render-recovery-contract.cjs').register(test, async () => ({ store: new MemoryStore(), uid: `recovery-${sequence++}` }));

test('two schedulers cannot exceed the global cap with different unclaimed jobs', async () => {
  const store = new MemoryStore(), jobs = new RenderJobs(store), launched = [];
  for (const uid of ['first', 'second']) {
    await store.ensureUser(uid); await store.updateUser(uid, { devAccess: {} });
    await store.credit(uid, { kind: 'grant_extra', amount: 1 }, 'test');
    const p = await store.saveProject(uid, null, { planSpec: { levels: [{}] } });
    await jobs.create(uid, { requestId: 'one', projectId: p.id, revision: 1 });
  }
  const dispatch = () => new RenderDispatcher({ jobs, launch: async j => { launched.push(j.id); }, maxConcurrent: 1 }).dispatch();
  await Promise.all([dispatch(), dispatch()]);
  await dispatch();
  assert.equal(launched.length, 1, 'pending launches hold durable capacity before the worker claims');
});

test('a late failed notification sender cannot turn a newer success back into pending', async () => {
  const store = new MemoryStore(); await store.ensureUser('owner', 'test@example.test');
  let now = Date.now(), release, began;
  const ready = new Promise(r => { began = r; }), gate = new Promise(r => { release = r; });
  store.outbox.set('notice', { id: 'notice', ownerUid: 'owner', status: 'pending', attempts: 0, nextAt: now, lease: null });
  const old = deliverOutbox(store, { send: async () => { began(); await gate; throw new Error('late failure'); } }, { clock: () => now });
  await ready; now += OUTBOX_LEASE_MS + 1;
  await deliverOutbox(store, { send: async () => {} }, { clock: () => now });
  release(); await old;
  assert.equal(store.outbox.get('notice').status, 'sent');
});
