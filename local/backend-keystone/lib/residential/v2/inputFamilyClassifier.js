'use strict';
const { supportsSocialFeaturePair } = require('./featurePairPolicy');

/**
 * Input Family Classifier
 *
 * Classifies every possible brief (via its compiled intent) into a named
 * family ID, family cluster, house pattern, and support status.
 *
 * Used by supportMatrix (Phase 2.2) and the parity dashboard.
 */

// ── Helpers ─────────────────────────────────────────────────────────────────

function featureSignature(featureIntent) {
  const types = (featureIntent?.featureTypes || []).slice().sort();
  if (!types.length) return 'base';
  return types.join('_');
}

function isShapeSupportedByV2(shape) {
  const normalized = String(shape || '').toUpperCase();
  return (
    normalized === 'RECTANGULAR' ||
    normalized === 'WIDE' ||
    normalized === 'DEEP' ||
    normalized === 'L_SHAPE' ||
    normalized === 'T_SHAPE'
  );
}

function isLotContextSupportedByV2(lotContext) {
  const normalized = String(lotContext || '').toUpperCase();
  return (
    normalized === 'SUBURBAN' ||
    normalized === 'URBAN' ||
    normalized === 'RURAL' ||
    normalized === 'VIEW' ||
    normalized === 'WATERFRONT'
  );
}

// ── Cluster resolution ──────────────────────────────────────────────────────

function resolveCluster(intent) {
  const massing = intent?.massingIntent || {};
  const topology = intent?.topologyIntent || {};
  const accessibility = intent?.accessibilityIntent || {};
  const stories = massing.stories || 1;
  const bedrooms = intent?.privacyIntent?.bedrooms || 2;
  const hasGarage = massing.garagePresence || false;
  const shape = massing.shape || 'RECTANGULAR';
  const lotContext = massing.lotContext || 'SUBURBAN';
  const area = massing.targetArea || 2000;

  // Priority order: micro -> accessible -> non_rectangular -> non_suburban -> stories/bed/garage

  if (area < 1000) return 'micro';

  if (accessibility.forceSingleStory && stories >= 2) return 'accessible_single_story';

  if (!isShapeSupportedByV2(shape)) return 'non_rectangular';

  if (!isLotContextSupportedByV2(lotContext)) return 'non_suburban';

  // Standard clusters by stories / bedrooms / garage
  if (stories === 1) {
    if (bedrooms >= 4) return hasGarage ? 'one_story_large_garage' : 'one_story_large';
    return hasGarage ? 'one_story_compact_garage' : 'one_story_compact';
  }

  // stories >= 2
  if (bedrooms >= 4) return hasGarage ? 'two_story_large_garage' : 'two_story_large';
  return hasGarage ? 'two_story_garage' : 'two_story_compact';
}

// ── House pattern mapping ───────────────────────────────────────────────────

const SUPPORTED_FEATURE_TYPES = new Set([
  'study',
  'library',
  'gym',
  'gaming_room',
  'playroom',
  'movie_room',
  'music_room',
  'wine_cellar',
  'guest_bedroom',
]);
const FEATURE_MIN_AREA = Object.freeze({
  gym: 1800,
  library: 1800,
  gaming_room: 1800,
  playroom: 1800,
  music_room: 1800,
  wine_cellar: 1600,
  movie_room: 2200,
  guest_bedroom: 2200,
});

function resolveHousePatternFromIntent(intent) {
  const massing = intent?.massingIntent || {};
  const privacy = intent?.privacyIntent || {};
  const topology = intent?.topologyIntent || {};
  const feature = intent?.featureIntent || {};
  const stories = massing.stories || 1;
  const bedrooms = privacy.bedrooms || 2;
  const bathrooms = privacy.bathrooms || 2;
  const hasGarage = massing.garagePresence || false;
  const garageType = massing.garageType || 'NONE';
  const shape = massing.shape || 'RECTANGULAR';
  const lotContext = massing.lotContext || 'SUBURBAN';
  const area = massing.targetArea || 2000;
  const primaryLevel = topology.primaryLevel || (stories === 1 ? 1 : 2);
  const featureTypes = (feature.featureTypes || []).slice().sort();
  const featureCount = feature.featureCount || 0;

  // Gate checks — must ALL pass for v2 support
  if (!isShapeSupportedByV2(shape)) return null;
  if (!isLotContextSupportedByV2(lotContext)) return null;
  if (garageType !== 'NONE' && garageType !== 'ONE_CAR' && garageType !== 'TWO_CAR') return null;
  if (bedrooms < 2 || bedrooms > 5) return null;
  const fourBathFamily = stories === 2 && bedrooms === 4 && bathrooms === 4 &&
    privacy.privateBathCount === 1 && area >= 2800 &&
    (featureCount === 0 || (featureCount === 1 && featureTypes[0] === 'study' && area >= 3000 && hasGarage) ||
      (featureCount === 2 && featureTypes.includes('study') && featureTypes.includes('gym') && area >= 3200 && hasGarage));
  if (bathrooms < 2 || (bathrooms > 3 && !fourBathFamily)) return null;
  if (stories < 1 || stories > 2) return null;
  if (area < 1000) return null;

  // Feature gate
  if (featureCount === 1) {
    const featureType = featureTypes[0];
    if (!SUPPORTED_FEATURE_TYPES.has(featureType)) return null;
    const minArea = Number(FEATURE_MIN_AREA[featureType] || 0);
    if (minArea > 0 && area < minArea) return null;
  } else if (featureCount === 2) {
    const isStudyGym = featureTypes.includes('study') && featureTypes.includes('gym');
    const isLibraryGym = featureTypes.includes('library') && featureTypes.includes('gym');
    const quietPair = !isStudyGym && !isLibraryGym &&
      featureTypes.every(type => SUPPORTED_FEATURE_TYPES.has(type)) &&
      featureTypes.some(type => ['study', 'library', 'guest_bedroom'].includes(type)) &&
      stories === 2 && bedrooms === 3 && bathrooms === 3 && primaryLevel === 2 && area >= 2600;
    const socialPair = supportsSocialFeaturePair({ featureTypes, featureCount,
      stories, bedrooms, bathrooms, primaryLevel, garageType, shape, area });
    if (!isStudyGym && !isLibraryGym && !quietPair && !socialPair) return null;
    // Combo-specific gates
    if (isStudyGym && !(stories === 2 && primaryLevel === 2 &&
      ((bedrooms === 3 && bathrooms === 3 && area >= 3000) || fourBathFamily))) return null;
    if (isLibraryGym && !(stories === 2 && bedrooms === 3 && bathrooms === 3 && area >= 3200 && primaryLevel === 2)) return null;
  } else if (featureCount > 2) {
    return null;
  }

  // Story-specific gates
  if (stories === 1) {
    if (bedrooms === 4 && area < 2200) return null;
    if (bedrooms === 5 && area < 2800) return null;
    if (garageType !== 'NONE' && area < 1500) return null;
    if (garageType !== 'NONE' && featureCount > 0) return null;
    if (bedrooms >= 4 && featureCount > 0) return null;
    if (bedrooms >= 4 && garageType !== 'NONE') return 'one_story_large_split_bedroom_with_garage';
    if (bedrooms >= 4) return 'one_story_large_split_bedroom_compact';
    if (garageType !== 'NONE') {
      if (bedrooms >= 3) return 'one_story_split_bedroom_with_garage';
      return 'one_story_central_core_with_garage';
    }
    if (bedrooms >= 3) return 'one_story_split_bedroom_compact';
    return 'one_story_central_core_compact';
  }

  // Two-story gates
  if (primaryLevel !== 2) return null;
  if (bedrooms > 4) return null;

  // Area minimums
  if (garageType !== 'NONE' && area < 1800) return null;
  if (garageType === 'NONE' && bedrooms >= 3 && area < 1800) return null;
  if (garageType === 'NONE' && bedrooms === 2 && area < 1500) return null;

  // Pattern resolution
  if (hasGarage) {
    const hasStudy = featureCount === 1 && featureTypes[0] === 'study';
    if (hasStudy && bedrooms === 2) return 'two_story_upper_primary_with_garage_study';
    if (bedrooms === 4) return 'two_story_upper_primary_with_garage_four_bed';
    if (bedrooms === 3) return 'two_story_upper_primary_with_garage_three_bed';
    return 'two_story_upper_primary_with_garage';
  }

  if (bedrooms === 4) return 'two_story_upper_primary_four_bed_compact';
  if (bedrooms === 3) return 'two_story_upper_primary_three_bed_compact';
  return 'two_story_upper_primary_compact';
}

// ── Main classifier ─────────────────────────────────────────────────────────

function classifyInputFamily(intent) {
  const massing = intent?.massingIntent || {};
  const privacy = intent?.privacyIntent || {};
  const feature = intent?.featureIntent || {};
  const stories = massing.stories || 1;
  const bedrooms = privacy.bedrooms || 2;
  const bathrooms = privacy.bathrooms || 2;
  const shape = massing.shape || 'RECTANGULAR';
  const garageType = massing.garageType || 'NONE';
  const lotContext = massing.lotContext || 'SUBURBAN';
  const featureSig = featureSignature(feature);

  const familyId = `${stories}s_${bedrooms}b_${bathrooms}ba_${shape}_${garageType}_${lotContext}_${featureSig}`;
  const familyCluster = resolveCluster(intent);
  const housePattern = resolveHousePatternFromIntent(intent);

  let supportStatus;
  const blockedReasons = [];

  if (housePattern) {
    supportStatus = 'v2_supported';
  } else {
    // Check if this is a recognized cluster that could be expanded
    const expandableClusters = new Set([
      'one_story_compact', 'one_story_compact_garage',
      'one_story_large', 'one_story_large_garage',
      'two_story_compact', 'two_story_garage',
      'two_story_large', 'two_story_large_garage',
    ]);

    if (expandableClusters.has(familyCluster)) {
      supportStatus = 'v2_wip';
      // Determine specific blocked reason
      if (stories === 1 && garageType !== 'NONE' && (massing.targetArea || 0) < 1500) {
        blockedReasons.push('one_story_garage_requires_min_1500_sqft');
      }
      if (stories === 1 && garageType !== 'NONE' && (feature.featureCount || 0) > 0) {
        blockedReasons.push('one_story_garage_feature_rooms_not_supported');
      }
      if (stories === 1 && bedrooms > 5) blockedReasons.push('bedroom_count_not_supported');
      if (stories === 2 && bedrooms > 4) blockedReasons.push('bedroom_count_not_supported');
      if (bedrooms < 2) blockedReasons.push('bedroom_count_too_low');
      if (bathrooms > 3) blockedReasons.push('bathroom_count_not_supported');
      if (bathrooms < 2) blockedReasons.push('bathroom_count_too_low');
      if (stories === 1 && bedrooms === 4 && (massing.targetArea || 0) < 2200) {
        blockedReasons.push('one_story_four_bed_requires_min_2200_sqft');
      }
      if (stories === 1 && bedrooms === 5 && (massing.targetArea || 0) < 2800) {
        blockedReasons.push('one_story_five_bed_requires_min_2800_sqft');
      }
      if (stories === 1 && bedrooms >= 4 && (feature.featureCount || 0) > 0) {
        blockedReasons.push('one_story_large_feature_rooms_not_supported');
      }
    } else {
      supportStatus = 'v2_blocked';
      if (familyCluster === 'micro') blockedReasons.push('area_too_small');
      if (familyCluster === 'non_rectangular') blockedReasons.push('shape_not_rectangular');
      if (familyCluster === 'non_suburban') blockedReasons.push('lot_context_not_suburban');
      if (familyCluster === 'accessible_single_story') blockedReasons.push('accessibility_forces_single_story');
    }
  }

  return {
    familyId,
    familyCluster,
    housePattern,
    supportStatus,
    blockedReasons,
  };
}

module.exports = {
  classifyInputFamily,
  featureSignature,
};
