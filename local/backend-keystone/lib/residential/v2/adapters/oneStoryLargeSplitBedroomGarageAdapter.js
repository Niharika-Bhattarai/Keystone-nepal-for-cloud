'use strict';

const { oneStoryLargeSplitBedroomWithGarage } = require('../patterns/oneStoryLargeSplitBedroom');
const { oneStorySplitRanch } = require('../patterns/oneStorySplitRanch');

// Four bedrooms with a garage: the split-bedroom ranch where its three
// columns fit (three secondary bedrooms and a hall bath in its wing), else
// the large split-bedroom family.
function assembleLayout({ brief, interpretation, footprint, program }) {
  try {
    return oneStorySplitRanch({ brief, interpretation, footprint, program });
  } catch (_) { /* falls through */ }
  return oneStoryLargeSplitBedroomWithGarage({ brief, interpretation, footprint, program });
}

module.exports = { assembleLayout };
