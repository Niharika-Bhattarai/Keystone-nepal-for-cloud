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
  area = '2000',
  bedrooms = '2 Bed',
  bathrooms = '2 Bath',
  garage = '1 Car Garage',
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

test('architect_v2 routes one-story 2-bed / 2-bath one-car garage briefs without legacy fallback', async () => {
  const result = await invokePlan(makePayload({ area: '1800', bedrooms: '2 Bed', bathrooms: '2 Bath', garage: '1 Car Garage' }));
  const engine = result.body?.engine || {};
  const rooms = levelRooms(result.body?.planSpec, 1);
  const garageRoom = rooms.find((room) => String(room?.type) === 'garage') || null;

  assert.equal(result.statusCode, 200);
  assert.equal(result.body?.success, true, JSON.stringify(result.body, null, 2));
  assert.equal(engine.generatorId, 'architect_v2');
  assert.equal(engine.fallbackUsed, false);
  assert.equal(engine.housePattern, 'one_story_central_core_with_garage');
  assert.ok(garageRoom, 'Expected a garage room on level 1');
  assert.ok(Number(garageRoom?.w) >= 14, `Expected one-car garage width >= 14 ft, got ${garageRoom?.w}`);
  assert.equal(countType(rooms, 'mudroom'), 1);
  assert.equal(countType(rooms, 'laundry'), 1);
  assert.equal(countType(rooms, 'entry'), 1);
});

test('architect_v2 routes one-story 3-bed / 3-bath one-car garage briefs on the split-bedroom garage pattern', async () => {
  const result = await invokePlan(makePayload({ area: '2200', bedrooms: '3 Bed', bathrooms: '3 Bath', garage: '1 Car Garage' }));
  const engine = result.body?.engine || {};
  const rooms = levelRooms(result.body?.planSpec, 1);

  assert.equal(result.statusCode, 200);
  assert.equal(result.body?.success, true, JSON.stringify(result.body, null, 2));
  assert.equal(engine.generatorId, 'architect_v2');
  assert.equal(engine.fallbackUsed, false);
  assert.equal(engine.housePattern, 'one_story_split_bedroom_with_garage');
  assert.equal(countType(rooms, 'primary_bedroom'), 1);
  assert.equal(countType(rooms, 'bedroom'), 2);
  assert.ok(countType(rooms, 'bathroom') >= 1, 'Expected at least one shared bathroom on level 1');
});

test('one-story garage briefs with feature rooms stay explicit on legacy in Phase 5.1', async () => {
  const result = await invokePlan(makePayload({
    area: '2400',
    bedrooms: '3 Bed',
    bathrooms: '3 Bath',
    garage: '1 Car Garage',
    features: '1 Study',
  }));
  const engine = result.body?.engine || {};

  assert.ok(result.statusCode === 200 || result.statusCode === 422);
  assert.equal(engine.generatorId, 'legacy');
  assert.equal(engine.fallbackUsed, false);
  assert.equal(String(engine.supportTier), 'legacy_only', JSON.stringify(result.body, null, 2));
});

test('architect_v2 routes one-story two-car garage briefs with wider garage geometry', async () => {
  const result = await invokePlan(makePayload({ area: '2600', bedrooms: '3 Bed', bathrooms: '2 Bath', garage: '2 Car Garage' }));
  const engine = result.body?.engine || {};
  const rooms = levelRooms(result.body?.planSpec, 1);
  const garageRoom = rooms.find((room) => String(room?.type) === 'garage') || null;

  assert.equal(result.statusCode, 200);
  assert.equal(result.body?.success, true, JSON.stringify(result.body, null, 2));
  assert.equal(engine.generatorId, 'architect_v2');
  assert.equal(engine.fallbackUsed, false);
  assert.equal(engine.housePattern, 'one_story_split_bedroom_with_garage');
  assert.ok(garageRoom, 'Expected a garage room on level 1');
  assert.ok(Number(garageRoom?.w) >= 20, `Expected two-car garage width >= 20 ft, got ${garageRoom?.w}`);
});
