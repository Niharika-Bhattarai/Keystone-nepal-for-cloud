'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const handler = require('../api/plan');
const { normalizeBrief } = require('../lib/tile/normalizeBrief');
const { resolveArchitectV2Support } = require('../lib/residential/v2/supportMatrix');
const { interpretBriefV2 } = require('../lib/residential/v2/interpretBriefV2');
const { buildCandidateFootprintsV2 } = require('../lib/residential/v2/candidateFootprintsV2');

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
  lotContext = 'Suburban standard lot',
  area = '3000',
}) {
  return {
    surveyData: {
      location: '',
      totalArea: area,
      stories: '2 Stories',
      bedrooms: '3 Bed',
      bathrooms: '3 Bath',
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
      lotContext,
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

function topAspectForLotContext(lotContext) {
  const brief = normalizeBrief(makePayload({ lotContext }).surveyData);
  const support = resolveArchitectV2Support(brief);
  const interpretation = interpretBriefV2(brief, support);
  const candidates = buildCandidateFootprintsV2(brief, interpretation);
  assert.ok(candidates.length > 0, `Expected candidates for ${lotContext}`);
  return Number(candidates[0]?.aspectRatio || 0);
}

test('architect_v2 routes urban/rural/view/waterfront contexts without fallback', async () => {
  const lotContexts = [
    'Urban narrow lot',
    'Rural acreage lot',
    'View-focused lot',
    'Waterfront lot',
  ];

  for (const lotContext of lotContexts) {
    const result = await invokePlan(makePayload({ lotContext }));
    const engine = result.body?.engine || {};

    assert.equal(result.statusCode, 200, `Expected 200 for ${lotContext}`);
    assert.equal(result.body?.success, true, `Expected success for ${lotContext}`);
    assert.equal(engine.generatorId, 'architect_v2', `Expected v2 routing for ${lotContext}`);
    assert.equal(engine.fallbackUsed, false, `Expected no fallback for ${lotContext}`);
    assert.equal(engine.supportTier, 'wave1', `Expected wave1 support for ${lotContext}`);
  }
});

test('candidate footprints bias urban contexts deeper than rural contexts', () => {
  const urbanAspect = topAspectForLotContext('Urban narrow lot');
  const ruralAspect = topAspectForLotContext('Rural acreage lot');

  assert.ok(
    urbanAspect < ruralAspect,
    `Expected urban aspect (${urbanAspect}) < rural aspect (${ruralAspect})`
  );
});

test('support matrix keeps unsupported corner lots explicit on legacy', () => {
  const brief = normalizeBrief(makePayload({ lotContext: 'Corner lot' }).surveyData);
  const support = resolveArchitectV2Support(brief);
  assert.equal(support.supported, false);
  assert.equal(support.generatorId, 'legacy');
  assert.ok((support.reasons || []).includes('lot_context_not_supported'));
});

