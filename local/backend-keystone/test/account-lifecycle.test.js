'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { MemoryStore, setStore } = require('../lib/accounts/store');
const { resumeDeletion } = require('../lib/accounts/lifecycle');
const { emulatorConfig } = require('../lib/accounts/emulatorConfig');
const { createApp } = require('../app');
const { setVerifier } = require('../lib/accounts/auth');

test('emulator configuration rejects live endpoints and credentials', () => {
  const env = { KEYSTONE_EMULATOR_TEST: '1', GCLOUD_PROJECT: 'demo-keystone-test', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8187' };
  assert.equal(emulatorConfig(env).ssl, false);
  for (const patch of [{ KEYSTONE_EMULATOR_TEST: '' }, { GCLOUD_PROJECT: 'real-project' }, { FIRESTORE_EMULATOR_HOST: 'example.com:8187' }, { FIRESTORE_EMULATOR_HOST: '127.0.0.1:99999' }, { GOOGLE_APPLICATION_CREDENTIALS: 'secret' }, { K_SERVICE: 'service' }]) assert.throws(() => emulatorConfig({ ...env, ...patch }));
});

test('deletion fences writes and resumes after identity failure without restoring personal data', async () => {
  const store = new MemoryStore();
  await store.ensureUser('alice', 'alice@example.test');
  await store.saveProject('alice', null, { name: 'Private house' }, { mutationId: 'create' });
  await store.credit('alice', { kind: 'grant_extra', amount: 1 }, 'test');
  const first = await store.beginDeletion('alice');
  assert.equal(first.state, 'pending');
  for (const operation of [() => store.ensureUser('alice'), () => store.updateUser('alice', { name: 'back' }), () => store.saveProject('alice', null, {}, { mutationId: 'new' }), () => store.credit('alice', { kind: 'grant_extra', amount: 1 }, 'test')]) await assert.rejects(operation, { code: 'ACCOUNT_DELETING' });
  const failed = await resumeDeletion(store, 'alice', async () => { throw new Error('provider secret detail'); });
  assert.equal(failed.state, 'pending'); assert.equal(failed.failure, 'RETRY_REQUIRED');
  assert.equal(await store.getUser('alice'), null); assert.equal(store.projects.size, 0); assert.equal(store.ledger.size, 0);
  assert.equal(JSON.stringify(failed).includes('provider'), false);
  assert.equal((await store.listPendingDeletions()).length, 1);
  let calls = 0;
  assert.equal((await resumeDeletion(store, 'alice', async () => { calls++; })).state, 'complete');
  await resumeDeletion(store, 'alice', async () => { calls++; }); assert.equal(calls, 1);
  await assert.rejects(store.ensureUser('alice'), { code: 'ACCOUNT_DELETING' });
});

test('subscription check and deletion start share a storage boundary', async () => {
  const store = new MemoryStore(); await store.ensureUser('u');
  await store.updateUser('u', { subscription: { status: 'active' } });
  await assert.rejects(store.beginDeletion('u'), { code: 'CANCEL_PLAN_FIRST' });
  assert.equal(await store.getDeletion('u'), null);
});

test('HTTP deletion reports pending, blocks projects, and returns complete only after identity removal', async t => {
  const store = new MemoryStore(); setStore(store); setVerifier(async uid => ({ uid }));
  const app = createApp(); let fail = true;
  app.locals.deleteIdentity = async () => { if (fail) throw new Error('offline'); };
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => new Promise(r => server.close(r)));
  const call = async (method, route) => { const r = await fetch(`http://127.0.0.1:${server.address().port}/api${route}`, { method, headers: { Authorization: 'Bearer lifecycle' } }); return { status: r.status, data: await r.json() }; };
  await call('GET', '/me');
  assert.equal((await call('DELETE', '/me')).status, 202);
  assert.equal((await call('GET', '/me')).data.deletion.state, 'pending');
  assert.equal((await call('GET', '/projects')).status, 409);
  fail = false;
  assert.equal((await call('DELETE', '/me')).data.deletion.state, 'complete');
  assert.equal((await call('GET', '/me')).data.deletion.state, 'complete');
});
