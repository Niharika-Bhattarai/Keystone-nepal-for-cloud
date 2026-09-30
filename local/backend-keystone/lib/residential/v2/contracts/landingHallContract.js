'use strict';

/**
 * Validates landing/hallway topology for v2 graphs:
 * - Multi-story graphs must have stair_core and landing nodes
 * - Landing must be adjacent to stair_core
 * - Landing must be adjacent to at least one private room
 * - Stair_core must be adjacent to common_area or lower_landing
 * - No landing/hallway can be terminal (dead-end with only one edge)
 */

const PRIVATE_ROLES = Object.freeze([
  'primary_suite', 'secondary_bedroom', 'special_room', 'library', 'gym', 'study',
]);

function validate(graph) {
  const violations = [];

  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    return { valid: false, violations: ['graph must have nodes and edges arrays'] };
  }

  // Determine story count from node levels
  const levels = new Set(graph.nodes.map((n) => n.level));
  const isMultiStory = levels.size > 1;

  if (!isMultiStory) {
    // Single-story: no landing/stair rules apply
    return { valid: true, violations: [] };
  }

  // Build adjacency map
  const adjacencyMap = new Map();
  for (const node of graph.nodes) {
    adjacencyMap.set(node.key, new Set());
  }
  for (const edge of graph.edges) {
    if (adjacencyMap.has(edge.from)) adjacencyMap.get(edge.from).add(edge.to);
    if (adjacencyMap.has(edge.to)) adjacencyMap.get(edge.to).add(edge.from);
  }

  const nodeByKey = new Map();
  for (const node of graph.nodes) {
    nodeByKey.set(node.key, node);
  }

  const stairCores = graph.nodes.filter((n) => n.role === 'stair_core');
  const landings = graph.nodes.filter((n) => n.role === 'landing');

  // Must have at least one stair_core
  if (stairCores.length === 0) {
    violations.push('multi-story graph must have at least one stair_core node');
  }

  // Must have at least one landing
  if (landings.length === 0) {
    violations.push('multi-story graph must have at least one landing node');
  }

  // Landing must be adjacent to stair_core
  for (const landing of landings) {
    const neighbors = adjacencyMap.get(landing.key) || new Set();
    const adjToStair = [...neighbors].some((nk) => {
      const n = nodeByKey.get(nk);
      return n && n.role === 'stair_core';
    });
    if (!adjToStair) {
      violations.push(`landing '${landing.key}' must be adjacent to a stair_core`);
    }

    // Landing must be adjacent to at least one private room
    const adjToPrivate = [...neighbors].some((nk) => {
      const n = nodeByKey.get(nk);
      return n && PRIVATE_ROLES.includes(n.role);
    });
    if (!adjToPrivate) {
      violations.push(`landing '${landing.key}' must be adjacent to at least one private room`);
    }
  }

  // Stair_core must be adjacent to common_area or lower_landing
  for (const stair of stairCores) {
    const neighbors = adjacencyMap.get(stair.key) || new Set();
    const adjToCommonOrLower = [...neighbors].some((nk) => {
      const n = nodeByKey.get(nk);
      return n && (n.role === 'common_area' || n.role === 'lower_landing');
    });
    if (!adjToCommonOrLower) {
      violations.push(
        `stair_core '${stair.key}' must be adjacent to common_area or lower_landing`
      );
    }
  }

  // No landing can be terminal (degree <= 1)
  for (const landing of landings) {
    const neighbors = adjacencyMap.get(landing.key) || new Set();
    if (neighbors.size <= 1) {
      violations.push(`landing '${landing.key}' is terminal (dead-end) with only ${neighbors.size} connection(s)`);
    }
  }

  return { valid: violations.length === 0, violations };
}

module.exports = { validate };
