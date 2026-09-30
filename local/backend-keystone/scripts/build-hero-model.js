'use strict';
// Build the landing page's photoreal model for one generated plan: a cutaway bake
// (no roof or ceilings, open to the sky while the light is baked), web-optimised and
// packed into one GLB with its lightmaps inside, plus the level heights the page needs
// to lift the upper floor.
//
//   BLENDER_BIN=... ASSET_DIR=... node scripts/build-hero-model.js <plan-response.json> <out-dir> [preview|final]
//
// <plan-response.json> is a saved POST /api/plan response (it needs planSpec). Writes
// <out-dir>/house.glb and <out-dir>/house.json. Local tool: nothing is uploaded.
const fs = require('node:fs');
const path = require('node:path');
const { buildModel } = require('../lib/model3d/buildModel');
const { toGlb } = require('../lib/model3d/writers');
const { run } = require('../lib/model3d/hq/bakeJob');

const BAKE_DIR = path.join(__dirname, '..', 'bake');
const LIFT = 3; // metres the upper floor is raised, baked in (the page eases the floors apart to it)

async function main() {
  const [planFile, outDir, quality = 'final'] = process.argv.slice(2);
  if (!planFile || !outDir) throw new Error('usage: node scripts/build-hero-model.js <plan-response.json> <out-dir> [preview|final]');
  const { planSpec } = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  if (!planSpec) throw new Error('the plan file has no planSpec');
  const work = path.resolve(outDir, 'work');
  const bakeOut = path.join(work, 'out');
  fs.mkdirSync(bakeOut, { recursive: true });

  const model = buildModel(planSpec, {});
  fs.writeFileSync(path.join(work, 'house.glb'), toGlb(model, { withSolids: true }));
  fs.writeFileSync(path.join(work, 'house.json'), JSON.stringify({ meta: model.meta, palette: model.palette }));

  const log = (line) => { if (line.startsWith('[bake')) console.log(line); };
  const t = Date.now();
  await run(process.env.BLENDER_BIN || 'blender', ['-b', '--factory-startup', '--python', path.join(BAKE_DIR, 'blender', 'bake_house.py'), '--',
    '--in', path.join(work, 'house.glb'), '--meta', path.join(work, 'house.json'),
    '--assets', process.env.ASSET_DIR || path.join(BAKE_DIR, 'asset-pack'), '--out', bakeOut,
    '--sky', 'day', '--quality', quality, '--device', process.env.BAKE_DEVICE || 'auto', '--bake', '--cutaway', '--cutaway-lift', String(LIFT)], { onLine: log });
  console.log(`bake: ${((Date.now() - t) / 60000).toFixed(1)} min`);
  await run(process.execPath, [path.join(BAKE_DIR, 'optimize_glb.mjs'), path.join(bakeOut, 'house.glb'), path.join(bakeOut, 'house.web.glb')], { onLine: console.log });
  await run(process.execPath, [path.join(BAKE_DIR, 'hero_pack.mjs'), bakeOut, path.resolve(outDir, 'house.glb'), '1024', String(LIFT)], { onLine: console.log });

  // What the page needs to place the camera and lift the upper floor (feet).
  const { levels, footprint } = model.meta;
  fs.writeFileSync(path.resolve(outDir, 'house.json'), JSON.stringify({
    levels: levels.map((l) => ({ level: l.level, floorY: l.floorY, ceilingY: l.ceilingY })),
    footprint, lift: LIFT, quality, builtAt: new Date().toISOString(),
  }, null, 1));
  console.log(`wrote ${path.resolve(outDir, 'house.glb')} and house.json`);
}

main().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
