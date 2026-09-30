'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateEntryCore } = require('../lib/residential/v2/validators/entryCoreValidator');

function arrival(type = 'mudroom', width = 6) {
  return { level: 1, width: 20, height: 20, rooms: [
    { id: 'entry', type: 'entry', x: 0, y: 0, w: 6, h: 4 },
    { id: 'vestibule', type, x: 0, y: 4, w: width, h: 4 },
    { id: 'hall', type: 'hallway', x: 0, y: 8, w: 6, h: 4 },
    { id: 'living', type: 'living_room', x: 0, y: 12, w: 12, h: 8 },
  ], doors: [
    { a: 'entry', b: 'vestibule' }, { a: 'vestibule', b: 'hall' }, { a: 'hall', b: 'living' },
  ] };
}

test('arrival can use one compact mudroom and a landing with actual door connections', () => {
  assert.equal(validateEntryCore(arrival(), { openConcept: false }), null);
});

test('arrival cannot substitute a bathroom, bedroom, laundry, or unusably narrow mudroom', () => {
  for (const type of ['bathroom', 'bedroom', 'laundry']) assert.ok(validateEntryCore(arrival(type), { openConcept: false }));
  assert.ok(validateEntryCore(arrival('mudroom', 2), { openConcept: false }));
});

test('an open-concept survey cannot invent doors through the arrival vestibule', () => {
  const level = arrival();
  level.doors = level.doors.filter(door => door.a !== 'vestibule');
  assert.ok(validateEntryCore(level, { openConcept: true }));
});
