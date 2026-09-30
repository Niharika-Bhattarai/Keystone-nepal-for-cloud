'use strict';
// C4e: the preview runtime profile. It must connect only to the declared preview
// project, bucket and render job, and refuse live resources and features that
// have not passed their own gates (billing, Gemini, e-mail).
const test = require('node:test'), assert = require('node:assert/strict');
const { configureKeystoneRuntime, LIVE } = require('../lib/keystoneRuntime');

const PREVIEW = Object.freeze({
  KEYSTONE_RUNTIME: 'preview', KEYSTONE_PREVIEW_PROJECT: 'keystone-preview-123', FIREBASE_PROJECT_ID: 'keystone-preview-123',
  RENDER_BUCKET: 'keystone-preview-renders', HQ_PROJECT: 'keystone-preview-123', HQ_REGION: 'us-central1', HQ_JOB_NAME: 'keystone-render',
  PORT: '8080', K_SERVICE: 'keystone-preview', NODE_ENV: 'production',
});
const preview = (extra = {}) => configureKeystoneRuntime({ ...PREVIEW, ...extra });

test('a complete preview configuration is accepted and says what it will use', () => {
  const env = { ...PREVIEW };
  const r = configureKeystoneRuntime(env);
  assert.deepEqual(r, { mode: 'preview', host: '0.0.0.0', port: 8080, project: 'keystone-preview-123', bucket: 'keystone-preview-renders',
    job: { project: 'keystone-preview-123', region: 'us-central1', name: 'keystone-render' }, maxConcurrent: 1, renderLoop: false, photoreal: 'on' });
  assert.equal(env.ACCOUNTS_STORE, undefined, 'the Firestore store is the default; memory is never selected');
  assert.equal(preview({ HQ_MAX_CONCURRENT: '4', KEYSTONE_RENDER_LOOP: '1' }).maxConcurrent, 4);
  assert.equal(preview({ KEYSTONE_RENDER_LOOP: '1' }).renderLoop, true);
  assert.equal(preview({ K_SERVICE: undefined, NODE_ENV: undefined, PORT: undefined }).port, 8080);
  assert.equal(preview({ KEYSTONE_PHOTOREAL: 'paused' }).photoreal, 'paused');
});

test('every required preview setting is required', () => {
  for (const key of ['KEYSTONE_PREVIEW_PROJECT', 'FIREBASE_PROJECT_ID', 'RENDER_BUCKET', 'HQ_PROJECT', 'HQ_REGION', 'HQ_JOB_NAME']) {
    assert.throws(() => preview({ [key]: undefined }), new RegExp(key), key);
    assert.throws(() => preview({ [key]: '' }), new RegExp(key), key);
  }
});

test('the preview must name one project everywhere, and never the live one', () => {
  assert.throws(() => preview({ FIREBASE_PROJECT_ID: 'other-project' }), /FIREBASE_PROJECT_ID/);
  assert.throws(() => preview({ HQ_PROJECT: 'other-project' }), /HQ_PROJECT/);
  assert.throws(() => preview({ GOOGLE_CLOUD_PROJECT: 'other-project' }), /GOOGLE_CLOUD_PROJECT/);
  const live = { KEYSTONE_PREVIEW_PROJECT: LIVE.project, FIREBASE_PROJECT_ID: LIVE.project, HQ_PROJECT: LIVE.project };
  assert.throws(() => preview(live), /live/);
  assert.throws(() => preview({ KEYSTONE_PREVIEW_PROJECT: 'Bad Project!' }), /KEYSTONE_PREVIEW_PROJECT/);
});

test('live resources and ungated features are refused', () => {
  const refused = {
    RENDER_BUCKET: LIVE.bucket, K_SERVICE: LIVE.service, GCS_BUCKET_NAME: 'anything',
    STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x', STRIPE_PRICE_PRO: 'price_x',
    GEMINI_API_KEY: 'k', GOOGLE_API_KEY: 'k', ACCOUNTS_STORE: 'memory', ACCOUNTS_AUTH: 'insecure-dev',
    KEYSTONE_HQ: 'local', DEV_ACCESS_KEYS: 'k', GOOGLE_APPLICATION_CREDENTIALS: '/key.json',
  };
  for (const [key, value] of Object.entries(refused)) assert.throws(() => preview({ [key]: value }), Error, `${key} must be refused`);
  assert.throws(() => preview({ RENDER_BUCKET: 'Not_A_Bucket' }), /RENDER_BUCKET/);
  assert.throws(() => preview({ HQ_JOB_NAME: 'bad job' }), /HQ_JOB_NAME/);
  assert.throws(() => preview({ HQ_REGION: 'moon-1' }), /HQ_REGION/);
});

test('dispatch limits are bounded by the GPU quota', () => {
  for (const bad of ['0', '9', '1.5', 'x', '-1']) assert.throws(() => preview({ HQ_MAX_CONCURRENT: bad }), /HQ_MAX_CONCURRENT/);
  for (const bad of ['yes', '2', 'true']) assert.throws(() => preview({ KEYSTONE_RENDER_LOOP: bad }), /KEYSTONE_RENDER_LOOP/);
  for (const bad of ['off', 'false', '0']) assert.throws(() => preview({ KEYSTONE_PHOTOREAL: bad }), /KEYSTONE_PHOTOREAL/);
});

test('the worker checks the same contract and must be the declared job', () => {
  const worker = (extra = {}) => configureKeystoneRuntime({ ...PREVIEW, K_SERVICE: undefined, CLOUD_RUN_JOB: 'keystone-render', ...extra }, { role: 'worker' });
  assert.equal(worker().mode, 'preview');
  assert.throws(() => worker({ CLOUD_RUN_JOB: 'other-job' }), /CLOUD_RUN_JOB/);
  assert.throws(() => worker({ CLOUD_RUN_JOB: undefined }), /CLOUD_RUN_JOB/);
  assert.throws(() => worker({ K_SERVICE: 'keystone-preview' }), /service/);
  assert.throws(() => configureKeystoneRuntime({ KEYSTONE_RUNTIME: 'local' }, { role: 'worker' }), /preview/);
});

test('any other runtime value, and the local profile in the cloud, still fail closed', () => {
  for (const runtime of [undefined, '', 'production', 'Preview', 'cloud']) assert.throws(() => configureKeystoneRuntime({ ...PREVIEW, KEYSTONE_RUNTIME: runtime }));
  assert.throws(() => configureKeystoneRuntime({ KEYSTONE_RUNTIME: 'local', K_SERVICE: 'keystone-preview' }));
  assert.throws(() => configureKeystoneRuntime({ KEYSTONE_RUNTIME: 'local', NODE_ENV: 'production' }));
  assert.deepEqual(configureKeystoneRuntime({ KEYSTONE_RUNTIME: 'local' }), { host: '127.0.0.1', port: 8198 });
});

test('the owner access tool grants and revokes preview Pro, only inside the preview contract', async () => {
  const { grantAccess, args, cli } = require('../deploy/preview/grant-access.cjs');
  const { MemoryStore } = require('../lib/accounts/store');
  const store = new MemoryStore();
  const auth = { getUserByEmail: async email => { if (email === 'tester@example.test') return { uid: 'u1' }; throw Object.assign(new Error('x'), { code: 'auth/user-not-found' }); } };
  assert.deepEqual(await grantAccess({ store, auth, email: 'tester@example.test', credits: 2 }), { uid: 'u1', pro: true, credited: 2 });
  const user = await store.getUser('u1');
  assert.ok(user.devAccess?.grantedAt); assert.equal(user.devAccess.by, 'preview-owner');
  await assert.rejects(grantAccess({ store, auth, email: 'nobody@example.test' }), /sign up on the preview first/);
  await assert.rejects(grantAccess({ store, auth, email: 'not-an-email' }), /--email/);
  await assert.rejects(grantAccess({ store, auth, email: 'tester@example.test', credits: 99 }), /--credits/);
  assert.deepEqual(await grantAccess({ store, auth, email: 'tester@example.test', revoke: true }), { uid: 'u1', pro: false, credited: 0 });
  assert.equal((await store.getUser('u1')).devAccess, null);
  assert.deepEqual(args(['--email', 'a@b.co', '--credits', '1']), { email: 'a@b.co', credits: 1, revoke: false });
  assert.throws(() => args(['--project', 'x']), /Unknown argument/);
  await assert.rejects(cli(['--email', 'a@b.co'], { KEYSTONE_RUNTIME: 'local' }), /preview environment/);
  await assert.rejects(cli(['--email', 'a@b.co'], { ...PREVIEW, K_SERVICE: undefined, KEYSTONE_PREVIEW_PROJECT: LIVE.project, FIREBASE_PROJECT_ID: LIVE.project, HQ_PROJECT: LIVE.project }), /live/);
});

test('developer keys are accepted only as long random keys (from Secret Manager)', () => {
  const long = 'kX9-_' + 'a'.repeat(19), other = 'Z'.repeat(30);
  assert.doesNotThrow(() => preview({ DEV_ACCESS_KEYS: long }));
  assert.doesNotThrow(() => preview({ DEV_ACCESS_KEYS: `${long}, ${other}` }));
  for (const bad of ['', 'k', 'keystone-dev-2026', 'a'.repeat(23), `${long},short`, `${'a'.repeat(24)} space`, `${'a'.repeat(24)};x`]) {
    assert.throws(() => preview({ DEV_ACCESS_KEYS: bad }), /DEV_ACCESS_KEYS/, JSON.stringify(bad));
  }
});
