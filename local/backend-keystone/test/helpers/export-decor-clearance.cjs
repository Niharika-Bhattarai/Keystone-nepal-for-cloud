'use strict';
// Writes the decoration clearance fixture's bake metadata for
// test/blender/decor_clearance.py. Usage: node export-decor-clearance.cjs <out-dir>
const fs = require('node:fs'), path = require('node:path');
const { buildModel } = require('../../lib/model3d');
const decorClearancePlan = require('./decor-clearance-plan.cjs');
const out = path.resolve(process.argv[2]);
fs.mkdirSync(out, { recursive: true });
const model = buildModel(decorClearancePlan(), {});
fs.writeFileSync(path.join(out, 'decor-clearance.json'), JSON.stringify({ meta: model.meta, palette: model.palette }));
console.log(path.join(out, 'decor-clearance.json'));
