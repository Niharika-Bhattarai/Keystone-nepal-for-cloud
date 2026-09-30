'use strict';

const VARIATION_PROFILES = Object.freeze([
  {
    id: 'variant_a_compact_core',
    label: 'Compact Core',
    theme: 'balanced_compact',
    functionalId: 'front_core_compact',
    functionalLabel: 'Front Core — Compact',
    functionalDescription: 'Stair/circulation anchored near front-entry service zone. Compact central public core.',
    twoStory: {
      targetAspect: 1.48,
      widthScale: 1.0,
      depthOffsets: [-2, 0, 2],
      widthOffsets: [-6, -4, -2, 0, 2, 4, 6],
      upperCore: {
        leftWingWidth: 14,
        landingDepth: 6,
        landingWidth: 10,
        stairRunBias: 0,
      },
      lowerFloor: {
        stairAnchor: 'center',
        publicZoneBias: 'front',
        serviceEntryRelation: 'center_service',
        garageStairProximity: 'adjacent',
      },
    },
  },
  {
    id: 'variant_b_daylight_wing',
    label: 'Daylight Wing',
    theme: 'wider_public_edge',
    functionalId: 'side_spine_daylight',
    functionalLabel: 'Side Spine — Daylight',
    functionalDescription: 'Circulation runs as controlled side spine with daylight-oriented public zone.',
    twoStory: {
      targetAspect: 1.68,
      widthScale: 1.12,
      depthOffsets: [-4, -2, 0],
      widthOffsets: [-6, -4, -2, 0, 2, 4, 6, 8],
      upperCore: {
        leftWingWidth: 12,
        landingDepth: 8,
        landingWidth: 12,
        stairRunBias: -1,
      },
      lowerFloor: {
        stairAnchor: 'side_east',
        publicZoneBias: 'east_daylight',
        serviceEntryRelation: 'side_spine',
        garageStairProximity: 'separated',
      },
    },
  },
  {
    id: 'variant_c_service_spine',
    label: 'Service Spine',
    theme: 'deeper_private_edge',
    functionalId: 'rear_service_pivot',
    functionalLabel: 'Rear Service — Pivot',
    functionalDescription: 'Service/garage transition and stair pivot rearward. Public core pulled away from front-core default.',
    twoStory: {
      targetAspect: 1.3,
      widthScale: 0.9,
      depthOffsets: [0, 2, 4],
      widthOffsets: [-8, -6, -4, -2, 0, 2, 4, 6],
      upperCore: {
        leftWingWidth: 16,
        landingDepth: 6,
        landingWidth: 10,
        stairRunBias: 1,
      },
      lowerFloor: {
        stairAnchor: 'rear',
        publicZoneBias: 'front_away_from_service',
        serviceEntryRelation: 'rear_pivot',
        garageStairProximity: 'tight_rear',
      },
    },
  },
]);

function listVariationProfiles(brief, interpretation) {
  // Delegate to variationPlannerV2 for 3-profile selection across all families
  const { planVariations } = require('./variationPlannerV2');
  return planVariations(brief, interpretation);
}

module.exports = {
  VARIATION_PROFILES,
  listVariationProfiles,
};

