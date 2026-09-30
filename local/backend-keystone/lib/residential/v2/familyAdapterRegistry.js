'use strict';

const twoStoryGarageAdapter = require('./adapters/twoStoryGarageAdapter');
const twoStoryCompactAdapter = require('./adapters/twoStoryCompactAdapter');
const oneStoryCentralCoreAdapter = require('./adapters/oneStoryCentralCoreAdapter');
const oneStorySplitBedroomAdapter = require('./adapters/oneStorySplitBedroomAdapter');
const oneStoryCentralCoreGarageAdapter = require('./adapters/oneStoryCentralCoreGarageAdapter');
const oneStorySplitBedroomGarageAdapter = require('./adapters/oneStorySplitBedroomGarageAdapter');
const oneStoryLargeSplitBedroomAdapter = require('./adapters/oneStoryLargeSplitBedroomAdapter');
const oneStoryLargeSplitBedroomGarageAdapter = require('./adapters/oneStoryLargeSplitBedroomGarageAdapter');

/**
 * Maps housePattern strings to adapter modules.
 * Each adapter exports assembleLayout({ brief, interpretation, footprint, program, graph }).
 *
 * New families (Phase 4.2+) register here by adding their pattern → adapter mapping.
 */
const PATTERN_ADAPTER_MAP = {
  two_story_main_primary_with_garage_three_bed: require('./patterns/twoStoryMainPrimary'),
  // Two, four and five bedrooms with the primary suite on the main floor.
  two_story_main_primary_with_garage: require('./patterns/twoStoryMainPrimary'),
  // Two-story with garage variants
  two_story_upper_primary_with_garage: twoStoryGarageAdapter,
  two_story_upper_primary_with_garage_three_bed: twoStoryGarageAdapter,
  two_story_upper_primary_with_garage_four_bed: twoStoryGarageAdapter,
  two_story_upper_primary_with_garage_study: twoStoryGarageAdapter,

  // Two-story compact (no garage) variants
  two_story_upper_primary_compact: twoStoryCompactAdapter,
  two_story_upper_primary_three_bed_compact: twoStoryCompactAdapter,
  two_story_upper_primary_four_bed_compact: twoStoryCompactAdapter,

  // One-story variants
  one_story_central_core_compact: oneStoryCentralCoreAdapter,
  one_story_split_bedroom_compact: oneStorySplitBedroomAdapter,
  one_story_large_split_bedroom_compact: oneStoryLargeSplitBedroomAdapter,
  one_story_central_core_with_garage: oneStoryCentralCoreGarageAdapter,
  one_story_split_bedroom_with_garage: oneStorySplitBedroomGarageAdapter,
  one_story_large_split_bedroom_with_garage: oneStoryLargeSplitBedroomGarageAdapter,
};

/**
 * Returns the adapter for a given housePattern, or null if no adapter is registered.
 */
function getAdapter(housePattern) {
  return PATTERN_ADAPTER_MAP[housePattern] || null;
}

/**
 * Returns the list of all registered pattern names.
 */
function listRegisteredPatterns() {
  return Object.keys(PATTERN_ADAPTER_MAP);
}

module.exports = { getAdapter, listRegisteredPatterns, PATTERN_ADAPTER_MAP };
