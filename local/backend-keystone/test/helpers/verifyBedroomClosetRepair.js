'use strict';

const assert = require('node:assert/strict');
const { validateEditedPlan } = require('../../lib/validateEditedPlan');
const { closetLayout } = require('../../lib/closetGeometry');
const { partListOf } = require('../../lib/planGeometry');
const { buildFloorPassageModel } = require('../../lib/geometry/floorPassageModel');
const { checkBedroomApproach } = require('../../lib/geometry/bedroomApproach');
const { resolveOpeningSchedules } = require('../../lib/geometry/openingIdentity');
const { containsRect, subtract, unionArea, intersection } = require('../../lib/geometry/rectBoolean');
const { bedClearanceEnvelope, doorClearances, intersects } = require('../../lib/furnitureGeometry');

// Independent reconstruction of the permitted edit surface and swept routes.
// Used by both the regression test and the reproducible audit command.
function verifyBedroomClosetRepair(input, result) {
  assert.equal(result.status, 'repaired');
  const { plan, survey, options } = input, proposed = result.proposedPlan;
  const level = proposed.levels.find(l => l.level === options.levelNumber);
  const oldLevel = plan.levels.find(l => l.level === options.levelNumber);
  const oldRoom = oldLevel.rooms.find(r => r.id === result.bedroomId), room = level.rooms.find(r => r.id === oldRoom.id);
  const oldCloset = oldLevel.rooms.find(r => r.id === result.closetId), closet = level.rooms.find(r => r.id === oldCloset.id);
  const pair = new Set([room.id, closet.id]);
  assert.deepEqual(validateEditedPlan(proposed, survey), []);
  assert.deepEqual(resolveOpeningSchedules(level).errors, []);
  const model = buildFloorPassageModel(level), oldModel = buildFloorPassageModel(oldLevel);
  assert.deepEqual(model.errors, []);
  assert.ok(Math.abs(model.partition.residualSqFt) < 1e-7);
  assert.ok(Math.abs(model.partition.nominalAreaSqFt - oldModel.partition.nominalAreaSqFt) < 1e-7);
  for (const unchanged of model.roomClear.filter(r => !pair.has(r.roomId))) {
    const original = oldModel.roomClear.find(r => r.roomId === unchanged.roomId);
    assert.ok(unionArea(subtract(unchanged.parts, original.parts)) < 1e-7);
    assert.ok(unionArea(subtract(original.parts, unchanged.parts)) < 1e-7);
  }
  const a = [...partListOf(oldRoom), ...partListOf(oldCloset)], b = [...partListOf(room), ...partListOf(closet)];
  assert.ok(unionArea(subtract(a, b)) < 1e-7 && unionArea(subtract(b, a)) < 1e-7);
  assert.ok(Math.abs(unionArea(partListOf(room)) - unionArea(partListOf(oldRoom))) < 1e-7);
  assert.ok(!partListOf(room).some(p => intersection(p, closet)));
  const oldLayout = closetLayout(oldCloset), layout = closetLayout(closet);
  for (const key of ['along', 'depth', 'aisleDepth']) assert.equal(layout[key], oldLayout[key]);
  const size = r => [r.w, r.h].sort((x, y) => x - y);
  assert.deepEqual(size(result.physicalClosetAccess), size(layout.access));
  const bedroomClear = model.roomClear.find(r => r.roomId === room.id).parts;
  const closetClear = model.roomClear.find(r => r.roomId === closet.id).parts;
  assert.ok(containsRect(closetClear, layout.storage));
  assert.ok(containsRect(closet.closetType === 'walk_in' ? closetClear : bedroomClear, result.physicalClosetAccess));
  const furniture = level.furniture.filter(f => pair.has(f.roomId));
  for (const f of furniture) {
    assert.ok(containsRect(f.roomId === room.id ? bedroomClear : closetClear, f));
    if (f.roomId === room.id) assert.ok(!doorClearances(room, level).some(z => intersects(f, z)));
    if (f.roomId === (closet.closetType === 'walk_in' ? closet.id : room.id)) assert.ok(!intersects(f, result.physicalClosetAccess));
    assert.deepEqual(size(f), size(oldLevel.furniture.find(before => before.id === f.id)));
  }
  assert.ok(containsRect(bedroomClear, bedClearanceEnvelope(furniture.find(f => f.id === options.request.bedId), room)));
  // Only the pair's geometry, its door binding and furniture coordinates may
  // change. This catches edits to windows, stairs, other doors, IDs, contracts,
  // inventory, metadata, levels and unrelated furniture anywhere in the plan.
  const expected = structuredClone(plan), target = expected.levels.find(l => l.level === level.level);
  for (const updated of [room, closet]) {
    const original = target.rooms.find(r => r.id === updated.id);
    for (const key of ['x', 'y', 'w', 'h', 'x2', 'y2', 'parts', 'closetFront']) {
      if (Object.hasOwn(updated, key)) original[key] = structuredClone(updated[key]);
    }
  }
  const oldDoor = target.doors.find(d => d.id === result.openingId), newDoor = level.doors.find(d => d.id === oldDoor.id);
  for (const key of ['x', 'y', 'dir']) oldDoor[key] = newDoor[key];
  for (const updated of furniture) {
    const original = target.furniture.find(f => f.id === updated.id);
    for (const key of ['x', 'y', 'w', 'h', 'rotation']) if (Object.hasOwn(updated, key)) original[key] = updated[key];
  }
  const otherRecords = target.openingScheduleBook.records.filter(r => r.openingId !== oldDoor.id);
  assert.deepEqual(level.openingScheduleBook.records.filter(r => r.openingId !== oldDoor.id), otherRecords);
  const record = level.openingScheduleBook.records.find(r => r.openingId === oldDoor.id);
  assert.deepEqual(record.dimensions, options.replacementClosetSchedule.dimensions);
  target.openingScheduleBook.records = [...otherRecords, structuredClone(record)];
  if (expected.furniture) expected.furniture.find(f => f.level === level.level).items = structuredClone(target.furniture);
  assert.deepEqual(proposed, expected);
  const after = checkBedroomApproach(level, options.request);
  assert.equal(after.status, 'clear'); assert.deepEqual(after, result.after);
  assert.equal(after.sidePolicy, options.request.sidePolicy); assert.equal(after.clearWidthFt, options.request.clearWidthFt);
  const allowed = new Set(after.allowedRoomIds);
  const free = subtract([
    ...model.roomClear.filter(r => allowed.has(r.roomId)).flatMap(r => r.parts),
    ...model.openings.filter(o => o.rooms.every(id => allowed.has(id))).map(o => o.clear),
  ], level.furniture.filter(f => allowed.has(f.roomId)));
  for (const side of after.sides.filter(s => s.status === 'clear')) for (let i = 1; i < side.path.length; i++) {
    const a = side.path[i - 1], b = side.path[i], radius = options.request.clearWidthFt / 2;
    assert.ok(a.x === b.x || a.y === b.y);
    assert.ok(containsRect(free, { x: Math.min(a.x, b.x) - radius, y: Math.min(a.y, b.y) - radius,
      w: Math.abs(a.x - b.x) + radius * 2, h: Math.abs(a.y - b.y) + radius * 2 }));
  }
  assert.equal(result.constructionVerified, false); assert.equal(result.doorSwingVerified, false);
  assert.equal(result.requiresDerivedModelRebuild, true);
}

function relocationOptions(input) {
  const level = input.plan.levels.find(l => l.level === input.options.levelNumber);
  const bed = level.furniture.find(f => f.id === input.options.request.bedId);
  const closet = level.rooms.find(r => r.ownerBedroomId === bed.roomId);
  const door = level.doors.find(d => d.a === closet.id || d.b === closet.id);
  return { ...input.options, replacementClosetSchedule: { openingId: door.id, reviewedForRelocation: true,
    dimensions: { roughWidthFt: door.width, frameStartFt: 0.0625, frameEndFt: 0.0625,
      leafProjectionFt: 0.125, leafSide: 'start',
      basis: 'Diagnostic relocation study only; explicit assumed dimensions, not a project hardware specification.' } } };
}

module.exports = { verifyBedroomClosetRepair, relocationOptions };
