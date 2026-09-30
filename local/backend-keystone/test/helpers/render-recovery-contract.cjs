'use strict';
const assert = require('node:assert/strict');
const { RenderJobs, LEASE_MS } = require('../../lib/accounts/renderJobs');
const { RenderDispatcher } = require('../../lib/model3d/hq/dispatcher');
const { deliverOutbox, OUTBOX_LEASE_MS, MAX_ATTEMPTS } = require('../../lib/accounts/outbox');

function register(test, factory) {
  async function setup() {
    const { store, uid } = await factory(); let now = Date.now(), seq = 0;
    const clock = () => now, jobs = new RenderJobs(store, { clock, pool: uid });
    async function create(owner = uid) {
      await store.ensureUser(owner, 'owner@example.test'); await store.updateUser(owner, { devAccess: {} });
      await store.credit(owner, { kind: 'grant_extra', amount: 1 }, 'test');
      const p = await store.saveProject(owner, null, { planSpec: { levels: [{}] } });
      return jobs.create(owner, { requestId: `request-${seq++}`, projectId: p.id, revision: 1 });
    }
    const scoped = {
      listOutboxDue: async t => (await store.listOutboxDue(t, 1000)).filter(r => r.ownerUid === uid),
      updateOutbox: (...args) => store.updateOutbox(...args), getUser: (...args) => store.getUser(...args),
    };
    async function notice() { const job = await create(), claim = await jobs.claim(uid, job.id); await jobs.fail(uid, job.id, claim.token); return (await scoped.listOutboxDue(now))[0]; }
    const readNotice = id => store.updateOutbox(id, r => r);
    const pool = async () => store.renderPools instanceof Map ? store.renderPools.get(uid) : (await store.renderPools.doc(uid).get()).data();
    return { store, uid, jobs, clock, create, scoped, notice, readNotice, pool, tick: ms => { now += ms; } };
  }
  test('recovery: distinct unclaimed launches share global and owner capacity across scheduler instances', async () => {
    const { jobs, uid, create } = await setup();
    const a = await create(), b = await create(), c = await create(`${uid}-other`);
    const due = [a, b, c].map((j, i) => ({ id: j.id, ownerUid: i === 2 ? `${uid}-other` : uid })), launched = [];
    const make = () => new RenderDispatcher({ jobs: { running: async () => [], dueScan: async () => due, markDispatched: (...a) => jobs.markDispatched(...a) },
      launch: async j => { launched.push(j.id); }, maxConcurrent: 2, perOwner: 1 });
    await Promise.all([make().dispatch(), make().dispatch()]); await make().dispatch();
    assert.deepEqual(launched.slice().sort(), [a.id, c.id].sort());
  });
  test('recovery: expired launch cannot steal capacity; claims and heartbeats retain it; failure releases it', async () => {
    const { store, uid, jobs, clock, create, tick, pool } = await setup();
    const a = await create(), b = await create(`${uid}-other`), cap = { maxConcurrent: 1, perOwner: 1 };
    assert.equal(await jobs.markDispatched(uid, a.id, 1000, cap), true);
    tick(1001);
    const restarted = new RenderJobs(store, { clock, pool: uid });
    assert.equal(await restarted.markDispatched(`${uid}-other`, b.id, 1000, cap), true);
    assert.equal(await jobs.claim(uid, a.id), null, 'delayed execution lost admission');
    const claim = await restarted.claim(`${uid}-other`, b.id); assert.ok(claim);
    tick(LEASE_MS - 1); await restarted.heartbeat(`${uid}-other`, b.id, claim.token, 0.5); tick(2);
    assert.equal(await jobs.markDispatched(uid, a.id, 1000, cap), false, 'renewed lease survives original launch timeout');
    await restarted.fail(`${uid}-other`, b.id, claim.token);
    assert.equal((await pool()).slots[b.id], undefined);
    assert.equal(await jobs.markDispatched(uid, a.id, 1000, cap), true);
  });
  test('recovery: both deletion cleanup paths erase owner capacity and preserve other owners', async () => {
    for (const cleanup of ['purge', 'artifacts']) {
      const { store, uid, jobs, create, pool } = await setup();
      const a = await create(), b = await create(`${uid}-other`), cap = { maxConcurrent: 2, perOwner: 1 };
      await jobs.markDispatched(uid, a.id, 60000, cap); await jobs.markDispatched(`${uid}-other`, b.id, 60000, cap);
      await store.beginDeletion(uid);
      if (cleanup === 'artifacts') await jobs.cleanupOwner(uid, { remove: async () => ({ removed: 0 }) });
      else await store.purgeAccountData(uid);
      const slots = (await pool()).slots; assert.equal(slots[a.id], undefined); assert.equal(slots[b.id].ownerUid, `${uid}-other`);
    }
  });
  for (const lateFails of [true, false]) test(`recovery: stale notification ${lateFails ? 'failure' : 'success'} cannot settle a newer lease`, async () => {
    const { scoped, clock, tick, notice, readNotice } = await setup(), n = await notice();
    let release, began; const ready = new Promise(r => { began = r; }), gate = new Promise(r => { release = r; });
    const old = deliverOutbox(scoped, { send: async () => { began(); await gate; if (lateFails) throw new Error('late'); } }, { clock });
    await ready; tick(OUTBOX_LEASE_MS + 1);
    await deliverOutbox(scoped, { send: async () => { if (!lateFails) throw new Error('retry'); } }, { clock });
    const before = await readNotice(n.id); release(); const result = await old;
    assert.equal(result[0].status, 'stale'); assert.deepEqual(await readNotice(n.id), before);
    assert.equal(before.attempts, 2);
  });
  test('recovery: interrupted notification attempts are bounded and deletion prevents sending', async () => {
    const { store, uid, scoped, clock, tick, notice, readNotice } = await setup(), n = await notice();
    const active = [], releases = [];
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      let began; const ready = new Promise(r => { began = r; });
      active.push(deliverOutbox(scoped, { send: () => { began(); return new Promise(r => releases.push(r)); } }, { clock }));
      await ready; tick(OUTBOX_LEASE_MS + 1);
    }
    let sends = 0; const provider = { send: async () => { sends++; } };
    await deliverOutbox(scoped, provider, { clock }); releases.forEach(r => r()); await Promise.all(active);
    assert.equal(sends, 0); assert.equal((await readNotice(n.id)).status, 'failed'); assert.equal((await readNotice(n.id)).attempts, MAX_ATTEMPTS);
    const second = await notice(); await store.beginDeletion(uid);
    await deliverOutbox(scoped, provider, { clock });
    assert.equal(sends, 0); assert.equal((await readNotice(second.id)).status, 'dropped');
  });
}
module.exports = { register };
