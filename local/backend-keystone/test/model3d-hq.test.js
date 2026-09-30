'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runBake, bakeId, progressFor, normaliseOptions } = require('../lib/model3d/hq/bakeJob');
const { LocalStore, safeName } = require('../lib/model3d/hq/store');
const plan = require('./fixtures/model3d-plan.json');

const tmpStore = () => new LocalStore(fs.mkdtempSync(path.join(os.tmpdir(), 'hq-test-')));

// Stands in for Blender: writes the files a real bake produces.
async function fakeRunner({ work, out, onLine }) {
  assert.ok(fs.existsSync(path.join(work, 'house.glb')), 'engine GLB handed to the bake');
  const side = JSON.parse(fs.readFileSync(path.join(work, 'house.json'), 'utf8'));
  assert.ok(side.meta.lights.length > 0 && side.meta.furniture.length > 0);
  for (const l of ['[bake    0.1s] import engine model', '[bake   20.0s] lightmaps: grouping furniture', '[bake   90.0s] export GLB']) onLine(l);
  fs.writeFileSync(path.join(out, 'house.web.glb'), Buffer.from('glTF'));
  fs.writeFileSync(path.join(out, 'lm_level_1.jpg'), 'x');
  fs.writeFileSync(path.join(out, 'exterior_day.jpg'), 'x');
  fs.writeFileSync(path.join(out, 'bake.json'), JSON.stringify({ seconds: 1 }));
}

test('bake ids are stable and change with the options that change the result', () => {
  const a = bakeId(plan, {});
  assert.equal(a, bakeId(plan, {}));
  assert.match(a, /^hq_[0-9a-f]{24}$/);
  assert.notEqual(a, bakeId(plan, { sky: 'dusk' }));
  assert.notEqual(a, bakeId(plan, { quality: 'preview' }));
  assert.deepEqual(normaliseOptions({ sky: 'nope', quality: 'x' }), { sky: 'day', quality: 'final', roofKind: undefined, stills: true });
});

test('Blender log lines map to rising progress', () => {
  const p = progressFor('[bake   10.0s] furniture', { progress: 0 });
  assert.equal(p.step, 'Furnishing rooms');
  assert.equal(progressFor('[bake   10.0s] furniture', { progress: 0.9 }), null);
});

test('a bake publishes the model, lightmaps, stills and a manifest', async () => {
  const store = tmpStore();
  const id = bakeId(plan, {});
  const m = await runBake({ id, planSpec: plan, options: {}, store, runner: fakeRunner, log: () => {} });
  assert.deepEqual(m.lightmaps, ['lm_level_1.jpg']);
  assert.deepEqual(m.stills, ['exterior_day.jpg']);
  assert.ok(store.localPath(id, 'house.glb'));
  assert.equal((await store.readJson(id, 'status.json')).state, 'done');
  assert.ok(m.meta.entry && m.meta.levels.length === 2);
});

test('a failing bake is reported, not thrown away', async () => {
  const store = tmpStore();
  const id = bakeId(plan, { sky: 'golden' });
  await assert.rejects(runBake({ id, planSpec: plan, options: {}, store, runner: async () => { throw new Error('blender crashed'); }, log: () => {} }));
  const st = await store.readJson(id, 'status.json');
  assert.equal(st.state, 'failed');
});

test('store names cannot escape the job folder', () => {
  assert.throws(() => safeName('../secrets'));
  assert.throws(() => safeName('a/b'));
  assert.equal(safeName('lm_level_1.jpg'), 'lm_level_1.jpg');
});

// The unowned legacy route (api/plan_model_hq.js) was retired in C4c; owned
// renders are covered by test/render-delivery.test.js.
