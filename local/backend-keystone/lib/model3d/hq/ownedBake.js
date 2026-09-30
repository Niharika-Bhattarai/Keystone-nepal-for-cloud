'use strict';
// Real bake for one owned render attempt: the job's frozen input in, allowlisted
// artifacts out through a writer scoped to that attempt. It writes no status or
// manifest files; the job transaction is the only record of progress and outcome.
// Not wired to a route or cloud worker yet; HQ remains disabled.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { buildModel } = require('../buildModel');
const { toGlb } = require('../writers');
const { blenderRunner, progressFor, viewerMeta } = require('./bakeJob');
const { error } = require('../../accounts/creditRecords');

const IMAGES = /^(?:lm_[a-zA-Z0-9_-]{1,70}|(?:exterior|interior)_[a-zA-Z0-9_-]{1,64})\.jpg$/;

async function bakeOwned({ input, writer, signal, progress = () => {}, runner = blenderRunner, log = () => {} }) {
  if (!input?.planSpec || !input.options || !writer) throw error('BAKE_INVALID', 'A frozen job input and a scoped writer are required');
  const options = input.options; // normalised when the job was created
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'keystone-owned-bake-'));
  try {
    const model = buildModel(input.planSpec, { roofKind: options.roofKind || undefined });
    await fsp.writeFile(path.join(work, 'house.glb'), toGlb(model, { withSolids: true }));
    await fsp.writeFile(path.join(work, 'house.json'), JSON.stringify({ meta: model.meta, palette: model.palette }));
    const out = path.join(work, 'out');
    await fsp.mkdir(out);
    let last = { progress: 0 };
    await runner({ work, out, options, signal, onLine: (line) => {
      if (!line.startsWith('[bake')) return;
      log(line);
      const next = progressFor(line, last);
      if (next) { last = next; progress(next.progress); }
    } });
    if (signal?.aborted) throw error('BAKE_ABORTED', 'Render attempt was cancelled');
    const present = await fsp.readdir(out);
    const model3d = present.includes('house.web.glb') ? 'house.web.glb' : present.includes('house.glb') ? 'house.glb' : null;
    if (!model3d) throw error('BAKE_OUTPUT_MISSING', 'The bake produced no model');
    // Only the optimised model and named images leave the work folder. Blender's
    // report, the engine input and anything unexpected stay behind and are removed.
    const images = present.filter(n => IMAGES.test(n)).sort();
    if (images.length > 199) throw error('BAKE_OUTPUT_INVALID', 'The bake produced too many files');
    await writer.put('house.glb', path.join(out, model3d));
    for (const name of images) await writer.put(name, path.join(out, name));
    return { files: ['house.glb', ...images], viewer: viewerMeta(model) };
  } finally {
    await fsp.rm(work, { recursive: true, force: true });
    if (fs.existsSync(work)) log(`[owned-bake] work folder could not be removed: ${path.basename(work)}`);
  }
}
module.exports = { bakeOwned };
