'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFloorPassageModel } = require('../lib/geometry/floorPassageModel');
const { buildWallModel } = require('../lib/geometry/wallModel');
const { unionArea, intersection } = require('../lib/geometry/rectBoolean');

const fixture = () => ({ level: 1, width: 20, height: 10, rooms: [
  { id: 'hall', type: 'hallway', x: 0, y: 0, w: 10, h: 10 },
  { id: 'bed', type: 'bedroom', x: 10, y: 0, w: 10, h: 10 },
], doors: [{ a: 'hall', b: 'bed', x: 10, y: 5, width: 3, dir: 'vertical' }], windows: [] });
const schedule = (patch = {}) => ({ roughWidthFt: 3.125, frameStartFt: 0.0625, frameEndFt: 0.0625,
  leafProjectionFt: 1.75 / 12, leafSide: 'start', basis: 'Explicit test geometry, not a product or code specification', ...patch });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
function partitionCheck(model) {
  close(model.partition.residualSqFt, 0);
  const categories = [model.roomClear.flatMap(room => room.parts), model.wallSolids, model.assemblyReservations, model.passageParts];
  for (let i = 0; i < categories.length; i++) for (let j = i + 1; j < categories.length; j++) {
    close(unionArea(categories[i].flatMap(a => categories[j].map(b => intersection(a, b)).filter(Boolean))), 0);
  }
  close(unionArea(categories.flat()), model.partition.nominalAreaSqFt);
}

test('scheduled door separates rough void, frame/leaf reservations and clear floor passage exactly once', () => {
  const level = fixture(), snapshot = structuredClone(level);
  const model = buildFloorPassageModel(level, [schedule()]);
  assert.equal(model.status, 'scheduled_geometry');
  assert.equal(model.constructionVerified, false);
  assert.equal(model.continuousRoutesChecked, false);
  const door = model.openings[0];
  close(door.clearWidthFt, 3 - 1.75 / 12);
  close(door.clear.y, 5 - 3.125 / 2 + 0.0625 + 1.75 / 12);
  close(model.partition.passageAreaSqFt, door.clearWidthFt * 4.5 / 12);
  close(model.partition.wallSolidAreaSqFt + unionArea(model.roughVoids), buildWallModel(level).partition.wallSolidAreaSqFt);
  partitionCheck(model);
  assert.deepEqual(level, snapshot);
});

test('missing dimensions stay incomplete, never certify nominal sliding/garage/threshold passage', () => {
  for (const patch of [{}, { sliding: true }, { garageDoor: true }, { openThreshold: true }]) {
    const level = fixture(); Object.assign(level.doors[0], patch);
    const model = buildFloorPassageModel(level);
    assert.equal(model.status, 'incomplete');
    assert.equal(model.openingVoidsIncluded, false);
    assert.equal(model.passageParts.length, 0);
    assert.equal(model.incomplete[0].code, 'OPENING_SCHEDULE_REQUIRED');
    partitionCheck(model);
  }
});

test('wide nominal opening loses the supplied frame and open-leaf deductions', () => {
  const level = fixture(); level.doors[0].width = 4;
  const model = buildFloorPassageModel(level, [schedule({ roughWidthFt: 4.125, leafSide: 'end' })]);
  close(model.openings[0].clearWidthFt * 12, 46.25);
  assert.ok(model.openings[0].clearWidthFt < level.doors[0].width);
  close(model.openings[0].clear.y, 5 - 4.125 / 2 + 0.0625);
  partitionCheck(model);
});

test('open threshold only cuts a floor passage when its frame-free schedule is explicit', () => {
  const level = fixture(); level.doors[0].openThreshold = true;
  const model = buildFloorPassageModel(level, [schedule({ roughWidthFt: 3, frameStartFt: 0, frameEndFt: 0, leafProjectionFt: 0, leafSide: 'none' })]);
  assert.equal(model.status, 'scheduled_geometry');
  close(model.partition.assemblyReservationAreaSqFt, 0);
  close(model.partition.passageAreaSqFt, 3 * 4.5 / 12);
  partitionCheck(model);
});

test('exterior passage clips to the nominal envelope and glazing never becomes a floor void', () => {
  const level = fixture();
  level.doors = [{ a: 'hall', b: '__exterior__', x: 0, y: 5, width: 3, dir: 'vertical' }];
  level.windows = [{ roomId: 'bed', x: 20, y: 5, width: 4, dir: 'vertical' }];
  const model = buildFloorPassageModel(level, [schedule()]);
  assert.equal(model.status, 'scheduled_geometry');
  close(model.partition.passageAreaSqFt, (3 - 1.75 / 12) * (7.25 / 24));
  assert.ok(model.passageParts.every(part => part.x >= 0 && part.x < 1));
  partitionCheck(model);
});

test('rough openings cannot cut wall junctions, wrong hosts or each other', () => {
  for (const [edit, schedules, code] of [
    [level => { level.doors[0].y = 2; }, [schedule({ roughWidthFt: 4.5, frameStartFt: 0.8, frameEndFt: 0.8 })], 'ROUGH_OPENING_OUTSIDE_HOST'],
    [level => { level.doors[0].y = 2.25; }, [schedule({ roughWidthFt: 4.5, frameStartFt: 0.8, frameEndFt: 0.8 })], 'ROUGH_OPENING_WALL_CONFLICT'],
    [level => { level.doors[0].b = '__exterior__'; }, [schedule()], 'ROUGH_OPENING_OUTSIDE_HOST'],
    [level => { level.doors = [3, 7].map(y => ({ ...level.doors[0], y, width: 2 })); },
      [schedule({ roughWidthFt: 4.5, frameStartFt: 1.25, frameEndFt: 1.25 }), schedule({ roughWidthFt: 4.5, frameStartFt: 1.25, frameEndFt: 1.25 })], 'ROUGH_OPENINGS_OVERLAP'],
  ]) {
    const level = fixture(); edit(level);
    const model = buildFloorPassageModel(level, schedules);
    assert.equal(model.status, 'invalid');
    assert.ok(model.errors.some(error => error.code === code), JSON.stringify(model.errors));
    partitionCheck(model);
  }
});

test('malformed schedules fail closed and edits recompute instead of reusing old passages', () => {
  for (const patch of [{ roughWidthFt: NaN }, { frameStartFt: -1 }, { frameEndFt: '0.1' },
    { basis: '' }, { leafSide: 'none' }, { leafProjectionFt: 10 }, { roughWidthFt: 2 }]) {
    const model = buildFloorPassageModel(fixture(), [schedule(patch)]);
    assert.equal(model.status, 'invalid');
    assert.equal(model.passageParts.length, 0);
  }
  const level = fixture();
  const a = buildFloorPassageModel(level, [schedule()]);
  level.doors[0].y += 1;
  const b = buildFloorPassageModel(level, [schedule()]);
  close(b.openings[0].clear.y - a.openings[0].clear.y, 1);
  level.rooms[1].x += 1;
  assert.equal(buildFloorPassageModel(level, [schedule()]).status, 'invalid');
  assert.equal(buildFloorPassageModel(fixture(), [schedule(), schedule()]).status, 'invalid');
});

test('horizontal composite-room boundaries use their actual wall rather than the bounding box', () => {
  const level = { level: 1, rooms: [
    { id: 'hall', type: 'hallway', x: 0, y: 0, w: 12, h: 12, parts: [{ x: 0, y: 0, w: 12, h: 4 }, { x: 0, y: 4, w: 4, h: 8 }] },
    { id: 'bed', type: 'bedroom', x: 4, y: 4, w: 8, h: 8 },
  ], doors: [{ a: 'hall', b: 'bed', x: 8, y: 4, dir: 'horizontal', width: 3 }], windows: [] };
  const model = buildFloorPassageModel(level, [schedule()]);
  assert.equal(model.status, 'scheduled_geometry');
  close(model.openings[0].clear.y, 4 - 4.5 / 24);
  partitionCheck(model);
  level.doors[0].y = 12;
  assert.equal(buildFloorPassageModel(level, [schedule()]).status, 'invalid');
});
