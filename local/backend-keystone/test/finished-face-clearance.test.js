'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { base } = require('../scripts/benchmark/generation-coverage');
const { invoke } = require('../scripts/benchmark/survey-delivery-audit');
const { buildWallModel, buildWallModelForPlan } = require('../lib/geometry/wallModel');
const { WALL_ASSEMBLIES, inches, toInches } = require('../lib/geometry/units');

const room = (id, type, x, y, w, h) => ({ id, type, x, y, w, h });

/* Item 1 of P04. Two rooms either side of a partition each report that
   boundary. If the model records one wall per report it counts the assembly
   twice, and every clear-width figure derived from it is wrong. */
test('one shared boundary becomes one wall, not one per room', () => {
  const level = {
    level: 1,
    rooms: [
      room('a', 'bedroom', 0, 0, 10, 10),
      room('b', 'bedroom', 10, 0, 10, 10),
    ],
  };
  const model = buildWallModel(level);
  const shared = model.walls.filter((wall) => !wall.exterior);
  assert.equal(shared.length, 1, 'the partition between the two rooms is one wall');
  assert.deepEqual(shared[0].roomIds.sort(), ['a', 'b'], 'both rooms are recorded on it');
  assert.equal(shared[0].orientation, 'vertical');
  assert.equal(shared[0].axisFt, 10);
  assert.equal(shared[0].lengthFt, 10);
});

/* Item 2. The assembly is a property of the boundary, and the heavier
   requirement wins.

   This test originally asserted that a bathroom backing onto a bedroom took a
   plumbing wall. That was wrong, and it cost real coverage: making every
   boundary of a wet room 6.5 in took half an inch a side off every bathroom in
   the plan, and two briefs lost their toilet clearance because of it. A thick
   wet wall carries the drain and vent stack, which is the wall shared by
   back-to-back fixtures - not every wall a bathroom happens to touch. The
   expectation is corrected here rather than removed; the ranking it was
   written to check is still checked, by the garage case below and by the
   back-to-back case further down. */
test('a boundary takes the thicker of the two assemblies it must satisfy', () => {
  const model = buildWallModel({
    level: 1,
    rooms: [
      room('bed', 'bedroom', 0, 0, 10, 10),
      room('bath', 'bathroom', 10, 0, 8, 10),
    ],
  });
  const shared = model.walls.find((wall) => !wall.exterior);
  assert.equal(shared.assembly.id, 'interior',
    'one wet room on one side is an ordinary partition, not a wet wall');
  assert.ok(
    WALL_ASSEMBLIES.plumbing.thicknessFt > WALL_ASSEMBLIES.interior.thicknessFt,
    'a plumbing wall is still the thicker assembly where one is warranted',
  );
});

test('a garage boundary takes the rated separation assembly', () => {
  const model = buildWallModel({
    level: 1,
    rooms: [
      room('garage', 'garage', 0, 0, 20, 20),
      room('mud', 'mudroom', 20, 0, 8, 20),
    ],
  });
  const shared = model.walls.find((wall) => !wall.exterior);
  assert.equal(shared.assembly.id, 'garage');
});

/* Item 2, the part that matters to a person. A nominal dimension is measured
   between lines with no thickness; the clear dimension is what is left after
   the walls are reserved, and it is always smaller. */
test('clear space is smaller than the nominal rectangle it came from', () => {
  const model = buildWallModel({
    level: 1,
    rooms: [
      room('hall', 'hallway', 0, 0, 4, 20),
      room('bed', 'bedroom', 4, 0, 12, 20),
    ],
  });
  const hall = model.roomClear.find((entry) => entry.roomId === 'hall');
  const clearWidthFt = hall.parts[0].w;
  assert.ok(clearWidthFt < 4, 'a 4 ft nominal hall cannot be 4 ft clear');
  // Exterior on one side, partition on the other.
  const expected = 4 - WALL_ASSEMBLIES.exterior.thicknessFt / 2 - WALL_ASSEMBLIES.interior.thicknessFt / 2;
  assert.ok(Math.abs(clearWidthFt - expected) < 0.01, `expected about ${expected.toFixed(3)} ft clear, got ${clearWidthFt}`);
  assert.ok(
    toInches(clearWidthFt) < 44,
    'the clear aperture of a 48 in nominal run is materially less than 48 in',
  );
});

/* Item 6. A room whose nominal size cannot survive its own walls is a
   candidate failure that must be reported, not a room that quietly renders. */
test('a room whose clear space collapses is reported rather than hidden', () => {
  const model = buildWallModel({
    level: 1,
    rooms: [
      room('sliver', 'closet', 0, 0, inches(5), 10),
      room('next', 'bedroom', inches(5), 0, 12, 10),
    ],
  });
  const collapsed = model.errors.filter((error) => error.code === 'ROOM_CLEAR_SPACE_COLLAPSED');
  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0].roomId, 'sliver');
  assert.match(collapsed[0].message, /clear/);
});

/* Exact union/subtraction accounts for wall junctions once. This equation
   covers the nominal room union, not unassigned space in an external envelope. */
test('clear space plus wall solids account for the floor, within a stated tolerance', async () => {
  const previous = process.env.V2_DISABLE_LEGACY_FALLBACK;
  process.env.V2_DISABLE_LEGACY_FALLBACK = 'true';
  try {
    const { status, body } = await invoke({ ...base });
    assert.equal(status, 200);
    const models = buildWallModelForPlan(body.planSpec);
    assert.ok(models.length >= 1);
    for (const model of models) {
      const { nominalAreaSqFt, roomClearAreaSqFt, wallSolidAreaSqFt, residualSqFt } = model.partition;
      assert.ok(nominalAreaSqFt > 0, 'a level must have nominal area');
      assert.ok(roomClearAreaSqFt > 0 && roomClearAreaSqFt < nominalAreaSqFt,
        'clear area must be positive and smaller than nominal');
      assert.ok(wallSolidAreaSqFt > 0, 'walls must consume area');
      assert.ok(
        Math.abs(residualSqFt) <= 1e-7,
        `level ${model.level}: wall partition residual ${residualSqFt} sq ft`,
      );
    }
  } finally {
    if (previous === undefined) delete process.env.V2_DISABLE_LEGACY_FALLBACK;
    else process.env.V2_DISABLE_LEGACY_FALLBACK = previous;
  }
});

/* The model must describe the storey that exists. A partial upper floor has a
   smaller perimeter than the floor below it, and deriving the envelope from
   the level rectangle would invent exterior walls where there is open air. */
test('a partial upper floor reports its own perimeter, not the floor below', async () => {
  const previous = process.env.V2_DISABLE_LEGACY_FALLBACK;
  process.env.V2_DISABLE_LEGACY_FALLBACK = 'true';
  try {
    const { status, body } = await invoke({
      ...base,
      totalArea: '1800',
      stories: '2 Stories',
      bedrooms: '2 Bed',
      bathrooms: '3 Bath',
      privateBaths: '1',
      garage: '2 Car Garage',
      masterLocation: 'Level 2 (Upper)',
    });
    assert.equal(status, 200);
    const [lower, upper] = buildWallModelForPlan(body.planSpec);
    const perimeter = (model) => model.walls
      .filter((wall) => wall.exterior)
      .reduce((sum, wall) => sum + wall.lengthFt, 0);
    assert.ok(
      perimeter(upper) < perimeter(lower),
      `the upper storey encloses less, so its exterior run must be shorter: ${perimeter(upper)} vs ${perimeter(lower)}`,
    );
    assert.ok(
      upper.partition.roomClearAreaSqFt < lower.partition.roomClearAreaSqFt,
      'the upper storey must hold less clear space than the floor below it',
    );
  } finally {
    if (previous === undefined) delete process.env.V2_DISABLE_LEGACY_FALLBACK;
    else process.env.V2_DISABLE_LEGACY_FALLBACK = previous;
  }
});

/* ── Clear apertures (P04 item 2, second half) ─────────────────────────── */

const {
  deriveOpeningClearance,
  deriveLevelClearances,
  findNarrowPassages,
  CLEAR_WIDTH_REFERENCES,
} = require('../lib/geometry/clearanceGeometry');

/* The three numbers hiding inside one nominal width. A check that reads the
   nominal figure is not a check of anything a person passes through. */
test('a nominal door frames larger and passes smaller than its label', () => {
  const wall = { id: 'w', assembly: WALL_ASSEMBLIES.interior };
  const derived = deriveOpeningClearance({ width: 3, dir: 'vertical' }, wall, 'door');

  assert.equal(derived.nominalWidthIn, 36);
  assert.ok(derived.roughOpeningWidthFt > derived.nominalWidthFt,
    'the framed opening must be larger than nominal');
  assert.ok(derived.clearWidthFt < derived.nominalWidthFt,
    'the passage must be smaller than nominal');
  assert.ok(derived.clearWidthIn > 33 && derived.clearWidthIn < 35,
    `a 36 in door passes about 34 in, got ${derived.clearWidthIn}`);
  assert.equal(derived.revealDepthFt, derived.wallThicknessFt,
    'the reveal is as deep as the wall it sits in');
});

test('a cased opening keeps more of its width than a door does', () => {
  const wall = { id: 'w', assembly: WALL_ASSEMBLIES.interior };
  const door = deriveOpeningClearance({ width: 4, dir: 'vertical' }, wall, 'door');
  const cased = deriveOpeningClearance({ width: 4, cased: true, dir: 'vertical' }, wall, 'door');
  assert.ok(cased.clearWidthFt > door.clearWidthFt,
    'no leaf means no stop and no door standing in the opening');
});

test('a genuinely narrow passage is reported against a stated minimum', () => {
  const wall = { id: 'w', assembly: WALL_ASSEMBLIES.interior };
  const clearances = {
    level: 1,
    doors: [{ ...deriveOpeningClearance({ width: 2, a: 'hall', b: 'closet' }, wall, 'door'), rooms: ['hall', 'closet'] }],
    windows: [],
  };
  const findings = findNarrowPassages(clearances, CLEAR_WIDTH_REFERENCES.accessiblePassageFt);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, 'OPENING_CLEAR_WIDTH_BELOW_MINIMUM');
  assert.ok(findings[0].clearWidthIn < findings[0].requiredWidthIn);
  assert.ok(findings[0].nominalWidthIn > findings[0].clearWidthIn,
    'the finding must show that nominal flattered the real aperture');
});

test('every opening in a delivered plan sits in a known wall', async () => {
  const previous = process.env.V2_DISABLE_LEGACY_FALLBACK;
  process.env.V2_DISABLE_LEGACY_FALLBACK = 'true';
  try {
    const { status, body } = await invoke({ ...base });
    assert.equal(status, 200);
    for (const level of body.planSpec.levels) {
      const clearances = deriveLevelClearances(level, buildWallModel(level));
      assert.equal(clearances.unhostedCount, 0,
        `level ${level.level}: an opening with no host wall has no assembly, so its reveal is unknown`);
      for (const door of clearances.doors) {
        assert.ok(door.hostAssemblyId, 'each door must resolve an assembly');
        if (door.kind === 'open_threshold') assert.equal(door.clearWidthFt, door.nominalWidthFt);
        else if (['garage_door', 'sliding_door'].includes(door.kind)) assert.equal(door.clearWidthFt, null);
        else assert.ok(door.clearWidthFt < door.nominalWidthFt);
      }
    }
  } finally {
    if (previous === undefined) delete process.env.V2_DISABLE_LEGACY_FALLBACK;
    else process.env.V2_DISABLE_LEGACY_FALLBACK = previous;
  }
});

/* The survey's wide-doorway option has been checked against nominal leaf width
   until now. This is the first assertion that it buys real clear passage. */
test('choosing wide doorways buys measurably more clear passage', async () => {
  const previous = process.env.V2_DISABLE_LEGACY_FALLBACK;
  process.env.V2_DISABLE_LEGACY_FALLBACK = 'true';
  try {
    const narrowest = async (survey) => {
      const { status, body } = await invoke(survey);
      assert.equal(status, 200);
      let min = Infinity;
      for (const level of body.planSpec.levels) {
        const clearances = deriveLevelClearances(level, buildWallModel(level));
        for (const door of clearances.doors) {
          if (door.kind === 'garage_door') continue;
          min = Math.min(min, door.clearWidthIn);
        }
      }
      return min;
    };

    const standard = await narrowest({ ...base });
    const wide = await narrowest({ ...base, accessibilityNeeds: 'Wide doorways' });

    assert.ok(standard >= 32, `standard doors should still pass 32 in clear, got ${standard}`);
    assert.ok(wide > standard + 6,
      `wide doorways must buy real clear width, not a label: ${wide} in vs ${standard} in`);
  } finally {
    if (previous === undefined) delete process.env.V2_DISABLE_LEGACY_FALLBACK;
    else process.env.V2_DISABLE_LEGACY_FALLBACK = previous;
  }
});

/* ── Stairs and furniture measured against finished space (P04 items 3, 4) ── */

const { deriveStairClearance, findNarrowStairs, STAIR_RESERVATIONS } = require('../lib/geometry/clearanceGeometry');
const { fitsRoom } = require('../lib/furnitureGeometry');

/* Item 3. A stair core is allocated as a rectangle, and its width has been
   checked against that rectangle - a distance between lines with no thickness.
   The walls either side and the handrail both take from it before anyone
   climbs. */
test('a stair is measured between finished faces, past the handrail', () => {
  const level = {
    level: 1,
    rooms: [
      room('stairs', 'stairs', 0, 0, 4, 12),
      room('hall', 'hallway', 4, 0, 6, 12),
    ],
  };
  const model = buildWallModel(level);
  const clearance = deriveStairClearance(level.rooms[0], model, 1, { valid: true, flights: [
    { rect: { x:0, y:1, w:4, h:10 }, from: { x:2, y:1 }, to: { x:2, y:11 } },
  ] });

  assert.equal(clearance.nominalWidthIn, 48);
  assert.ok(clearance.clearAboveHandrailIn < clearance.nominalWidthIn,
    'the walls take width before anyone climbs');
  assert.ok(clearance.clearBelowHandrailIn < clearance.clearAboveHandrailIn,
    'the handrail takes more of it at rail height');
  assert.equal(
    Math.round((clearance.clearAboveHandrailFt - clearance.clearBelowHandrailFt) * 1000) / 1000,
    Math.round(STAIR_RESERVATIONS.handrailProjectionFt * 1000) / 1000,
  );
});

test('a stair that only clears 36 inches nominally is reported', () => {
  const level = {
    level: 1,
    rooms: [
      room('stairs', 'stairs', 0, 0, 3, 12),
      room('hall', 'hallway', 3, 0, 6, 12),
    ],
  };
  const clearance = deriveStairClearance(level.rooms[0], buildWallModel(level), 1, { valid: true, flights: [
    { rect: { x:0, y:1, w:3, h:10 }, from: { x:1.5, y:1 }, to: { x:1.5, y:11 } },
  ] });
  assert.equal(clearance.nominalWidthIn, 36, 'it claims the 36 in minimum');
  assert.ok(clearance.clearAboveHandrailIn < 36, 'but does not deliver it between finished faces');
  const findings = findNarrowStairs(clearance);
  assert.ok(findings.length >= 1);
  assert.ok(findings.some(finding => finding.code === 'STAIR_CLEAR_WIDTH_BELOW_MINIMUM'));
});

/* Item 4. Furniture used to be fitted inside the nominal rectangle inset by a
   flat 0.25 ft. That figure is wrong in both directions: a 2x4 partition takes
   less, a 2x6 exterior wall takes more. */
test('furniture is fitted against the finished clear polygon', () => {
  const level = {
    level: 1,
    rooms: [
      room('bath', 'bathroom', 0, 0, 6, 8),
      room('bed', 'bedroom', 6, 0, 12, 8),
    ],
  };
  const model = buildWallModel(level);
  const clear = model.roomClear.find((r) => r.roomId === 'bath');
  const clearParts = clear.parts;

  // An item filling the nominal rectangle cannot fit the finished one.
  const oversized = { x: 0.1, y: 0.1, w: 5.8, h: 7.8 };
  assert.equal(fitsRoom(oversized, level.rooms[0], clearParts), false);

  // An item inside the clear polygon fits.
  const inside = { x: clearParts[0].x + 0.1, y: clearParts[0].y + 0.1, w: 2, h: 2 };
  assert.equal(fitsRoom(inside, level.rooms[0], clearParts), true);
});

/* Plans built before finished faces existed, and fixtures that carry a bare
   room with no level context, must keep working. */
test('without finished geometry the old inset still applies', () => {
  const bare = room('bed', 'bedroom', 0, 0, 10, 10);
  const item = { x: 0.3, y: 0.3, w: 9.4, h: 9.4 };
  assert.equal(fitsRoom(item, bare), true, 'the flat 0.25 ft inset is the fallback');
  assert.equal(fitsRoom({ x: 0.1, y: 0.1, w: 9.8, h: 9.8 }, bare), false);
});

/* A wet wall is for the drain stack, and a house has few of them. Making every
   boundary of a bathroom 6.5 in took half an inch a side off every bathroom in
   the plan and cost several briefs their toilet clearance. */
test('only a wall between two wet rooms is a plumbing wall', () => {
  const bathToBed = buildWallModel({
    level: 1,
    rooms: [room('bath', 'bathroom', 0, 0, 6, 8), room('bed', 'bedroom', 6, 0, 12, 8)],
  }).walls.find((w) => !w.exterior);
  assert.equal(bathToBed.assembly.id, 'interior',
    'a bathroom wall to a bedroom is an ordinary partition');

  const bathToBath = buildWallModel({
    level: 1,
    rooms: [room('bath1', 'bathroom', 0, 0, 6, 8), room('bath2', 'bathroom', 6, 0, 6, 8)],
  }).walls.find((w) => !w.exterior);
  assert.equal(bathToBath.assembly.id, 'plumbing',
    'back-to-back fixtures share a wet wall');
});
