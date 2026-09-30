'use strict';

// High-end model bake: engine model -> Blender (materials, furniture, lights,
// baked global illumination, hero renders) -> web-optimised GLB + lightmaps.
//
// A job is identified by a hash of everything that changes the result, so a
// repeated request for the same plan and options is served from the store.
// Status lives next to the outputs (status.json, manifest.json) so any API
// instance can answer a status poll.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { buildModel } = require('../buildModel');
const { toGlb } = require('../writers');

const PIPELINE = 'hq-7'; // trees kept out of the lightmaps (the viewer hides them)
const BAKE_DIR = path.join(__dirname, '..', '..', '..', 'bake');
const SKIES = new Set(['day', 'golden', 'dusk']);
const QUALITIES = new Set(['preview', 'final']);

function normaliseOptions(o = {}) {
  return {
    sky: SKIES.has(o.sky) ? o.sky : 'day',
    quality: QUALITIES.has(o.quality) ? o.quality : 'final',
    roofKind: typeof o.roofKind === 'string' ? o.roofKind.slice(0, 40) : undefined,
    stills: o.stills !== false,
  };
}

function bakeId(planSpec, opts) {
  const o = normaliseOptions(opts);
  const basis = JSON.stringify({
    v: PIPELINE, levels: planSpec.levels, vm: planSpec.verticalModel, finish: planSpec.finishSpec,
    open: planSpec.openConcept, roof: o.roofKind, sky: o.sky, q: o.quality, s: o.stills,
  });
  return 'hq_' + crypto.createHash('sha256').update(basis).digest('hex').slice(0, 24);
}

// Blender prints "[bake  12.3s] <step>" lines; map them onto 0..1.
const STEPS = [
  [/import engine model/, 0.03, 'Reading the plan'],
  [/weld, bevel/, 0.06, 'Shaping walls and trim'],
  [/lawn and planting/, 0.1, 'Landscaping'],
  [/^furniture/, 0.14, 'Furnishing rooms'],
  [/^lights/, 0.18, 'Switching on the lights'],
  [/^stills/, 0.2, 'Rendering photographs'],
  [/exterior_/, 0.3, 'Rendering photographs'],
  [/interior_living/, 0.38, 'Rendering photographs'],
  [/interior_kitchen/, 0.44, 'Rendering photographs'],
  [/interior_primary/, 0.5, 'Rendering photographs'],
  [/lightmaps: grouping/, 0.52, 'Baking light'],
  [/Level 1:/, 0.62, 'Baking light'],
  [/Level 2:/, 0.7, 'Baking light'],
  [/Roof:/, 0.76, 'Baking light'],
  [/Furniture/, 0.82, 'Baking light'],
  [/Lawn:/, 0.86, 'Baking light'],
  [/export GLB/, 0.88, 'Packing the model'],
  [/house\.glb/, 0.95, 'Packing the model'],
];

function progressFor(line, last) {
  const msg = line.replace(/^\[bake\s+[\d.]+s\]\s*/, '').trim();
  for (const [re, p, label] of STEPS) if (re.test(msg) && p > last.progress) return { progress: p, step: label };
  return null;
}

// Cancellation kills the child and settles only after it has exited, so a caller
// can safely remove the work folder and a cancelled bake stops writing output.
function run(cmd, args, { onLine, env, cwd, signal } = {}) {
  const aborted = () => Object.assign(new Error('Render attempt was cancelled'), { code: 'BAKE_ABORTED' });
  if (signal?.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...env }, cwd, windowsHide: true });
    let cancelled = false;
    const cancel = () => { cancelled = true; child.kill(); };
    signal?.addEventListener('abort', cancel, { once: true });
    let tail = '';
    const feed = (buf) => {
      tail += buf.toString();
      const lines = tail.split(/\r?\n/);
      tail = lines.pop();
      for (const l of lines) onLine && onLine(l);
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.on('error', (e) => { if (!cancelled) reject(e); });
    child.on('close', (code) => {
      signal?.removeEventListener('abort', cancel);
      if (cancelled) reject(aborted());
      else if (code === 0) resolve();
      else reject(new Error(`${path.basename(cmd)} exited with ${code}`));
    });
  });
}

/**
 * Run one bake end to end and publish the results to `store`.
 * `runner` is injectable for tests (defaults to Blender + the optimiser).
 */
async function runBake({ id, planSpec, options, store, runner = blenderRunner, log = console.log }) {
  const o = normaliseOptions(options);
  const started = Date.now();
  let last = { state: 'running', progress: 0.01, step: 'Starting', startedAt: new Date(started).toISOString() };
  const status = async (patch) => {
    last = { ...last, ...patch, updatedAt: new Date().toISOString() };
    await store.writeJson(id, 'status.json', last);
  };
  await status({});
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'keystone-bake-'));
  try {
    const model = buildModel(planSpec, { roofKind: o.roofKind });
    fs.writeFileSync(path.join(work, 'house.glb'), toGlb(model, { withSolids: true }));
    fs.writeFileSync(path.join(work, 'house.json'), JSON.stringify({ meta: model.meta, palette: model.palette }));
    const out = path.join(work, 'out');
    fs.mkdirSync(out);

    await runner({
      work, out, options: o,
      onLine: (line) => {
        if (!line.startsWith('[bake')) return;
        log(`[hq ${id}] ${line}`);
        const p = progressFor(line, last);
        if (p) status(p).catch(() => {});
      },
    });

    const files = fs.readdirSync(out);
    const lightmaps = files.filter((f) => /^lm_.*\.jpg$/.test(f));
    const stills = files.filter((f) => /^(exterior|interior)_.*\.jpg$/.test(f));
    const glb = files.includes('house.web.glb') ? 'house.web.glb' : 'house.glb';
    for (const f of [glb, ...lightmaps, ...stills]) {
      await store.put(id, f === glb ? 'house.glb' : f, path.join(out, f), f.endsWith('.glb') ? 'model/gltf-binary' : 'image/jpeg');
    }
    const report = fs.existsSync(path.join(out, 'bake.json')) ? JSON.parse(fs.readFileSync(path.join(out, 'bake.json'), 'utf8')) : null;
    const manifest = {
      id, pipeline: PIPELINE, options: o, createdAt: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000),
      glb: 'house.glb', lightmaps, stills,
      meta: viewerMeta(model),
      report,
    };
    await store.writeJson(id, 'manifest.json', manifest);
    await status({ state: 'done', progress: 1, step: 'Ready' });
    return manifest;
  } catch (err) {
    await status({ state: 'failed', error: String(err.message || err).slice(0, 300) });
    throw err;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// What the photoreal viewer needs to place the camera, rooms and stairs.
function viewerMeta(model) {
  const { entry, levels, rooms, footprint, stairPath } = model.meta;
  return { entry, levels, rooms: rooms.map(({ id, label, type, level, center, floorY }) => ({ id, label, type, level, center, floorY })), footprint, stairPath, units: 'feet' };
}

async function blenderRunner({ work, out, options, onLine, signal }) {
  const blender = process.env.BLENDER_BIN || 'blender';
  const assets = process.env.ASSET_DIR || path.join(BAKE_DIR, 'asset-pack');
  const args = ['-b', '--factory-startup', '--python', path.join(BAKE_DIR, 'blender', 'bake_house.py'), '--',
    '--in', path.join(work, 'house.glb'), '--meta', path.join(work, 'house.json'), '--assets', assets, '--out', out,
    '--sky', options.sky, '--quality', options.quality, '--device', process.env.BAKE_DEVICE || 'auto', '--bake'];
  if (options.stills) args.push('--stills');
  await run(blender, args, { onLine, signal });
  await run(process.execPath, [path.join(BAKE_DIR, 'optimize_glb.mjs'), path.join(out, 'house.glb'), path.join(out, 'house.web.glb')], { onLine: () => {}, signal });
}

module.exports = { runBake, bakeId, normaliseOptions, progressFor, PIPELINE, run, blenderRunner, viewerMeta };
