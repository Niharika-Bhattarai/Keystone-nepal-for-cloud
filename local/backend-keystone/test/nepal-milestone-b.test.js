'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { preflightNepal } = require('../lib/nepal/preflight');
const { normalizeBrief } = require('../lib/nepal/normalizeBrief');
const { areaSqM } = require('../lib/nepal/units');
const fixture = name => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/nepal', name), 'utf8'));

test('area conversion uses 16 aana per ropani and international square foot', () => {
  assert.equal(areaSqM({ value: 4, unit: 'aana' }), 1369 * 0.09290304);
  assert.equal(areaSqM({ value: 1, unit: 'ropani' }), 5476 * 0.09290304);
});
test('rectangular 2.5 levels preserve partial floor and geometry', () => {
  const result = preflightNepal(fixture('rectangle-2_5.json'));
  assert.equal(result.contractReady, true, JSON.stringify(result.blockers));
  assert.equal(result.supported, false);
  assert.equal(result.normalizedBrief.buildingProgram.levels.length, 3);
  assert.equal(result.normalizedBrief.buildingProgram.levels[2].kind, 'partial');
  assert.equal(result.normalizedBrief.site.verticesMm.length, 4);
  assert.equal(result.normalizedBrief.buildingProgram.levels[0].elevationMm, 0);
});
test('surveyed irregular 3.5 levels preserve boundary and partial fourth floor', () => {
  const result = preflightNepal(fixture('irregular-3_5.json'));
  assert.equal(result.contractReady, true, JSON.stringify(result.blockers));
  assert.equal(result.normalizedBrief.site.verticesMm.length, 5);
  assert.equal(result.normalizedBrief.buildingProgram.levels[3].targetAreaSqM, 40);
});
test('two rental floors and upper owner duplex retain independent flat briefs and external shared stair', () => {
  const result = preflightNepal(fixture('rental-3_5.json'));
  assert.equal(result.contractReady, true, JSON.stringify(result.blockers));
  assert.deepEqual(result.normalizedBrief.buildingProgram.rental.floorIds, ['ground', 'first']);
  assert.equal(result.normalizedBrief.buildingProgram.rental.access.type, 'continuousSharedStairOutsideUnits');
  assert.equal(result.normalizedBrief.buildingProgram.ownerProgram.attachedBathrooms, 1);
  assert.deepEqual(result.normalizedBrief.buildingProgram.ownerProgram.specialRooms, ['puja', 'guestBedroom']);
});
test('rental unit needs its own kitchen, living room and continuous external access', () => {
  const raw = fixture('rental-3_5.json');
  raw.buildingProgram.levels[0].kitchens = 0;
  raw.buildingProgram.levels[0].livingRooms = 0;
  raw.buildingProgram.rental.access.type = 'privateInternalStair';
  const result = preflightNepal(raw);
  assert.equal(result.contractReady, false);
  assert.ok(result.blockers.some(b => b.code === 'RENTAL_ACCESS_REQUIRED'));
  assert.ok(result.blockers.some(b => b.field === 'buildingProgram.levels.0.kitchens'));
  assert.ok(result.blockers.some(b => b.field === 'buildingProgram.levels.0.livingRooms'));
});
test('irregular side lengths without coordinates ask for missing survey geometry', () => {
  const raw = fixture('irregular-3_5.json');
  delete raw.site.vertices;
  raw.site.sideLengths = [12, 10, 9, 6, 9].map(value => ({ value, unit: 'm' }));
  const result = preflightNepal(raw);
  assert.equal(result.classification, 'missing_information');
  assert.ok(result.blockers.some(b => b.code === 'POLYGON_COORDINATES_REQUIRED'));
});
test('self crossing polygon, wrong storey list and inconsistent sides fail input checks', () => {
  const raw = fixture('irregular-3_5.json');
  raw.site.vertices = [{x:0,y:0,unit:'m'},{x:10,y:10,unit:'m'},{x:0,y:10,unit:'m'},{x:10,y:0,unit:'m'}];
  raw.buildingProgram.levels.pop();
  const result = normalizeBrief(raw);
  assert.ok(result.invalid.some(b => b.field === 'site.vertices'));
  assert.ok(result.invalid.some(b => b.field === 'buildingProgram.levels'));
});
test('local access guard is false outside explicit local runtime', () => {
  const { localStudio } = require('../lib/nepal/localAccess');
  const before = { ...process.env };
  try {
    delete process.env.KEYSTONE_RUNTIME;
    assert.equal(localStudio(), false);
    process.env.NEPAL_LOCAL_STUDIO = '1'; process.env.KEYSTONE_RUNTIME = 'local';
    process.env.ACCOUNTS_STORE = 'memory'; process.env.ACCOUNTS_AUTH = 'insecure-dev';
    assert.equal(localStudio(), true);
    process.env.K_SERVICE = 'cloud'; assert.equal(localStudio(), false);
  } finally { process.env = before; }
});
