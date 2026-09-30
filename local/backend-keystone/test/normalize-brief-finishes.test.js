'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeBrief } = require('../lib/tile/normalizeBrief');

function makeBaseSurvey(overrides = {}) {
  return {
    totalArea: '1800',
    stories: '2 Stories',
    bedrooms: '3 Bed',
    bathrooms: '2 Bath',
    privateBaths: '1',
    shape: 'Rectangular',
    garage: '1 Car Garage',
    materials: 'Craftsman (Wood & Stone)',
    budgetTier: 'Mid ($200-300/sqft)',
    ...overrides,
  };
}

test('normalizeBrief applies style-default finish spec for each style label', () => {
  const styles = [
    ['Craftsman (Wood & Stone)', 'craftsman'],
    ['Modern Farmhouse (Board & Batten)', 'modern_farmhouse'],
    ['Traditional Colonial (Brick)', 'colonial'],
    ['Contemporary Modern (Concrete)', 'contemporary'],
    ['Mediterranean (Stucco & Tile)', 'mediterranean'],
  ];

  for (const [materials, expectedStyleId] of styles) {
    const brief = normalizeBrief(makeBaseSurvey({ materials }));
    assert.equal(brief.finishSpec?.styleId, expectedStyleId);
    assert.ok(brief.finishSpec?.styleLabel);
  }
});

test('normalizeBrief applies finish overrides on top of style defaults', () => {
  const brief = normalizeBrief(
    makeBaseSurvey({
      finishOverrides: {
        exteriorSiding: 'Board & batten',
        roofMaterial: 'Standing seam metal',
        countertop: 'Quartz',
        flooringPublic: 'LVP',
        cabinetGrade: 'Full custom',
        fixtureGrade: 'Luxury',
      },
    })
  );

  assert.equal(brief.finishSpec?.exterior?.primaryCladding?.material, 'board_batten');
  assert.equal(brief.finishSpec?.roofing?.material, 'standing_seam_metal');
  assert.equal(brief.finishSpec?.interiorFinishes?.countertops?.material, 'quartz');
  assert.equal(brief.finishSpec?.interiorFinishes?.flooring?.public?.material, 'lvp');
  assert.equal(brief.finishSpec?.interiorFinishes?.cabinets?.grade, 'full_custom');
  assert.equal(brief.finishSpec?.interiorFinishes?.fixtures?.grade, 'luxury');
});

test('normalizeBrief parses foundation, mechanical, and outdoor living fields', () => {
  const brief = normalizeBrief(
    makeBaseSurvey({
      foundationType: 'Full basement',
      hvacSystem: 'Heat pump',
      outdoorLiving: 'Screened porch',
      outdoorArea: '320',
    })
  );

  assert.equal(brief.foundationType, 'BASEMENT');
  assert.equal(brief.hvacType, 'HEAT_PUMP');
  assert.equal(brief.outdoorType, 'SCREENED_PORCH');
  assert.equal(brief.outdoorArea, 320);
});

test('normalizeBrief keeps outdoor area at 0 when outdoor living is none', () => {
  const brief = normalizeBrief(
    makeBaseSurvey({
      outdoorLiving: 'None',
      outdoorArea: '500',
    })
  );

  assert.equal(brief.outdoorType, 'NONE');
  assert.equal(brief.outdoorArea, 0);
});

