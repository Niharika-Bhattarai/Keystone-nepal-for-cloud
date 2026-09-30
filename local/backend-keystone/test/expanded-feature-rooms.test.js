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
  area = '3200',
  bedrooms = '3 Bed',
  bathrooms = '3 Bath',
  garage = '1 Car Garage',
  features = '',
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

function countRoomType(planSpec, type) {
  return (planSpec?.levels || []).reduce((sum, level) => {
    return sum + (level?.rooms || []).filter((room) => String(room?.type) === String(type)).length;
  }, 0);
}

test('architect_v2 routes expanded single-feature room briefs on v2 and materializes requested rooms', async () => {
  const cases = [
    { features: '1 Gaming Room', expectedRoomType: 'gaming_room' },
    { features: '1 Movie Room', expectedRoomType: 'movie_room' },
    { features: '1 Music Room', expectedRoomType: 'music_room' },
    { features: '1 Wine Cellar', expectedRoomType: 'wine_cellar' },
    { features: '1 Guest Bedroom', expectedRoomType: 'guest_bedroom' },
  ];

  const failures = [];

  for (const candidate of cases) {
    const result = await invokePlan(makePayload({
      area: candidate.expectedRoomType === 'wine_cellar' ? '3000' : '3200',
      features: candidate.features,
    }));
    const engine = result.body?.engine || {};
    const roomCount = countRoomType(result.body?.planSpec, candidate.expectedRoomType);
    const ok =
      result.statusCode === 200 &&
      result.body?.success === true &&
      String(engine.generatorId) === 'architect_v2' &&
      !Boolean(engine.fallbackUsed) &&
      String(engine.supportTier) === 'wave1' &&
      roomCount >= 1;

    if (!ok) {
      failures.push({
        ...candidate,
        statusCode: result.statusCode,
        success: result.body?.success,
        generatorId: engine.generatorId,
        fallbackUsed: engine.fallbackUsed,
        supportTier: engine.supportTier,
        housePattern: engine.housePattern,
        roomCount,
        topologyFailures: engine.topologyFailures || [],
        geometryFailures: engine.geometryFailures || [],
      });
    }
  }

  assert.deepEqual(failures, [], JSON.stringify(failures, null, 2));
});

test('architect_v2 keeps unsupported multi-feature mixes explicit on legacy', async () => {
  const result = await invokePlan(makePayload({
    area: '3200',
    features: '1 Movie Room, 1 Gym',
  }));
  const engine = result.body?.engine || {};

  assert.ok(result.statusCode === 200 || result.statusCode === 422);
  assert.equal(String(engine.generatorId), 'legacy');
  assert.equal(Boolean(engine.fallbackUsed), false);
  assert.ok(
    String(engine.supportTier) === 'unsupported' || String(engine.supportTier) === 'legacy_only',
    `Expected legacy support tier, got ${engine.supportTier}`
  );
});

