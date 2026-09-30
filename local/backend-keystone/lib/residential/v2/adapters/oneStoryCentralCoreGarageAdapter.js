'use strict';
const { oneStoryGarageCore } = require('../patterns/oneStoryGarageCore');
const { oneStorySplitRanch } = require('../patterns/oneStorySplitRanch');

// The split-bedroom ranch first; where its three columns do not fit the
// footprint (or the program has rooms it has no position for), the compact
// garage core.
function assembleLayout({ brief, interpretation, footprint, program }) {
  try {
    return oneStorySplitRanch({ brief, interpretation, footprint, program });
  } catch (_) {
    return oneStoryGarageCore({ brief, interpretation, footprint, program });
  }
}

module.exports = { assembleLayout };
