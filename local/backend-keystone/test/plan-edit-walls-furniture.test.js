'use strict';
// The Studio's edit mode, phases 2 and 3: taking out a wall (the rooms open
// into each other), merging two rooms into one, and moving, turning and
// removing furniture. An opened wall must agree everywhere a wall is read:
// the drawing, the doors, access, the wall model (DXF, estimate) and the 3D
// model. Furniture a person arranged stays where they put it.
process.env.V2_DISABLE_LEGACY_FALLBACK = 'true';
const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/plan');
const editHandler = require('../api/plan_edit');
const { base } = require('../scripts/benchmark/studio-full-coverage.cjs');
const { planWallRuns, cellsOf } = require('../lib/planEdit/wallRuns');
const { applyEditOps, simplifyParts } = require('../lib/planEdit/applyEditOps');
const { recomputeEditedPlan } = require('../lib/planEdit/recomputeEditedPlan');
const { pairKey, sharedLength } = require('../lib/openEdges');
const { buildWallModel } = require('../lib/geometry/wallModel');
const { validatePhysicalAccess } = require('../lib/validatePhysicalAccess');
const { fitsRoom } = require('../lib/furnitureGeometry');

const generate = (overrides) => new Promise((resolve, reject) => {
  const res = { statusCode: 200, setHeader() {}, status(n) { this.statusCode = n; return this; }, json(b) { resolve(b); return this; } };
  Promise.resolve(handler({ method: 'POST', body: { surveyData: { ...base, ...overrides } }, headers: {} }, res)).catch(reject);
});
const call = (fn, body) => new Promise((resolve) => {
  const res = { statusCode: 200, setHeader() {}, status(n) { this.statusCode = n; return this; }, json(b) { resolve({ status: this.statusCode, body: b }); return this; } };
  fn({ method: 'POST', body, headers: {} }, res);
});

const SURVEYS = {
  ranch: { stories: '1 Story', masterLocation: 'Level 1 (Main)', bedrooms: '3 Bed', bathrooms: '2 Bath', privateBaths: '1', totalArea: '1800', garage: '2 Car Garage' },
  twoStoryUpper: { stories: '2 Stories', bedrooms: '3 Bed', bathrooms: '3 Bath', privateBaths: '1', totalArea: '2400', garage: '1 Car Garage' },
  mainFloor: { stories: '2 Stories', masterLocation: 'Level 1 (Main)', bedrooms: '4 Bed', bathrooms: '3 Bath', privateBaths: '1', totalArea: '3200', garage: '2 Car Garage', features: '' },
};
const plans = {};
test.before(async () => {
  for (const [name, survey] of Object.entries(SURVEYS)) {
    const body = await generate(survey);
    assert.ok(body.success, `${name} generates`);
    plans[name] = body.planSpec;
  }
});

const roomsOf = (plan, type) => plan.levels.flatMap((l) => l.rooms.filter((r) => r.type === type));
const levelOf = (plan, id) => plan.levels.find((l) => l.rooms.some((r) => String(r.id) === String(id)));
const doorsBetween = (level, a, b) => (level.doors || []).filter((d) => pairKey(d.a, d.b) === pairKey(a, b));
const wallLines = (svg) => (svg.match(/stroke="#2c2c2e"/g) || []).length;
function overlaps(level) {
  const cells = cellsOf(level);
  for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) {
    const a = cells[i], b = cells[j];
    if (Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1e-6 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1e-6) return `${a.room.id} overlaps ${b.room.id}`;
  }
  return null;
}
const levelArea = (level) => cellsOf(level).reduce((s, c) => s + c.w * c.h, 0);
// Two neighbouring rooms of the given types on one floor.
function pairOf(plan, typesA, typesB) {
  for (const level of plan.levels) {
    for (const a of level.rooms.filter((r) => typesA.includes(r.type))) {
      const b = level.rooms.find((r) => r !== a && typesB.includes(r.type) && sharedLength(a, r) >= 3);
      if (b) return [a, b, level];
    }
  }
  return null;
}
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

test('opening a wall removes it everywhere a wall is read, and closing it brings the door back', () => {
  const plan = plans.ranch;
  const [bed, hall] = pairOf(plan, ['bedroom'], ['hallway']);
  const level = levelOf(plan, bed.id);
  assert.equal(doorsBetween(level, bed.id, hall.id).length, 1, 'a door joins them to start with');
  const before = recomputeEditedPlan(plan, []);
  const opened = recomputeEditedPlan(plan, [{ op: 'openWall', a: bed.id, b: hall.id }]);
  assert.ok(opened.ok, JSON.stringify(opened.issues));
  const after = levelOf(opened.planSpec, bed.id);
  assert.deepEqual(after.openEdges, [{ a: String(bed.id), b: String(hall.id) }]);
  assert.equal(doorsBetween(after, bed.id, hall.id).length, 0, 'no door in an opening');
  assert.ok(wallLines(opened.svg) < wallLines(before.svg), 'the drawing leaves the wall out');
  const pairIds = (w) => w.roomIds.map(String).sort().join('|');
  assert.ok(!buildWallModel(after).walls.some((w) => pairIds(w) === [bed.id, hall.id].map(String).sort().join('|')), 'the wall model (DXF, estimate) leaves it out');
  assert.deepEqual(validatePhysicalAccess(opened.planSpec), [], 'the bedroom is still reached, through the opening');
  assert.ok(!opened.issues.some((i) => i.code === 'unreachable'));
  assert.ok(require('../lib/model3d/buildModel').buildModel(opened.planSpec), 'the 3D model builds');
  const closed = recomputeEditedPlan(opened.planSpec, [{ op: 'closeWall', a: bed.id, b: hall.id }]);
  assert.ok(closed.ok);
  const back = levelOf(closed.planSpec, bed.id);
  assert.equal(back.openEdges, undefined);
  assert.equal(doorsBetween(back, bed.id, hall.id).length, 1, 'the door comes back');
});

test('the garage and the stair keep their walls; rooms must share one', () => {
  const plan = plans.twoStoryUpper;
  const garagePair = pairOf(plan, ['garage'], ['mudroom', 'laundry', 'hallway', 'entry', 'kitchen']);
  let out = applyEditOps(plan, [{ op: 'openWall', a: garagePair[0].id, b: garagePair[1].id }]);
  assert.equal(out.issues[0].code, 'room_locked');
  assert.match(out.issues[0].message, /fire/);
  const stairPair = pairOf(plan, ['stairs'], ['hallway', 'entry', 'loft', 'living_room']);
  out = applyEditOps(plan, [{ op: 'mergeRooms', a: stairPair[0].id, b: stairPair[1].id }]);
  assert.equal(out.issues[0].code, 'room_locked');
  const [k] = roomsOf(plan, 'kitchen'), [p] = roomsOf(plan, 'primary_bedroom');
  out = applyEditOps(plan, [{ op: 'openWall', a: k.id, b: p.id }]);
  assert.ok(['not_neighbours', 'different_floors'].includes(out.issues[0].code));
  assert.equal(out.plan, plan);
});

test('an opening stays in its wall when the rooms swap places', () => {
  const plan = plans.ranch;
  const [bed, hall] = pairOf(plan, ['bedroom'], ['hallway']);
  const other = roomsOf(plan, 'bedroom').find((r) => r.id !== bed.id);
  const { plan: opened } = applyEditOps(plan, [{ op: 'openWall', a: bed.id, b: hall.id }]);
  const { plan: swapped, issues } = applyEditOps(opened, [{ op: 'swapRooms', a: bed.id, b: other.id }]);
  assert.deepEqual(issues, []);
  const edges = levelOf(swapped, hall.id).openEdges || [];
  // The other bedroom now stands where the opened one was; if it still meets
  // the hall there, the opening joins it.
  if (sharedLength(levelOf(swapped, other.id).rooms.find((r) => r.id === other.id), hall) > 0.5) {
    assert.deepEqual(edges.map((e) => pairKey(e.a, e.b)), [pairKey(other.id, hall.id)]);
  }
});

test('merging two rooms makes one: the larger keeps its name, nothing overlaps, the floor area is kept', () => {
  for (const [name, plan] of Object.entries(plans)) {
    const found = pairOf(plan, ['bedroom'], ['bedroom', 'closet', 'storage', 'study']) || pairOf(plan, ['bedroom'], ['hallway']);
    if (!found) continue;
    const [a, b, level] = found;
    const larger = (a.w * a.h >= b.w * b.h) ? a : b;
    const result = recomputeEditedPlan(plan, [{ op: 'mergeRooms', a: a.id, b: b.id }]);
    assert.ok(result.ok, `${name}: ${JSON.stringify(result.issues)}`);
    const after = result.planSpec.levels.find((l) => (Number(l.level) || 1) === (Number(level.level) || 1));
    assert.equal(after.rooms.length, level.rooms.length - 1, name);
    const kept = after.rooms.find((r) => r.mergedFrom);
    assert.equal(kept.id, larger.id, `${name}: the larger room keeps its name`);
    assert.equal(overlaps(after), null, name);
    assert.ok(Math.abs(levelArea(after) - levelArea(level)) < 1e-6, `${name}: floor area kept`);
    assert.ok(!(after.furniture || []).some((f) => String(f.roomId) === String(kept.id === a.id ? b.id : a.id)), `${name}: nothing left in the room that went`);
    if (a.type === 'bedroom' && b.type === 'bedroom') assert.ok(result.issues.some((i) => i.code === 'bedroom_count'), name);
  }
});

test('room counts are measured against the plan as generated, not the brief', () => {
  const plan = plans.twoStoryUpper;
  const found = pairOf(plan, ['bedroom'], ['bathroom']);
  assert.ok(found, 'a bedroom next to a bathroom');
  const result = recomputeEditedPlan(plan, [{ op: 'mergeRooms', a: found[0].id, b: found[1].id }]);
  assert.ok(result.ok);
  const baths = result.issues.find((i) => i.code === 'bath_count');
  assert.equal(baths?.severity, 'info');
  assert.equal(baths.measured, baths.needed - 1);
  // A later edit keeps the first baseline; an edit that changes no rooms reports nothing.
  assert.deepEqual(result.planSpec.editBaseline, recomputeEditedPlan(plan, [{ op: 'closeWall', a: 'x', b: 'y' }]).planSpec.editBaseline);
  const untouched = recomputeEditedPlan(plan, [{ op: 'closeWall', a: 'x', b: 'y' }]);
  assert.ok(!untouched.issues.some((i) => i.code === 'bath_count' || i.code === 'bedroom_count'));
});

test('rectangles that make one rectangle become one', () => {
  assert.deepEqual(simplifyParts([{ x: 0, y: 0, w: 10, h: 12 }, { x: 0, y: 12, w: 10, h: 4 }]), [{ x: 0, y: 0, w: 10, h: 16 }]);
  assert.equal(simplifyParts([{ x: 0, y: 0, w: 10, h: 12 }, { x: 10, y: 0, w: 4, h: 6 }]).length, 2);
});

test('moving furniture: the piece stays where it was put, its group moves with it, a later wall move keeps it', () => {
  const plan = plans.ranch;
  const level = plan.levels[0];
  const sofa = level.furniture.find((f) => f.kind === 'sofa');
  const moved = recomputeEditedPlan(plan, [{ op: 'moveFurniture', itemId: sofa.id, dx: 1.5, dy: 1 }]);
  assert.ok(moved.ok, JSON.stringify(moved.issues));
  const s2 = moved.planSpec.levels[0].furniture.find((f) => f.id === sofa.id);
  assert.ok(s2.pinned);
  assert.ok(moved.planSpec.levels[0].rooms.find((r) => r.id === s2.roomId).furnitureEdited);
  // An unrelated wall moves: the arranged room keeps the sofa exactly.
  const run = moved.wallRuns.find((r) => r.movable && !r.rooms.includes(String(s2.roomId)) && r.maxDelta >= 1);
  const later = recomputeEditedPlan(moved.planSpec, [{ op: 'moveWall', runId: run.id, delta: 1 }]);
  assert.ok(later.ok);
  const s3 = later.planSpec.levels[0].furniture.find((f) => f.id === sofa.id);
  assert.deepEqual([s3.x, s3.y], [s2.x, s2.y]);
  // The dining table takes its chairs.
  const table = level.furniture.find((f) => f.kind === 'dining_table');
  const set = recomputeEditedPlan(plan, [{ op: 'moveFurniture', itemId: table.id, dx: 0, dy: 1 }]);
  assert.ok(set.ok);
  const was = (id) => level.furniture.find((f) => f.id === id);
  const members = set.planSpec.levels[0].furniture.filter((f) => /^(dining_table|chair_)/.test(f.kind));
  assert.ok(members.length >= 2);
  const shifts = new Set(members.map((m) => `${(m.x - was(m.id).x).toFixed(3)},${(m.y - was(m.id).y).toFixed(3)}`));
  assert.equal(shifts.size, 1, 'every piece of the set moved the same way');
});

test('turning a bed turns its nightstands with it and keeps the plan and 3D facing the same way', () => {
  const plan = plans.ranch;
  const level = plan.levels[0];
  const bed = level.furniture.find((f) => /^bed_/.test(f.kind));
  const result = recomputeEditedPlan(plan, [{ op: 'turnFurniture', itemId: bed.id }]);
  assert.ok(result.ok, JSON.stringify(result.issues));
  const b2 = result.planSpec.levels[0].furniture.find((f) => f.id === bed.id);
  assert.deepEqual([b2.w, b2.h], [bed.h, bed.w]);
  assert.equal(b2.rotation, ((bed.rotation || 0) + 90) % 360);
  assert.equal(b2.back, { 0: 'n', 90: 'e', 180: 's', 270: 'w' }[b2.rotation]);
  assert.ok(!result.newIssues.some((i) => i.code === 'furniture_overlap'), JSON.stringify(result.newIssues));
  // Its head was against a wall, so it goes against the wall behind its new head.
  const room = result.planSpec.levels[0].rooms.find((r) => r.id === bed.roomId);
  const gap = { n: b2.y - room.y, s: room.y + room.h - (b2.y + b2.h), w: b2.x - room.x, e: room.x + room.w - (b2.x + b2.w) }[b2.back];
  assert.ok(gap <= 1, `head ${gap} ft from the wall`);
});

test('pieces stay in rooms made for them, inside the house, off the stair', () => {
  const plan = plans.ranch;
  const level = plan.levels[0];
  const toilet = level.furniture.find((f) => f.kind === 'toilet');
  const bed = level.rooms.find((r) => r.type === 'bedroom');
  let out = applyEditOps(plan, [{ op: 'moveFurniture', itemId: toilet.id, dx: bed.x + bed.w / 2 - toilet.x, dy: bed.y + bed.h / 2 - toilet.y }]);
  assert.equal(out.issues[0].code, 'furniture_wrong_room');
  const sofa = level.furniture.find((f) => f.kind === 'sofa');
  out = applyEditOps(plan, [{ op: 'moveFurniture', itemId: sofa.id, dx: 500 - 1, dy: 0 }]);
  assert.ok(['furniture_outside', 'bad_move'].includes(out.issues[0].code));
  out = applyEditOps(plan, [{ op: 'moveFurniture', itemId: 'nope', dx: 1, dy: 1 }]);
  assert.equal(out.issues[0].code, 'item_not_found');
});

test('removing a piece is a note, overlapping or blocking a door a warning, and reset refurnishes the room', () => {
  const plan = plans.ranch;
  const level = plan.levels[0];
  const bed = level.furniture.find((f) => /^bed_/.test(f.kind));
  const removed = recomputeEditedPlan(plan, [{ op: 'removeFurniture', itemId: bed.id }]);
  assert.ok(removed.ok);
  assert.ok(!removed.planSpec.levels[0].furniture.some((f) => f.id === bed.id));
  const note = removed.issues.find((i) => i.roomId === String(bed.roomId) && i.code === 'furniture_absent');
  assert.equal(note?.severity, 'info');
  const reset = recomputeEditedPlan(removed.planSpec, [{ op: 'resetFurniture', roomId: bed.roomId }]);
  assert.ok(reset.ok);
  assert.ok(reset.planSpec.levels[0].furniture.some((f) => String(f.roomId) === String(bed.roomId) && /^bed_/.test(f.kind)));
  assert.ok(!reset.planSpec.levels[0].rooms.find((r) => r.id === bed.roomId).furnitureEdited);
  const sofa = level.furniture.find((f) => f.kind === 'sofa'), table = level.furniture.find((f) => f.kind === 'coffee_table');
  const onto = recomputeEditedPlan(plan, [{ op: 'moveFurniture', itemId: sofa.id, dx: table.x - sofa.x, dy: table.y - sofa.y }]);
  assert.ok(onto.ok);
  assert.ok(onto.newIssues.some((i) => i.code === 'furniture_overlap' && i.severity === 'warn'), JSON.stringify(onto.newIssues));
});

test('a piece squeezed out by a wall is taken out and reported once', () => {
  const plan = plans.ranch;
  const level = plan.levels[0];
  // Pin the sofa, then shrink its room from every movable side as far as it goes.
  const sofa = level.furniture.find((f) => f.kind === 'sofa');
  let current = recomputeEditedPlan(plan, [{ op: 'moveFurniture', itemId: sofa.id, dx: 0.25, dy: 0 }]);
  assert.ok(current.ok);
  const roomId = String(current.planSpec.levels[0].furniture.find((f) => f.id === sofa.id).roomId);
  let reported = null;
  for (let step = 0; step < 8 && !reported; step++) {
    const run = current.wallRuns.find((r) => r.movable && r.moves.some((m) => m.roomId === roomId));
    if (!run) break;
    const move = run.moves.find((m) => m.roomId === roomId);
    const delta = move.edge === 'right' || move.edge === 'bottom' ? run.minDelta : run.maxDelta;
    if (!delta) break;
    const next = recomputeEditedPlan(current.planSpec, [{ op: 'moveWall', runId: run.id, delta }]);
    assert.ok(next.ok);
    reported = next.newIssues.find((i) => i.code === 'furniture_dropped') || null;
    const still = next.planSpec.levels[0].furniture.find((f) => f.id === sofa.id);
    if (still) {
      const room = next.planSpec.levels[0].rooms.find((r) => String(r.id) === roomId);
      assert.ok(fitsRoom(still, room), 'a kept piece is inside its room');
    }
    current = next;
  }
  if (reported) {
    assert.equal(reported.severity, 'warn');
    // The next edit does not report it again.
    const run = current.wallRuns.find((r) => r.movable && !r.rooms.includes(roomId) && r.maxDelta >= 0.5);
    if (run) assert.ok(!recomputeEditedPlan(current.planSpec, [{ op: 'moveWall', runId: run.id, delta: 0.5 }]).issues.some((i) => i.code === 'furniture_dropped'));
  }
});

test('a wall opened under the upper floor gets a note about a beam', () => {
  const plan = plans.twoStoryUpper;
  const ground = plan.levels[0];
  const types = ['kitchen', 'dining_room', 'living_room', 'hallway', 'mudroom', 'laundry', 'entry', 'bathroom'];
  let found = null;
  for (const a of ground.rooms.filter((r) => types.includes(r.type))) {
    for (const b of ground.rooms.filter((r) => r !== a && types.includes(r.type) && sharedLength(a, r) >= 3)) {
      const out = recomputeEditedPlan(plan, [{ op: 'openWall', a: a.id, b: b.id }]);
      if (out.ok && out.issues.some((i) => i.code === 'open_wall_beam')) { found = out; break; }
    }
    if (found) break;
  }
  assert.ok(found, 'some ground-floor wall sits under the upper floor');
  assert.equal(found.issues.find((i) => i.code === 'open_wall_beam').severity, 'info');
});

test('random mixed edits never overlap, never lose floor area, and keep arranged pieces inside their rooms', () => {
  for (const [name, plan] of Object.entries(plans)) {
    const next = rng(name.length * 104729);
    let current = plan;
    for (let step = 0; step < 10; step++) {
      const kind = next();
      let op = null;
      if (kind < 0.35) {
        const runs = planWallRuns(current).filter((r) => r.movable);
        const run = runs[Math.floor(next() * runs.length)];
        if (run) op = { op: 'moveWall', runId: run.id, delta: run.minDelta + Math.floor(next() * (Math.floor((run.maxDelta - run.minDelta) * 2) + 1)) / 2 };
      } else if (kind < 0.6) {
        const level = current.levels[Math.floor(next() * current.levels.length)];
        const rooms = level.rooms.filter((r) => !['stairs', 'garage'].includes(r.type));
        const a = rooms[Math.floor(next() * rooms.length)];
        const b = a && rooms.find((r) => r !== a && sharedLength(a, r) >= 2);
        if (b) op = { op: next() < 0.5 ? 'openWall' : 'mergeRooms', a: a.id, b: b.id };
      } else {
        const level = current.levels[Math.floor(next() * current.levels.length)];
        const items = (level.furniture || []).filter((f) => f.kind !== 'car');
        const item = items[Math.floor(next() * items.length)];
        if (item) op = next() < 0.7 ? { op: 'moveFurniture', itemId: item.id, dx: Math.round((next() * 6 - 3) * 4) / 4, dy: Math.round((next() * 6 - 3) * 4) / 4 }
          : { op: 'turnFurniture', itemId: item.id };
      }
      if (!op) continue;
      const result = recomputeEditedPlan(current, [op]);
      if (!result.ok) {
        assert.ok(result.issues.every((i) => i.severity === 'block'), `${name} step ${step}`);
        continue;
      }
      result.planSpec.levels.forEach((level, i) => {
        assert.equal(overlaps(level), null, `${name} step ${step} ${op.op}`);
        assert.ok(Math.abs(levelArea(level) - levelArea(current.levels[i])) < 1e-6, `${name} step ${step} ${op.op}: floor area kept`);
        for (const room of level.rooms.filter((r) => r.furnitureEdited)) {
          for (const item of level.furniture.filter((f) => String(f.roomId) === String(room.id))) {
            assert.ok(fitsRoom(item, room), `${name} step ${step} ${op.op}: ${item.id} inside ${room.id}`);
          }
        }
        for (const e of level.openEdges || []) assert.ok(level.rooms.some((r) => String(r.id) === e.a) && level.rooms.some((r) => String(r.id) === e.b));
      });
      current = result.planSpec;
    }
  }
});

test('an edited plan keeps its rendered presentation', async () => {
  const plan = plans.ranch;
  const beds = roomsOf(plan, 'bedroom');
  const merged = recomputeEditedPlan(plan, [{ op: 'mergeRooms', a: beds[0].id, b: beds[1].id }]);
  assert.ok(merged.ok);
  const { validateEditedPlan } = require('../lib/validateEditedPlan');
  assert.ok(validateEditedPlan(merged.planSpec, merged.planSpec.designSurvey).length > 0, 'the generator rules reject a merged bedroom');
  const presentation = await call(require('../api/plan_presentation'), { planSpec: merged.planSpec, surveyData: merged.planSpec.designSurvey });
  assert.equal(presentation.status, 200, JSON.stringify(presentation.body).slice(0, 300));
  assert.ok(presentation.body.svg.startsWith('<svg'));
  // A plan that was not edited by hand is still held to the generator's rules.
  const { edited, ...unmarked } = merged.planSpec;
  assert.equal((await call(require('../api/plan_presentation'), { planSpec: unmarked, surveyData: merged.planSpec.designSurvey })).status, 422);
});

test('POST /api/plan/edit takes the new edits', async () => {
  const plan = plans.ranch;
  const [bed, hall] = pairOf(plan, ['bedroom'], ['hallway']);
  const sofa = plan.levels[0].furniture.find((f) => f.kind === 'sofa');
  const res = await call(editHandler, { planSpec: plan, ops: [{ op: 'openWall', a: bed.id, b: hall.id }, { op: 'moveFurniture', itemId: sofa.id, dx: '1', dy: 0.5 }] });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(res.body.planSpec.levels[0].openEdges.length === 1);
  assert.ok(res.body.svg.includes(`data-item="${sofa.id}"`), 'each piece is its own group in the drawing');
  const refused = await call(editHandler, { planSpec: plan, ops: [{ op: 'mergeRooms', a: bed.id, b: 'nowhere' }] });
  assert.equal(refused.status, 422);
});
