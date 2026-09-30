'use strict';

const { buildRealmGraphV2 } = require('../graph/graphBuilderV2');
const { buildAssemblyOrderV2 } = require('../assemblyOrderV2');
const { assembleOrthogonalPlanV2 } = require('../orthogonalAssembler');

/**
 * Adapter for two-story compact (no garage) house patterns.
 * Covers: two_story_upper_primary_compact, _three_bed_compact variants.
 */
function assembleLayout({ brief, interpretation, footprint, program, graph }) {
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
