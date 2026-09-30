'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const handler = require('../api/plan');

function invokePlan(payload) {
  return new Promise((resolve, reject) => {
    const req = { method: 'POST', body: payload, headers: {} };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) {
        this.headers[name] = value;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        resolve({ statusCode: this.statusCode, body, headers: this.headers });
        return this;
      },
      send(body) {
        resolve({ statusCode: this.statusCode, body, headers: this.headers });
        return this;
      },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

function makePayload({
  totalArea = '2600',
  garage = '1 Car Garage',
  bedrooms = '4 Bed',
  bathrooms = '3 Bath',
  privateBaths = '1',
}) {
  return {
    surveyData: {
      location: '',
      totalArea,
      stories: '2 Stories',
      bedrooms,
      bathrooms,
      privateBaths,
      bedroomConfigs: null,
      shape: 'Rectangular',
      garage,
      materials: 'Craftsman (Wood & Stone)',
      openConcept: 'Open Concept (Combined)',
      masterLocation: 'Level 2 (Upper)',
      kitchenPlacement: 'Rear of House',
      features: '',
      frontFacing: 'South',
      lotContext: 'Suburban standard lot',
      laundryLocation: 'Level 1 (near garage/mud)',
      ceilingHeight: 'Standard (9 ft)',
      indoorOutdoor: 'Moderate (some connection)',
      naturalLight: 'Balanced windows',
      accessibilityNeeds: 'None',
      budgetTier: 'Mid ($200-300/sqft)',
      freeformWishes: '',
    },
    chatHistory: [],
  };
}

function countRooms(planSpec, type) {
  return (planSpec?.levels || []).reduce((sum, level) => {
    return sum + (level?.rooms || []).filter((room) => String(room?.type) === type).length;
  }, 0);
}

test('architect_v2 routes 4-bed two-story garage briefs without legacy fallback', async () => {
  const result = await invokePlan(makePayload({ garage: '1 Car Garage', totalArea: '2600' }));
  const engine = result.body?.engine || {};

  assert.equal(result.statusCode, 200);
  assert.equal(result.body?.success, true, JSON.stringify(result.body, null, 2));
  assert.equal(engine.generatorId, 'architect_v2');
  assert.equal(engine.fallbackUsed, false);
  assert.equal(engine.housePattern, 'two_story_upper_primary_with_garage_four_bed');
  assert.equal(countRooms(result.body?.planSpec, 'primary_bedroom'), 1);
  assert.equal(countRooms(result.body?.planSpec, 'bedroom'), 3);
  assert.deepEqual(engine.topologyFailures || [], []);
  assert.deepEqual(engine.geometryFailures || [], []);
});

test('architect_v2 routes 4-bed two-story compact briefs without legacy fallback', async () => {
  const result = await invokePlan(makePayload({ garage: 'No Garage', totalArea: '2600' }));
  const engine = result.body?.engine || {};

  assert.equal(result.statusCode, 200);
  assert.equal(result.body?.success, true, JSON.stringify(result.body, null, 2));
  assert.equal(engine.generatorId, 'architect_v2');
  assert.equal(engine.fallbackUsed, false);
  assert.equal(engine.housePattern, 'two_story_upper_primary_four_bed_compact');
  assert.equal(countRooms(result.body?.planSpec, 'primary_bedroom'), 1);
  assert.equal(countRooms(result.body?.planSpec, 'bedroom'), 3);
  assert.deepEqual(engine.topologyFailures || [], []);
  assert.deepEqual(engine.geometryFailures || [], []);
});

test('architect_v2 rejects invalid low-area 4-bed legacy layouts', async () => {
  // Below the measured range for this home (from 2,000 sq ft with no closets
  // asked for; 2,200 generates since the measured support table).
  const result = await invokePlan(makePayload({ garage: '1 Car Garage', totalArea: '1800' }));
  const engine = result.body?.engine || {};

  assert.equal(result.statusCode, 422);
  assert.equal(result.body?.code, 'NO_VALID_LAYOUT');
  assert.equal(result.body?.svg, undefined);
  assert.equal(engine.generatorId, 'legacy');
  assert.equal(engine.fallbackUsed, false);
  assert.equal(engine.supportTier, 'unsupported');
  assert.equal(engine.housePattern, null);
});
