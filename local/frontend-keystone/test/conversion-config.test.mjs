import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assertLocalConversion, localApiTarget } from '../scripts/conversion-config.mjs';
import { createAuthFetch, ownerToken } from '../src/lib/authFetch.js';
import { getInitialStudioSession, studioSessionKey } from '../src/lib/storage.js';
import { readSaveJournal, writeSaveJournal, clearSaveJournal, saveJournalKey } from '../src/lib/saveJournal.js';

test('conversion config cannot fall through to production API or cloud auth', () => {
  assert.equal(assertLocalConversion({ KEYSTONE_RUNTIME: 'local' }), 'http://127.0.0.1:8198');
  for (const env of [{}, { KEYSTONE_RUNTIME:'local', VERCEL:'1' }, { KEYSTONE_RUNTIME:'local', VITE_FIREBASE_PROJECT_ID:'live' }]) assert.throws(() => assertLocalConversion(env));
  for (const url of ['https://keystone-api-yhicwzbyja-uc.a.run.app', 'http://localhost.evil.test', 'http://user@localhost', 'http://localhost/api']) assert.throws(() => localApiTarget(url));
  // Vercel is a pass-through to the Keystone AI service (keystone-ai-37537), never the old live API.
  const config = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url)));
  assert.equal(config.buildCommand, 'node -e 0', 'Vercel does not build the site');
  // "/:path*" does not match the bare home page on Vercel (it answered 404), so "/" has its own rule.
  assert.deepEqual(config.rewrites, [
    { source: '/', destination: 'https://keystone-preview-808501199224.us-central1.run.app/' },
    { source: '/:path*', destination: 'https://keystone-preview-808501199224.us-central1.run.app/:path*' },
  ]);
  assert.ok(!JSON.stringify(config).includes('keystone-api'));
});

test('an account-bound request cannot adopt a different identity while awaiting a token', async () => {
  let owner = 'alice', resolve;
  const getToken = ownerToken(() => new Promise(r => { resolve = r; }), () => owner, 'alice');
  const request = getToken(); owner = 'bob'; resolve('bob-token');
  await assert.rejects(request, /account changed/);
  await assert.rejects(getToken(), /account changed/);
});

test('draft restoration refuses legacy unowned and mismatched-owner records', () => {
  const previous = globalThis.window;
  const items = new Map([['keystone_studio_session', JSON.stringify({ version: 1, planSvg: 'private' })]]);
  globalThis.window = { localStorage: { getItem: key => items.get(key) || null } };
  try {
    assert.equal(getInitialStudioSession(), null);
    items.set(studioSessionKey('alice'), JSON.stringify({ version: 2, ownerUid: 'alice', planSvg: 'alice drawing' }));
    assert.equal(getInitialStudioSession('alice').planSvg, 'alice drawing');
    assert.equal(getInitialStudioSession('bob'), null);
    items.set(studioSessionKey('bob'), items.get(studioSessionKey('alice')));
    assert.equal(getInitialStudioSession('bob'), null);
    assert.notEqual(studioSessionKey(null), studioSessionKey('anonymous'));
  } finally { globalThis.window = previous; }
});

test('save journal retains pending request and committed receipt across reload without crossing owners', () => {
  const items = new Map(), storage = { getItem: key => items.get(key) || null, setItem: (key, value) => items.set(key, value), removeItem: key => items.delete(key) };
  const request = { id: null, body: JSON.stringify({ mutationId: 'same-request', name: 'House' }), serialized: JSON.stringify({ name: 'House' }) };
  writeSaveJournal('alice', 'pending', request, null, storage);
  assert.deepEqual(readSaveJournal('alice', storage).request, request);
  assert.equal(readSaveJournal('bob', storage), null);
  writeSaveJournal('alice', 'complete', request, { id: 'project', revision: 1 }, storage);
  assert.equal(readSaveJournal('alice', storage).project.revision, 1);
  items.set(saveJournalKey('bob'), items.get(saveJournalKey('alice')));
  assert.throws(() => readSaveJournal('bob', storage), /could not be read/);
  assert.throws(() => writeSaveJournal('alice', 'pending', request, null, { setItem: () => { throw new Error('quota'); } }), /quota/);
  clearSaveJournal('alice', storage); assert.equal(readSaveJournal('alice', storage), null);
});

test('authenticated transport refreshes tokens, preserves headers and refuses external destinations', async () => {
  let token='first'; const calls=[];
  const api=createAuthFetch(async()=>token, async(url,options)=>{calls.push({url,options});return {ok:true};}, 'http://localhost:5198');
  const controller=new AbortController();
  await api('/api/plan/model', {method:'POST',body:'{}',headers:new Headers({'Content-Type':'application/json',Authorization:'Bearer stale'}),signal:controller.signal});
  token='second'; await api('/api/plan');
  token=null; await api('/api/me',{headers:{Authorization:'Bearer stale'}});
  assert.equal(calls[0].options.headers.get('Authorization'),'Bearer first');
  assert.equal(calls[0].options.headers.get('Content-Type'),'application/json');
  assert.equal(calls[0].options.signal,controller.signal);
  assert.equal(calls[1].options.headers.get('Authorization'),'Bearer second');
  assert.equal(calls[2].options.headers.has('Authorization'),false);
  assert.equal(calls[0].options.redirect,'error');
  await assert.rejects(api('https://example.test/api/me'));
  await assert.rejects(api('/not-api'));
  assert.equal(calls.length,3);
});
