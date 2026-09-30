'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const handler = require('../api/plan');
const { normalizeBrief } = require('../lib/tile/normalizeBrief');
const { resolveArchitectV2Support } = require('../lib/residential/v2/supportMatrix');
const { interpretBriefV2 } = require('../lib/residential/v2/interpretBriefV2');
const { buildProgramV2 } = require('../lib/residential/v2/programBuilderV2');

function invokePlan(payload) {
  return new Promise((resolve, reject) => {
    const req = {
      method: 'POST',
      body: payload,
      headers: {},
    };

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
        resolve({
          statusCode: this.statusCode,
          headers: this.headers,
          body,
        });
        return this;
      },
      send(body) {
        resolve({
          statusCode: this.statusCode,
          headers: this.headers,
          body,
        });
        return this;
      },
      end() {
        resolve({
          statusCode: this.statusCode,
          headers: this.headers,
          body: null,
        });
        return this;
      },
    };

    Promise.resolve(handler(req, res)).catch(reject);
  });
}

function roomArea(room) {
  return Number(room?.w || 0) * Number(room?.h || 0);
}

test('architect_v2 keeps 2400 sqft three-bed upper private rooms reasonably close to program targets', async () => {
  const surveyData = {
    location: '',
    totalArea: '2400',
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
    lotContext: 'Suburban standard lot',
    laundryLocation: 'Level 1 (near garage/mud)',
    ceilingHeight: 'Standard (9 ft)',
    indoorOutdoor: 'Moderate (some connection)',
    naturalLight: 'Balanced windows',
    accessibilityNeeds: 'None',
    budgetTier: 'Mid ($200-300/sqft)',
    freeformWishes: '',
  };

  const brief = normalizeBrief(surveyData);
  const support = resolveArchitectV2Support(brief);
  const interpretation = interpretBriefV2(brief, support);
  const program = buildProgramV2(brief, interpretation);
  const upperTargets = new Map(
    (program.levels.find((level) => Number(level?.level) === 2)?.rooms || [])
      .map((room) => [String(room.id), Number(room?.targetAreaSqFt || 0)])
  );

  const result = await invokePlan({ surveyData, chatHistory: [] });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body?.success, true, JSON.stringify(result.body, null, 2));
  assert.equal(result.body?.engine?.generatorId, 'architect_v2');
  assert.equal(result.body?.engine?.fallbackUsed, false);

  const level2 = (result.body?.planSpec?.levels || []).find((level) => Number(level?.level) === 2);
  const checkedRooms = (level2?.rooms || []).filter((room) =>
    ['primary_bedroom', 'primary_bathroom', 'bedroom', 'bathroom'].includes(String(room?.type))
  );

  assert.ok(checkedRooms.length >= 5, 'Expected upper-level private rooms to be present');

  for (const room of checkedRooms) {
    const targetArea = upperTargets.get(String(room.id));
    assert.ok(targetArea > 0, `Expected a target area for ${room.id}`);
    assert.ok(
      roomArea(room) <= Math.ceil(targetArea * 1.6),
      `Expected ${room.id} (${room.type}) area ${roomArea(room)} to stay within 1.6x target ${targetArea}`
    );
  }
});
