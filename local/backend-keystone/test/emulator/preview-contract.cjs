'use strict';
// C4e preview wiring against the real Firestore SDK and emulator: two preview
// service instances share one dispatch pool, so however many kick at once the GPU
// quota holds; the Cloud Run execution's worker then claims, bakes into the
// (fake) private bucket and completes the job, spending exactly one credit.
// Cloud Run and Cloud Storage are test doubles; only Firestore is real.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { emulatorConfig } = require('../../lib/accounts/emulatorConfig');
const config = emulatorConfig();
const { Firestore } = require('@google-cloud/firestore');
const { FirestoreStore } = require('../../lib/accounts/store');
const { RenderJobs } = require('../../lib/accounts/renderJobs');
const { previewRender } = require('../../lib/previewRender');
const { bakeOwned } = require('../../lib/model3d/hq/ownedBake');
const { main: workerMain } = require('../../bake/worker');
const { glb, jpeg, FakeBucket } = require('../helpers/artifact-fixture.cjs');

// A named database of its own: the dispatcher counts every running job in its
// database, and other contracts leave jobs on simulated clocks in the default one.
const db = new Firestore({ ...config, databaseId: `preview-${Date.now()}` }), prefix = `preview-${Date.now()}`;
test.after(async () => db.terminate());
const runtime = (extra = {}) => ({ mode: 'preview', host: '0.0.0.0', port: 8080, project: 'keystone-preview-123', bucket: 'keystone-preview-renders',
  job: { project: 'keystone-preview-123', region: 'us-central1', name: 'keystone-render' }, maxConcurrent: 1, renderLoop: false, ...extra });
const runner = async ({ out }) => {
  fs.writeFileSync(path.join(out, 'house.web.glb'), glb(32));
  fs.writeFileSync(path.join(out, 'lm_level_1.jpg'), jpeg(40));
};

test('two preview instances kicking at once start one execution per quota slot, and the worker completes it', async () => {
  const store = new FirestoreStore(db), bucket = new FakeBucket(), runs = [];
  const runRequest = async (options) => { runs.push(options.data.overrides.containerOverrides[0].env); return { data: {} }; };
  const instance = () => previewRender(runtime(), { store: new FirestoreStore(db), bucket, runRequest, deleteIdentity: async () => {}, log: () => {} });
  const a = instance(), b = instance();

  const owners = [`${prefix}-a`, `${prefix}-b`], jobs = new RenderJobs(store), created = [];
  for (const uid of owners) {
    await store.ensureUser(uid, `${uid}@example.test`); await store.updateUser(uid, { devAccess: { grantedAt: 'test' } });
    await store.credit(uid, { kind: 'grant_extra', amount: 2 }, 'test');
    const project = await store.saveProject(uid, null, { name: 'house', planSpec: require('../fixtures/model3d-plan.json') });
    created.push(await jobs.create(uid, { requestId: 'r1', projectId: project.id, revision: project.revision, options: { stills: false } }));
  }
  await Promise.all([a.dispatcher.kick(), b.dispatcher.kick(), a.dispatcher.kick(), b.dispatcher.kick()]);
  const mine = runs.filter(env => owners.includes(env[1].value));
  assert.equal(mine.length, 1, `the quota of one holds across instances (got ${mine.length})`);

  const [jobEnv] = mine, id = jobEnv[0].value, uid = jobEnv[1].value;
  const result = await workerMain({ env: { RENDER_JOB_ID: id, RENDER_OWNER_UID: uid }, store, artifacts: a.artifacts,
    bake: args => bakeOwned({ ...args, runner }), log: () => {} });
  assert.equal(result.state, 'done');
  const again = await workerMain({ env: { RENDER_JOB_ID: id, RENDER_OWNER_UID: uid }, store, artifacts: a.artifacts,
    bake: () => { throw new Error('a duplicate execution must not bake'); }, log: () => {} });
  assert.notEqual(again?.state, 'running', 'a duplicate execution does nothing');
  const user = await store.getUser(uid);
  assert.equal(user.credits.extra, 1, 'exactly one credit spent for the finished render');

  // The slot is free again: the other owner's job starts on the next kick.
  await b.dispatcher.kick();
  const second = runs.filter(env => owners.includes(env[1].value));
  assert.equal(second.length, 2);
  assert.notEqual(second[1][1].value, uid, 'the other owner is served next');
});
