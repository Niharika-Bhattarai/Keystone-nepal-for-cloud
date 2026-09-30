'use strict';

const { STAGE_ORDER, NODE_TYPE_METADATA } = require('../graph/graphNodeTypes');

const KNOWN_ROLES = Object.freeze(Object.keys(NODE_TYPE_METADATA));

const KNOWN_STAGES = Object.freeze([...STAGE_ORDER]);

const KNOWN_PRIVACY_LEVELS = Object.freeze([
  'public', 'semi_public', 'circulation', 'private', 'semi_private', 'utility',
]);

const REQUIRED_NODE_FIELDS = Object.freeze({
  key:                     'string',
  role:                    'string',
  type:                    'string',
  level:                   'number',
  roomId:                  'string',
  targetAreaSqFt:          'number',
  requiredAdjacencies:     'array',
  forbiddenAdjacencies:    'array',
  bufferRequirements:      'array',
  stage:                   'string',
  privacyDepth:            'number',
  privacyLevel:            'string',
  exteriorEdgesRequired:   'number',
  sunAffinity:             'array',
  terminal:                'boolean',
});

// Fields that may be null
const NULLABLE_FIELDS = Object.freeze([
  'preferredSide', 'resolvedPreferredSide', 'requestedFeatureKind', 'roomContract',
]);

function validate(graph) {
  const violations = [];

  // Top-level shape
  if (!graph || typeof graph !== 'object') {
    return { valid: false, violations: ['graph must be a non-null object'] };
  }
  if (typeof graph.housePattern !== 'string' || graph.housePattern.length === 0) {
    violations.push('housePattern must be a non-empty string');
  }
  if (!Array.isArray(graph.nodes) || graph.nodes.length === 0) {
    violations.push('nodes must be a non-empty array');
  }
  if (!Array.isArray(graph.edges)) {
    violations.push('edges must be an array');
  }

  // Bail early if nodes are structurally broken
  if (!Array.isArray(graph.nodes)) {
    return { valid: false, violations };
  }

  // Node-level checks
  const seenKeys = new Set();
  for (let i = 0; i < graph.nodes.length; i++) {
    const node = graph.nodes[i];
    const prefix = `nodes[${i}]`;

    if (!node || typeof node !== 'object') {
      violations.push(`${prefix}: must be a non-null object`);
      continue;
    }

    // Required fields and type checks
    for (const [field, expectedType] of Object.entries(REQUIRED_NODE_FIELDS)) {
      if (!(field in node)) {
        violations.push(`${prefix}: missing required field '${field}'`);
        continue;
      }
      const val = node[field];
      if (expectedType === 'array') {
        if (!Array.isArray(val)) {
          violations.push(`${prefix}.${field}: expected array, got ${typeof val}`);
        }
      } else if (typeof val !== expectedType) {
        violations.push(`${prefix}.${field}: expected ${expectedType}, got ${typeof val}`);
      }
    }

    // Key uniqueness
    if (typeof node.key === 'string') {
      if (seenKeys.has(node.key)) {
        violations.push(`${prefix}: duplicate key '${node.key}'`);
      }
      seenKeys.add(node.key);
    }

    // Role membership
    if (typeof node.role === 'string' && !KNOWN_ROLES.includes(node.role)) {
      violations.push(`${prefix}: unknown role '${node.role}'`);
    }

    // Stage membership
    if (typeof node.stage === 'string' && !KNOWN_STAGES.includes(node.stage)) {
      violations.push(`${prefix}: unknown stage '${node.stage}'`);
    }

    // Privacy level membership
    if (typeof node.privacyLevel === 'string' && !KNOWN_PRIVACY_LEVELS.includes(node.privacyLevel)) {
      violations.push(`${prefix}: unknown privacyLevel '${node.privacyLevel}'`);
    }

    // Level must be 1 or 2
    if (typeof node.level === 'number' && node.level !== 1 && node.level !== 2) {
      violations.push(`${prefix}: level must be 1 or 2, got ${node.level}`);
    }

    // targetAreaSqFt must be positive
    if (typeof node.targetAreaSqFt === 'number' && node.targetAreaSqFt <= 0) {
      violations.push(`${prefix}: targetAreaSqFt must be positive, got ${node.targetAreaSqFt}`);
    }

    // privacyDepth must be non-negative
    if (typeof node.privacyDepth === 'number' && node.privacyDepth < 0) {
      violations.push(`${prefix}: privacyDepth must be non-negative`);
    }

    // exteriorEdgesRequired must be non-negative
    if (typeof node.exteriorEdgesRequired === 'number' && node.exteriorEdgesRequired < 0) {
      violations.push(`${prefix}: exteriorEdgesRequired must be non-negative`);
    }
  }

  // Edge-level checks
  if (Array.isArray(graph.edges)) {
    for (let i = 0; i < graph.edges.length; i++) {
      const edge = graph.edges[i];
      const prefix = `edges[${i}]`;

      if (!edge || typeof edge !== 'object') {
        violations.push(`${prefix}: must be a non-null object`);
        continue;
      }
      if (typeof edge.from !== 'string') {
        violations.push(`${prefix}: 'from' must be a string`);
      }
      if (typeof edge.to !== 'string') {
        violations.push(`${prefix}: 'to' must be a string`);
      }
      if (typeof edge.kind !== 'string') {
        violations.push(`${prefix}: 'kind' must be a string`);
      }
      // Referential integrity
      if (typeof edge.from === 'string' && !seenKeys.has(edge.from)) {
        violations.push(`${prefix}: 'from' references unknown node key '${edge.from}'`);
      }
      if (typeof edge.to === 'string' && !seenKeys.has(edge.to)) {
        violations.push(`${prefix}: 'to' references unknown node key '${edge.to}'`);
      }
    }
  }

  return { valid: violations.length === 0, violations };
}

module.exports = { validate, KNOWN_ROLES, KNOWN_STAGES, KNOWN_PRIVACY_LEVELS };
