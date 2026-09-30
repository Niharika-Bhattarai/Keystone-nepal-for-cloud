'use strict';

const { oneStoryPublicSpine } = require('../patterns/oneStoryPublicSpine');

/**
 * Adapter for one-story split bedroom compact pattern (3-bed).
 */
function assembleLayout({ brief, interpretation, footprint, program }) {
  return oneStoryPublicSpine({ brief, interpretation, footprint, program });
}

module.exports = { assembleLayout };
