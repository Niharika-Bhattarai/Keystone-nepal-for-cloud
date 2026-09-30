'use strict';

const { buildRealmGraphV2 } = require('../graph/graphBuilderV2');
const { buildAssemblyOrderV2 } = require('../assemblyOrderV2');
const { assembleOrthogonalPlanV2 } = require('../orthogonalAssembler');
const { twoStoryNorthTGarage } = require('../patterns/twoStoryNorthTGarage');

/**
 * Adapter for all two-story-with-garage house patterns.
 * Covers: two_story_upper_primary_with_garage, _three_bed, _study variants.
 */
function assembleLayout({ brief, interpretation, footprint, program, graph }) {
  const retainedTLayout = twoStoryNorthTGarage({ brief, footprint, program });
  if (retainedTLayout) return retainedTLayout;
  const resolvedGraph = graph || program?.graph || buildRealmGraphV2(brief, interpretation, program?.levels || []);
  const assemblyOrder = buildAssemblyOrderV2(resolvedGraph);
  return assembleOrthogonalPlanV2({
    brief,
    interpretation,
    footprint,
    program,
    graph: resolvedGraph,
    assemblyOrder,
  });
}

module.exports = { assembleLayout };
