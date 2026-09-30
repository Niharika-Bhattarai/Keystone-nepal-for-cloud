'use strict';

/**
 * Variation Planner V2
 *
 * Deterministic 3-profile selection for ALL families, including one-story.
 * Two-story reuses the existing 3 profiles for backward compatibility.
 * One-story gets 3 new profiles with distinct aspect ratios and room
 * arrangement strategies.
 */

const { VARIATION_PROFILES } = require('./variationProfiles');

const ONE_STORY_PROFILES = Object.freeze([
  {
    id: 'variant_d_wide_front_living',
    label: 'Wide Front Living',
    theme: 'public_front_emphasis',
    oneStory: {
      targetAspect: 1.6,
      widthScale: 1.1,
      depthOffsets: [-4, -2, 0],
      widthOffsets: [-6, -4, -2, 0, 2, 4, 6],
      publicZoneRatio: 0.45,
      wingStyle: 'front_public_rear_private',
      servicePosition: 'side',
    },
  },
  {
    id: 'variant_e_deep_garden_spine',
    label: 'Deep Garden Spine',
    theme: 'garden_oriented_depth',
    oneStory: {
      targetAspect: 1.1,
      widthScale: 0.88,
      depthOffsets: [0, 2, 4],
      widthOffsets: [-8, -6, -4, -2, 0, 2, 4],
      publicZoneRatio: 0.40,
      wingStyle: 'central_spine_side_wings',
      servicePosition: 'rear',
    },
  },
  {
    id: 'variant_f_central_hub',
    label: 'Central Hub',
    theme: 'symmetric_central_core',
    oneStory: {
      targetAspect: 1.35,
      widthScale: 1.0,
      depthOffsets: [-2, 0, 2],
      widthOffsets: [-6, -4, -2, 0, 2, 4, 6],
      publicZoneRatio: 0.42,
      wingStyle: 'central_hub_symmetric_wings',
      servicePosition: 'center_rear',
    },
  },
]);

/**
 * Returns 3 variation profiles for any brief.
 * Two-story: existing VARIATION_PROFILES (variant_a, _b, _c).
 * One-story: ONE_STORY_PROFILES (variant_d, _e, _f).
 */
function planVariations(brief, interpretation) {
  const stories = Number(brief?.stories || interpretation?.stories || 1);

  if (stories >= 2) {
    return [...VARIATION_PROFILES];
  }

  return [...ONE_STORY_PROFILES];
}

module.exports = {
  ONE_STORY_PROFILES,
  planVariations,
};
