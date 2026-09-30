'use strict';
// Store contract for C4c delivery, run against memory and the real Firestore
// emulator: dispatch discovery and marking, owner listing, notification outbox
// claims and deletion cleanup.
const assert = require('node:assert/strict');
const { RenderJobs, LEASE_MS } = require('../../lib/accounts/renderJobs');
const { RenderDispatcher } = require('../../lib/model3d/hq/dispatcher');
const { deliverOutbox } = require('../../lib/accounts/outbox');
const files = [{ name: 'house.glb', contentType: 'model/gltf-binary', size: 12, sha256: '1'.repeat(64) }, { name: 'lm_a.jpg', contentType: 'image/jpeg', size: 8, sha256: '2'.repeat(64) }];

function register(test, factory) {
  async function setup() {
    const { store, uid } = await factory(); let now = Date.now();
    const jobs = new RenderJobs(store, { clock: () => now, pool: uid });
    const account = async (owner, credits) => {
      await store.ensureUser(owner, `${owner}@example.test`); await store.updateUser(owner, { devAccess: { grantedAt: 'test' } });
      await store.credit(owner, { kind: 'grant_extra', amount: credits }, 'test');
      return store.saveProject(owner, null, { name: 'Contract house', planSpec: { levels: [{}] } });
    };
    return { store, uid, jobs, account, tick: ms => { now += ms; }, clock: () => now };
  }
  test('delivery contract: paged discovery passes blocked owners and two dispatchers launch once', async () => {
    const { store, uid, jobs, account, tick } = await setup();
    for (let i = 0; i < 6; i++) {
      const owner = `${uid}-gone${i}`, p = await account(owner, 2);
      for (const r of ['a', 'b']) await jobs.create(owner, { requestId: r, projectId: p.id, revision: 1, options: { stills: false } });
      await store.beginDeletion(owner);
    }
    tick(1); const p = await account(uid, 1), wanted = await jobs.create(uid, { requestId: 'wanted', projectId: p.id, revision: 1, options: { stills: false } });
    const mine = j => j.ownerUid.startsWith(uid);
    // Other contracts can mutate their jobs between these scans. Compare the
    // stable fixture owned here; neither query promises a cross-scan snapshot.
    const whole = await jobs.dueScan({ pageSize: 500, maxPages: 50 }), paged = await jobs.dueScan({ pageSize: 5, maxPages: 50 });
    assert.equal(new Set(paged.map(j => j.id)).size, paged.length, 'pages do not repeat');
    assert.deepEqual(paged.filter(mine).map(j => j.id), whole.filter(mine).map(j => j.id), 'cursor paging preserves every stable fixture job in order');
    assert.ok(whole.filter(mine).some(j => j.id === wanted.id));
    assert.equal(whole.filter(mine).length, 13, 'twelve blocked jobs and the wanted one');
    const launched = [];
    const scoped = { ...jobs, clock: jobs.clock, running: async () => (await jobs.running()).filter(mine), dueScan: async o => (await jobs.dueScan(o)).filter(mine), markDispatched: (...a) => jobs.markDispatched(...a) };
    const make = () => new RenderDispatcher({ jobs: scoped, launch: async j => { launched.push(j.id); }, maxConcurrent: 1, pageSize: 500, maxPages: 50 });
    await Promise.all([make().dispatch(), make().dispatch()]);
    assert.deepEqual(launched, [wanted.id], 'the dispatch record lets only one scheduler launch it');
    tick(2 * LEASE_MS + 1);
    await make().dispatch();
    assert.deepEqual(launched, [wanted.id, wanted.id], 'relaunched after the retry delay because nobody claimed it');
  });
  test('delivery contract: owner listing is newest first and scoped; the outbox is claimed by one deliverer and purged with the account', async () => {
    const { store, uid, jobs, account, tick, clock } = await setup(), p = await account(uid, 2);
    const older = await jobs.create(uid, { requestId: 'older', projectId: p.id, revision: 1, options: { stills: false } }); tick(10);
    const newer = await jobs.create(uid, { requestId: 'newer', projectId: p.id, revision: 1, options: { stills: false } });
    assert.deepEqual((await jobs.list(uid)).map(r => r.id), [newer.id, older.id]);
    assert.equal((await jobs.list(`${uid}-nobody`)).length, 0);
    const c = await jobs.claim(uid, older.id); await jobs.complete(uid, older.id, c.token, files);
    let sends = 0; const slow = { send: async () => { sends++; await new Promise(r => setTimeout(r, 50)); } };
    const scopedStore = { ...store, listOutboxDue: async (now, limit) => (await store.listOutboxDue(now, 200)).filter(r => r.ownerUid === uid).slice(0, limit),
      updateOutbox: (...a) => store.updateOutbox(...a), getUser: (...a) => store.getUser(...a) };
    await Promise.all([deliverOutbox(scopedStore, slow, { clock }), deliverOutbox(scopedStore, slow, { clock })]);
    assert.equal(sends, 1, 'the lease claim lets exactly one deliverer send');
    const f = await jobs.claim(uid, newer.id); await jobs.fail(uid, newer.id, f.token);
    await store.beginDeletion(uid); tick(24 * 60 * 60_000);
    await jobs.cleanupOwner(uid, { remove: async () => ({ removed: 1 }) });
    await store.purgeAccountData(uid);
    assert.equal((await store.listOutboxDue(clock(), 200)).filter(r => r.ownerUid === uid).length, 0, 'intents are removed with the account');
  });
}
module.exports = { register };
