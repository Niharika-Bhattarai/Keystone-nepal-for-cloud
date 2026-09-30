'use strict';

const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { createBedroomArchitecturalCheck } = require('../lib/geometry/bedroomArchitecture');
const { buildWallModel } = require('../lib/geometry/wallModel');
const { assignOpeningIds, bindOpeningSchedule } = require('../lib/geometry/openingIdentity');
const { proposeBedroomApproachRepair } = require('../lib/geometry/repairBedroomApproach');
const { proposeBedroomClosetRepair } = require('../lib/geometry/repairBedroomCloset');
const { relocationOptions, verifyBedroomClosetRepair } = require('./helpers/verifyBedroomClosetRepair');
const { bedroomArchitecturePolicy } = require('./helpers/bedroomArchitecturePolicy');
const { validateEditedPlan } = require('../lib/validateEditedPlan');

function fixture(rotation = 0) {
  const level = { level: 1, rooms: [{ id: 'room', type: 'bedroom', x: 0, y: 0, w: 20, h: 20 }], windows: [], doors: [], furniture: [] };
  const half = buildWallModel(level).walls[0].assembly.thicknessFt / 2;
  const bed = { id: 'bed', kind: 'bed_full', roomId: 'room', x: 10, y: half, w: 4.5, h: 6.25, rotation };
  if (rotation === 90) Object.assign(bed, { x: 20 - half - 6.25, y: 10, w: 6.25, h: 4.5 });
  if (rotation === 180) Object.assign(bed, { x: 10, y: 20 - half - 6.25 });
  if (rotation === 270) Object.assign(bed, { x: half, y: 10, w: 6.25, h: 4.5 });
  level.furniture.push(bed);
  const policy = { basis: 'Explicit unit-test dimensions; not project measurements.', headboardMaxGapFt: .25,
    furniture: [{ furnitureId: 'bed', kind: 'bed_full', widthFt: 4.5, lengthFt: 6.25, heightFt: 2, headboardHeightFt: 4, headboardDepthFt: .25 }], windows: [] };
  return { level, policy, bed, half };
}
function window(f, overrides = {}) {
  const w = { roomId: 'room', x: 12, y: 0, dir: 'horizontal', width: 4 };
  f.level.windows.push(w);
  f.policy.windows.push({ binding: structuredClone(w), sillHeightFt: 3, headHeightFt: 7, clearanceDepthFt: .75, ...overrides });
}
function check(f) {
  const compiled = createBedroomArchitecturalCheck(f.level, 'room', 'bed', f.policy);
  assert.equal(compiled.status, 'ready', compiled.reason);
  return compiled.check(f.level.furniture);
}
for (const rotation of [0, 90, 180, 270]) test(`headboard uses the correct finished wall and declared gap at ${rotation} degrees`, () => {
  const f = fixture(rotation), original = structuredClone(f);
  assert.equal(check(f).status, 'clear'); assert.deepEqual(f, original);
  const key = rotation % 180 ? 'x' : 'y', direction = rotation === 0 || rotation === 270 ? 1 : -1;
  f.bed[key] += direction * .25; assert.equal(check(f).status, 'clear');
  f.bed[key] += direction * .01; assert.equal(check(f).status, 'conflict');
  assert.equal(check(f).issues[0].code, 'HEADBOARD_WALL_SUPPORT');
});
for (const rotation of [0, 90, 180, 270]) test(`headboard cannot cover low glazing at ${rotation} degrees`, () => {
  const f = fixture(rotation), horizontal = rotation % 180 === 0;
  const w = { roomId: 'room', width: 4, dir: horizontal ? 'horizontal' : 'vertical',
    x: horizontal ? 12 : rotation === 90 ? 20 : 0,
    y: horizontal ? rotation === 0 ? 0 : 20 : 12 };
  f.level.windows.push(w);
  f.policy.windows.push({ binding: structuredClone(w), sillHeightFt: 3, headHeightFt: 7, clearanceDepthFt: .75 });
  const result = check(f);
  assert.equal(result.status, 'conflict'); assert.equal(result.headboardSupported, false);
  assert.ok(result.issues.some(i => i.component === 'headboard'));
  f.policy.furniture[0].headboardHeightFt = 2.75;
  assert.equal(check(f).status, 'clear');
});

test('glazing behind a tall headboard fails, but glazing above a low headboard does not', () => {
  const f = fixture(); window(f);
  const result = check(f);
  assert.ok(result.issues.some(i => i.code === 'HEADBOARD_WALL_SUPPORT'));
  assert.ok(result.issues.some(i => i.component === 'headboard'));
  assert.ok(!result.issues.some(i => i.component === 'body'));
  f.policy.furniture[0].headboardHeightFt = 2.75;
  assert.equal(check(f).status, 'clear');
});

test('only the headboard strip uses headboard height, not the whole bed footprint', () => {
  const f = fixture(90);
  const w = { roomId: 'room', x: 20, y: 6, dir: 'vertical', width: 4 };
  f.level.windows.push(w); f.policy.windows.push({ binding: w, sillHeightFt: 1, headHeightFt: 7, clearanceDepthFt: .75 });
  assert.equal(check(f).status, 'clear');
  f.bed.y = 7;
  assert.ok(check(f).issues.some(i => i.component === 'body'));
});

test('dresser height and declared window operating depth are checked', () => {
  const f = fixture(); window(f);
  f.level.windows[0].x = 4; f.policy.windows[0].binding.x = 4;
  const dresser = { id: 'dresser', roomId: 'room', kind: 'dresser', x: 3, y: f.half, w: 2, h: 1 };
  f.level.furniture.push(dresser);
  f.policy.furniture.push({ furnitureId: 'dresser', kind: 'dresser', widthFt: 2, lengthFt: 1, heightFt: 3.5 });
  assert.ok(check(f).issues.some(i => i.furnitureId === 'dresser'));
  f.policy.furniture[1].heightFt = 3; assert.equal(check(f).status, 'clear');
  f.policy.furniture[1].heightFt = 3.5; dresser.y = f.half + .75;
  assert.equal(check(f).status, 'clear');
});

test('rough door opening breaks support even outside the nominal door span', () => {
  const f = fixture(); f.bed.x = 5;
  f.level.doors.push({ a: 'room', b: '__exterior__', x: 12, y: 0, width: 3, dir: 'horizontal' });
  assignOpeningIds(f.level);
  f.level = bindOpeningSchedule(f.level, f.level.doors[0].id, { roughWidthFt: 6, frameStartFt: 1.5, frameEndFt: 1.5, leafProjectionFt: 0, leafSide: 'none', basis: 'Test rough assembly' });
  assert.equal(check(f).status, 'conflict'); // Bed ends at 9.5; nominal door starts at 10.5; rough starts at 9.
  delete f.level.openingScheduleBook;
  assert.equal(createBedroomArchitecturalCheck(f.level, 'room', 'bed', f.policy).status, 'not_checked');
});

test('internal composite seams cannot provide headboard support', () => {
  const f = fixture(); f.level.rooms[0].parts = [{ x: 0, y: 0, w: 20, h: 10 }, { x: 0, y: 10, w: 10, h: 10 }];
  Object.assign(f.bed, { x: 2, y: 10 });
  assert.equal(check(f).status, 'conflict');
  Object.assign(f.bed, { x: 10 - f.half - 6.25, y: 12, w: 6.25, h: 4.5, rotation: 90 });
  assert.equal(check(f).status, 'clear');
});

test('missing, stale, duplicated and malformed dimensions never certify a layout', () => {
  for (const mutate of [f => { f.policy.basis = ''; }, f => { f.policy.furniture = []; },
    f => { f.policy.furniture[0].heightFt = NaN; }, f => { f.policy.furniture[0].widthFt = 100; },
    f => { f.policy.furniture[0].headboardDepthFt = 10; }, f => { f.policy.headboardMaxGapFt = 5; },
    f => { window(f); f.level.windows[0].x += 1; }, f => { window(f); f.policy.windows[0].clearanceDepthFt = 0; },
    f => { window(f); f.policy.windows.push(structuredClone(f.policy.windows[0])); },
    f => { window(f); f.policy.windows[0].headHeightFt = 2; },
    f => { window(f); delete f.level.windows[0].roomId; }]) {
    const f = fixture(); mutate(f);
    assert.equal(createBedroomArchitecturalCheck(f.level, 'room', 'bed', f.policy).status, 'not_checked');
  }
  const f = fixture(), compiled = createBedroomArchitecturalCheck(f.level, 'room', 'bed', f.policy);
  f.bed.w += 1; assert.equal(compiled.check(f.level.furniture).status, 'not_checked');
});

const saved = name => {
  const input = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/bedroom-approach-repair', name + '-input.json')));
  input.options = { ...relocationOptions(input), architecturePolicy: bedroomArchitecturePolicy(input), allowQuarterTurns: true,
    nightstandPlacement: 'head_sides', maxCandidates: 4000, maxRouteChecks: 64 };
  return input;
};
test('repair entry points reject missing measurements and stale window policies without returning a plan', () => {
  const input = saved('matrix-North-standard-1-option-4-level-2');
  for (const policy of [null, {}, { ...input.options.architecturePolicy, furniture: [] },
    { ...input.options.architecturePolicy, windows: [] }]) {
    for (const repair of [proposeBedroomApproachRepair, proposeBedroomClosetRepair]) {
      const result = repair(input.plan, input.survey, { ...input.options, architecturePolicy: policy });
      assert.equal(result.status, 'not_checked'); assert.equal(result.proposedPlan, undefined);
    }
  }
});
for (const name of ['East-standard-1-option-2', 'East-wide-1-option-2', 'North-standard-1-option-4', 'West-standard-1-option-2', 'West-standard-1-option-3', 'West-standard-1-option-4', 'West-wide-1-option-2']) {
  test(`saved case retains explicit architectural policy: ${name}`, () => {
    const i = saved(`matrix-${name}-level-2`), snapshot = structuredClone(i);
    let result = proposeBedroomApproachRepair(i.plan, i.survey, i.options);
    if (result.status !== 'repaired') result = proposeBedroomClosetRepair(i.plan, i.survey, i.options);
    assert.deepEqual(i, snapshot);
    if (['West-standard-1-option-3', 'West-standard-1-option-4'].includes(name)) {
      assert.equal(result.status, 'search_limit'); assert.equal(result.proposedPlan, undefined); return;
    }
    assert.equal(result.status, 'repaired'); assert.equal(result.architecturalValidation.status, 'clear');
    assert.deepEqual(validateEditedPlan(result.proposedPlan, i.survey), []);
    if (result.strategy === 'coordinated_bedroom_closet') verifyBedroomClosetRepair(i, result);
    const level = result.proposedPlan.levels[1], bed = level.furniture.find(f => f.id === i.options.request.bedId);
    const compiled = createBedroomArchitecturalCheck(level, bed.roomId, bed.id, i.options.architecturePolicy);
    assert.equal(compiled.status, 'ready'); assert.equal(compiled.check(level.furniture.filter(f => f.roomId === bed.roomId)).status, 'clear');
  });
}
