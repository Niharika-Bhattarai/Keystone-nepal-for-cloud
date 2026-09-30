'use strict';
// The Studio's edit mode (lib/planEdit): hand edits keep every room a
// rectangle (or rectangular parts), never open a gap or an overlap, never
// touch a stair, and are refused only when physically impossible; everything
// else comes back as a finding the Studio shows.
process.env.V2_DISABLE_LEGACY_FALLBACK = 'true';
const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/plan');
const editHandler = require('../api/plan_edit');
const { base } = require('../scripts/benchmark/studio-full-coverage.cjs');
const { planWallRuns, cellsOf } = require('../lib/planEdit/wallRuns');
const { applyEditOps } = require('../lib/planEdit/applyEditOps');
const { recomputeEditedPlan } = require('../lib/planEdit/recomputeEditedPlan');

const generate = (overrides) => new Promise((resolve, reject) => {
  const res = { statusCode: 200, setHeader() {}, status(n) { this.statusCode = n; return this; }, json(b) { resolve(b); return this; } };
  Promise.resolve(handler({ method: 'POST', body: { surveyData: { ...base, ...overrides } }, headers: {} }, res)).catch(reject);
});
const call = (fn, body) => new Promise((resolve) => {
  const res = { statusCode: 200, setHeader() {}, status(n) { this.statusCode = n; return this; }, json(b) { resolve({ status: this.statusCode, body: b }); return this; } };
  fn({ method: 'POST', body, headers: {} }, res);
});

const SURVEYS = {
  twoStoryUpper: { stories: '2 Stories', bedrooms: '3 Bed', bathrooms: '3 Bath', privateBaths: '1', totalArea: '2400', garage: '1 Car Garage' },
  mainFloor: { stories: '2 Stories', masterLocation: 'Level 1 (Main)', bedrooms: '4 Bed', bathrooms: '3 Bath', privateBaths: '1', totalArea: '3200', garage: '2 Car Garage', features: '' },
  ranch: { stories: '1 Story', masterLocation: 'Level 1 (Main)', bedrooms: '3 Bed', bathrooms: '2 Bath', privateBaths: '1', totalArea: '1800', garage: '2 Car Garage' },
  cottage: { stories: '1 Story', masterLocation: 'Level 1 (Main)', bedrooms: '1 Bed', bathrooms: '1 Bath', privateBaths: '0', totalArea: '800', garage: 'No Garage' },
};
const plans = {};
test.before(async () => {
  for (const [name, survey] of Object.entries(SURVEYS)) {
    const body = await generate(survey);
    assert.ok(body.success, `${name} generates`);
    plans[name] = body.planSpec;
  }
});

function overlaps(level) {
  const cells = cellsOf(level);
  for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) {
    const a = cells[i], b = cells[j];
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (ox > 1e-6 && oy > 1e-6) return `${a.room.id} overlaps ${b.room.id}`;
  }
  return null;
}
const levelArea = (level) => cellsOf(level).reduce((s, c) => s + c.w * c.h, 0);
const stairs = (plan) => JSON.stringify(plan.levels.map((l) => l.rooms.filter((r) => r.type === 'stairs').map(({ x, y, w, h }) => [x, y, w, h])));

// A deterministic stream of numbers for the random edits.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

test('every family offers draggable walls, and stair walls are locked', () => {
  for (const [name, plan] of Object.entries(plans)) {
    const runs = planWallRuns(plan);
    assert.ok(runs.some((r) => r.movable), `${name}: some wall can move`);
    const stairIds = new Set(plan.levels.flatMap((l) => l.rooms.filter((r) => r.type === 'stairs').map((r) => String(r.id))));
    for (const run of runs) {
      if (run.moves.some((m) => stairIds.has(m.roomId))) assert.equal(run.movable, false, `${name}: ${run.id} touches a stair`);
    }
  }
});

test('random wall drags keep rooms whole: no overlap, no gap, no room under 3 ft, stairs untouched', () => {
  for (const [name, plan] of Object.entries(plans)) {
    const next = rng(name.length * 7919);
    let current = plan;
    for (let step = 0; step < 12; step++) {
      const runs = planWallRuns(current).filter((r) => r.movable);
      if (!runs.length) break;
      const run = runs[Math.floor(next() * runs.length)];
      const span = Math.floor((run.maxDelta - run.minDelta) * 2);
      const delta = run.minDelta + Math.floor(next() * (span + 1)) / 2;
      const { plan: edited, issues } = applyEditOps(current, [{ op: 'moveWall', runId: run.id, delta }]);
      assert.deepEqual(issues, [], `${name} step ${step}: ${run.id} by ${delta}`);
      edited.levels.forEach((level, i) => {
        assert.equal(overlaps(level), null, `${name} step ${step}`);
        assert.ok(Math.abs(levelArea(level) - levelArea(current.levels[i])) < 1e-6, `${name} step ${step}: floor area kept`);
        for (const cell of cellsOf(level)) assert.ok(Math.min(cell.w, cell.h) >= 3 - 1e-6, `${name}: ${cell.room.id} at least 3 ft`);
      });
      assert.equal(stairs(edited), stairs(plan), `${name}: stairs untouched`);
      current = edited;
    }
  }
});

test('refused edits change nothing: a stair wall, a room below 3 ft, an unknown edit', () => {
  const plan = plans.mainFloor;
  const runs = planWallRuns(plan);
  const locked = runs.find((r) => r.reason === 'stairs');
  let out = applyEditOps(plan, [{ op: 'moveWall', runId: locked.id, delta: 1 }]);
  assert.equal(out.issues[0].code, 'wall_locked_stairs');
  assert.equal(out.plan, plan);
  const run = runs.find((r) => r.movable);
  out = applyEditOps(plan, [{ op: 'moveWall', runId: run.id, delta: run.maxDelta + 1 }]);
  assert.equal(out.issues[0].code, 'room_below_minimum');
  out = applyEditOps(plan, [{ op: 'flyAway' }]);
  assert.equal(out.issues[0].code, 'unknown_op');
});

test('shrinking a bedroom is allowed and reports what broke', () => {
  const plan = plans.twoStoryUpper;
  const bedroomIds = new Set(plan.levels[1].rooms.filter((r) => r.type === 'bedroom').map((r) => String(r.id)));
  // A movable wall of a secondary bedroom, dragged until the bedroom is 5 ft across.
  const run = planWallRuns(plan).find((r) => r.movable && r.moves.some((m) => bedroomIds.has(m.roomId)));
  assert.ok(run, 'a secondary bedroom has a movable wall');
  const move = run.moves.find((m) => bedroomIds.has(m.roomId));
  const bedroom = plan.levels[1].rooms.find((r) => String(r.id) === move.roomId);
  const cell = move.part === null ? bedroom : bedroom.parts[move.part];
  const span = run.axis === 'x' ? cell.w : cell.h;
  const shrink = span - 5;
  const delta = move.edge === 'right' || move.edge === 'bottom' ? -shrink : shrink;
  const result = recomputeEditedPlan(plan, [{ op: 'moveWall', runId: run.id, delta: Math.max(run.minDelta, Math.min(run.maxDelta, delta)) }]);
  assert.ok(result.ok, JSON.stringify(result.issues));
  const mine = result.newIssues.filter((i) => i.roomId === String(bedroom.id));
  assert.ok(mine.some((i) => ['room_narrow', 'room_small', 'furniture_missing'].includes(i.code)), JSON.stringify(result.newIssues));
  assert.ok(result.newIssues.every((i) => i.severity !== 'block'));
  assert.ok(result.planSpec.edited);
  assert.equal(result.planSpec.edits.ops.length, 1);
});

test('swapping the kitchen and living room exchanges their places; furniture elsewhere stays put', () => {
  const plan = plans.mainFloor;
  const ground = plan.levels[0];
  const kitchen = ground.rooms.find((r) => r.type === 'kitchen'), living = ground.rooms.find((r) => r.type === 'living_room');
  const result = recomputeEditedPlan(plan, [{ op: 'swapRooms', a: kitchen.id, b: living.id }]);
  assert.ok(result.ok, JSON.stringify(result.issues));
  const after = result.planSpec.levels[0].rooms;
  const k2 = after.find((r) => r.id === kitchen.id), l2 = after.find((r) => r.id === living.id);
  assert.equal(k2.type, 'kitchen');
  assert.deepEqual([k2.x, k2.y, k2.w, k2.h], [living.x, living.y, living.w, living.h]);
  assert.deepEqual([l2.x, l2.y, l2.w, l2.h], [kitchen.x, kitchen.y, kitchen.w, kitchen.h]);
  // An upstairs bedroom did not change: its furniture is exactly as it was.
  const bed = plan.levels[1].rooms.find((r) => r.type === 'bedroom');
  const items = (p) => JSON.stringify(p.levels[1].furniture.filter((f) => String(f.roomId) === String(bed.id)));
  assert.equal(items(result.planSpec), items(plan));
});

test('a bedroom can become a study; the primary suite keeps its type', () => {
  const plan = plans.twoStoryUpper;
  const bedroom = plan.levels[1].rooms.find((r) => r.type === 'bedroom');
  const result = recomputeEditedPlan(plan, [{ op: 'changeRoomType', roomId: bedroom.id, type: 'study' }]);
  assert.ok(result.ok);
  assert.equal(result.planSpec.levels[1].rooms.find((r) => r.id === bedroom.id).type, 'study');
  const primary = plan.levels.flatMap((l) => l.rooms).find((r) => r.type === 'primary_bedroom');
  const refused = recomputeEditedPlan(plan, [{ op: 'changeRoomType', roomId: primary.id, type: 'study' }]);
  assert.equal(refused.ok, false);
  assert.equal(refused.issues[0].code, 'room_locked');
});

test('POST /api/plan/edit: describes a plan, applies edits, refuses bad input', async () => {
  const plan = plans.ranch;
  const described = await call(editHandler, { planSpec: plan });
  assert.equal(described.status, 200);
  const { layout, wallRuns, areas, svg } = described.body;
  assert.ok(svg.startsWith('<svg'));
  assert.equal(layout.levels.length, plan.levels.length);
  assert.ok(layout.levels[0].pxPerFt > 0 && layout.width > 0);
  assert.ok(wallRuns.some((r) => r.movable));
  assert.ok(areas.finished > 0 && areas.requested === 1800);
  const run = wallRuns.find((r) => r.movable && r.maxDelta >= 1);
  const moved = await call(editHandler, { planSpec: plan, ops: [{ op: 'moveWall', runId: run.id, delta: 1 }] });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.ok(moved.body.changedRoomIds.length >= 2);
  assert.equal((await call(editHandler, { planSpec: plan, ops: [{ op: 'explode' }] })).status, 400);
  assert.equal((await call(editHandler, { planSpec: plan, ops: 'x' })).status, 400);
  assert.equal((await call(editHandler, {})).status, 400);
  const locked = wallRuns.find((r) => !r.movable);
  if (locked) assert.equal((await call(editHandler, { planSpec: plan, ops: [{ op: 'moveWall', runId: locked.id, delta: 1 }] })).status, 422);
});

test('generated plans start with no findings that would block an edit', () => {
  for (const [name, plan] of Object.entries(plans)) {
    const result = recomputeEditedPlan(plan, []);
    assert.ok(result.ok, name);
    assert.deepEqual(result.issues.filter((i) => i.severity === 'block'), [], name);
  }
});
