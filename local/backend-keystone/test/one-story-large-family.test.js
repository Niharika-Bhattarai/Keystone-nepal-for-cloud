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
  area = '2400',
  bedrooms = '4 Bed',
  bathrooms = '3 Bath',
  garage = 'None',
  features = '',
}) {
  return {
    surveyData: {
      location: '',
      totalArea: area,
      stories: '1 Story',
      bedrooms,
      bathrooms,
      privateBaths: '1',
      bedroomConfigs: null,
      shape: 'Rectangular',
      garage,
      materials: 'Craftsman (Wood & Stone)',
      openConcept: 'Open Concept (Combined)',
      masterLocation: 'Level 1 (Main)',
      kitchenPlacement: 'Rear of House',
      features,
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

function levelRooms(planSpec, level = 1) {
  return (planSpec?.levels || []).find((candidate) => Number(candidate?.level) === Number(level))?.rooms || [];
}

function countType(rooms, type) {
  return rooms.filter((room) => String(room?.type) === String(type)).length;
}

test('architect_v2 routes one-story 4-bed / 3-bath no-garage briefs on the large split pattern', async () => {
  const result = await invokePlan(makePayload({ area: '2400', bedrooms: '4 Bed', bathrooms: '3 Bath', garage: 'None' }));
  const engine = result.body?.engine || {};
  const rooms = levelRooms(result.body?.planSpec, 1);

  assert.equal(result.statusCode, 200);
  assert.equal(result.body?.success, true, JSON.stringify(result.body, null, 2));
  assert.equal(engine.generatorId, 'architect_v2');
  assert.equal(engine.fallbackUsed, false);
  assert.equal(engine.housePattern, 'one_story_large_split_bedroom_compact');
  assert.equal(countType(rooms, 'primary_bedroom'), 1);
  assert.equal(countType(rooms, 'bedroom'), 3);
});

test('architect_v2 routes one-story 5-bed / 3-bath garage briefs on the large split garage pattern', async () => {
  const result = await invokePlan(makePayload({ area: '3000', bedrooms: '5 Bed', bathrooms: '3 Bath', garage: '1 Car Garage' }));
  const engine = result.body?.engine || {};
  const rooms = levelRooms(result.body?.planSpec, 1);
  const garageRoom = rooms.find((room) => String(room?.type) === 'garage') || null;

  assert.equal(result.statusCode, 200);
  assert.equal(result.body?.success, true, JSON.stringify(result.body, null, 2));
  assert.equal(engine.generatorId, 'architect_v2');
  assert.equal(engine.fallbackUsed, false);
  assert.equal(engine.housePattern, 'one_story_large_split_bedroom_with_garage');
  assert.equal(countType(rooms, 'primary_bedroom'), 1);
  assert.equal(countType(rooms, 'bedroom'), 4);
  assert.ok(garageRoom, 'Expected a garage room on level 1');
});

test('compact one-story 5-bed briefs now use v2 below the former 2800 sqft gate', async () => {
  const result = await invokePlan(makePayload({ area: '2600', bedrooms: '5 Bed', bathrooms: '3 Bath', garage: 'None' }));
  const engine = result.body?.engine || {};

  assert.equal(result.statusCode, 200);
  assert.equal(engine.generatorId, 'architect_v2');
  assert.equal(engine.fallbackUsed, false);
  assert.equal(countType(levelRooms(result.body.planSpec, 1), 'bedroom'), 4);
});

test('one-story large-family briefs with feature rooms stay explicit on legacy in Phase 5.2', async () => {
  const result = await invokePlan(makePayload({
    area: '3000',
    bedrooms: '4 Bed',
    bathrooms: '3 Bath',
    garage: 'None',
    features: '1 Study',
  }));
  const engine = result.body?.engine || {};

  assert.ok(result.statusCode === 200 || result.statusCode === 422);
  assert.equal(engine.generatorId, 'legacy');
  assert.equal(engine.fallbackUsed, false);
  assert.equal(String(engine.supportTier), 'legacy_only', JSON.stringify(result.body, null, 2));
});
