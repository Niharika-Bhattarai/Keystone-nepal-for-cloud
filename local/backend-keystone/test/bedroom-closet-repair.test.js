'use strict';

const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { proposeBedroomClosetRepair } = require('../lib/geometry/repairBedroomCloset');
const { verifyBedroomClosetRepair, relocationOptions } = require('./helpers/verifyBedroomClosetRepair');
const names = ['North-standard-1-option-4', 'East-wide-1-option-2', 'West-standard-1-option-3', 'West-standard-1-option-4'];
function load(name = names[0]) {
  const input = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/bedroom-approach-repair', `matrix-${name}-level-2-input.json`)));
  input.options = relocationOptions(input);
  return input;
}
for (const name of names) test(`coordinated closet repair preserves survey, partition and inventory: ${name}`, () => {
  const input = load(name), snapshot = structuredClone(input);
  const result = proposeBedroomClosetRepair(input.plan, input.survey, input.options);
  assert.deepEqual(input, snapshot);
  verifyBedroomClosetRepair(input, result);
  assert.ok(result.reservationCount <= 128 && result.furnitureCandidateCount <= 2000 && result.routeCheckCount <= 64);
});

test('opt-in, original survey, reviewed replacement and bounded policy are required', () => {
  const input = load();
  assert.equal(proposeBedroomClosetRepair(input.plan, input.survey).status, 'disabled');
  const patches = [{ enabled: 'yes' }, { maxReservations: 0 }, { maxReservations: 257 }, { maxFurnitureCandidates: Infinity },
    { maxRouteChecks: 1001 }, { levelNumber: 99 }, { replacementClosetSchedule: undefined },
    { replacementClosetSchedule: { ...input.options.replacementClosetSchedule, reviewedForRelocation: false } },
    { replacementClosetSchedule: { ...input.options.replacementClosetSchedule, openingId: 'stale' } },
    { request: { ...input.options.request, sidePolicy: undefined } },
    { request: { ...input.options.request, maxNodes: 50000 } }];
  for (const patch of patches) {
    const result = proposeBedroomClosetRepair(input.plan, input.survey, { ...input.options, ...patch });
    assert.equal(result.status, 'not_checked'); assert.equal(result.proposedPlan, undefined);
  }
  assert.equal(proposeBedroomClosetRepair(input.plan, {}, input.options).status, 'not_checked');
});

test('malformed replacement schedule and stale source schedule fail closed', () => {
  const input = load();
  for (const dimensions of [{}, { ...input.options.replacementClosetSchedule.dimensions, roughWidthFt: 100 },
    { ...input.options.replacementClosetSchedule.dimensions, basis: '' }]) {
    const result = proposeBedroomClosetRepair(input.plan, input.survey, { ...input.options,
      replacementClosetSchedule: { ...input.options.replacementClosetSchedule, dimensions } });
    assert.equal(result.status, 'not_checked'); assert.equal(result.reservationCount, 0);
  }
  const changed = structuredClone(input);
  changed.plan.levels[1].openingScheduleBook.records[0].binding.x += 0.25;
  assert.equal(proposeBedroomClosetRepair(changed.plan, changed.survey, changed.options).status, 'not_checked');
});

test('inventory or aggregate conflicts are never hidden by regeneration', () => {
  for (const mutate of [i => i.plan.furniture[1].items.pop(),
    i => { i.plan.levels[1].furniture.find(f => f.id === i.options.request.bedId).rotation = 45; },
    i => { i.plan.levels[1].furniture.push(structuredClone(i.plan.levels[1].furniture[0])); }]) {
    const input = load(); mutate(input); const snapshot = structuredClone(input);
    const result = proposeBedroomClosetRepair(input.plan, input.survey, input.options);
    assert.equal(result.status, 'not_checked'); assert.equal(result.proposedPlan, undefined); assert.deepEqual(input, snapshot);
  }
});

test('already repaired layouts remain unchanged and protected reservations are refused', () => {
  const input = load();
  const result = proposeBedroomClosetRepair(input.plan, input.survey, input.options);
  const restored = JSON.parse(JSON.stringify(result.proposedPlan)), snapshot = structuredClone(restored);
  const again = proposeBedroomClosetRepair(restored, input.survey, input.options);
  assert.equal(again.status, 'unchanged'); assert.equal(again.proposedPlan, undefined);
  assert.deepEqual(restored, snapshot);
  const closet = input.plan.levels[1].rooms.find(r => r.id === result.closetId);
  closet.protected = true;
  assert.equal(proposeBedroomClosetRepair(input.plan, input.survey, input.options).status, 'not_checked');
});

test('entry width and explicit finite budgets cannot be bypassed', () => {
  const input = load();
  const wide = proposeBedroomClosetRepair(input.plan, input.survey, { ...input.options, request: { ...input.options.request, clearWidthFt: 4 } });
  assert.equal(wide.status, 'blocked'); assert.equal(wide.proposedPlan, undefined);
  for (const patch of [{ maxReservations: 1 }, { maxRouteChecks: 1 }]) {
    const result = proposeBedroomClosetRepair(input.plan, input.survey, { ...input.options, ...patch });
    assert.equal(result.status, 'search_limit'); assert.equal(result.proposedPlan, undefined);
    assert.ok(result.routeCheckCount <= (patch.maxRouteChecks || 64));
    assert.ok(result.reservationCount <= (patch.maxReservations || 128));
  }
});

test('nested search respects shared budgets and retains the stronger side policy', () => {
  const input = load('West-standard-1-option-3');
  for (const patch of [{ maxFurnitureCandidates: 1 }, { maxRouteChecks: 2 }]) {
    const result = proposeBedroomClosetRepair(input.plan, input.survey, { ...input.options, ...patch });
    assert.equal(result.status, 'search_limit'); assert.equal(result.proposedPlan, undefined);
    assert.ok(result.furnitureCandidateCount <= (patch.maxFurnitureCandidates || 2000));
    assert.ok(result.routeCheckCount <= (patch.maxRouteChecks || 64));
  }
  input.options.request.sidePolicy = 'both';
  const result = proposeBedroomClosetRepair(input.plan, input.survey, input.options);
  if (result.status === 'repaired') {
    verifyBedroomClosetRepair(input, result);
    assert.equal(result.after.accessibleSides.length, 2);
  } else {
    assert.ok(['search_limit', 'search_exhausted'].includes(result.status));
    assert.equal(result.proposedPlan, undefined);
  }
});
