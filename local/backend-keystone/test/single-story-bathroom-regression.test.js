'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeBrief } = require('../lib/tile/normalizeBrief');
const { buildProgramFromBrief } = require('../lib/tile/buildProgramFromBrief');
const planHandler = require('../api/plan');

function makeResponseCapture() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(key, value) {
      this.headers[key] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    end(payload) {
      this.body = payload;
      return this;
    },
  };
}

const SURVEY_DATA = {
  location: '',
  totalArea: '1800',
  stories: '1 Story',
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

test('single-story 3 bed / 3 bath / 1 private bath keeps three full bathrooms in the room program', () => {
  const brief = normalizeBrief(SURVEY_DATA);
  const program = buildProgramFromBrief(brief, { levelAreaSqFtActual: 1800 });
  const roomTypes = program.levels.flatMap((level) => level.rooms.map((room) => room.type));

  assert.equal(roomTypes.filter((type) => type === 'primary_bathroom').length, 1);
  assert.equal(roomTypes.filter((type) => type === 'bathroom').length, 2);
  assert.equal(roomTypes.filter((type) => type === 'powder_room').length, 0);
});

test('single-story 1800 sqft 3 bed / 3 bath brief returns a valid plan', async () => {
  const req = {
    method: 'POST',
    headers: {},
    body: {
      surveyData: SURVEY_DATA,
      chatHistory: [],
    },
  };
  const res = makeResponseCapture();

  await planHandler(req, res);

  assert.equal(res.statusCode, 200, `Unexpected status ${res.statusCode}: ${JSON.stringify(res.body)}`);
  assert.equal(res.body?.success, true, `Expected success but got ${JSON.stringify(res.body)}`);
});
