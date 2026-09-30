'use strict';
const assert = require('node:assert/strict');
const { RenderJobs, LEASE_MS, DEADLINE_MS, WRITE_GRACE_MS } = require('../../lib/accounts/renderJobs');
const files = [
  { name: 'house.glb', contentType: 'model/gltf-binary', size: 12, sha256: '1'.repeat(64) },
  { name: 'lm_floor.jpg', contentType: 'image/jpeg', size: 8, sha256: '2'.repeat(64) },
];
function register(test, factory) {
  async function setup() {
    const { store, uid } = await factory(); let now = Date.now();
    await store.ensureUser(uid); await store.updateUser(uid, { devAccess: { grantedAt: 'test' } });
    await store.credit(uid, { kind: 'reset_monthly', amount: 3 }, 'test', 'month');
    const project = await store.saveProject(uid, null, { name: 'House', planSpec: { levels: [{ rooms: [{ name: 'Bedroom', rotation: 90 }] }], finishSpec: { floor: 'oak' } } });
    const jobs = new RenderJobs(store, { clock: () => now });
    return { store, uid, project, jobs, tick: ms => { now += ms; }, input: { requestId: 'request', projectId: project.id, revision: project.revision, options: { stills: false } } };
  }
  test('render contract: atomic reserve, duplicate requests, immutable snapshot and owner isolation', async () => {
    const { store, uid, project, jobs, input } = await setup();
    const [a, b] = await Promise.all([jobs.create(uid, input), jobs.create(uid, input)]);
    assert.equal(a.id, b.id); assert.equal((await store.getUser(uid)).credits.monthly, 2);
    await assert.rejects(jobs.create(uid, { ...input, options: { stills: false, sky: 'dusk' } }), { code: 'JOB_CONFLICT' });
    await store.ensureUser(`${uid}_other`);
    assert.equal(await jobs.get(`${uid}_other`, a.id), null);
    assert.equal(await jobs.claim(`${uid}_other`, a.id), null);
    await store.saveProject(uid, project.id, { planSpec: { levels: [{ rooms: [] }] } }, { expectedRevision: 1 });
    assert.equal((await jobs.create(uid, input)).id, a.id, 'lost response retry survives a newer saved revision');
    await assert.rejects(jobs.create(uid, { ...input, requestId: 'different' }), { code: 'PROJECT_CONFLICT' });
    const claim = await jobs.claim(uid, a.id), snapshot = await jobs.input(uid, a.id, claim.token);
    assert.equal(snapshot.planSpec.levels[0].rooms[0].rotation, 90);
    assert.equal((await jobs.get(uid, a.id)).lease, undefined);
    assert.equal((await jobs.get(uid, a.id)).contentHash, undefined);
    assert.equal(await jobs.input(`${uid}_other`, a.id, claim.token), null);
  });
  test('render contract: last credit creates only one job and no partial loser', async () => {
    const { store, uid, jobs, input } = await setup();
    await store.credit(uid, { kind: 'reset_monthly', amount: 1 }, 'test', 'one');
    const results = await Promise.allSettled(['a', 'b'].map(requestId => jobs.create(uid, { ...input, requestId })));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.find(r => r.status === 'rejected').reason.code, 'NO_CREDITS');
    assert.equal((await store.getUser(uid)).credits.monthly, 0);
    // Large scan: the emulator is shared with other contracts' due jobs.
    assert.equal((await jobs.dueScan({ pageSize: 500, maxPages: 50 })).filter(j => j.ownerUid === uid).length, 1);
  });
  test('render contract: exclusive claims, lease takeover, stale worker fencing and atomic completion', async () => {
    const { store, uid, jobs, input, tick } = await setup(); const job = await jobs.create(uid, input);
    const claims = await Promise.all([1, 2].map(() => jobs.claim(uid, job.id)));
    assert.equal(claims.filter(Boolean).length, 1); const old = claims.find(Boolean);
    await jobs.heartbeat(uid, job.id, old.token, 0.5);
    tick(LEASE_MS + 1); const replacement = await jobs.claim(uid, job.id);
    assert.notEqual(replacement.artifactId, old.artifactId); assert.equal(replacement.attempt, 2);
    for (const action of [() => jobs.heartbeat(uid, job.id, old.token), () => jobs.complete(uid, job.id, old.token, files), () => jobs.fail(uid, job.id, old.token)]) await assert.rejects(action, { code: 'JOB_LEASE_LOST' });
    await assert.rejects(jobs.complete(uid, job.id, replacement.token, [files[0]]), { code: 'JOB_MANIFEST_INVALID' });
    const done = await jobs.complete(uid, job.id, replacement.token, files);
    assert.equal(done.state, 'done'); assert.equal((await jobs.complete(uid, job.id, replacement.token, files)).state, 'done');
    await assert.rejects(jobs.fail(uid, job.id, replacement.token), { code: 'JOB_LEASE_LOST' });
    assert.equal(await jobs.claim(uid, job.id), null);
    assert.deepEqual((await store.getUser(uid)).credits, { monthly: 2, extra: 0 });
    assert.equal((await store.listLedger(uid)).filter(e => e.reason === 'bake_spend').length, 1);
  });
  test('render contract: restart recovery is bounded and refunds once into the renewed extra bucket', async () => {
    const { store, uid, jobs, input, tick } = await setup(); const job = await jobs.create(uid, input);
    for (let i = 0; i < 3; i++) { assert.ok((await jobs.claim(uid, job.id)).token); tick(LEASE_MS + 1); }
    await store.credit(uid, { kind: 'reset_monthly', amount: 3 }, 'test', 'renewal');
    const freshService = new RenderJobs(store, { clock: jobs.clock });
    assert.ok((await freshService.due(100)).some(j => j.id === job.id));
    assert.equal((await freshService.claim(uid, job.id)).state, 'failed');
    assert.equal(await freshService.claim(uid, job.id), null);
    assert.deepEqual((await store.getUser(uid)).credits, { monthly: 3, extra: 1 });
    assert.equal((await store.listLedger(uid)).filter(e => e.reason === 'bake_refund').length, 1);
  });
  test('render contract: never-scheduled jobs expire; deletion cleans queued inputs and fences active attempts', async () => {
    const { store, uid, jobs, input, tick } = await setup(); const job = await jobs.create(uid, input);
    tick(DEADLINE_MS + 1);
    assert.equal((await jobs.claim(uid, job.id)).state, 'failed');
    assert.equal((await store.getUser(uid)).credits.monthly, 3);
    await store.deleteUser(uid); assert.equal(await store.getUser(uid), null);
    if (store.db) assert.equal((await store.renderJobs.doc(job.id).collection('payload').get()).size, 0);
    const other = await setup(), active = await other.jobs.create(other.uid, other.input), claim = await other.jobs.claim(other.uid, active.id);
    await other.store.beginDeletion(other.uid);
    await assert.rejects(other.jobs.complete(other.uid, active.id, claim.token, files), { code: 'ACCOUNT_DELETING' });
    await assert.rejects(other.store.purgeAccountData(other.uid), { code: 'RENDER_CLEANUP_REQUIRED' });
    assert.ok(await other.store.getUser(other.uid), 'identity/data cleanup must wait for artifact cleanup');
  });
  test('render contract: quiet attempts are cleaned, the published one kept, then deletion removes every attempt', async () => {
    const { store, uid, jobs, input, tick } = await setup(), job = await jobs.create(uid, input);
    const gone = [], artifacts = { remove: async id => { gone.push(id); return { removed: 1 }; } };
    const first = await jobs.claim(uid, job.id); tick(LEASE_MS + 1);
    const second = await jobs.claim(uid, job.id); await jobs.complete(uid, job.id, second.token, files);
    assert.deepEqual((await jobs.cleanupAttempts(uid, job.id, artifacts)).removed, [], 'the superseded worker may still be uploading');
    tick(WRITE_GRACE_MS);
    assert.deepEqual((await jobs.cleanupAttempts(uid, job.id, artifacts)).removed, [first.artifactId]);
    assert.deepEqual((await jobs.cleanupAttempts(uid, job.id, artifacts)).removed, [], 'the published attempt is kept while the account exists');
    const running = await jobs.create(uid, { ...input, requestId: 'running' }), live = await jobs.claim(uid, running.id);
    await assert.rejects(jobs.cleanupOwner(uid, artifacts), { code: 'JOB_INVALID' }, 'owner cleanup requires the deletion fence');
    await store.beginDeletion(uid);
    await assert.rejects(jobs.cleanupOwner(uid, artifacts), { code: 'RENDER_CLEANUP_REQUIRED' }, 'a live lease is never cleaned');
    assert.equal(gone.includes(live.artifactId), false);
    await assert.rejects(store.purgeAccountData(uid), { code: 'RENDER_CLEANUP_REQUIRED' });
    tick(LEASE_MS + WRITE_GRACE_MS);
    assert.deepEqual(await jobs.cleanupOwner(uid, artifacts), { pending: 0 });
    assert.deepEqual([...gone].sort(), [first.artifactId, second.artifactId, live.artifactId].sort());
    await store.purgeAccountData(uid); assert.equal(await store.getUser(uid), null);
    if (store.db) for (const id of [job.id, running.id]) {
      assert.equal((await store.renderJobs.doc(id).get()).exists, false);
      assert.equal((await store.renderJobs.doc(id).collection('payload').get()).size, 0);
    } else assert.equal([...store.renderJobs.values()].filter(j => j.ownerUid === uid).length, 0);
  });
}
module.exports = { register, files };
