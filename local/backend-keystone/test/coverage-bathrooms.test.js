'use strict';
// Bathroom counts beyond the families' fixed slots: leftover bathrooms take a
// spare room with their own door, every bedroom reaches a bathroom, and a
// survey whose bathrooms are all attached to some bedrooms is refused up front.
const test = require('node:test');
const assert = require('node:assert/strict');
const { placeRemainingBathrooms } = require('../lib/residential/v2/placeRemainingBathrooms');
const { validateBedroomSharedBathAccess } = require('../lib/bedroomSharedBathAccess');
const { validateSurveyInput } = require('../lib/briefContract');
const { shareWall } = require('../lib/planGeometry');

const room = (id, type, x, y, w, h, extra = {}) => ({ id, type, level: 2, x, y, w, h, ...extra });

test('a leftover shared bathroom takes a spare storage room off the hall, keeping the rest as storage', () => {
  const hall = room('hall', 'hallway', 10, 0, 4, 20);
  const store = room('store', 'storage', 14, 0, 8, 14);
  const layout = { levels: [{ level: 2, width: 30, height: 20, rooms: [hall, store, room('bed', 'bedroom', 0, 0, 10, 20)] }] };
  const program = { levels: [{ level: 2, rooms: [{ id: 'bath2', type: 'bathroom', level: 2, bathroomUse: 'shared_extra' }] }] };
  placeRemainingBathrooms(layout, program);
  const rooms = layout.levels[0].rooms;
  const bath = rooms.find((r) => r.id === 'bath2');
  assert.ok(bath, 'the bathroom is placed');
  assert.ok(Math.min(bath.w, bath.h) >= 6 && bath.w * bath.h >= 48, 'a usable bathroom');
  assert.ok(shareWall(bath, hall, 3), 'it opens from the hall');
  const rest = rooms.find((r) => r.id === 'store');
  assert.ok(rest && rest.w * rest.h + bath.w * bath.h === 8 * 14, 'the host keeps the remainder');
});

test('a leftover private bathroom goes next to its own bedroom, and a missing host fails honestly', () => {
  const bed = room('bed3', 'bedroom', 0, 0, 12, 12);
  const layout = { levels: [{ level: 2, width: 30, height: 20, rooms: [bed, room('store', 'storage', 12, 0, 7, 9), room('hall', 'hallway', 12, 9, 18, 4)] }] };
  const program = { levels: [{ level: 2, rooms: [{ id: 'ens3', type: 'bathroom', level: 2, bathroomUse: 'private', attachedTo: 'bed3' }] }] };
  placeRemainingBathrooms(layout, program);
  const bath = layout.levels[0].rooms.find((r) => r.id === 'ens3');
  assert.ok(bath && shareWall(bath, bed, 3), 'the ensuite shares a wall with its bedroom');

  const bare = { levels: [{ level: 2, width: 20, height: 20, rooms: [room('bed', 'bedroom', 0, 0, 20, 20)] }] };
  assert.throws(() => placeRemainingBathrooms(bare, { levels: [{ level: 2, rooms: [{ id: 'b', type: 'bathroom', level: 2 }] }] }), /No spare room/);
});

test('every bedroom without an ensuite reaches a shared bathroom without crossing another bedroom', () => {
  const level = (rooms, doors) => ({ levels: [{ level: 1, rooms, doors }] });
  const rooms = [room('p', 'primary_bedroom', 0, 0, 12, 12), room('e', 'primary_bathroom', 12, 0, 8, 8, { attachedTo: 'p' }),
    room('b2', 'bedroom', 0, 12, 12, 12), room('h', 'hallway', 12, 8, 4, 16)];
  const onlyEnsuite = level(rooms, [{ a: 'p', b: 'e' }, { a: 'p', b: 'h' }, { a: 'b2', b: 'h' }]);
  assert.equal(validateBedroomSharedBathAccess(onlyEnsuite).length, 1, 'bedroom 2 has nowhere to go but the primary suite');

  const withHallBath = level([...rooms, room('s', 'bathroom', 16, 8, 6, 8)],
    [{ a: 'p', b: 'e' }, { a: 'p', b: 'h' }, { a: 'b2', b: 'h' }, { a: 's', b: 'h' }]);
  assert.deepEqual(validateBedroomSharedBathAccess(withHallBath), []);

  // Upstairs bedrooms may use a shared bathroom downstairs by the stair.
  const twoLevels = { levels: [
    { level: 1, rooms: [room('s1', 'bathroom', 0, 0, 6, 8), room('h1', 'hallway', 6, 0, 4, 8)], doors: [{ a: 's1', b: 'h1' }] },
    { level: 2, rooms: [room('b3', 'bedroom', 0, 0, 12, 12), room('h2', 'hallway', 12, 0, 4, 12), room('st', 'stairs', 16, 0, 4, 12)],
      doors: [{ a: 'b3', b: 'h2' }, { a: 'st', b: 'h2' }] },
  ] };
  assert.deepEqual(validateBedroomSharedBathAccess(twoLevels), []);

  // Open plan: kitchen, dining and living connect without door records.
  const open = { levels: [{ level: 1, rooms: [room('b', 'bedroom', 0, 0, 12, 12), room('d', 'dining_room', 12, 0, 12, 10),
    room('l', 'living_room', 12, 10, 12, 12), room('h', 'hallway', 24, 10, 4, 12), room('s', 'bathroom', 28, 10, 6, 8)],
  doors: [{ a: 'b', b: 'd' }, { a: 'h', b: 's' }] }] };
  assert.equal(validateBedroomSharedBathAccess(open, { openConcept: false }).length, 1, 'separate rooms need a door from dining to living');
  assert.deepEqual(validateBedroomSharedBathAccess(open, { openConcept: true }), [], 'open plan: dining, living and hall are one space');
});

test('a survey whose bathrooms all belong to some bedrooms is refused before generation', () => {
  const configs = (...yes) => yes.map((y, i) => ({ privateBath: y ? 'Yes' : 'No', closet: i ? 'Standard' : 'Walk-in' }));
  const code = (s) => validateSurveyInput(s).errors.map((e) => e.code);
  assert.ok(code({ bedrooms: '2 Bed', bathrooms: '1 Bath', privateBaths: '1', bedroomConfigs: configs(true, false) }).includes('PROGRAM_CONFLICT'));
  assert.ok(code({ bedrooms: '3 Bed', bathrooms: '2 Bath', privateBaths: '2', bedroomConfigs: configs(true, true, false) }).includes('PROGRAM_CONFLICT'));
  assert.deepEqual(code({ bedrooms: '2 Bed', bathrooms: '1 Bath', privateBaths: '0', bedroomConfigs: configs(false, false) }), []);
  assert.deepEqual(code({ bedrooms: '1 Bed', bathrooms: '1 Bath', privateBaths: '1', bedroomConfigs: configs(true) }), [], 'a one-bedroom home may keep its only bathroom as an ensuite');
  assert.deepEqual(code({ bedrooms: '3 Bed', bathrooms: '3 Bath', privateBaths: '2', bedroomConfigs: configs(true, true, false) }), []);
});
