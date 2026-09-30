'use strict';

/**
 * Derives an envelope class string from shape and story count.
 */
function deriveEnvelopeClass(shape, stories) {
  switch (shape) {
    case 'L_SHAPE': return 'l_wing';
    case 'T_SHAPE': return 't_wing';
    case 'WIDE':   return 'wide_rectangle';
    case 'DEEP':   return 'deep_rectangle';
    case 'SQUARE': return 'square_block';
    default:       return 'compact_rectangle';  // RECTANGULAR or fallback
  }
}

/**
 * Derives sun-affinity zones from the front-facing direction.
 * The idea: regardless of which way the front faces, we want to know
 * which building sides get the most sun exposure for living spaces.
 */
function deriveSunAffinityZones(frontFacing) {
  switch (frontFacing) {
    case 'North': return ['south', 'east'];
    case 'East':  return ['east', 'south'];
    case 'West':  return ['west', 'south'];
    case 'South':
    default:      return ['south', 'west'];
  }
}

/**
 * Maps budget tier to a room-size ambition label.
 */
function deriveRoomSizeAmbition(budgetTier) {
  switch (budgetTier) {
    case 'ENTRY':  return 'compact';
    case 'LUXURY': return 'generous';
    case 'MID':
    default:       return 'standard';
  }
}

/**
 * Maps a feature count to a complexity label.
 */
function deriveFeatureComplexity(count) {
  if (count === 0) return 'none';
  if (count === 1) return 'single';
  if (count === 2) return 'dual';
  return 'complex';
}

/**
 * compileSurveyIntent — pure, deterministic transform from a normalized
 * brief into a structured intent object consumed by downstream v2 modules.
 *
 * @param {object} brief - Output of normalizeBrief()
 * @returns {object} structured intent with 10 sub-objects
 */
function compileSurveyIntent(brief) {
  const privateBathCount = brief.privateBathsRequested;
  const sharedBathCount = privateBathCount != null
    ? Math.max(0, brief.bathrooms - privateBathCount - Number(brief.primaryEnsuiteRequested !== false))
    : null;

  const features = brief.requestedFeatureItems || [];
  const featureTypes = [...new Set(features.map(f => f.canonicalType))];

  return {
    massingIntent: {
      stories:          brief.stories,
      shape:            brief.shape,
      targetArea:       brief.totalAreaSqFt,
      conditionedArea:  brief.conditionedAreaSqFt,
      garagePresence:   brief.hasGarage,
      garageType:       brief.garageType,
      envelopeClass:    deriveEnvelopeClass(brief.shape, brief.stories),
      lotContext:        brief.lotContext,
      lotWidth:         brief.lotWidth,
      lotDepth:         brief.lotDepth,
    },

    topologyIntent: {
      primaryLevel:     brief.primaryLevel,
      circulationType:  brief.stories >= 2 ? 'stair_landing' : 'corridor_or_open',
      stairRequired:    brief.stories >= 2,
      primaryOnMain:    brief.primaryOnMain,
    },

    privacyIntent: {
      gradient:           brief.stories >= 2 ? 'public_down_private_up' : 'front_public_back_private',
      bedrooms:           brief.bedrooms,
      bathrooms:          brief.bathrooms,
      privateBathCount:   privateBathCount,
      sharedBathCount:    sharedBathCount,
      bedroomIsolation:   brief.bedrooms >= 4 ? 'wing_separation' : 'corridor_access',
      bedroomClosets:     brief.bedroomClosets,
      bedroomProgram:    brief.bedroomProgram || null,
      primaryEnsuite:    brief.primaryEnsuiteRequested !== false,
    },

    daylightIntent: {
      lightPriority:      brief.naturalLight,
      frontFacing:        brief.frontFacing,
      sunAffinityZones:   deriveSunAffinityZones(brief.frontFacing),
      location:           brief.location,
    },

    openingIntent: {
      openConcept:        brief.openConcept,
      indoorOutdoor:      brief.indoorOutdoor,
      kitchenPlacement:   brief.kitchenRear ? 'rear_anchor' : 'central_anchor',
    },

    serviceIntent: {
      garageType:         brief.garageType,
      laundryLevel:       brief.laundryLevel,
      mudroomRequired:    brief.hasGarage,
    },

    materialIntent: {
      materials:          brief.materials,
      ceilingHeight:      brief.ceilingHeight,
      ceilingAreaScale:   brief.ceilingAreaScale,
    },

    budgetIntent: {
      tier:               brief.budgetTier,
      roomSizeAmbition:   deriveRoomSizeAmbition(brief.budgetTier),
    },

    accessibilityIntent: {
      wheelchair:         Boolean(brief.accessibility?.wheelchair),
      wideDoors:          Boolean(brief.accessibility?.wideDoors),
      forceSingleStory:   false,
      preferSingleStory:  Boolean(brief.accessibility?.singleLevel),
    },

    featureIntent: {
      requestedFeatures:  features,
      featureCount:       features.length,
      featureComplexity:  deriveFeatureComplexity(features.length),
      featureTypes:       featureTypes,
    },
  };
}

module.exports = { compileSurveyIntent };
