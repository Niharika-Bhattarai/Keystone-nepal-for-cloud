'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { compileSurveyIntent } = require('../lib/residential/v2/surveyIntentCompiler');

function baseBrief(overrides = {}) {
  return {
    raw: {},
    location: '',
    totalAreaSqFt: 2400,
    conditionedAreaSqFt: 2400,
    garageAreaSqFtTarget: 280,
    footprintAreaSqFtTarget: 2540,
    stories: 2,
    bedrooms: 3,
    bathrooms: 3,
    shape: 'RECTANGULAR',
    lotWidth: null,
    lotDepth: null,
    garageType: 'ONE_CAR',
    materials: '',
    openConcept: true,
    primaryOnMain: false,
    kitchenRear: false,
    laundryLevel: 1,
    featureCounts: {},
    requestedFeatureItems: [],
    primaryLevel: 2,
    hasGarage: true,
    privateBathsRequested: 1,
    bedroomClosets: null,
    lotContext: 'SUBURBAN',
    ceilingHeight: 'STANDARD',
    ceilingAreaScale: 1.0,
    accessibility: { wheelchair: false, wideDoors: false, singleLevel: false },
    indoorOutdoor: 'MODERATE',
    naturalLight: 'BALANCED',
    budgetTier: 'MID',
    frontFacing: 'South',
    ...overrides,
  };
}

describe('compileSurveyIntent', () => {
  // 1. totalArea drives massingIntent.targetArea
  it('totalAreaSqFt maps to massingIntent.targetArea', () => {
    const intent = compileSurveyIntent(baseBrief({ totalAreaSqFt: 3200 }));
    assert.equal(intent.massingIntent.targetArea, 3200);
  });

  // 2. stories=2 sets topologyIntent.stairRequired=true
  it('stories=2 sets stairRequired=true', () => {
    const intent = compileSurveyIntent(baseBrief({ stories: 2 }));
    assert.equal(intent.topologyIntent.stairRequired, true);
  });

  // 3. stories=1 sets topologyIntent.stairRequired=false
  it('stories=1 sets stairRequired=false', () => {
    const intent = compileSurveyIntent(baseBrief({ stories: 1 }));
    assert.equal(intent.topologyIntent.stairRequired, false);
  });

  // 4. bedrooms=4 sets bedroomIsolation='wing_separation'
  it('bedrooms >= 4 sets bedroomIsolation to wing_separation', () => {
    const intent = compileSurveyIntent(baseBrief({ bedrooms: 4 }));
    assert.equal(intent.privacyIntent.bedroomIsolation, 'wing_separation');
  });

  // 5. bedrooms=2 sets bedroomIsolation='corridor_access'
  it('bedrooms < 4 sets bedroomIsolation to corridor_access', () => {
    const intent = compileSurveyIntent(baseBrief({ bedrooms: 2 }));
    assert.equal(intent.privacyIntent.bedroomIsolation, 'corridor_access');
  });

  // 6. naturalLight='MAXIMUM' sets daylightIntent.lightPriority='MAXIMUM'
  it('naturalLight maps to daylightIntent.lightPriority', () => {
    const intent = compileSurveyIntent(baseBrief({ naturalLight: 'MAXIMUM' }));
    assert.equal(intent.daylightIntent.lightPriority, 'MAXIMUM');
  });

  // 7. openConcept=true sets openingIntent.openConcept=true
  it('openConcept passes through to openingIntent', () => {
    const intent = compileSurveyIntent(baseBrief({ openConcept: true }));
    assert.equal(intent.openingIntent.openConcept, true);
  });

  // 8. garageType='TWO_CAR' sets serviceIntent.garageType='TWO_CAR'
  it('garageType maps to serviceIntent.garageType', () => {
    const intent = compileSurveyIntent(baseBrief({ garageType: 'TWO_CAR' }));
    assert.equal(intent.serviceIntent.garageType, 'TWO_CAR');
  });

  // 9. laundryLevel=2 sets serviceIntent.laundryLevel=2
  it('laundryLevel maps to serviceIntent.laundryLevel', () => {
    const intent = compileSurveyIntent(baseBrief({ laundryLevel: 2 }));
    assert.equal(intent.serviceIntent.laundryLevel, 2);
  });

  // 10. ceilingHeight='CATHEDRAL' sets materialIntent.ceilingHeight='CATHEDRAL'
  it('ceilingHeight maps to materialIntent.ceilingHeight', () => {
    const intent = compileSurveyIntent(baseBrief({ ceilingHeight: 'CATHEDRAL' }));
    assert.equal(intent.materialIntent.ceilingHeight, 'CATHEDRAL');
  });

  // 11. budgetTier='LUXURY' sets budgetIntent.roomSizeAmbition='generous'
  it('budgetTier LUXURY yields roomSizeAmbition generous', () => {
    const intent = compileSurveyIntent(baseBrief({ budgetTier: 'LUXURY' }));
    assert.equal(intent.budgetIntent.roomSizeAmbition, 'generous');
  });

  // 12. accessibility.wheelchair=true sets accessibilityIntent.wheelchair=true
  it('accessibility.wheelchair passes through', () => {
    const intent = compileSurveyIntent(baseBrief({
      accessibility: { wheelchair: true, wideDoors: false, singleLevel: false },
    }));
    assert.equal(intent.accessibilityIntent.wheelchair, true);
  });

  // 13. requestedFeatureItems with 2 items sets featureComplexity='dual'
  it('2 requestedFeatureItems yields featureComplexity dual', () => {
    const items = [
      { kind: 'gym', canonicalType: 'gym', displayLabel: 'Gym' },
      { kind: 'study', canonicalType: 'study', displayLabel: 'Study' },
    ];
    const intent = compileSurveyIntent(baseBrief({ requestedFeatureItems: items }));
    assert.equal(intent.featureIntent.featureComplexity, 'dual');
    assert.equal(intent.featureIntent.featureCount, 2);
  });

  // 14. shape='WIDE' sets massingIntent.envelopeClass='wide_rectangle'
  it('shape WIDE yields envelopeClass wide_rectangle', () => {
    const intent = compileSurveyIntent(baseBrief({ shape: 'WIDE' }));
    assert.equal(intent.massingIntent.envelopeClass, 'wide_rectangle');
  });

  // 15. frontFacing='North' changes daylightIntent.sunAffinityZones
  it('frontFacing North sets sunAffinityZones to south,east', () => {
    const intent = compileSurveyIntent(baseBrief({ frontFacing: 'North' }));
    assert.deepEqual(intent.daylightIntent.sunAffinityZones, ['south', 'east']);
  });

  // 16. indoorOutdoor='MAXIMUM' sets openingIntent.indoorOutdoor='MAXIMUM'
  it('indoorOutdoor maps to openingIntent.indoorOutdoor', () => {
    const intent = compileSurveyIntent(baseBrief({ indoorOutdoor: 'MAXIMUM' }));
    assert.equal(intent.openingIntent.indoorOutdoor, 'MAXIMUM');
  });

  // 17. lotContext='URBAN' sets massingIntent.lotContext='URBAN'
  it('lotContext maps to massingIntent.lotContext', () => {
    const intent = compileSurveyIntent(baseBrief({ lotContext: 'URBAN' }));
    assert.equal(intent.massingIntent.lotContext, 'URBAN');
  });

  // 18. kitchenRear=true sets openingIntent.kitchenPlacement='rear_anchor'
  it('kitchenRear true yields kitchenPlacement rear_anchor', () => {
    const intent = compileSurveyIntent(baseBrief({ kitchenRear: true }));
    assert.equal(intent.openingIntent.kitchenPlacement, 'rear_anchor');
  });

  // 19. privateBathsRequested=2 sets privacyIntent.privateBathCount=2
  it('privateBathsRequested maps to privacyIntent.privateBathCount', () => {
    const intent = compileSurveyIntent(baseBrief({ privateBathsRequested: 2, bathrooms: 4 }));
    assert.equal(intent.privacyIntent.privateBathCount, 2);
    // sharedBathCount = 4 - 2 - 1 = 1
    assert.equal(intent.privacyIntent.sharedBathCount, 1);
  });

  // 20. bedroomClosets array is passed through to privacyIntent
  it('bedroomClosets passes through to privacyIntent', () => {
    const closets = ['walk_in', 'reach_in', 'reach_in'];
    const intent = compileSurveyIntent(baseBrief({ bedroomClosets: closets }));
    assert.deepEqual(intent.privacyIntent.bedroomClosets, closets);
  });

  // 21. primaryOnMain=true sets topologyIntent.primaryOnMain=true
  it('primaryOnMain passes through to topologyIntent', () => {
    const intent = compileSurveyIntent(baseBrief({ primaryOnMain: true }));
    assert.equal(intent.topologyIntent.primaryOnMain, true);
  });

  // 22. materials string is passed through to materialIntent
  it('materials passes through to materialIntent', () => {
    const intent = compileSurveyIntent(baseBrief({ materials: 'Brick and Stone' }));
    assert.equal(intent.materialIntent.materials, 'Brick and Stone');
  });

  // 23. location string is passed through to daylightIntent
  it('location passes through to daylightIntent', () => {
    const intent = compileSurveyIntent(baseBrief({ location: 'Austin, TX' }));
    assert.equal(intent.daylightIntent.location, 'Austin, TX');
  });

  // Additional edge-case tests
  it('stories=1 sets circulationType to corridor_or_open', () => {
    const intent = compileSurveyIntent(baseBrief({ stories: 1 }));
    assert.equal(intent.topologyIntent.circulationType, 'corridor_or_open');
  });

  it('stories=2 sets circulationType to stair_landing', () => {
    const intent = compileSurveyIntent(baseBrief({ stories: 2 }));
    assert.equal(intent.topologyIntent.circulationType, 'stair_landing');
  });

  it('stories=1 sets privacy gradient to front_public_back_private', () => {
    const intent = compileSurveyIntent(baseBrief({ stories: 1 }));
    assert.equal(intent.privacyIntent.gradient, 'front_public_back_private');
  });

  it('stories=2 sets privacy gradient to public_down_private_up', () => {
    const intent = compileSurveyIntent(baseBrief({ stories: 2 }));
    assert.equal(intent.privacyIntent.gradient, 'public_down_private_up');
  });

  it('shape DEEP yields envelopeClass deep_rectangle', () => {
    const intent = compileSurveyIntent(baseBrief({ shape: 'DEEP' }));
    assert.equal(intent.massingIntent.envelopeClass, 'deep_rectangle');
  });

  it('shape SQUARE yields envelopeClass square_block', () => {
    const intent = compileSurveyIntent(baseBrief({ shape: 'SQUARE' }));
    assert.equal(intent.massingIntent.envelopeClass, 'square_block');
  });

  it('shape L_SHAPE yields envelopeClass l_wing', () => {
    const intent = compileSurveyIntent(baseBrief({ shape: 'L_SHAPE' }));
    assert.equal(intent.massingIntent.envelopeClass, 'l_wing');
  });

  it('shape T_SHAPE yields envelopeClass t_wing', () => {
    const intent = compileSurveyIntent(baseBrief({ shape: 'T_SHAPE' }));
    assert.equal(intent.massingIntent.envelopeClass, 't_wing');
  });

  it('budgetTier ENTRY yields roomSizeAmbition compact', () => {
    const intent = compileSurveyIntent(baseBrief({ budgetTier: 'ENTRY' }));
    assert.equal(intent.budgetIntent.roomSizeAmbition, 'compact');
  });

  it('0 features yields featureComplexity none', () => {
    const intent = compileSurveyIntent(baseBrief({ requestedFeatureItems: [] }));
    assert.equal(intent.featureIntent.featureComplexity, 'none');
  });

  it('1 feature yields featureComplexity single', () => {
    const items = [{ kind: 'gym', canonicalType: 'gym', displayLabel: 'Gym' }];
    const intent = compileSurveyIntent(baseBrief({ requestedFeatureItems: items }));
    assert.equal(intent.featureIntent.featureComplexity, 'single');
  });

  it('3+ features yields featureComplexity complex', () => {
    const items = [
      { kind: 'gym', canonicalType: 'gym', displayLabel: 'Gym' },
      { kind: 'study', canonicalType: 'study', displayLabel: 'Study' },
      { kind: 'library', canonicalType: 'library', displayLabel: 'Library' },
    ];
    const intent = compileSurveyIntent(baseBrief({ requestedFeatureItems: items }));
    assert.equal(intent.featureIntent.featureComplexity, 'complex');
  });

  it('featureTypes are deduplicated', () => {
    const items = [
      { kind: 'gym', canonicalType: 'gym', displayLabel: 'Gym' },
      { kind: 'gym2', canonicalType: 'gym', displayLabel: 'Gym 2' },
    ];
    const intent = compileSurveyIntent(baseBrief({ requestedFeatureItems: items }));
    assert.deepEqual(intent.featureIntent.featureTypes, ['gym']);
  });

  it('privateBathsRequested=null yields sharedBathCount=null', () => {
    const intent = compileSurveyIntent(baseBrief({ privateBathsRequested: null }));
    assert.equal(intent.privacyIntent.privateBathCount, null);
    assert.equal(intent.privacyIntent.sharedBathCount, null);
  });

  it('kitchenRear false yields kitchenPlacement central_anchor', () => {
    const intent = compileSurveyIntent(baseBrief({ kitchenRear: false }));
    assert.equal(intent.openingIntent.kitchenPlacement, 'central_anchor');
  });

  it('hasGarage drives mudroomRequired', () => {
    const withGarage = compileSurveyIntent(baseBrief({ hasGarage: true }));
    assert.equal(withGarage.serviceIntent.mudroomRequired, true);
    const noGarage = compileSurveyIntent(baseBrief({ hasGarage: false }));
    assert.equal(noGarage.serviceIntent.mudroomRequired, false);
  });

  it('frontFacing East sets sunAffinityZones to east,south', () => {
    const intent = compileSurveyIntent(baseBrief({ frontFacing: 'East' }));
    assert.deepEqual(intent.daylightIntent.sunAffinityZones, ['east', 'south']);
  });

  it('frontFacing West sets sunAffinityZones to west,south', () => {
    const intent = compileSurveyIntent(baseBrief({ frontFacing: 'West' }));
    assert.deepEqual(intent.daylightIntent.sunAffinityZones, ['west', 'south']);
  });

  it('frontFacing South sets sunAffinityZones to south,west', () => {
    const intent = compileSurveyIntent(baseBrief({ frontFacing: 'South' }));
    assert.deepEqual(intent.daylightIntent.sunAffinityZones, ['south', 'west']);
  });
});
