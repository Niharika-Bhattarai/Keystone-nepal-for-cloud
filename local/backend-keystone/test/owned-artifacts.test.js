'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { MemoryStore } = require('../lib/accounts/store');
const { RenderJobs, LEASE_MS, WRITE_GRACE_MS } = require('../lib/accounts/renderJobs');
const { resumeDeletion } = require('../lib/accounts/lifecycle');
const { runOwnedRender } = require('../lib/model3d/hq/ownedWorker');
const { run } = require('../lib/model3d/hq/bakeJob');
const { LocalArtifacts, GcsArtifacts } = require('../lib/model3d/hq/ownedArtifacts');
const { bakeOwned } = require('../lib/model3d/hq/ownedBake');
const fixture = require('./fixtures/model3d-plan.json');
const { glb, jpeg, FakeBucket } = require('./helpers/artifact-fixture.cjs');

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'keystone-artifacts-'));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
async function setup({ stills = false, credits = 2 } = {}) {
  let now = Date.now();
  const store = new MemoryStore(), jobs = new RenderJobs(store, { clock: () => now }), uid = 'artifact-owner';
  await store.ensureUser(uid); await store.updateUser(uid, { devAccess: {} });
  await store.credit(uid, { kind: 'grant_extra', amount: credits }, 'test');
  const project = await store.saveProject(uid, null, { planSpec: fixture.planSpec || fixture });
  const job = await jobs.create(uid, { requestId: 'artifact', projectId: project.id, revision: 1, options: { stills, quality: 'preview' } });
  return { store, jobs, uid, job, project, tick: ms => { now += ms; }, clock: () => now };
}
// Writes the files a successful Blender run leaves in its output folder.
const fakeRunner = (extra = {}) => async ({ out, options }) => {
  fs.writeFileSync(path.join(out, 'house.glb'), glb(64));
  fs.writeFileSync(path.join(out, 'house.web.glb'), extra.glb || glb(32));
  fs.writeFileSync(path.join(out, 'lm_level_1.jpg'), jpeg(40));
  fs.writeFileSync(path.join(out, 'bake.json'), '{"internal":true}');
  if (options.stills) fs.writeFileSync(path.join(out, 'exterior_day.jpg'), jpeg(50));
};

test('local artifacts: names are checked before storage access and descriptors come from bytes', async () => {
  const root = path.join(temp(), 'never-created'), store = new LocalArtifacts(root), id = `rj_${'a'.repeat(40)}_${'b'.repeat(32)}`;
  for (const name of ['../input.json', 'status.json', 'manifest.json', 'house.glb/../x', `lm_${'x'.repeat(80)}.jpg`]) {
    await assert.rejects(store.writer(id).put(name, __filename), { code: 'ARTIFACT_INVALID' });
    await assert.rejects(store.inspect(id, name), { code: 'ARTIFACT_INVALID' });
  }
  for (const bad of ['rj_x', '../rj', `rj_${'a'.repeat(40)}`]) await assert.rejects(store.inspect(bad, 'house.glb'), { code: 'ARTIFACT_INVALID' });
  assert.equal(fs.existsSync(root), false, 'rejections happen before any filesystem access');
  const src = temp(), body = glb(20), picture = jpeg(30);
  fs.writeFileSync(path.join(src, 'a'), body); fs.writeFileSync(path.join(src, 'b'), picture);
  await store.writer(id).put('house.glb', path.join(src, 'a')); await store.writer(id).put('lm_floor.jpg', path.join(src, 'b'));
  assert.deepEqual(await store.inspect(id, 'house.glb'), { name: 'house.glb', contentType: 'model/gltf-binary', size: body.length, sha256: sha(body), generation: null });
  assert.equal((await store.inspect(id, 'lm_floor.jpg')).sha256, sha(picture));
});

test('local artifacts: truncated or disguised content is rejected; changed bytes are detected at read', async () => {
  const root = temp(), store = new LocalArtifacts(root), id = `rj_${'c'.repeat(40)}_${'d'.repeat(32)}`, src = temp();
  const cases = [['house.glb', Buffer.from('not a model')], ['house.glb', glb(20).subarray(0, 30)], ['lm_a.jpg', glb(20)], ['lm_a.jpg', jpeg(30).subarray(0, 20)], ['exterior_day.jpg', Buffer.alloc(0)]];
  for (const [name, bytes] of cases) {
    fs.writeFileSync(path.join(src, 'x'), bytes); await store.writer(id).put(name, path.join(src, 'x'));
    await assert.rejects(store.inspect(id, name), { code: 'ARTIFACT_CONTENT_INVALID' }, name);
  }
  fs.writeFileSync(path.join(src, 'x'), glb(20)); await store.writer(id).put('house.glb', path.join(src, 'x'));
  const descriptor = await store.inspect(id, 'house.glb');
  assert.deepEqual(await store.read(id, descriptor), glb(20));
  fs.writeFileSync(path.join(root, id, 'house.glb'), glb(21));
  await assert.rejects(store.read(id, descriptor), { code: 'ARTIFACT_CHANGED' });
  assert.deepEqual(await store.remove(id), { removed: 3 }, 'every file in the attempt, including rejected ones'); assert.deepEqual(await store.remove(id), { removed: 0 });
});

test('writer refuses output after abort or after the attempt deadline', async () => {
  const store = new LocalArtifacts(temp()), id = `rj_${'e'.repeat(40)}_${'f'.repeat(32)}`, src = path.join(temp(), 'g');
  fs.writeFileSync(src, glb(10));
  const abort = new AbortController(); abort.abort();
  await assert.rejects(store.writer(id, { signal: abort.signal }).put('house.glb', src), { code: 'ARTIFACT_WRITER_CLOSED' });
  await assert.rejects(store.writer(id, { closed: () => true }).put('house.glb', src), { code: 'ARTIFACT_WRITER_CLOSED' });
  assert.deepEqual(await store.list(id), []);
});

test('cloud artifacts: private create-only writes, pinned generations, short URLs and versioned removal', async () => {
  const bucket = new FakeBucket(), store = new GcsArtifacts({ bucket, clock: () => 1_000_000 }), id = `rj_${'1'.repeat(40)}_${'2'.repeat(32)}`, src = path.join(temp(), 'h');
  fs.writeFileSync(src, glb(12));
  await store.writer(id).put('house.glb', src);
  const object = bucket.current(`owned-renders/${id}/house.glb`);
  assert.equal(object.metadata.cacheControl, 'private, no-store'); assert.equal(object.contentType, 'model/gltf-binary');
  await assert.rejects(store.writer(id).put('house.glb', src), { code: 'ARTIFACT_EXISTS' }, 'a late writer cannot replace an inspected object');
  const descriptor = await store.inspect(id, 'house.glb');
  assert.equal(descriptor.generation, String(object.generation)); assert.equal(descriptor.sha256, sha(glb(12)));
  const url = await store.url(id, descriptor, { ttlMs: 60_000 });
  assert.equal(url.config.queryParams.generation, descriptor.generation); assert.ok(url.config.expires <= 1_000_000 + 15 * 60_000);
  await assert.rejects(store.url(id, descriptor, { ttlMs: 60 * 60_000 }), { code: 'ARTIFACT_INVALID' });
  bucket.overwrite(`owned-renders/${id}/house.glb`, glb(13));
  await assert.rejects(store.url(id, descriptor), { code: 'ARTIFACT_CHANGED' }, 'a replaced generation is never signed');
  assert.deepEqual(await store.remove(id), { removed: 2 }); assert.equal(bucket.all().length, 0);
});

test('owned bake uses frozen input, publishes only allowlisted outputs and returns viewer metadata', async () => {
  const { jobs, uid, job, store } = await setup({ stills: true }), root = temp(), artifacts = new LocalArtifacts(root);
  await store.saveProject(uid, job.projectId, { planSpec: { levels: [{}] } }, { expectedRevision: 1 });
  const result = await runOwnedRender({ jobs, uid, id: job.id, artifacts,
    bake: args => bakeOwned({ ...args, runner: fakeRunner() }) });
  assert.equal(result.state, 'done');
  const saved = store.renderJobs.get(job.id), dir = path.join(root, saved.manifest.artifactId);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['exterior_day.jpg', 'house.glb', 'lm_level_1.jpg']);
  assert.equal(saved.manifest.files.find(f => f.name === 'house.glb').sha256, sha(glb(32)), 'the optimised web model is published');
  assert.ok(saved.viewer.rooms.length > 3, 'viewer metadata comes from the frozen plan, not the edited project');
  assert.equal(JSON.stringify(await jobs.get(uid, job.id)).includes('viewer'), false);
});

test('owned bake: corrupt output fails and refunds; nothing is published', async () => {
  const { jobs, uid, job, store } = await setup(), artifacts = new LocalArtifacts(temp());
  const result = await runOwnedRender({ jobs, uid, id: job.id, artifacts, bake: args => bakeOwned({ ...args, runner: fakeRunner({ glb: Buffer.from('truncated') }) }) });
  assert.equal(result.state, 'failed'); assert.equal(store.renderJobs.get(job.id).manifest, null);
  assert.equal((await store.getUser(uid)).credits.extra, 2);
});

test('aborting a bake terminates the real child process before its work folder is removed', async () => {
  const abort = new AbortController(), marker = path.join(temp(), 'alive');
  const script = `const write=()=>require('fs').writeFileSync(${JSON.stringify(marker)},String(Date.now()));write();setInterval(write,50);console.log('ready')`;
  let started = false;
  const deadline = setTimeout(() => abort.abort(), 10_000);
  try {
    const running = run(process.execPath, ['-e', script], {
      signal: abort.signal,
      onLine: line => { if (line === 'ready') { started = true; abort.abort(); } },
    });
    await assert.rejects(running, { code: 'BAKE_ABORTED' });
    assert.ok(started, 'the child must write its marker before cancellation is tested');
  } finally { clearTimeout(deadline); abort.abort(); }
  const stamp = fs.readFileSync(marker, 'utf8'); await new Promise(r => setTimeout(r, 300));
  assert.equal(fs.readFileSync(marker, 'utf8'), stamp, 'the child no longer writes after the promise settles');
});

test('superseded attempts are cleaned after their write grace; the published attempt is kept', async () => {
  const { jobs, uid, job, tick } = await setup(), root = temp(), artifacts = new LocalArtifacts(root), src = path.join(temp(), 's');
  fs.writeFileSync(src, glb(10));
  const first = await jobs.claim(uid, job.id); await artifacts.writer(first.artifactId).put('house.glb', src);
  tick(LEASE_MS + 1);
  const result = await runOwnedRender({ jobs, uid, id: job.id, artifacts, bake: args => bakeOwned({ ...args, runner: fakeRunner() }) });
  assert.equal(result.state, 'done');
  assert.deepEqual((await jobs.cleanupAttempts(uid, job.id, artifacts)).removed, [], 'a stale worker may still be writing');
  tick(WRITE_GRACE_MS);
  assert.deepEqual((await jobs.cleanupAttempts(uid, job.id, artifacts)).removed, [first.artifactId]);
  assert.equal(fs.existsSync(path.join(root, first.artifactId)), false);
  assert.equal((await jobs.get(uid, job.id)).state, 'done');
  const published = (await jobs.cleanupAttempts(uid, job.id, artifacts)); assert.deepEqual(published.removed, []);
});

test('account deletion waits for attempted output to go quiet, removes it, then completes', async () => {
  const { store, jobs, uid, job, tick, clock } = await setup(), root = temp(), artifacts = new LocalArtifacts(root), src = path.join(temp(), 'p');
  fs.writeFileSync(src, glb(10));
  const claim = await jobs.claim(uid, job.id); await artifacts.writer(claim.artifactId).put('house.glb', src);
  await store.beginDeletion(uid);
  const cleanupRenders = owner => new RenderJobs(store, { clock }).cleanupOwner(owner, artifacts);
  const pending = await resumeDeletion(store, uid, async () => {}, cleanupRenders);
  assert.equal(pending.state, 'pending'); assert.ok(fs.existsSync(path.join(root, claim.artifactId)), 'a live lease is never cleaned');
  tick(LEASE_MS + WRITE_GRACE_MS + 1);
  const done = await resumeDeletion(store, uid, async () => {}, cleanupRenders);
  assert.equal(done.state, 'complete'); assert.equal(fs.existsSync(path.join(root, claim.artifactId)), false);
  assert.equal(store.renderJobs.size, 0); assert.equal(store.renderInputs.size, 0); assert.equal(await store.getUser(uid), null);
});

test('a valid model whose glTF JSON chunk exceeds 1 MB is measured and accepted', async () => {
  let json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, extras: { pad: 'x'.repeat(3_000_000) } }));
  json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
  const bytes = Buffer.alloc(20 + json.length);
  bytes.writeUInt32LE(0x46546c67, 0); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(json.length, 12); bytes.writeUInt32LE(0x4e4f534a, 16); json.copy(bytes, 20);
  const store = new LocalArtifacts(temp()), id = `rj_${'7'.repeat(40)}_${'8'.repeat(32)}`, src = path.join(temp(), 'big');
  fs.writeFileSync(src, bytes); await store.writer(id).put('house.glb', src);
  assert.equal((await store.inspect(id, 'house.glb')).sha256, sha(bytes));
});

test('a storage failure during removal keeps deletion pending with nothing recorded; a retry finishes', async () => {
  const { store, jobs, uid, job, tick, clock } = await setup(), root = temp(), local = new LocalArtifacts(root), src = path.join(temp(), 'q');
  fs.writeFileSync(src, glb(10));
  const claim = await jobs.claim(uid, job.id); await local.writer(claim.artifactId).put('house.glb', src);
  await store.beginDeletion(uid); tick(LEASE_MS + WRITE_GRACE_MS + 1);
  let outage = true;
  const flaky = { remove: async id => { if (outage) throw Object.assign(new Error('storage unavailable: bucket internals'), { code: 503 }); return local.remove(id); } };
  const cleanupRenders = owner => new RenderJobs(store, { clock }).cleanupOwner(owner, flaky);
  const pending = await resumeDeletion(store, uid, async () => {}, cleanupRenders);
  assert.equal(pending.state, 'pending'); assert.equal(JSON.stringify(pending).includes('bucket'), false);
  assert.equal(store.renderJobs.get(job.id).removedAttempts, undefined); assert.ok(await store.getUser(uid));
  outage = false;
  assert.equal((await resumeDeletion(store, uid, async () => {}, cleanupRenders)).state, 'complete');
  assert.equal(fs.existsSync(path.join(root, claim.artifactId)), false);
});

test('a transient heartbeat failure does not abort a long bake; a lost lease does', async () => {
  for (const failure of ['transient', 'lease']) {
    const { jobs, uid, job, store } = await setup(), artifacts = new LocalArtifacts(temp());
    const beat = jobs.heartbeat.bind(jobs); let calls = 0, sawAbort = false;
    jobs.heartbeat = async (...args) => {
      if (++calls === 1) throw Object.assign(new Error('deadline exceeded'), { code: failure === 'transient' ? 'UNAVAILABLE' : 'JOB_LEASE_LOST' });
      return beat(...args);
    };
    const result = await runOwnedRender({ jobs, uid, id: job.id, artifacts, heartbeatMs: 20,
      bake: async args => { await new Promise(r => setTimeout(r, 150)); sawAbort = args.signal.aborted; return bakeOwned({ ...args, runner: fakeRunner() }); } });
    if (failure === 'transient') { assert.equal(sawAbort, false); assert.equal(result.state, 'done'); }
    else { assert.equal(sawAbort, true); assert.notEqual(store.renderJobs.get(job.id).state, 'done'); }
  }
});
