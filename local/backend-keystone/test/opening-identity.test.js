'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assignOpeningIds, bindOpeningSchedule, resolveOpeningSchedules } = require('../lib/geometry/openingIdentity');
const { buildFloorPassageModel } = require('../lib/geometry/floorPassageModel');
const { validateEditedPlan } = require('../lib/validateEditedPlan');
const { stripPlanSpecForValidation } = require('../lib/residential/v2/candidateGeneration');
const { validatePlanSpecSchema } = require('../lib/validateSchema');

const fixture = () => assignOpeningIds({ level: 1, width: 20, height: 10, rooms: [
  { id: 'hall', type: 'hallway', x: 0, y: 0, w: 10, h: 10 },
  { id: 'bed', type: 'bedroom', x: 10, y: 0, w: 10, h: 10 },
], doors: [{ a: 'hall', b: 'bed', x: 10, y: 5, width: 3, dir: 'vertical' }], windows: [] });
const dimensions = () => ({ roughWidthFt: 3.125, frameStartFt: 0.0625, frameEndFt: 0.0625,
  leafProjectionFt: 0.125, leafSide: 'start', basis: 'Test-only dimensions; not a product schedule' });
const scheduled = () => { const level = fixture(); return bindOpeningSchedule(level, level.doors[0].id, dimensions()); };

test('opening identities survive reordering, movement and width edits, and distinguish floors and kinds', () => {
  const level = fixture();
  level.doors.push({ a: 'hall', b: '__exterior__', x: 0, y: 5, width: 3, dir: 'vertical' });
  assignOpeningIds(level);
  const ids = Object.fromEntries(level.doors.map(door => [door.b, door.id]));
  level.doors.reverse();
  level.doors.forEach(door => { door.width = 4; door.y = 6; });
  assignOpeningIds(level);
  assert.deepEqual(Object.fromEntries(level.doors.map(door => [door.b, door.id])), ids);
  const copy = structuredClone(level); copy.level = 2; assignOpeningIds(copy);
  assert.ok(copy.doors.every((door, i) => door.id !== level.doors[i].id));
  copy.level = 1; copy.doors[0].slidingDoor = true; assignOpeningIds(copy);
  assert.notEqual(copy.doors[0].id, level.doors[0].id);
});

test('binding is immutable and JSON restore uses identities, not array positions', () => {
  const level = fixture(), snapshot = structuredClone(level);
  const bound = bindOpeningSchedule(level, level.doors[0].id, dimensions());
  assert.deepEqual(level, snapshot);
  bound.doors.unshift({ a: 'hall', b: '__exterior__', x: 0, y: 5, width: 3, dir: 'vertical' });
  assignOpeningIds(bound);
  const restored = JSON.parse(JSON.stringify(bound));
  const resolved = resolveOpeningSchedules(restored);
  assert.deepEqual(resolved.errors, []);
  assert.equal(resolved.schedules[0], null);
  assert.deepEqual(resolved.schedules[1], dimensions());
  const model = buildFloorPassageModel(restored);
  assert.equal(model.status, 'incomplete');
  assert.equal(model.openings[1].status, 'scheduled_geometry');
  assert.equal(model.openings[0].status, 'incomplete');
});

test('moved, resized, rotated, removed, rehosted or retyped openings invalidate saved dimensions', () => {
  for (const edit of [
    l => { l.doors[0].y += 1; }, l => { l.doors[0].width = 4; },
    l => { l.doors[0].dir = 'horizontal'; }, l => { l.doors = []; },
    l => { l.doors[0].b = '__exterior__'; }, l => { l.doors[0].openThreshold = true; },
    l => { l.level = 2; }, l => { delete l.doors[0].id; },
  ]) {
    const level = scheduled(); edit(level);
    const result = resolveOpeningSchedules(level);
    assert.ok(result.errors.some(error => error.code === 'OPENING_SCHEDULE_STALE'));
    assert.ok(result.schedules.every(schedule => schedule === null));
    assert.equal(buildFloorPassageModel(level).passageParts.length, 0);
  }
});

test('multiple openings between the same rooms are explicitly ambiguous for binding', () => {
  const level = fixture(); level.doors.push({ ...level.doors[0], y: 8 }); assignOpeningIds(level);
  assert.equal(new Set(level.doors.map(d => d.id)).size, 2);
  assert.throws(() => bindOpeningSchedule(level, level.doors[0].id, dimensions()), /Multiple openings/);
  const bound = scheduled(); bound.doors.push({ ...bound.doors[0], y: 8 }); assignOpeningIds(bound);
  assert.match(resolveOpeningSchedules(bound).errors[0].message, /ambiguous/);
});

test('unknown versions, null books, duplicate records and missing dimensions fail closed', () => {
  for (const edit of [
    l => { l.openingScheduleBook = null; }, l => { l.openingScheduleBook.version = 2; },
    l => { l.openingScheduleBook.records = {}; }, l => { l.openingScheduleBook.records.push(l.openingScheduleBook.records[0]); },
    l => { l.openingScheduleBook.records[0].dimensions = null; }, l => { l.openingScheduleBook.records[0] = null; },
  ]) {
    const level = scheduled(); edit(level);
    assert.ok(resolveOpeningSchedules(level).errors.length);
    const model = buildFloorPassageModel(level);
    assert.equal(model.status, 'invalid'); assert.equal(model.passageParts.length, 0);
  }
});

test('schema validation retains the schedule book and rejects malformed dimensions', () => {
  const level = scheduled(); level.rooms.forEach(room => { room.level = 1; });
  const plan = { stories: 1, totalAreaSqFt: 200, levels: [level] };
  let stripped = stripPlanSpecForValidation(plan);
  assert.deepEqual(stripped.levels[0].openingScheduleBook, level.openingScheduleBook);
  assert.equal(stripped.levels[0].doors[0].id, level.doors[0].id);
  assert.equal(validatePlanSpecSchema(stripped).valid, true);
  level.openingScheduleBook.records[0].dimensions.frameStartFt = -1;
  stripped = stripPlanSpecForValidation(plan);
  assert.equal(validatePlanSpecSchema(stripped).valid, false);
});

test('schema stripping preserves the opening kind needed to resolve schedule identity', () => {
  for (const flag of ['openThreshold', 'sliding', 'slidingDoor', 'cased', 'garageDoor']) {
    let level = fixture(); level.doors[0][flag] = true; assignOpeningIds(level);
    level = bindOpeningSchedule(level, level.doors[0].id, dimensions());
    const stripped = stripPlanSpecForValidation({ stories: 1, totalAreaSqFt: 200, levels: [level] });
    assert.deepEqual(resolveOpeningSchedules(stripped.levels[0]).errors, []);
  }
});

test('production generation assigns closet IDs and unchanged regeneration preserves a bound schedule', () => {
  const { base } = require('../scripts/benchmark/generation-coverage');
  const { normalizeBrief } = require('../lib/tile/normalizeBrief');
  const { resolveArchitectV2Support } = require('../lib/residential/v2/supportMatrix');
  const { interpretBriefV2 } = require('../lib/residential/v2/interpretBriefV2');
  const { buildCandidateFootprintsV2 } = require('../lib/residential/v2/candidateFootprintsV2');
  const { tryGenerateArchitectV2Candidate } = require('../lib/residential/v2/candidateGeneration');
  const { placeOpenings } = require('../lib/placeOpenings');
  const { placeBedroomClosets } = require('../lib/placeBedroomClosets');
  const survey = { ...base, totalArea: '3200', features: '1 Gaming Room, 1 Playroom' };
  const brief = normalizeBrief(survey), interpretation = interpretBriefV2(brief, resolveArchitectV2Support(brief));
  const candidate = buildCandidateFootprintsV2(brief, interpretation).map(fp =>
    tryGenerateArchitectV2Candidate(brief, interpretation, fp, survey)).find(c => c.ok);
  assert.ok(candidate);
  const plan = candidate.result.planSpec;
  assert.deepEqual(validateEditedPlan(plan, survey), []);
  for (const level of plan.levels) {
    assert.ok(level.doors.every(door => typeof door.id === 'string'));
    assert.equal(new Set(level.doors.map(d => d.id)).size, level.doors.length);
    const expected = assignOpeningIds(structuredClone(level));
    assert.deepEqual(level.doors.map(d => d.id), expected.doors.map(d => d.id));
  }
  const level = plan.levels[0];
  const door = level.doors.find(d => !d.garageDoor && !d.openThreshold && !d.sliding && !d.slidingDoor && !d.cased);
  plan.levels[0] = bindOpeningSchedule(level, door.id, { ...dimensions(), roughWidthFt: door.width + 0.125 });
  assert.deepEqual(validateEditedPlan(plan, survey), []);
  const ids = plan.levels.map(l => l.doors.map(d => d.id).sort());
  placeOpenings(plan, survey);
  placeBedroomClosets(plan, brief);
  assert.deepEqual(plan.levels.map(l => l.doors.map(d => d.id).sort()), ids);
  assert.deepEqual(resolveOpeningSchedules(plan.levels[0]).errors, []);
  // Refinement clears opening arrays before regeneration. A stale schedule must
  // remain visible, never disappear when a connection moves or is removed.
  const rebuilt = structuredClone(plan);
  for (const floor of rebuilt.levels) { floor.doors = []; floor.windows = []; }
  placeOpenings(rebuilt, survey);
  assert.deepEqual(rebuilt.levels[0].openingScheduleBook, plan.levels[0].openingScheduleBook);
  const replacement = rebuilt.levels[0].doors.find(d => d.id === door.id);
  if (replacement) replacement.width -= 0.25;
  assert.ok(validateEditedPlan(rebuilt, survey).some(e => e.includes('OPENING_SCHEDULE_STALE')));
  const restored = JSON.parse(JSON.stringify(plan));
  assert.deepEqual(validateEditedPlan(restored, survey), []);
  restored.levels[0].doors.find(d => d.id === door.id).width -= 0.25;
  assert.ok(validateEditedPlan(restored, survey).some(e => e.includes('OPENING_SCHEDULE_STALE')));
});
