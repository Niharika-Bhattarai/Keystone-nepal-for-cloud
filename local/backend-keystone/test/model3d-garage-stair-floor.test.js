'use strict';
// C5d follow-ups: garage doors use the garage room's saved door head, and stair
// rooms carry the same finished floor as every other room.
const test = require('node:test'), assert = require('node:assert/strict');
const { buildModel } = require('../lib/model3d');
const { doorHeight } = require('../lib/openingPresentation');
const { renderElevations } = require('../lib/renderElevationSvg');
const { stairPlan } = require('./helpers/openings-stairs-plan.cjs');
const options = { include: { roof: false, site: false, furniture: false } };
const points = (model, level, mat) => { const b = model.builder.nodes.get(`Level ${level}`)?.get(mat); return b ? Array.from({ length: b.positions.length / 3 }, (_, i) => b.positions.slice(i * 3, i * 3 + 3)) : []; };

// A generated garage: its room metadata carries an 8 ft door head in a 9 ft storey.
function garagePlan(head = 8, clear = 9) {
  return { levels: [{ level: 1, width: 20, height: 22, rooms: [{ id: 'g', type: 'garage', x: 0, y: 0, w: 20, h: 22,
    heightMeta: { clearHeightFt: clear, doorHeadHeightFt: head } }],
  doors: [{ id: 'gd', a: 'g', b: '__exterior__', dir: 'horizontal', x: 10, y: 22, width: 16, garageDoor: true }] }],
  verticalModel: { levels: [{ level: 1, floorZFt: 0, clearHeightFt: clear, floorToFloorFt: clear + 1, structureThicknessFt: 1 }] } };
}

test('garage door head follows the garage room (8 ft), in 3D and elevations', () => {
  const plan = garagePlan();
  assert.equal(doorHeight(plan.levels[0].doors[0], plan.levels[0].rooms), 8);
  const m = buildModel(plan, options);
  assert.equal(Math.max(...points(m, 1, 'garage-door').map(p => p[1])), 8, 'the door leaf reaches the 8 ft head');
  // Wall solids are boxes (corner vertices only): every exterior wall solid that
  // crosses the door's centre line must start at or above the head.
  const b = m.builder.nodes.get('Level 1').get('cladding'), solids = new Map();
  b.solids.forEach((id, i) => { if (!solids.has(id)) solids.set(id, []); solids.get(id).push(b.positions.slice(i * 3, i * 3 + 3)); });
  const across = [...solids.values()].filter(vs => Math.min(...vs.map(v => v[0])) < 0 && Math.max(...vs.map(v => v[0])) > 0 && Math.min(...vs.map(v => v[2])) > 10.5);
  assert.ok(across.length, 'the wall above the door exists');
  assert.ok(across.every(vs => Math.min(...vs.map(v => v[1])) >= 8 - 1e-6), 'no wall below the 8 ft head inside the opening');
  const svg = Object.values(renderElevations(plan, {})).filter(v => typeof v === 'string').join('');
  assert.match(svg, /data-opening="garage-door"/);
});

test('an explicit saved garage height still wins, and a garage without metadata keeps 7 ft', () => {
  const plan = garagePlan();
  assert.equal(doorHeight({ ...plan.levels[0].doors[0], heightFt: 7.5 }, plan.levels[0].rooms), 7.5);
  assert.equal(doorHeight(plan.levels[0].doors[0], [{ id: 'g', type: 'garage' }]), 7);
});

test('stair rooms carry the finished floor at the shared datum, except over the upper opening', () => {
  const p = stairPlan('quarter-turn'), m = buildModel(p, options), core = p.levels[0].rooms[0];
  // Group the floor finish by solid; a solid belongs to the stair room when its centre is strictly inside it.
  const solidsInCore = level => {
    const b = m.builder.nodes.get(`Level ${level}`)?.get('floor-public'), groups = new Map();
    if (!b) return [];
    b.solids.forEach((id, i) => { if (!groups.has(id)) groups.set(id, []); groups.get(id).push(b.positions.slice(i * 3, i * 3 + 3)); });
    return [...groups.values()].filter(vs => {
      const c = [0, 2].map(a => (Math.min(...vs.map(v => v[a])) + Math.max(...vs.map(v => v[a]))) / 2);
      return c[0] > core.x - 16 && c[0] < core.x + core.w - 16 && c[1] > core.y - 16 && c[1] < core.y + core.h - 16;
    });
  };
  const lower = solidsInCore(1);
  assert.ok(lower.length, 'the ground-floor stair room has a floor finish');
  for (const vs of lower) assert.equal(Math.max(...vs.map(v => v[1])), 0, 'at the finished-floor datum shared with the first riser');
  assert.equal(solidsInCore(2).length, 0, 'the upper stair opening stays open');
});
