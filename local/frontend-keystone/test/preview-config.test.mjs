import test from 'node:test';
import assert from 'node:assert/strict';
import { assertConversion, assertLocalConversion } from '../scripts/conversion-config.mjs';

// C4e: a preview build is served by the preview API service from the same origin,
// signs in with the preview Firebase project only, and never with test sign-in.
const PREVIEW = Object.freeze({
  KEYSTONE_RUNTIME: 'preview', KEYSTONE_PREVIEW_PROJECT: 'keystone-preview-123',
  VITE_FIREBASE_API_KEY: 'AIzaSyTest', VITE_FIREBASE_AUTH_DOMAIN: 'keystone-preview-123.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'keystone-preview-123', VITE_FIREBASE_APP_ID: '1:123:web:abc',
});

test('a complete preview build configuration is same-origin and uses the preview project', () => {
  assert.deepEqual(assertConversion({ ...PREVIEW }), { mode: 'preview', api: null, project: 'keystone-preview-123' });
  assert.deepEqual(assertConversion({ KEYSTONE_RUNTIME: 'local' }), { mode: 'local', api: 'http://127.0.0.1:8198' });
});

test('every Firebase setting is required and must name the preview project', () => {
  for (const key of ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID', 'KEYSTONE_PREVIEW_PROJECT']) {
    assert.throws(() => assertConversion({ ...PREVIEW, [key]: '' }), new RegExp(key), key);
  }
  assert.throws(() => assertConversion({ ...PREVIEW, VITE_FIREBASE_PROJECT_ID: 'another-project' }), /VITE_FIREBASE_PROJECT_ID/);
  assert.throws(() => assertConversion({ ...PREVIEW, VITE_FIREBASE_AUTH_DOMAIN: 'evil.example.com' }), /AUTH_DOMAIN/);
  const live = 'gen-lang-client-0717800720';
  assert.throws(() => assertConversion({ ...PREVIEW, KEYSTONE_PREVIEW_PROJECT: live, VITE_FIREBASE_PROJECT_ID: live, VITE_FIREBASE_AUTH_DOMAIN: `${live}.firebaseapp.com` }), /live/);
});

test('a preview build refuses test sign-in, a separate API origin and Vercel', () => {
  for (const [key, value] of [['VITE_DEV_AUTH', '1'], ['KEYSTONE_API_ORIGIN', 'https://example.com'], ['VERCEL', '1']]) {
    assert.throws(() => assertConversion({ ...PREVIEW, [key]: value }), Error, key);
  }
});

test('the local guard itself is unchanged: Firebase settings still refuse a local build', () => {
  assert.throws(() => assertLocalConversion({ KEYSTONE_RUNTIME: 'local', VITE_FIREBASE_PROJECT_ID: 'keystone-preview-123' }));
  assert.throws(() => assertLocalConversion({ ...PREVIEW }));
  for (const runtime of [undefined, '', 'production', 'Preview']) assert.throws(() => assertConversion({ ...PREVIEW, KEYSTONE_RUNTIME: runtime }));
});
