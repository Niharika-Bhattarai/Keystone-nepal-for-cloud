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
        resolve({ statusCode: this.statusCode, headers: this.headers, body });
        return this;
      },
      send(body) {
        resolve({ statusCode: this.statusCode, headers: this.headers, body });
        return this;
      },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

const payload = {
  surveyData: {
    location: '',
    totalArea: '1800',
    stories: '2 Stories',
    bedrooms: '2 Bed',
    bathrooms: '2 Bath',
    privateBaths: '1',
    bedroomConfigs: null,
    shape: 'Rectangular',
    garage: '1 Car Garage',
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

test('v2 composite scoring flag controls scoring model/mode in response', async () => {
  const previous = process.env.V2_COMPOSITE_SCORING;
  try {
    process.env.V2_COMPOSITE_SCORING = 'false';
    const basicResult = await invokePlan(payload);
    assert.equal(basicResult.statusCode, 200);
    assert.equal(basicResult.body?.success, true, JSON.stringify(basicResult.body, null, 2));
    assert.equal(basicResult.body?.engine?.generatorId, 'architect_v2');
    assert.equal(basicResult.body?.engine?.scoringMode, 'basic');
    assert.equal(basicResult.body?.engine?.scoringModelId, 'architect_v2_basic_v0');
    assert.equal(basicResult.body?.scoreBreakdown?.modelId, 'architect_v2_basic_v0');

    process.env.V2_COMPOSITE_SCORING = 'true';
    const compositeResult = await invokePlan(payload);
    assert.equal(compositeResult.statusCode, 200);
    assert.equal(compositeResult.body?.success, true, JSON.stringify(compositeResult.body, null, 2));
    assert.equal(compositeResult.body?.engine?.generatorId, 'architect_v2');
    assert.equal(compositeResult.body?.engine?.scoringMode, 'composite');
    assert.equal(compositeResult.body?.engine?.scoringModelId, 'architect_v2_composite_v1');
    assert.equal(compositeResult.body?.scoreBreakdown?.modelId, 'architect_v2_composite_v1');
    assert.ok(
      Number.isFinite(Number(compositeResult.body?.scoreBreakdown?.components?.adjacencySatisfaction)),
      'Expected composite component scores to be populated'
    );
    const firstAlternative = Array.isArray(compositeResult.body?.alternatives)
      ? compositeResult.body.alternatives[0]
      : null;
    assert.ok(firstAlternative, 'Expected at least one alternative for v2 composite scoring response');
    assert.equal(firstAlternative?.scoreBreakdown?.modelId, 'architect_v2_composite_v1');
  } finally {
    if (previous === undefined) delete process.env.V2_COMPOSITE_SCORING;
    else process.env.V2_COMPOSITE_SCORING = previous;
  }
});
