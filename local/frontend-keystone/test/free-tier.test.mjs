import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';

// C7: the account dialog tells a visitor whether a free account unlocks what they
// asked for. Its list must match the backend's entitlements exactly.
test('the frontend free-tier list matches the backend entitlements', async () => {
  const require = createRequire(import.meta.url);
  const { FEATURES } = require('../../backend-keystone/lib/accounts/entitlements.js');
  const backendFree = Object.entries(FEATURES).filter(([, tiers]) => tiers.includes('free')).map(([k]) => k).sort();
  // account.jsx is JSX, so read the declared set rather than importing the module.
  const source = fs.readFileSync(new URL('../src/lib/account.jsx', import.meta.url), 'utf8');
  const declared = JSON.parse(source.match(/export const FREE_FEATURES = new Set\((\[[^\]]*\])\)/)[1].replace(/'/g, '"')).sort();
  assert.deepEqual(declared, backendFree);
});
