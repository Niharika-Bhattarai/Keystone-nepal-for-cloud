'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { compileSurveyIntent } = require('../lib/residential/v2/surveyIntentCompiler');
const { classifyInputFamily } = require('../lib/residential/v2/inputFamilyClassifier');

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

function classify(overrides) {
  return classifyInputFamily(compileSurveyIntent(baseBrief(overrides)));
}

describe('inputFamilyClassifier', () => {
  it('2s/3b/3ba/RECTANGULAR/ONE_CAR/SUBURBAN/base -> two_story_garage, v2_supported', () => {
    const result = classify({});
    assert.equal(result.familyCluster, 'two_story_garage');
    assert.equal(result.housePattern, 'two_story_upper_primary_with_garage_three_bed');
    assert.equal(result.supportStatus, 'v2_supported');
  });

  it('1s/2b/2ba/RECTANGULAR/NONE/SUBURBAN/base -> one_story_compact, v2_supported', () => {
    const result = classify({ stories: 1, bedrooms: 2, bathrooms: 2, garageType: 'NONE', hasGarage: false, primaryLevel: 1 });
    assert.equal(result.familyCluster, 'one_story_compact');
    assert.equal(result.housePattern, 'one_story_central_core_compact');
    assert.equal(result.supportStatus, 'v2_supported');
  });

  it('1s/3b/2ba/RECTANGULAR/NONE/SUBURBAN/base -> one_story_compact, v2_supported', () => {
    const result = classify({ stories: 1, bedrooms: 3, bathrooms: 2, garageType: 'NONE', hasGarage: false, primaryLevel: 1 });
    assert.equal(result.familyCluster, 'one_story_compact');
    assert.equal(result.housePattern, 'one_story_split_bedroom_compact');
    assert.equal(result.supportStatus, 'v2_supported');
  });

  it('2s/2b/2ba/RECTANGULAR/NONE/SUBURBAN/base -> two_story_compact, v2_supported', () => {
    const result = classify({ bedrooms: 2, bathrooms: 2, garageType: 'NONE', hasGarage: false });
    assert.equal(result.familyCluster, 'two_story_compact');
    assert.equal(result.housePattern, 'two_story_upper_primary_compact');
    assert.equal(result.supportStatus, 'v2_supported');
  });

  it('2s/2b/2ba/RECTANGULAR/ONE_CAR/SUBURBAN/study -> two_story_garage, v2_supported', () => {
    const result = classify({
      bedrooms: 2, bathrooms: 2,
      requestedFeatureItems: [{ kind: 'study', canonicalType: 'study', displayLabel: 'Study', rawLabel: 'study', source: 'requested' }],
    });
    assert.equal(result.familyCluster, 'two_story_garage');
    assert.equal(result.housePattern, 'two_story_upper_primary_with_garage_study');
    assert.equal(result.supportStatus, 'v2_supported');
  });

  it('2s/3b/3ba/RECTANGULAR/ONE_CAR/SUBURBAN/movie_room -> two_story_garage, v2_supported', () => {
    const result = classify({
      requestedFeatureItems: [{ kind: 'movie_room', canonicalType: 'movie_room', displayLabel: 'Movie Room', rawLabel: 'movie room', source: 'requested' }],
      totalAreaSqFt: 3200,
    });
    assert.equal(result.familyCluster, 'two_story_garage');
    assert.equal(result.housePattern, 'two_story_upper_primary_with_garage_three_bed');
    assert.equal(result.supportStatus, 'v2_supported');
  });

  it('2s/4b/3ba/RECTANGULAR/ONE_CAR/SUBURBAN/base -> two_story_large_garage, v2_supported', () => {
    const result = classify({ bedrooms: 4 });
    assert.equal(result.familyCluster, 'two_story_large_garage');
    assert.equal(result.housePattern, 'two_story_upper_primary_with_garage_four_bed');
    assert.equal(result.supportStatus, 'v2_supported');
  });

  it('1s/3b/2ba/RECTANGULAR/ONE_CAR/SUBURBAN/base -> one_story_compact_garage, v2_supported', () => {
    const result = classify({ stories: 1, bedrooms: 3, bathrooms: 2, primaryLevel: 1 });
    assert.equal(result.familyCluster, 'one_story_compact_garage');
    assert.equal(result.housePattern, 'one_story_split_bedroom_with_garage');
    assert.equal(result.supportStatus, 'v2_supported');
  });

  it('1s/4b/3ba/RECTANGULAR/NONE/SUBURBAN/base -> one_story_large, v2_supported', () => {
    const result = classify({
      stories: 1,
      bedrooms: 4,
      bathrooms: 3,
      garageType: 'NONE',
      hasGarage: false,
      primaryLevel: 1,
      totalAreaSqFt: 2400,
    });
    assert.equal(result.familyCluster, 'one_story_large');
    assert.equal(result.housePattern, 'one_story_large_split_bedroom_compact');
    assert.equal(result.supportStatus, 'v2_supported');
  });

  it('1s/5b/3ba/RECTANGULAR/ONE_CAR/SUBURBAN/base -> one_story_large_garage, v2_supported when area is sufficient', () => {
    const result = classify({
      stories: 1,
      bedrooms: 5,
      bathrooms: 3,
      garageType: 'ONE_CAR',
      hasGarage: true,
      primaryLevel: 1,
      totalAreaSqFt: 3000,
    });
    assert.equal(result.familyCluster, 'one_story_large_garage');
    assert.equal(result.housePattern, 'one_story_large_split_bedroom_with_garage');
    assert.equal(result.supportStatus, 'v2_supported');
  });

  it('1s/5b/3ba/RECTANGULAR/NONE/SUBURBAN/base with low area -> one_story_large, v2_wip', () => {
    const result = classify({
      stories: 1,
      bedrooms: 5,
      bathrooms: 3,
      garageType: 'NONE',
      hasGarage: false,
      primaryLevel: 1,
      totalAreaSqFt: 2600,
    });
    assert.equal(result.familyCluster, 'one_story_large');
    assert.equal(result.housePattern, null);
    assert.equal(result.supportStatus, 'v2_wip');
    assert.ok(result.blockedReasons.includes('one_story_five_bed_requires_min_2800_sqft'));
  });

  it('2s/3b/3ba/WIDE/NONE/SUBURBAN/base -> two_story_compact, v2_supported', () => {
    const result = classify({ shape: 'WIDE', garageType: 'NONE', hasGarage: false });
    assert.equal(result.familyCluster, 'two_story_compact');
    assert.equal(result.housePattern, 'two_story_upper_primary_three_bed_compact');
    assert.equal(result.supportStatus, 'v2_supported');
  });

  it('2s/3b/3ba/DEEP/NONE/SUBURBAN/base -> two_story_compact, v2_supported', () => {
    const result = classify({ shape: 'DEEP', garageType: 'NONE', hasGarage: false });
    assert.equal(result.familyCluster, 'two_story_compact');
    assert.equal(result.housePattern, 'two_story_upper_primary_three_bed_compact');
    assert.equal(result.supportStatus, 'v2_supported');
  });

  it('2s/3b/3ba/L_SHAPE/NONE/SUBURBAN/base -> two_story_compact, v2_supported', () => {
    const result = classify({ shape: 'L_SHAPE', garageType: 'NONE', hasGarage: false });
    assert.equal(result.familyCluster, 'two_story_compact');
    assert.equal(result.housePattern, 'two_story_upper_primary_three_bed_compact');
    assert.equal(result.supportStatus, 'v2_supported');
  });

  it('2s/3b/3ba/T_SHAPE/NONE/SUBURBAN/base -> two_story_compact, v2_supported', () => {
    const result = classify({ shape: 'T_SHAPE', garageType: 'NONE', hasGarage: false });
    assert.equal(result.familyCluster, 'two_story_compact');
    assert.equal(result.housePattern, 'two_story_upper_primary_three_bed_compact');
    assert.equal(result.supportStatus, 'v2_supported');
  });

  it('2s/3b/3ba/RECTANGULAR/NONE/URBAN/base -> two_story_compact, v2_supported', () => {
    const result = classify({ garageType: 'NONE', hasGarage: false, lotContext: 'URBAN' });
    assert.equal(result.familyCluster, 'two_story_compact');
    assert.equal(result.housePattern, 'two_story_upper_primary_three_bed_compact');
    assert.equal(result.supportStatus, 'v2_supported');
  });

  it('2s/3b/3ba/RECTANGULAR/NONE/CORNER/base -> non_suburban, v2_blocked', () => {
    const result = classify({ garageType: 'NONE', hasGarage: false, lotContext: 'CORNER' });
    assert.equal(result.familyCluster, 'non_suburban');
    assert.equal(result.supportStatus, 'v2_blocked');
    assert.ok(result.blockedReasons.includes('lot_context_not_suburban'));
  });

  it('area < 1000 -> micro cluster', () => {
    const result = classify({ totalAreaSqFt: 800 });
    assert.equal(result.familyCluster, 'micro');
    assert.equal(result.supportStatus, 'v2_blocked');
  });

  it('feature sig: gym+study -> gym_study (alphabetically sorted)', () => {
    const result = classify({
      requestedFeatureItems: [
        { kind: 'gym', canonicalType: 'gym', displayLabel: 'Gym', rawLabel: 'gym', source: 'requested' },
        { kind: 'study', canonicalType: 'study', displayLabel: 'Study', rawLabel: 'study', source: 'requested' },
      ],
      totalAreaSqFt: 3200,
    });
    assert.ok(result.familyId.endsWith('_gym_study'));
  });

  it('single-level preference does not reclassify an explicitly two-storey brief', () => {
    const result = classify({ accessibility: { wheelchair: true, wideDoors: true, singleLevel: true } });
    assert.notEqual(result.familyCluster, 'accessible_single_story');
    assert.ok(result.familyId.startsWith('2s_'));
  });

  it('familyId contains all classification axes', () => {
    const result = classify({});
    assert.match(result.familyId, /^2s_3b_3ba_RECTANGULAR_ONE_CAR_SUBURBAN_base$/);
  });
});
