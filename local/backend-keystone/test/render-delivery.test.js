'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { MemoryStore, setStore } = require('../lib/accounts/store');
const { RenderJobs, LEASE_MS, WRITE_GRACE_MS } = require('../lib/accounts/renderJobs');
const { deliverOutbox, MAX_ATTEMPTS } = require('../lib/accounts/outbox');
const { RenderDispatcher, maintain, localLauncher } = require('../lib/model3d/hq/dispatcher');
const { renderUrls } = require('../lib/model3d/hq/renderUrls');
const { LocalArtifacts } = require('../lib/model3d/hq/ownedArtifacts');
const { bakeOwned } = require('../lib/model3d/hq/ownedBake');
const { runOwnedRender } = require('../lib/model3d/hq/ownedWorker');
const { startBakeJob } = require('../lib/model3d/hq/cloudRunJob');
const { main: workerMain } = require('../bake/worker');
const { configureKeystoneRuntime } = require('../lib/keystoneRuntime');
const { setVerifier } = require('../lib/accounts/auth');
const { createApp } = require('../app');
const { glb, jpeg } = require('./helpers/artifact-fixture.cjs');
const fixture = require('./fixtures/model3d-plan.json');

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'keystone-delivery-'));
function world() {
  let now = 1_800_000_000_000;
  const store = new MemoryStore(), clock = () => now, jobs = new RenderJobs(store, { clock });
  const account = async (uid, credits = 3, { pro = true } = {}) => {
    await store.ensureUser(uid, `${uid}@example.test`);
    if (pro) await store.updateUser(uid, { devAccess: { grantedAt: 'test' } });
    if (credits) await store.credit(uid, { kind: 'grant_extra', amount: credits }, 'test');
    return store.saveProject(uid, null, { name: `${uid} house`, planSpec: fixture });
  };
  const create = (uid, project, requestId, options = { stills: false }) => jobs.create(uid, { requestId, projectId: project.id, revision: project.revision, options });
  return { store, jobs, clock, account, create, tick: ms => { now += ms; } };
}
const runner = async ({ out, options }) => {
  fs.writeFileSync(path.join(out, 'house.web.glb'), glb(32));
  fs.writeFileSync(path.join(out, 'lm_level_1.jpg'), jpeg(40));
  if (options.stills) fs.writeFileSync(path.join(out, 'exterior_day.jpg'), jpeg(50));
};
const bake = args => bakeOwned({ ...args, runner });

test('dispatch reaches a paying job behind jobs of accounts being deleted, and shares capacity by owner', async () => {
  const { store, jobs, account, create, tick } = world();
  for (let i = 0; i < 30; i++) { const p = await account(`leaving${i}`, 5); for (let j = 0; j < 5; j++) await create(`leaving${i}`, p, `r${j}`); await store.beginDeletion(`leaving${i}`); }
  tick(1); const paying = await account('paying'); const wanted = await create('paying', paying, 'mine');
  const launched = [];
  const dispatcher = new RenderDispatcher({ jobs, launch: async j => { launched.push(j); }, maxConcurrent: 1, pageSize: 50, maxPages: 5 });
  assert.deepEqual(await dispatcher.dispatch(), [wanted.id], 'the 150 blocked jobs cannot hide the paying one');

  const fair = world(), a = await fair.account('a', 3), b = await fair.account('b', 3);
  for (const r of ['1', '2', '3']) await fair.create('a', a, r);
  fair.tick(1); await fair.create('b', b, '1');
  const owners = [];
  await new RenderDispatcher({ jobs: fair.jobs, launch: async j => { owners.push(j.ownerUid); }, maxConcurrent: 2 }).dispatch();
  assert.deepEqual(owners.sort(), ['a', 'b'], 'one per owner before a second for anyone');
});

test('dispatch counts live leases, never double-launches, and relaunches an execution that never claimed', async () => {
  const { jobs, account, create, tick } = world(), p = await account('u', 3);
  const first = await create('u', p, 'one'); tick(1); const second = await create('u', p, 'two');
  const launched = [];
  const dispatcher = new RenderDispatcher({ jobs, launch: async j => { launched.push(j.id); }, maxConcurrent: 2, perOwner: 2, retryMs: 20_000 });
  await jobs.claim('u', first.id); // lease until +60 s
  assert.deepEqual(await dispatcher.dispatch(), [second.id], 'the claimed job holds a slot; only the other is launched');
  assert.deepEqual(await dispatcher.dispatch(), [], 'a dispatched job is not launched again while its execution may still claim it');
  tick(20_000);
  assert.deepEqual(await dispatcher.dispatch(), [second.id], 'an execution that never claimed is replaced after the retry delay');
  await jobs.claim('u', second.id); // lease until +80 s
  tick(LEASE_MS - 20_000 + 1);
  assert.deepEqual(await dispatcher.dispatch(), [first.id], 'an expired lease makes that job due again; the live one is left alone');
  const failing = new RenderDispatcher({ jobs, launch: async () => { throw new Error('quota'); }, maxConcurrent: 2, perOwner: 2, retryMs: 20_000 });
  tick(LEASE_MS + 20_000);
  assert.deepEqual(await failing.dispatch(), [], 'a failed launch is logged, not reported as started');
  assert.equal(launched.length, 3);
});

test('a terminal job commits exactly one notification; delivery is idempotent, retried, then given up', async () => {
  const { store, jobs, account, create, clock, tick } = world(), p = await account('n', 3);
  const done = await create('n', p, 'done'), failed = await create('n', p, 'failed');
  const c = await jobs.claim('n', done.id);
  const files = [{ name: 'house.glb', contentType: 'model/gltf-binary', size: 12, sha256: '1'.repeat(64) }, { name: 'lm_a.jpg', contentType: 'image/jpeg', size: 8, sha256: '2'.repeat(64) }];
  await jobs.complete('n', done.id, c.token, files); await jobs.complete('n', done.id, c.token, files);
  const f = await jobs.claim('n', failed.id); await jobs.fail('n', failed.id, f.token);
  assert.deepEqual([...store.outbox.values()].map(r => r.kind).sort(), ['render_failed', 'render_ready']);
  assert.equal(JSON.stringify([...store.outbox.values()]).includes('@'), false, 'no address is stored with the intent');
  const sent = [];
  const provider = { send: async m => { sent.push(m); } };
  assert.equal((await deliverOutbox(store, provider, { clock })).length, 2);
  assert.equal((await deliverOutbox(store, provider, { clock })).length, 0);
  assert.deepEqual(sent.map(m => [m.to, m.kind, m.projectName]).sort(), [['n@example.test', 'render_failed', 'n house'], ['n@example.test', 'render_ready', 'n house']]);
  assert.ok(sent.every(m => /^rn_[a-f0-9]{40}$/.test(m.idempotencyKey)));

  const second = world(), q = await second.account('m', 1), job = await second.create('m', q, 'x'), claim = await second.jobs.claim('m', job.id);
  await second.jobs.fail('m', job.id, claim.token);
  const broken = { send: async () => { throw new Error('smtp secret detail'); } };
  for (let i = 0; i < MAX_ATTEMPTS; i++) { await deliverOutbox(second.store, broken, { clock: second.clock }); second.tick(7 * 60 * 60_000); }
  const record = [...second.store.outbox.values()][0];
  assert.equal(record.status, 'failed'); assert.equal(record.attempts, MAX_ATTEMPTS); assert.equal(JSON.stringify(record).includes('smtp'), false);
  tick(0);
});

test('maintenance removes orphan attempts after their grace, keeps the published one, and finishes pending deletions', async () => {
  const { store, jobs, account, create, tick } = world(), p = await account('o', 3), root = temp(), artifacts = new LocalArtifacts(root);
  const job = await create('o', p, 'orphan');
  const first = await jobs.claim('o', job.id), src = path.join(temp(), 'g'); fs.writeFileSync(src, glb(10));
  await artifacts.writer(first.artifactId).put('house.glb', src);
  tick(LEASE_MS + 1);
  assert.equal((await runOwnedRender({ jobs, uid: 'o', id: job.id, artifacts, bake })).state, 'done');
  assert.equal((await maintain({ jobs, store, artifacts })).swept, 0, 'not before the write grace');
  tick(WRITE_GRACE_MS);
  assert.equal((await maintain({ jobs, store, artifacts })).swept, 1);
  const saved = store.renderJobs.get(job.id);
  assert.equal(saved.sweepAt, null); assert.ok(fs.existsSync(path.join(root, saved.manifest.artifactId)));
  assert.equal(fs.existsSync(path.join(root, first.artifactId)), false);
  await store.beginDeletion('o');
  const identities = [];
  assert.equal((await maintain({ jobs, store, artifacts, deleteIdentity: async uid => { identities.push(uid); } })).deletions, 1, 'the published attempt is quiet too, so deletion completes');
  assert.deepEqual(identities, ['o']); assert.equal(fs.readdirSync(root).length, 0); assert.equal(store.outbox.size, 0);
});

test('renders over HTTP: owned create, status, list and signed files; nothing leaks across accounts', async t => {
  const { store, jobs, account, clock, tick } = world(); setStore(store);
  setVerifier(async token => { const [uid] = token.split(':'); if (!['pro', 'free', 'other', 'poor'].includes(uid)) throw new Error('bad'); return { uid, email: `${uid}@example.test` }; });
  const project = await account('pro', 2); await account('other', 1); await account('free', 0, { pro: false }); const poorProject = await account('poor', 0);
  const root = temp(), artifacts = new LocalArtifacts(root), urls = renderUrls({ secret: crypto.randomBytes(32), clock });
  let kicks = 0;
  const app = createApp({ render: { jobs, artifacts, urls, dispatcher: { kick: () => { kicks++; } }, forceOptions: { quality: 'preview' } } });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => new Promise(r => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (route, token, body) => fetch(base + route, { method: body ? 'POST' : 'GET', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const request = { requestId: 'req-1', projectId: project.id, revision: project.revision, options: { stills: true } };

  assert.equal((await call('/api/renders', null, request)).status, 401);
  assert.equal((await call('/api/renders', 'free', request)).status, 402);
  assert.equal((await (await call('/api/renders', 'poor', { ...request, projectId: poorProject.id })).json()).code, 'NO_CREDITS');
  assert.equal((await call('/api/renders', 'other', request)).status, 404, 'another account cannot render this saved house');
  const created = await call('/api/renders', 'pro', request); assert.equal(created.status, 202);
  const { render } = await created.json();
  assert.equal(render.state, 'queued'); assert.equal(render.projectName, 'pro house'); assert.equal(render.options.quality, 'preview', 'the local runtime can force preview quality');
  assert.equal((await (await call('/api/renders', 'pro', request)).json()).render.id, render.id, 'a repeated request ID is the same render');
  assert.equal((await call('/api/renders', 'pro', { ...request, options: { stills: false } })).status, 409);
  assert.equal((await (await call('/api/me', 'pro')).json()).credits.total, 1, 'charged once');
  assert.ok(kicks >= 2);
  assert.equal((await call(`/api/renders/${render.id}`, 'other')).status, 404);
  assert.equal((await (await call(`/api/renders?projectId=${project.id}`, 'pro')).json()).renders.length, 1);
  assert.equal((await (await call('/api/renders', 'other')).json()).renders.length, 0);

  assert.equal((await runOwnedRender({ jobs, uid: 'pro', id: render.id, artifacts, bake })).state, 'done');
  const status = await (await call(`/api/renders/${render.id}`, 'pro')).json();
  assert.equal(status.render.state, 'done'); assert.ok(status.model.meta.rooms.length > 3);
  assert.deepEqual(Object.keys(status.model.lightmaps), ['lm_level_1.jpg']); assert.equal(status.model.stills[0].name, 'exterior_day.jpg');
  const model = await fetch(base + status.model.glb);
  assert.equal(model.status, 200); assert.equal(model.headers.get('content-type'), 'model/gltf-binary');
  assert.deepEqual(Buffer.from(await model.arrayBuffer()), glb(32));
  assert.match(model.headers.get('cache-control'), /^private, max-age=\d+$/);
  const download = await fetch(base + status.model.files.find(f => f.name === 'house.glb').download);
  assert.match(download.headers.get('content-disposition'), /attachment; filename="keystone-house.glb"/);

  const signed = new URL(base + status.model.glb);
  for (const [label, mutate] of [['tampered signature', u => { const sig = u.searchParams.get('s'); u.searchParams.set('s', (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1)); }], ['other owner', u => u.searchParams.set('u', 'other')],
    ['other file', u => { u.pathname = u.pathname.replace('house.glb', 'lm_level_1.jpg'); }], ['internal file', u => { u.pathname = u.pathname.replace('house.glb', 'input.json'); }], ['no signature', u => { u.search = ''; }]]) {
    const u = new URL(signed); mutate(u);
    assert.equal((await fetch(u)).status, 403, label);
  }
  fs.writeFileSync(path.join(root, store.renderJobs.get(render.id).manifest.artifactId, 'house.glb'), glb(33));
  assert.equal((await fetch(base + status.model.glb)).status, 409, 'changed bytes are never served');
  tick(15 * 60_000);
  assert.equal((await fetch(base + status.model.glb)).status, 403, 'links expire');
  assert.equal((await fetch(base + '/api/renders/rj_' + '0'.repeat(40), { headers: { Authorization: 'Bearer pro' } })).status, 404);
});

test('render routes stay unavailable when no render service is configured', async t => {
  const store = new MemoryStore(); setStore(store);
  setVerifier(async token => ({ uid: token, email: `${token}@example.test` }));
  await store.ensureUser('pro'); await store.updateUser('pro', { devAccess: { grantedAt: 'test' } });
  const server = createApp().listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => new Promise(r => server.close(r)));
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/renders`, { headers: { Authorization: 'Bearer pro' } });
  assert.equal(res.status, 503); assert.equal((await res.json()).code, 'CONVERSION_NOT_READY');
  const health = await (await fetch(`http://127.0.0.1:${server.address().port}/api/health`)).json();
  assert.equal(health.photoreal, 'off');
});

test('the cloud worker entry claims only the named owned job; a duplicate execution does nothing', async () => {
  const { store, jobs, account, create } = world(), p = await account('w', 1), job = await create('w', p, 'cloud');
  await account('stranger', 0);
  const artifacts = new LocalArtifacts(temp()), env = { RENDER_JOB_ID: job.id, RENDER_OWNER_UID: 'w' };
  await assert.rejects(workerMain({ env: {}, store, artifacts, log: () => {} }), /RENDER_JOB_ID/);
  await assert.rejects(workerMain({ env: { ...env, RENDER_OWNER_UID: '../x' }, store, artifacts, log: () => {} }), /RENDER_JOB_ID/);
  const [a, b] = await Promise.all([workerMain({ env, store, artifacts, bake, log: () => {} }), workerMain({ env, store, artifacts, bake, log: () => {} })]);
  assert.deepEqual([a?.state, b?.state].sort(), ['done', undefined].sort());
  assert.equal((await jobs.get('w', job.id)).state, 'done');
  assert.equal((await workerMain({ env: { ...env, RENDER_OWNER_UID: 'stranger' }, store, artifacts, bake, log: () => {} })), null, 'the owner must match');
});

test('the Cloud Run launcher passes only the job and owner identifiers', async () => {
  let sent = null;
  const name = await startBakeJob({ jobId: `rj_${'a'.repeat(40)}`, ownerUid: 'u1' }, { env: { HQ_PROJECT: 'demo-keystone-x' }, request: async o => { sent = o; return { data: { name: 'executions/1' } }; } });
  assert.equal(name, 'executions/1');
  assert.match(sent.url, /projects\/demo-keystone-x\/locations\/us-central1\/jobs\/keystone-render:run$/);
  assert.deepEqual(sent.data.overrides.containerOverrides[0].env, [{ name: 'RENDER_JOB_ID', value: `rj_${'a'.repeat(40)}` }, { name: 'RENDER_OWNER_UID', value: 'u1' }]);
  await assert.rejects(startBakeJob({ jobId: 'hq_legacy', ownerUid: 'u1' }, { env: { HQ_PROJECT: 'p' }, request: async () => ({}) }));
});

test('signed links bind owner, job, file, expiry and disposition', () => {
  let now = 1000; const urls = renderUrls({ secret: crypto.randomBytes(32), clock: () => now }), id = `rj_${'b'.repeat(40)}`;
  const q = Object.fromEntries(new URL('http://x' + urls.sign('u1', id, 'house.glb')).searchParams);
  assert.deepEqual(urls.verify(id, 'house.glb', q), { uid: 'u1', download: false, expiresAt: 1000 + 10 * 60_000 });
  assert.equal(urls.verify(`rj_${'c'.repeat(40)}`, 'house.glb', q), null);
  assert.equal(urls.verify(id, 'lm_a.jpg', q), null);
  assert.equal(urls.verify(id, 'house.glb', { ...q, d: '1' }), null);
  assert.throws(() => urls.sign('u1', id, 'house.glb', { ttlMs: 16 * 60_000 }));
  assert.throws(() => renderUrls({ secret: Buffer.alloc(8) }));
  now += 10 * 60_000; assert.equal(urls.verify(id, 'house.glb', q), null);
});

test('local runtime enables photoreal only explicitly, with a local Blender', () => {
  assert.equal(configureKeystoneRuntime({ KEYSTONE_RUNTIME: 'local' }).photoreal, undefined);
  const on = configureKeystoneRuntime({ KEYSTONE_RUNTIME: 'local', KEYSTONE_HQ: 'local', BLENDER_BIN: 'b', ASSET_DIR: 'a', KEYSTONE_HQ_QUALITY: 'preview' });
  assert.equal(on.photoreal.quality, 'preview');
  for (const bad of [{ KEYSTONE_HQ: 'cloud', BLENDER_BIN: 'b', ASSET_DIR: 'a' }, { KEYSTONE_HQ: 'local' }, { KEYSTONE_HQ: 'local', BLENDER_BIN: 'b', ASSET_DIR: 'a', KEYSTONE_HQ_QUALITY: 'ultra' }]) {
    assert.throws(() => configureKeystoneRuntime({ KEYSTONE_RUNTIME: 'local', ...bad }));
  }
});

test('the local launcher runs a bake without blocking dispatch and reports when it settles', async () => {
  const { jobs, account, create } = world(), p = await account('l', 1), job = await create('l', p, 'local');
  let settled = 0;
  const launcher = localLauncher({ jobs, artifacts: new LocalArtifacts(temp()), bake, onSettled: () => { settled++; } });
  const started = await new RenderDispatcher({ jobs, launch: launcher.launch, active: launcher.active }).dispatch();
  assert.deepEqual(started, [job.id]); assert.equal(launcher.active(), 1);
  await launcher.idle();
  assert.equal(settled, 1); assert.equal((await jobs.get('l', job.id)).state, 'done');
});

require('./helpers/render-delivery-contract.cjs').register(test, async () => ({ store: new MemoryStore(), uid: `mem${crypto.randomBytes(3).toString('hex')}` }));
