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
  area = '3000',
  bedrooms = '3 Bed',
  bathrooms = '3 Bath',
  garage = '2 Car Garage',
}) {
  return {
    surveyData: {
      location: '',
      totalArea: area,
      stories: '2 Stories',
      bedrooms,
      bathrooms,
      privateBaths: '1',
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

function garageRoom(planSpec, levelNumber = 1) {
  const level = (planSpec?.levels || []).find((candidate) => Number(candidate?.level) === Number(levelNumber));
  return (level?.rooms || []).find((room) => String(room?.type) === 'garage') || null;
}

test('architect_v2 routes two-story 3-bed 3-bath two-car garage briefs without legacy fallback', async () => {
  const result = await invokePlan(makePayload({ area: '3000', bedrooms: '3 Bed', bathrooms: '3 Bath' }));
  const engine = result.body?.engine || {};
  const garage = garageRoom(result.body?.planSpec, 1);

  assert.equal(result.statusCode, 200);
  assert.equal(result.body?.success, true, JSON.stringify(result.body, null, 2));
  assert.equal(engine.generatorId, 'architect_v2');
  assert.equal(engine.fallbackUsed, false);
  assert.equal(engine.supportTier, 'wave1');
  assert.ok(garage, 'Expected a garage room on level 1');
  assert.ok(Number(garage?.w) >= 20, `Expected two-car garage width >= 20 ft, got ${garage?.w}`);
  assert.deepEqual(engine.topologyFailures || [], []);
  assert.deepEqual(engine.geometryFailures || [], []);
});

test('architect_v2 routes two-story 2-bed 2-bath two-car garage briefs without legacy fallback', async () => {
  const result = await invokePlan(makePayload({ area: '2800', bedrooms: '2 Bed', bathrooms: '2 Bath' }));
  const engine = result.body?.engine || {};
  const garage = garageRoom(result.body?.planSpec, 1);

  assert.equal(result.statusCode, 200);
  assert.equal(result.body?.success, true, JSON.stringify(result.body, null, 2));
  assert.equal(engine.generatorId, 'architect_v2');
  assert.equal(engine.fallbackUsed, false);
  assert.equal(engine.supportTier, 'wave1');
  assert.ok(garage, 'Expected a garage room on level 1');
  assert.ok(Number(garage?.w) >= 20, `Expected two-car garage width >= 20 ft, got ${garage?.w}`);
  assert.deepEqual(engine.topologyFailures || [], []);
  assert.deepEqual(engine.geometryFailures || [], []);
});

