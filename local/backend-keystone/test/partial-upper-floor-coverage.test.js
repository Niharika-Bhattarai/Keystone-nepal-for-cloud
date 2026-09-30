'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { base } = require('../scripts/benchmark/generation-coverage');
const { invoke } = require('../scripts/benchmark/survey-delivery-audit');
const { validateEditedPlan } = require('../lib/validateEditedPlan');

/* The two eligible briefs P03 was opened for.
 *
 * Both were declared supported and delivered nothing. The two-storey garage
 * templates need about 44 ft of service/public width and at least 28 ft of
 * depth on the ground floor, so the smallest footprint the search could offer
 * was 44x28. Filled on both levels that is 2,464 sq ft against a 2,240 sq ft
 * gross target, failing the area check by 224 sq ft on a 179 sq ft tolerance.
 * Repacking could not fix it; the upper floor had to stop short of the garage.
 */
const P03_BRIEFS = [
  { label: 'two bedroom', bedrooms: '2 Bed' },
  { label: 'three bedroom', bedrooms: '3 Bed' },
];

const compactGarageSurvey = (bedrooms) => ({
  ...base,
  totalArea: '1800',
  stories: '2 Stories',
  bedrooms,
  bathrooms: '3 Bath',
  privateBaths: '1',
  garage: '2 Car Garage',
  masterLocation: 'Level 2 (Upper)',
});

const levelRoomArea = (level) => (level.rooms || [])
  .reduce((sum, room) => sum + (Number(room.w) || 0) * (Number(room.h) || 0), 0);

const builtWidth = (level) => {
  const rooms = (level.rooms || []).filter((room) => Number(room.w) > 0);
  if (!rooms.length) return 0;
  return Math.max(...rooms.map((r) => Number(r.x) + Number(r.w))) - Math.min(...rooms.map((r) => Number(r.x)));
};

test('compact two-storey two-car garage briefs deliver a validated plan', async () => {
  const previous = process.env.V2_DISABLE_LEGACY_FALLBACK;
  process.env.V2_DISABLE_LEGACY_FALLBACK = 'true';
  try {
    for (const { label, bedrooms } of P03_BRIEFS) {
      const survey = compactGarageSurvey(bedrooms);
      const { status, body } = await invoke(survey);
      assert.equal(status, 200, `${label}: expected a delivered plan`);
      assert.equal(body.engine.generatorId, 'architect_v2', `${label}: must not fall back to legacy`);
      assert.equal(body.engine.fallbackUsed, false);

      for (const plan of [body.planSpec, ...(body.alternatives || []).map((option) => option.planSpec)]) {
        assert.deepEqual(validateEditedPlan(plan, survey), [], `${label}: every delivered option must validate`);
      }
    }
  } finally {
    if (previous === undefined) delete process.env.V2_DISABLE_LEGACY_FALLBACK;
    else process.env.V2_DISABLE_LEGACY_FALLBACK = previous;
  }
});

test('the upper floor stops short of the garage and the flights still align', async () => {
  const previous = process.env.V2_DISABLE_LEGACY_FALLBACK;
  process.env.V2_DISABLE_LEGACY_FALLBACK = 'true';
  try {
    const { body } = await invoke(compactGarageSurvey('2 Bed'));
    const [lower, upper] = body.planSpec.levels;

    assert.ok(
      builtWidth(upper) < builtWidth(lower),
      'the upper storey must be narrower than the ground floor it sits on',
    );
    assert.ok(
      levelRoomArea(upper) < levelRoomArea(lower),
      'the upper storey must enclose less area than the ground floor',
    );

    // The garage is what the upper floor steps back from, so the storey above
    // must not reach the far edge of the garage bay.
    const garage = (lower.rooms || []).find((room) => String(room.type).toLowerCase() === 'garage');
    assert.ok(garage, 'the ground floor must contain a garage');

    // A flight that does not land inside the storey above is unbuildable, and
    // shortening the upper floor is exactly the change that could break it.
    const lowerStair = (lower.rooms || []).find((room) => /stair/i.test(String(room.type)));
    const upperStair = (upper.rooms || []).find((room) => /stair/i.test(String(room.type)));
    assert.ok(lowerStair && upperStair, 'both levels need a stair room');
    assert.equal(Number(lowerStair.x), Number(upperStair.x), 'stair cores must align in x');
    assert.equal(Number(lowerStair.y), Number(upperStair.y), 'stair cores must align in y');

    const upperRooms = (upper.rooms || []).filter((room) => Number(room.w) > 0);
    const upperLeft = Math.min(...upperRooms.map((room) => Number(room.x)));
    const upperRight = Math.max(...upperRooms.map((room) => Number(room.x) + Number(room.w)));
    assert.ok(
      Number(lowerStair.x) >= upperLeft && Number(lowerStair.x) + Number(lowerStair.w) <= upperRight,
      'the flight must rise into the part of the plan that has a storey above it',
    );
  } finally {
    if (previous === undefined) delete process.env.V2_DISABLE_LEGACY_FALLBACK;
    else process.env.V2_DISABLE_LEGACY_FALLBACK = previous;
  }
});

/* The step-back is a repair for briefs whose only available template is too
   big, not a new default. A brief that already fits must be untouched, or the
   change would quietly reshape plans that were never broken. */
test('a brief whose template already fits keeps a full-width upper floor', async () => {
  const previous = process.env.V2_DISABLE_LEGACY_FALLBACK;
  process.env.V2_DISABLE_LEGACY_FALLBACK = 'true';
  try {
    const survey = { ...base, totalArea: '2400', stories: '2 Stories', bedrooms: '3 Bed', garage: '1 Car Garage' };
    const { status, body } = await invoke(survey);
    assert.equal(status, 200);
    const [lower, upper] = body.planSpec.levels;
    assert.equal(
      builtWidth(upper),
      builtWidth(lower),
      'an upper floor that already fits its area target must still span the footprint',
    );
  } finally {
    if (previous === undefined) delete process.env.V2_DISABLE_LEGACY_FALLBACK;
    else process.env.V2_DISABLE_LEGACY_FALLBACK = previous;
  }
});
