'use strict';

const { oneStoryLargeSplitBedroomCompact } = require('../patterns/oneStoryLargeSplitBedroom');

function assembleLayout({ brief, interpretation, footprint, program }) {
  return oneStoryLargeSplitBedroomCompact({ brief, interpretation, footprint, program });
}

module.exports = { assembleLayout };
