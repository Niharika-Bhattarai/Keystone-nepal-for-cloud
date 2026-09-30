'use strict';

const { oneStoryCentralCoreCompact } = require('../patterns/oneStoryCentralCoreCompact');
const { oneStoryPublicSpine } = require('../patterns/oneStoryPublicSpine');
const { oneStoryCottage } = require('../patterns/oneStoryCottage');

/**
 * Adapter for one-story central core compact pattern (1-2 bed, no garage).
 * One bedroom, or two under 1,200 sq ft (1,500 with one bathroom): the two-column cottage (the central
 * core and the public spine need three 12 ft columns); a two-bedroom house
 * whose footprint the cottage cannot use falls through to the families below.
 */
function assembleLayout({ brief, interpretation, footprint, program }) {
  const bedrooms = Number(brief.bedrooms);
  const area = Number(brief.totalAreaSqFt);
  if (bedrooms === 1 || (bedrooms === 2 && (area < 1200 || (Number(brief.bathrooms) === 1 && area <= 1500)))) {
    try {
      return oneStoryCottage({ brief, interpretation, footprint, program });
    } catch (error) {
      if (bedrooms === 1) throw error;
    }
  }
  if (Number(brief.bathrooms) > 2 || Number(brief.totalAreaSqFt) >= 2800 || brief.primaryEnsuiteRequested === false) return oneStoryPublicSpine({ brief, interpretation, footprint, program });
  return oneStoryCentralCoreCompact({ brief, interpretation, footprint, program });
}

module.exports = { assembleLayout };
