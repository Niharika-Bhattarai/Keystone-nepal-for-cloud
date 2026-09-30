'use strict';
// C5e: the model draws only what the plan contains, and publishes anything it adds
// as illustrative site dressing: every door, and the paving rectangles exactly as
// drawn. 2026-09-28: the owner asked for a porch at the front door. It is dressing
// of the same kind (published in meta.site.porch for the bake to reproduce), on the
// Site node, never the roof.
const test = require('node:test'), assert = require('node:assert/strict');
const { buildModel } = require('../lib/model3d');
const decorClearancePlan = require('./helpers/decor-clearance-plan.cjs');

const solidsOf = (model, node, mat) => {
  const b = model.builder.nodes.get(node)?.get(mat), out = new Map();
  if (!b) return [];
  b.solids.forEach((id, i) => { if (!out.has(id)) out.set(id, []); out.get(id).push(b.positions.slice(i * 3, i * 3 + 3)); });
  return [...out.values()];
};
const extent = (vs) => [Math.min(...vs.map(v => v[0])), Math.max(...vs.map(v => v[0])), Math.min(...vs.map(v => v[2])), Math.max(...vs.map(v => v[2]))];

test('the front porch is published dressing on the Site node, not part of the roof', () => {
  const m = buildModel(decorClearancePlan(), {});
  const porch = m.meta.site.porch;
  assert.ok(porch && porch.illustrative, 'published for the bake');
  const [x0, x1, z0, z1] = porch.canopy;
  assert.ok(x0 < -5 && x1 > -5 && z0 >= 13 - 0.5 && z1 > 13 + 6, 'the canopy covers the stoop in front of the door');
  assert.ok(porch.canopyY[0] > porch.floorY + 8, 'above the door head');
  assert.equal(porch.posts.length, 2);
  assert.ok(solidsOf(m, 'Site', 'soffit').length === 1, 'one canopy on the Site node');
  assert.equal(solidsOf(m, 'Roof', 'cladding-accent').length, 0, 'no stone piers');
  // Nothing on the Roof node stands over the stoop beyond the eave overhang:
  // the main door is at x -5 on the z 13 facade; its stoop runs 6 ft out.
  const roof = m.builder.nodes.get('Roof');
  const over = [];
  for (const [mat, b] of roof) for (let i = 0; i < b.positions.length; i += 3) {
    const [x, y, z] = [b.positions[i], b.positions[i + 1], b.positions[i + 2]];
    if (Math.abs(x + 5) < 3 && z > 13 + 3 && z < 13 + 6.5) over.push({ mat, y });
  }
  assert.deepEqual(over, [], 'no porch roof, beam, columns or ceiling over the stoop');
});

test('the paving the model draws is published as illustrative site dressing', () => {
  const m = buildModel(decorClearancePlan(), {});
  assert.equal(m.meta.site.illustrative, true);
  const drawn = [...solidsOf(m, 'Site', 'driveway'), ...solidsOf(m, 'Site', 'walkway')].map(extent).map(r => r.map(v => Math.round(v * 100) / 100));
  const published = m.meta.site.paving.map(p => p.rect.map(v => Math.round(v * 100) / 100));
  assert.deepEqual(new Set(m.meta.site.paving.map(p => p.kind)), new Set(['driveway', 'stoop', 'steps', 'walk']));
  assert.deepEqual(published.map(String).sort(), drawn.map(String).sort(), 'every published rectangle is a drawn slab and vice versa');
  const off = buildModel(decorClearancePlan(), { include: { site: false } });
  assert.equal(off.meta.site, null, 'no site, no site dressing');
});

test('every door is published with its engine position, width and orientation', () => {
  const m = buildModel(decorClearancePlan(), {});
  const byId = Object.fromEntries(m.meta.doors.map(d => [d.id, d]));
  assert.deepEqual(Object.keys(byId).sort(), ['d-bed', 'd-garage', 'd-liv', 'd-main']);
  assert.deepEqual(byId['d-liv'], { id: 'd-liv', level: 1, position: [1, -1], width: 3, alongX: true, exterior: false, kind: 'door' });
  assert.equal(byId['d-main'].exterior, true);
  assert.equal(byId['d-garage'].kind, 'garage');
});
