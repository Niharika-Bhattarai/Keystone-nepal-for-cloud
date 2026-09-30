'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePhysicalAccess } = require('../lib/validatePhysicalAccess');
const { placeOpenings } = require('../lib/placeOpenings');

function fixture() {
  return { openConcept: true, levels: [{ level: 1, width: 30, height: 12, rooms: [
    { id: 'entry', type: 'entry', x: 0, y: 0, w: 6, h: 12 },
    { id: 'living', type: 'living_room', x: 6, y: 0, w: 12, h: 12 },
    { id: 'laundry', type: 'laundry', x: 18, y: 0, w: 12, h: 12 },
  ], doors: [
    { a: 'entry', b: '__exterior__', isMainEntry: true, x: 0, y: 6, dir: 'vertical', width: 3 },
    { a: 'entry', b: 'living', x: 6, y: 6, dir: 'vertical', width: 3 },
  ], windows: [] }] };
}

test('open concept does not make a sealed laundry room reachable', () => {
  assert.deepEqual(validatePhysicalAccess(fixture()), ['Physical access: level 1 room laundry is disconnected from arrival']);
});

test('opening placement connects the service component to the actual arrival route', () => {
  const plan = placeOpenings(fixture(), { openConcept: 'Open Concept (Combined)', frontFacing: 'West' });
  assert.deepEqual(validatePhysicalAccess(plan), []);
  assert.ok(plan.levels[0].doors.some(door => [door.a, door.b].includes('laundry') && [door.a, door.b].includes('living')));
});

test('each upper floor must connect its rooms to the stairs, not arbitrary public seeds', () => {
  const plan = fixture();
  plan.levels[0].level = 2;
  assert.match(validatePhysicalAccess(plan)[0], /no stair connection/);
});
