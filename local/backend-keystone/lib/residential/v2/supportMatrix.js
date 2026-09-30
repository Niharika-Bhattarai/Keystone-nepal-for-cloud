'use strict';

const { compileSurveyIntent } = require('./surveyIntentCompiler');
const { classifyInputFamily } = require('./inputFamilyClassifier');
const { supportsSocialFeaturePair } = require('./featurePairPolicy');
const SUPPORTED_SHAPES = new Set(['RECTANGULAR', 'WIDE', 'DEEP', 'SQUARE', 'L_SHAPE', 'T_SHAPE']);
const SUPPORTED_LOT_CONTEXTS = new Set(['SUBURBAN', 'URBAN', 'RURAL', 'VIEW', 'WATERFRONT']);
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
const ALLOWED_FEATURE_TYPES = Object.keys(FEATURE_MIN_AREA).concat(['study']);

/* Measured support. For each home type (storeys, bedrooms, bathrooms, garage)
 * the area ranges in which the layouts delivered valid plans with the
 * Studio's payload and default settings, measured separately for a walk-in
 * closet, standard closets and none (scripts/benchmark/measure-support.cjs,
 * written to measuredSupportTable.json). Where a survey matches a measured
 * home type these ranges replace the hand-set structural gates below; other
 * choices (special rooms, extra en-suites, a main-floor primary upstairs of a
 * two-storey home) keep the rules written for them. */
let MEASURED = null;
try { MEASURED = require('./measuredSupportTable.json'); } catch (_) { MEASURED = null; }
const MEASURED_GATES = new Set(['area_too_small_for_v2', 'bedrooms_out_of_range', 'bathrooms_out_of_range',
  'primary_without_ensuite_topology_not_supported', 'one_story_public_spine_requires_min_1200_sqft',
  'one_story_garage_requires_min_1500_sqft', 'one_story_four_bed_requires_min_1800_sqft', 'one_story_four_bed_requires_min_2200_sqft',
  'one_story_five_bed_requires_min_2400_sqft', 'one_story_five_bed_requires_min_2800_sqft', 'two_story_garage_requires_min_1800_sqft',
  'two_story_compact_three_bed_requires_min_1800_sqft', 'two_story_compact_two_bed_requires_min_1500_sqft',
  'two_story_five_bed_requires_min_3000_sqft', 'two_story_four_bed_requires_min_2400_sqft']);

// The closets a survey asks for, as measured: any walk-in, standard
// (reach-in) closets only, or none (no per-bedroom settings).
function closetKind(configs) {
  if (!Array.isArray(configs) || !configs.some((c) => c && c.closet)) return 'none';
  return configs.some((c) => /walk/i.test(String(c?.closet || ''))) ? 'walk-in' : 'standard';
}

function measuredRanges({ stories, bedrooms, bathrooms, garageType, primaryLevel, attached, features, primaryEnsuite, closets }) {
  if (!MEASURED?.ranges || process.env.KEYSTONE_MEASURING_SUPPORT) return null;
  if (features || primaryLevel !== stories) return null;
  // Measured with the Studio's default attachment: the primary en-suite when
  // there is more than one bathroom, every other bathroom shared.
  const defaultAttached = bathrooms > 1 ? 1 : 0;
  if (attached !== defaultAttached || (defaultAttached === 1) !== (primaryEnsuite !== false)) return null;
  const garage = garageType === 'TWO_CAR' ? 'two' : garageType === 'ONE_CAR' ? 'one' : 'none';
  // Closets are requirements: a survey that asks for none (no per-bedroom
  // settings, as the API and older clients send) has its own measured ranges.
  const table = closets === 'walk-in' ? MEASURED.ranges
    : closets === 'standard' ? (MEASURED.rangesStandardClosets || MEASURED.ranges)
      : (MEASURED.rangesWithoutClosets || MEASURED.ranges);
  return table[`${stories}s-${bedrooms}b-${bathrooms}ba-${garage}`] || null;
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

/* Phrases that mean "no feature rooms", as opposed to a request that could
   not be parsed. The distinction matters because the two are handled in
   opposite ways below: unparseable text disqualifies the brief from v2 on
   the grounds that we should not silently ignore something the user asked
   for, while an explicit "none" is a brief that has been fully understood.
   "None" is what the survey's own feature picker submits, and it is the
   value in DEFAULT_FORM_DATA, so treating it as unrecognised sent the most
   common brief on the site down the legacy path. */
const EXPLICIT_NO_FEATURES = new Set([
  'none', 'no', 'nope', 'nothing', 'n/a', 'na',
  'no features', 'no feature', 'no extra rooms', 'no extras',
  'none needed', 'none required', 'not applicable',
]);

function hasRawFeatureRequestText(brief) {
  const text = normalizeText(brief?.requestedFeaturesText);
  if (!text.length) return false;
  return !EXPLICIT_NO_FEATURES.has(text);
}

function featureCount(brief) {
  const requested = Array.isArray(brief?.requestedFeatureItems) ? brief.requestedFeatureItems.length : 0;
  if (requested > 0) return requested;
  return Object.values(brief?.featureCounts || {}).reduce((sum, value) => sum + Math.max(0, num(value, 0)), 0);
}

function canonicalFeatureList(brief) {
  return (Array.isArray(brief?.requestedFeatureItems) ? brief.requestedFeatureItems : [])
    .map((item) => String(item?.canonicalType || '').trim().toLowerCase())
    .filter(Boolean);
}

function declaredBathroomCount(brief) {
  const rawBathrooms = String(brief?.raw?.bathrooms || '').trim();
  const match = rawBathrooms.match(/\d+/);
  if (match) return Math.max(1, num(match[0], 1));
  return Math.max(1, num(brief?.bathrooms, 1));
}

function resolveHousePattern(brief) {
  const stories = Math.max(1, num(brief?.stories, 1));
  const bedrooms = Math.max(1, num(brief?.bedrooms, 1));
  const hasGarage = Boolean(brief?.hasGarage);
  const primaryLevel = Math.max(1, num(brief?.primaryLevel, stories === 1 ? 1 : 2));
  const featureTypes = canonicalFeatureList(brief);
  const hasStudy = featureTypes.length === 1 && featureTypes[0] === 'study';

  if (stories === 1) {
    if (bedrooms >= 4) {
      return hasGarage
        ? 'one_story_large_split_bedroom_with_garage'
        : 'one_story_large_split_bedroom_compact';
    }
    if (hasGarage) {
      if (bedrooms >= 3) return 'one_story_split_bedroom_with_garage';
      return 'one_story_central_core_with_garage';
    }
    if (bedrooms >= 3) return 'one_story_split_bedroom_compact';
    return 'one_story_central_core_compact';
  }

  if (primaryLevel !== 2) {
    if (!supportsMainFloorPrimary(brief)) return null;
    return bedrooms === 3 ? 'two_story_main_primary_with_garage_three_bed' : 'two_story_main_primary_with_garage';
  }
  if (hasGarage) {
    if (hasStudy && bedrooms === 2) return 'two_story_upper_primary_with_garage_study';
    if (bedrooms >= 4) return 'two_story_upper_primary_with_garage_four_bed';
    if (bedrooms === 3) return 'two_story_upper_primary_with_garage_three_bed';
    return 'two_story_upper_primary_with_garage';
  }
  if (bedrooms >= 4) return 'two_story_upper_primary_four_bed_compact';
  if (bedrooms === 3) return 'two_story_upper_primary_three_bed_compact';
  if (bedrooms > 4) return null;
  return 'two_story_upper_primary_compact';
}

// The two-storey main-floor suite (patterns/twoStoryMainPrimary): two to five
// bedrooms, the primary en-suite the only private bath, any garage.
function mainFloorPrimaryEligible(brief) {
  const bedrooms = Number(brief.bedrooms), baths = declaredBathroomCount(brief);
  return Number(brief.stories) === 2 && Number(brief.primaryLevel) === 1 && bedrooms >= 2 && bedrooms <= 5 &&
    baths >= 2 && baths <= bedrooms + 1 && ['NONE', 'ONE_CAR', 'TWO_CAR'].includes(brief.garageType) && featureCount(brief) === 0 &&
    brief.primaryEnsuiteRequested !== false && Number(brief.privateBathCount ?? brief.raw?.privateBaths ?? 1) === 1 &&
    !brief.accessibility?.wideDoors && !brief.accessibility?.wheelchair &&
    !/10|tall|vault/i.test(String(brief.raw?.ceilingHeight || '')) &&
    ['RECTANGULAR', 'WIDE', 'DEEP'].includes(brief.shape);
}

// Its measured area ranges (measure-support.cjs --main-floor-primary), by the
// closets asked for; null where the home type was not measured.
function mainFloorPrimaryRanges(brief, closets = closetKind(brief?.raw?.bedroomConfigs)) {
  const tables = MEASURED?.mainFloorPrimary;
  if (!tables || process.env.KEYSTONE_MEASURING_SUPPORT) return null;
  const table = closets === 'walk-in' ? tables.ranges : closets === 'standard' ? tables.rangesStandardClosets : tables.rangesWithoutClosets;
  const garage = brief.garageType === 'TWO_CAR' ? 'two' : brief.garageType === 'ONE_CAR' ? 'one' : 'none';
  return table?.[`2s-${Number(brief.bedrooms)}b-${declaredBathroomCount(brief)}ba-${garage}`] || null;
}

// Before measurement: three bedrooms and bathrooms, from 3,200 sq ft with a
// walk-in closet (2,400 and 2,800 failed) and from 2,400 with standard
// closets or none, to 5,000.
function mainFloorPrimaryUnmeasured(brief) {
  const area = Number(brief.totalAreaSqFt);
  return Number(brief.bedrooms) === 3 && declaredBathroomCount(brief) === 3 && brief.garageType === 'ONE_CAR' && area <= 5000 &&
    area >= (closetKind(brief?.raw?.bedroomConfigs) === 'walk-in' ? 3200 : 2400);
}

const inAreaRanges = (ranges, area) => ranges.some(([from, to]) => area >= from && area <= to);

function supportsMainFloorPrimary(brief) {
  if (!mainFloorPrimaryEligible(brief)) return false;
  if (process.env.KEYSTONE_MEASURING_SUPPORT) return true;
  const ranges = mainFloorPrimaryRanges(brief);
  return ranges ? inAreaRanges(ranges, Number(brief.totalAreaSqFt)) : mainFloorPrimaryUnmeasured(brief);
}

// Why a main-floor suite is refused: the size (with the closets asked for, or
// with standard closets instead of a walk-in), or the combination itself.
function mainFloorPrimaryReason(brief) {
  if (!mainFloorPrimaryEligible(brief)) return 'two_story_primary_level_not_supported';
  const area = Number(brief.totalAreaSqFt);
  const ranges = mainFloorPrimaryRanges(brief);
  const text = (list) => list.map(([a, b]) => `${a}-${b}`).join('_');
  if (closetKind(brief?.raw?.bedroomConfigs) === 'walk-in') {
    const standard = mainFloorPrimaryRanges(brief, 'standard');
    const standardFits = standard ? inAreaRanges(standard, area) : mainFloorPrimaryUnmeasured({ ...brief, raw: { ...brief.raw, bedroomConfigs: null } });
    if (standardFits) return `closet_area_ranges_${ranges ? text(ranges) || 'none' : '3200-5000'}`;
  }
  return ranges?.length ? `measured_area_ranges_${text(ranges)}` : 'two_story_primary_level_not_supported';
}

function resolveArchitectV2Support(brief) {
  const reasons = [];
  const area = num(brief?.totalAreaSqFt, 0);
  const stories = Math.max(1, num(brief?.stories, 1));
  const bedrooms = Math.max(1, num(brief?.bedrooms, 1));
  const bathrooms = declaredBathroomCount(brief);
  const shape = String(brief?.shape || '').toUpperCase();
  const lotContext = String(brief?.lotContext || '').toUpperCase();
  const garageType = String(brief?.garageType || 'NONE').toUpperCase();
  const requestedFeatures = featureCount(brief);
  const rawFeatureTextRequested = hasRawFeatureRequestText(brief);
  const featureTypes = canonicalFeatureList(brief);
  // A cottage: one storey, no garage, one bedroom, or two under 1,200 sq ft,
  // no special rooms (oneStoryCottage). It starts at 600 sq ft.
  const cottage = stories === 1 && garageType === 'NONE' && (bedrooms === 1 || (bedrooms === 2 && area < 1200)) &&
    bathrooms <= bedrooms + 1 && requestedFeatures === 0 && !hasRawFeatureRequestText(brief);
  const MIN_V2_AREA = cottage ? 600 : 1000;
  const primaryLevel = Math.max(1, num(brief?.primaryLevel, stories === 1 ? 1 : 2));

  const singleSupportedFeatureRequest =
    requestedFeatures === 1 &&
    featureTypes.length === 1 &&
    ALLOWED_FEATURE_TYPES.includes(featureTypes[0]);
  const studyGymComboRequest =
    requestedFeatures === 2 &&
    featureTypes.length === 2 &&
    featureTypes.includes('study') &&
    featureTypes.includes('gym');
  const libraryGymComboRequest =
    requestedFeatures === 2 &&
    featureTypes.length === 2 &&
    featureTypes.includes('library') &&
    featureTypes.includes('gym');
  const studyGymComboSupported =
    studyGymComboRequest &&
    stories === 2 &&
    ((bedrooms === 3 && bathrooms === 3 && area >= 3000) ||
      (bedrooms === 4 && bathrooms === 4 && area >= 3200 && brief.hasGarage)) &&
    primaryLevel === 2;
  const libraryGymComboSupported =
    libraryGymComboRequest &&
    stories === 2 &&
    bedrooms === 3 &&
    bathrooms === 3 &&
    area >= 3200 &&
    primaryLevel === 2;
  const hasRequestedFeatures = requestedFeatures > 0;
  const socialRoomPairSupported = supportsSocialFeaturePair({ featureTypes, featureCount: requestedFeatures,
    stories, bedrooms, bathrooms, primaryLevel, garageType, shape, area });
  const quietRoomPairSupported = requestedFeatures === 2 &&
    featureTypes.every(type => ALLOWED_FEATURE_TYPES.includes(type)) &&
    featureTypes.some(type => ['study','library','guest_bedroom'].includes(type)) &&
    !studyGymComboRequest && !libraryGymComboRequest &&
    stories === 2 && bedrooms === 3 && bathrooms === 3 && primaryLevel === 2 && area >= 2600;
  const hasUnrecognizedFeatureText = rawFeatureTextRequested && !hasRequestedFeatures;
  const hasAnyFeatureRequest = hasRequestedFeatures || hasUnrecognizedFeatureText;

  // Keep backward-compatible alias for existing logic that references studyOnlyFeatureRequest
  const studyOnlyFeatureRequest = singleSupportedFeatureRequest;
  const rawFrontFacing = normalizeText(brief?.frontFacing || 'south');
  const validFacing = new Set(['north', 'south', 'east', 'west']);
  const rawPrivateBaths = normalizeText(brief?.raw?.privateBaths || '');
  const requestedPrivateBaths = brief.privateBathCount ?? (rawPrivateBaths ? Math.max(0, num(rawPrivateBaths.replace(/[^\d]/g, ''), 0)) : 1);
  // Measured, not assumed: a primary with no ensuite lays out on one storey
  // with or without a garage. It fails on two storeys, and it fails when a
  // secondary bedroom still wants its own ensuite. Garage and feature-room
  // briefs deliver, and feature rooms already have their own support gate.
  // (Home types in the measured table replace this with their measured ranges.)
  if (brief.primaryEnsuiteRequested === false && (stories !== 1 || requestedPrivateBaths > 0)) {
    reasons.push('primary_without_ensuite_topology_not_supported');
  }
  const fourBathFamily = stories === 2 && bedrooms === 4 && bathrooms === 4 &&
    requestedPrivateBaths === 2 && area >= 2800 &&
    (!hasAnyFeatureRequest || (singleSupportedFeatureRequest && featureTypes[0] === 'study' && area >= 3000 && brief.hasGarage) || studyGymComboSupported);

  if (area < MIN_V2_AREA) reasons.push('area_too_small_for_v2');
  if (stories < 1 || stories > 2) reasons.push('stories_out_of_range');
  if ((bedrooms < 2 && !cottage) || bedrooms > 5) reasons.push('bedrooms_out_of_range');
  if (bathrooms < 2 || (bathrooms > 3 && !fourBathFamily)) reasons.push('bathrooms_out_of_range');
  if (stories === 1 && bedrooms > 5) reasons.push('one_story_bedroom_count_not_supported');
  if (!SUPPORTED_SHAPES.has(shape)) reasons.push('shape_not_supported');
  // Outdoor structures sit outside the house (outdoorLiving.js); they need no
  // gate of their own.
  if (!SUPPORTED_LOT_CONTEXTS.has(lotContext)) reasons.push('lot_context_not_supported');
  if (!(garageType === 'NONE' || garageType === 'ONE_CAR' || garageType === 'TWO_CAR')) reasons.push('garage_type_not_supported');
  if (hasUnrecognizedFeatureText) {
    reasons.push('feature_type_not_supported');
  } else if (hasRequestedFeatures && !singleSupportedFeatureRequest && !studyGymComboSupported && !libraryGymComboSupported && !quietRoomPairSupported && !socialRoomPairSupported) {
    if (studyGymComboRequest) reasons.push('study_gym_combo_out_of_scope');
    else if (libraryGymComboRequest) reasons.push('library_gym_combo_out_of_scope');
    else
    if (requestedFeatures > 1) reasons.push('multiple_feature_rooms_not_supported');
    else if (featureTypes.length === 1 && !ALLOWED_FEATURE_TYPES.includes(featureTypes[0])) {
      reasons.push('feature_type_not_supported');
    } else {
      reasons.push('feature_rooms_not_supported');
    }
  }
  if (singleSupportedFeatureRequest) {
    const featureType = featureTypes[0];
    const minArea = Number(FEATURE_MIN_AREA[featureType] || 0);
    if (minArea > 0 && area < minArea) {
      reasons.push(`${featureType}_requires_min_${minArea}_sqft`);
    }
  }
  if (stories === 2 && garageType !== 'NONE' && area < 1800) {
    reasons.push('two_story_garage_requires_min_1800_sqft');
  }
  if (stories === 2 && garageType === 'NONE' && bedrooms >= 3 && area < 1800) {
    reasons.push('two_story_compact_three_bed_requires_min_1800_sqft');
  }
  if (stories === 2 && garageType === 'NONE' && bedrooms === 2 && area < 1500) {
    reasons.push('two_story_compact_two_bed_requires_min_1500_sqft');
  }
  if (stories === 1 && garageType !== 'NONE' && area < 1500) {
    reasons.push('one_story_garage_requires_min_1500_sqft');
  }
  if (stories === 1 && bedrooms === 4 && area < (brief.hasGarage ? 2200 : 1800)) {
    reasons.push(`one_story_four_bed_requires_min_${brief.hasGarage ? 2200 : 1800}_sqft`);
  }
  if (stories === 1 && bedrooms === 5 && area < (brief.hasGarage ? 2800 : 2400)) {
    reasons.push(`one_story_five_bed_requires_min_${brief.hasGarage ? 2800 : 2400}_sqft`);
  }
  if (stories === 1 && garageType !== 'NONE' && hasRequestedFeatures) {
    reasons.push('one_story_garage_feature_rooms_not_supported');
  }
  if (stories === 1 && bedrooms >= 4 && hasRequestedFeatures) {
    reasons.push('one_story_large_feature_rooms_not_supported');
  }
  if (!validFacing.has(rawFrontFacing)) reasons.push('front_facing_not_supported');
  if (
    requestedPrivateBaths > 1 &&
    !(stories === 2 && bedrooms === 3 && bathrooms >= 3 && requestedPrivateBaths <= 2) && !fourBathFamily
  ) {
    reasons.push('private_bath_count_not_supported');
  }

  if (stories === 1 && !brief.hasGarage && bedrooms <= 3 && (bedrooms === 3 || bathrooms > 2) && area < 1200) {
    reasons.push('one_story_public_spine_requires_min_1200_sqft');
  }
  if (stories === 2 && primaryLevel !== 2 && !supportsMainFloorPrimary(brief)) {
    reasons.push(mainFloorPrimaryReason(brief));
  }

  if (stories === 2 && bedrooms > 5) {
    reasons.push('two_story_bedroom_count_not_supported');
  }
  if (stories === 2 && bedrooms === 5 && area < 3000) reasons.push('two_story_five_bed_requires_min_3000_sqft');
  if (stories === 2 && bedrooms === 5 && hasAnyFeatureRequest) reasons.push('five_bed_feature_rooms_not_supported');
  if (stories === 2 && bedrooms === 4 && area < 2400) {
    reasons.push('two_story_four_bed_requires_min_2400_sqft');
  }

  const measuredQuery = { stories, bedrooms, bathrooms, garageType, primaryLevel, attached: requestedPrivateBaths,
    features: hasAnyFeatureRequest, primaryEnsuite: brief.primaryEnsuiteRequested,
    closets: closetKind(brief?.raw?.bedroomConfigs) };
  const measured = measuredRanges(measuredQuery);
  if (measured) {
    const kept = reasons.filter((code) => !MEASURED_GATES.has(code));
    reasons.splice(0, reasons.length, ...kept);
    const inRange = (ranges) => ranges.some(([from, to]) => area >= from && area <= to);
    if (!inRange(measured)) {
      const ranges = measured.map(([a, b]) => `${a}-${b}`).join('_');
      // Where the same home delivers with standard closets, say so: the
      // walk-in is what does not fit.
      const standard = measuredQuery.closets === 'walk-in' ? measuredRanges({ ...measuredQuery, closets: 'standard' }) : null;
      if (standard && inRange(standard)) reasons.push(`closet_area_ranges_${ranges || 'none'}`);
      else reasons.push(measured.length ? `measured_area_ranges_${ranges}` : 'home_type_not_available');
    }
  }
  // The main-floor suite's measured ranges (mainFloorPrimaryReason above)
  // replace the hand-set size and count gates for it too.
  if (stories === 2 && primaryLevel !== 2 && mainFloorPrimaryEligible(brief) &&
    (mainFloorPrimaryRanges(brief) || process.env.KEYSTONE_MEASURING_SUPPORT)) {
    const kept = reasons.filter((code) => !MEASURED_GATES.has(code));
    reasons.splice(0, reasons.length, ...kept);
  }
  const housePattern = reasons.length ? null : resolveHousePattern(brief);
  if (!housePattern) {
    if (stories === 2) reasons.push('house_pattern_not_supported');
  }

  const supported = reasons.length === 0;

  // Phase 2.2: enrich with family classification (non-breaking addition)
  let familyId = null;
  let familyCluster = null;
  try {
    const intent = compileSurveyIntent(brief);
    const classification = classifyInputFamily(intent);
    familyId = classification.familyId;
    familyCluster = classification.familyCluster;
  } catch (_) {
    // Classification is advisory — never block on it
  }

  return {
    supported,
    generatorId: supported ? 'architect_v2' : 'legacy',
    supportTier: supported ? 'wave1' : (hasAnyFeatureRequest ? 'legacy_only' : 'unsupported'),
    housePattern,
    reasons,
    familyId,
    familyCluster,
  };
}

module.exports = {
  resolveArchitectV2Support,
  resolveHousePattern,
};
