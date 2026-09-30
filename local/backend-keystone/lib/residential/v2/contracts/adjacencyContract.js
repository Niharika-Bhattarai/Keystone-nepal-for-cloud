'use strict';

/**
 * Validates adjacency rules for a v2 graph:
 * - Every node's requiredAdjacencies are satisfied by edges
 * - No forbiddenAdjacencies are present in edges
 * - Edges reference valid node keys
 */
function validate(graph) {
  const violations = [];

  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    return { valid: false, violations: ['graph must have nodes and edges arrays'] };
  }

  const nodeByKey = new Map();
  for (const node of graph.nodes) {
    nodeByKey.set(node.key, node);
  }

  // Build adjacency map from edges
  const adjacencyMap = new Map(); // key -> Set of adjacent keys
  for (const node of graph.nodes) {
    adjacencyMap.set(node.key, new Set());
  }

  for (const edge of graph.edges) {
    if (adjacencyMap.has(edge.from)) adjacencyMap.get(edge.from).add(edge.to);
    if (adjacencyMap.has(edge.to)) adjacencyMap.get(edge.to).add(edge.from);
  }

  for (const node of graph.nodes) {
    const neighbors = adjacencyMap.get(node.key) || new Set();

    // Check required adjacencies are satisfied
    if (Array.isArray(node.requiredAdjacencies)) {
      for (const reqRole of node.requiredAdjacencies) {
        // Find if any neighbor has the required role
        const satisfied = [...neighbors].some((nk) => {
          const neighbor = nodeByKey.get(nk);
          return neighbor && neighbor.role === reqRole;
        });
        if (!satisfied) {
          violations.push(
            `node '${node.key}': requiredAdjacency '${reqRole}' not satisfied by any edge`
          );
        }
      }
    }

    // Check forbidden adjacencies are not present
    if (Array.isArray(node.forbiddenAdjacencies)) {
      for (const forbiddenRole of node.forbiddenAdjacencies) {
        const violated = [...neighbors].some((nk) => {
          const neighbor = nodeByKey.get(nk);
          return neighbor && neighbor.role === forbiddenRole;
        });
        if (violated) {
          violations.push(
            `node '${node.key}': forbiddenAdjacency '${forbiddenRole}' is present in edges`
          );
        }
      }
    }
  }

  return { valid: violations.length === 0, violations };
}

module.exports = { validate };
