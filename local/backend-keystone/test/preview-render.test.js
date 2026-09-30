'use strict';
// C4e: the preview wiring end to end with fakes for the cloud: an API request
// creates a job, the dispatcher starts one Cloud Run Job execution for it (a
// request to the Run API for the declared job), the worker in that execution
// bakes into the private bucket, and the API answers with bucket-signed links.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { once } = require('node:events');
const { MemoryStore, setStore } = require('../lib/accounts/store');
const { setVerifier } = require('../lib/accounts/auth');
const { bakeOwned } = require('../lib/model3d/hq/ownedBake');
const { previewRender } = require('../lib/previewRender');
const { main: workerMain } = require('../bake/worker');
const { createApp } = require('../app');
const { glb, jpeg, FakeBucket } = require('./helpers/artifact-fixture.cjs');
const fixture = require('./fixtures/model3d-plan.json');

const runtime = (extra = {}) => ({ mode: 'preview', host: '0.0.0.0', port: 8080, project: 'keystone-preview-123', bucket: 'keystone-preview-renders',
  job: { project: 'keystone-preview-123', region: 'us-central1', name: 'keystone-render' }, maxConcurrent: 1, renderLoop: false, ...extra });
async function account(store, uid, credits = 3) {
  await store.ensureUser(uid, `${uid}@example.test`);
  await store.updateUser(uid, { devAccess: { grantedAt: 'test' } });
  await store.credit(uid, { kind: 'grant_extra', amount: credits }, 'test');
  return store.saveProject(uid, null, { name: `${uid} house`, planSpec: fixture });
}
const runner = async ({ out }) => {
  fs.writeFileSync(path.join(out, 'house.web.glb'), glb(32));
  fs.writeFileSync(path.join(out, 'lm_level_1.jpg'), jpeg(40));
};

test('only a preview runtime can build the preview wiring', () => {
  assert.throws(() => previewRender({ host: '127.0.0.1', port: 8198 }), /preview runtime/);
  assert.throws(() => previewRender(null), /preview runtime/);
});

test('a render goes from the API to one Cloud Run execution, the worker and a bucket-signed link', async (t) => {
  // The account routes use the process store; in the preview that is the same
  // Firestore store previewRender takes by default.
  const store = new MemoryStore(), bucket = new FakeBucket(), runs = [];
  setStore(store);
  const runRequest = async (options) => { runs.push(options); return { data: { name: `executions/${runs.length}` } }; };
  const render = previewRender(runtime(), { store, bucket, runRequest, deleteIdentity: async () => {}, log: () => {} });
  assert.equal(render.mode, 'preview');
  assert.equal(render.urls, null, 'links come from the bucket; no local link secret exists');

  setVerifier(async token => ({ uid: token, email: `${token}@example.test` }));
  const project = await account(store, 'pro');
  const server = createApp({ render, runtimeMode: 'preview' }).listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(r => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (route, body) => fetch(base + route, { method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer pro', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });

  const health = await (await fetch(base + '/api/health')).json();
  assert.equal(health.runtime, 'preview'); assert.equal(health.externalServicesEnabled, true); assert.equal(health.photoreal, 'preview');

  const created = await call('/api/renders', { requestId: 'req-1', projectId: project.id, revision: project.revision, options: { stills: false } });
  assert.equal(created.status, 202, await created.clone().text());
  const { render: job } = await created.json();
  await render.dispatcher.kick();
  assert.equal(runs.length, 1, 'one execution for one job');
  assert.equal(runs[0].method, 'POST');
  assert.equal(runs[0].url, 'https://run.googleapis.com/v2/projects/keystone-preview-123/locations/us-central1/jobs/keystone-render:run');
  assert.deepEqual(runs[0].data.overrides.containerOverrides[0].env, [{ name: 'RENDER_JOB_ID', value: job.id }, { name: 'RENDER_OWNER_UID', value: 'pro' }]);
  await render.dispatcher.kick();
  assert.equal(runs.length, 1, 'a dispatched job is not launched again while its execution may still claim it');

  // The Cloud Run execution: the worker with the same store and bucket.
  const env = { RENDER_JOB_ID: job.id, RENDER_OWNER_UID: 'pro' };
  const result = await workerMain({ env, store, artifacts: render.artifacts, bake: args => bakeOwned({ ...args, runner }), log: () => {} });
  assert.equal(result.state, 'done');

  const done = await (await call(`/api/renders/${job.id}`)).json();
  assert.equal(done.render.state, 'done');
  assert.match(done.model.glb.key, /^owned-renders\/[A-Za-z0-9_-]+\/house\.glb$/, 'the link is to the private attempt object');
  assert.ok(bucket.current(done.model.glb.key), 'the signed object exists in the private bucket');
  assert.match(done.model.glb.generation, /^[0-9]+$/, 'the link is pinned to the inspected generation');
  assert.equal(done.model.glb.config.version, 'v4');
  const local = await fetch(`${base}/api/renders/${job.id}/files/house.glb?u=pro&e=1&d=0&s=x`);
  assert.ok([403, 404].includes(local.status), `the local file route refuses in the preview (${local.status})`);
});

test('dispatch is capped by the GPU quota and shared by owner', async () => {
  const store = new MemoryStore(), runs = [];
  const render = previewRender(runtime({ maxConcurrent: 2 }), { store, bucket: new FakeBucket(), runRequest: async (o) => { runs.push(o); return { data: {} }; },
    deleteIdentity: async () => {}, log: () => {} });
  const { RenderJobs } = require('../lib/accounts/renderJobs');
  const jobs = new RenderJobs(store);
  for (const uid of ['a', 'b', 'c']) {
    const p = await account(store, uid);
    await jobs.create(uid, { requestId: `${uid}-1`, projectId: p.id, revision: p.revision, options: { stills: false } });
    await jobs.create(uid, { requestId: `${uid}-2`, projectId: p.id, revision: p.revision, options: { stills: false } });
  }
  await render.dispatcher.kick();
  const owners = runs.map(r => r.data.overrides.containerOverrides[0].env[1].value);
  assert.equal(runs.length, 2, 'never more executions than the quota');
  assert.equal(new Set(owners).size, 2, 'one per owner');
});

test('only the render-loop instance runs maintenance, which finishes account deletions', async () => {
  const store = new MemoryStore(), deleted = [];
  await account(store, 'leaving');
  await store.beginDeletion('leaving');
  const quiet = previewRender(runtime(), { store, bucket: new FakeBucket(), runRequest: async () => ({ data: {} }), deleteIdentity: async uid => deleted.push(uid), log: () => {} });
  await quiet.dispatcher.kick();
  assert.deepEqual(deleted, [], 'a kick-only instance does no maintenance');
  const loop = previewRender(runtime({ renderLoop: true }), { store, bucket: new FakeBucket(), runRequest: async () => ({ data: {} }),
    deleteIdentity: async uid => deleted.push(uid), log: () => {}, intervalMs: 60_000 });
  try { await loop.dispatcher.kick(); } finally { await loop.dispatcher.stop(); }
  assert.deepEqual(deleted, ['leaving'], 'the loop instance removes the sign-in of a deleted account');
});

test('the worker refuses to build real cloud clients outside the declared preview', async () => {
  const env = { RENDER_JOB_ID: 'rj_' + 'a'.repeat(40), RENDER_OWNER_UID: 'pro' };
  await assert.rejects(workerMain({ env, log: () => {} }), /preview/);
  await assert.rejects(workerMain({ env: { ...env, KEYSTONE_RUNTIME: 'preview', KEYSTONE_PREVIEW_PROJECT: 'keystone-preview-123', FIREBASE_PROJECT_ID: 'keystone-preview-123',
    RENDER_BUCKET: 'keystone-preview-renders', HQ_PROJECT: 'keystone-preview-123', HQ_REGION: 'us-central1', HQ_JOB_NAME: 'keystone-render', CLOUD_RUN_JOB: 'someone-else' }, log: () => {} }), /CLOUD_RUN_JOB/);
});

test('the served CSP lets the photoreal viewer fetch bucket-signed files and decode them', () => {
  // The C5e showcase failed when a fetch target was missing from connect-src.
  const { CSP } = require('../lib/securityHeaders');
  const directive = name => (CSP.split(';').map(s => s.trim()).find(s => s.startsWith(name + ' ')) || '').split(/\s+/).slice(1);
  for (const [name, source] of [['connect-src', 'https://storage.googleapis.com'], ['img-src', 'https://storage.googleapis.com'],
    ['script-src', "'wasm-unsafe-eval'"], ['connect-src', 'https://identitytoolkit.googleapis.com'], ['connect-src', 'https://securetoken.googleapis.com'],
    ['frame-src', 'https://*.firebaseapp.com']]) assert.ok(directive(name).includes(source), `${name} allows ${source}`);
});

// Photoreal paused (KEYSTONE_PHOTOREAL=paused): the preview runs without the GPU job
// (its quota is not granted yet). New renders are refused plainly and nothing is
// launched; the rest of the wiring (account deletion, maintenance) stays.
test('a paused preview refuses new renders and launches nothing', async (t) => {
  const store = new MemoryStore(), bucket = new FakeBucket(), runs = [];
  setStore(store);
  const runRequest = async (options) => { runs.push(options); return { data: { name: 'executions/x' } }; };
  const render = previewRender(runtime({ photoreal: 'paused' }), { store, bucket, runRequest, deleteIdentity: async () => {}, log: () => {} });
  assert.equal(render.mode, 'paused');
  assert.equal(typeof render.deleteIdentity, 'function', 'account deletion still removes the sign-in');
  setVerifier(async token => ({ uid: token, email: `${token}@example.test` }));
  const project = await account(store, 'pro');
  const server = createApp({ render, runtimeMode: 'preview' }).listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(r => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const health = await (await fetch(base + '/api/health')).json();
  assert.equal(health.photoreal, 'paused');
  const res = await fetch(base + '/api/renders', { method: 'POST', headers: { Authorization: 'Bearer pro', 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: 'req-p', projectId: project.id, revision: project.revision, options: {} }) });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.code, 'PHOTOREAL_PAUSED');
  assert.match(body.message, /coming soon/);
  await render.dispatcher.kick();
  assert.equal(runs.length, 0, 'no Cloud Run execution is started');
  assert.equal((await store.getUser('pro')).credits.extra, 3, 'no credit is reserved');
});
