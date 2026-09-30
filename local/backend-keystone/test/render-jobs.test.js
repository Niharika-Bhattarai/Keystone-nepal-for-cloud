'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { MemoryStore } = require('../lib/accounts/store');
const { RenderJobs, manifest } = require('../lib/accounts/renderJobs');
const { register, files } = require('./helpers/render-job-contract.cjs');
const { runOwnedRender, recoverDue } = require('../lib/model3d/hq/ownedWorker');
register(test, async () => ({ store: new MemoryStore(), uid: 'owner' }));

async function setup() {
  const store = new MemoryStore(), jobs = new RenderJobs(store), uid = 'worker';
  await store.ensureUser(uid); await store.updateUser(uid, { devAccess: {} });
  await store.credit(uid, { kind: 'grant_extra', amount: 2 }, 'test');
  const project = await store.saveProject(uid, null, { planSpec: { levels: [{}] } });
  const job = await jobs.create(uid, { requestId: 'worker', projectId: project.id, revision: 1, options: { stills: false } });
  return { store, jobs, uid, job };
}
test('worker verifies artifacts before atomic publication/spend and needs no browser polling', async () => {
  const { store, jobs, uid, job } = await setup(); let baked = 0;
  const run = item => runOwnedRender({ jobs, uid: item.ownerUid, id: item.id,
    bake: async ({ input, artifactId }) => { baked++; assert.ok(input.planSpec.levels); assert.match(artifactId, /^rj_/); return { files: files.map(f => f.name) }; },
    artifacts: { inspect: async (id, name) => files.find(f => f.name === name) } });
  await recoverDue({ jobs, run }); await recoverDue({ jobs, run });
  assert.equal(baked, 1); assert.equal((await jobs.get(uid, job.id)).state, 'done');
  assert.equal((await store.getUser(uid)).credits.extra, 1);
});
test('worker failure/missing artifacts refunds and never publishes a manifest', async () => {
  for (const kind of ['bake', 'inspect', 'unsafe']) {
    const { store, jobs, uid, job } = await setup();
    const result = await runOwnedRender({ jobs, uid, id: job.id,
      bake: async () => { if (kind === 'bake') throw new Error('private provider details'); return { files: kind === 'unsafe' ? ['input.json', 'house.glb'] : files.map(f => f.name) }; },
      artifacts: { inspect: async () => { throw new Error('missing file'); } } });
    assert.equal(result.state, 'failed'); assert.equal(store.renderJobs.get(job.id).manifest, null);
    assert.equal((await store.getUser(uid)).credits.extra, 2);
    assert.equal(JSON.stringify(result).includes('provider'), false);
  }
});
test('content identity includes the entire plan and versions; request ID is independent', async () => {
  const { store, jobs, uid, job } = await setup(), original = store.renderJobs.get(job.id);
  const second = await jobs.create(uid, { requestId: 'second', projectId: original.projectId, revision: 1, options: { stills: false } });
  assert.notEqual(second.id, job.id); assert.equal(store.renderJobs.get(second.id).contentHash, original.contentHash);
  assert.deepEqual(original.versions, { schema: 1, renderer: 'hq-4', model: 'model3d-6', assets: 'hq-assets-2' });
  await store.credit(uid, { kind: 'grant_extra', amount: 1 }, 'test');
  await store.saveProject(uid, original.projectId, { planSpec: { levels: [{}], eaveDepth: 3 } }, { expectedRevision: 1 });
  const changed = await jobs.create(uid, { requestId: 'changed', projectId: original.projectId, revision: 2, options: { stills: false } });
  assert.notEqual(store.renderJobs.get(changed.id).contentHash, original.contentHash, 'fields outside the legacy hash also invalidate content identity');
  assert.throws(() => manifest([...files, { ...files[1], name: '../secret.jpg' }], { stills: false }), { code: 'JOB_MANIFEST_INVALID' });
  assert.throws(() => manifest([...files, { ...files[1], name: `lm_${'x'.repeat(80)}.jpg` }], { stills: false }), { code: 'JOB_MANIFEST_INVALID' });
});

test('invalid options and free accounts cannot reserve a render credit', async () => {
  const { store, jobs, uid, job } = await setup(), original = store.renderJobs.get(job.id);
  for (const options of [{ sky: 'unknown' }, { hidden: true }, { stills: 'yes' }]) await assert.rejects(jobs.create(uid, { requestId: 'bad', projectId: original.projectId, revision: 1, options }), { code: 'JOB_INVALID' });
  await store.updateUser(uid, { devAccess: null });
  await assert.rejects(jobs.create(uid, { requestId: 'free', projectId: original.projectId, revision: 1 }), { code: 'UPGRADE_REQUIRED' });
  assert.equal((await store.getUser(uid)).credits.extra, 1);
});

test('two worker deliveries start only one bake and retry after a lost completion response is harmless', async () => {
  const { store, jobs, uid, job } = await setup(); let baked = 0;
  const options = { jobs, uid, id: job.id, bake: async () => { baked++; return { files: files.map(f => f.name) }; }, artifacts: { inspect: async (id, name) => files.find(f => f.name === name) } };
  const responses = await Promise.all([runOwnedRender(options), runOwnedRender(options)]);
  assert.equal(baked, 1); assert.equal(responses.filter(Boolean).length, 1);
  assert.equal(await runOwnedRender(options), null);
  assert.equal((await store.listLedger(uid)).filter(e => e.reason === 'bake_spend').length, 1);
});
