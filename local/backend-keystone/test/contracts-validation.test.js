'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const graphSchema = require('../lib/residential/v2/contracts/graphSchemaContract');
const adjacency = require('../lib/residential/v2/contracts/adjacencyContract');
const landingHall = require('../lib/residential/v2/contracts/landingHallContract');
const { validateProfile, validateProfileSet } = require('../lib/residential/v2/contracts/variationProfileContract');
const { VARIATION_PROFILES } = require('../lib/residential/v2/variationProfiles');

// ---------------------------------------------------------------------------
// Helpers — minimal valid graph fixtures
// ---------------------------------------------------------------------------

function makeNode(overrides) {
  return {
    key: 'node_' + Math.random().toString(36).slice(2, 8),
    role: 'common_area',
    type: 'living_room',
    level: 1,
    roomId: 'r_' + Math.random().toString(36).slice(2, 8),
    roomContract: null,
    targetAreaSqFt: 120,
    requiredAdjacencies: [],
    forbiddenAdjacencies: [],
    bufferRequirements: [],
    preferredSide: null,
    resolvedPreferredSide: null,
    requestedFeatureKind: null,
    stage: 'common_core',
    privacyDepth: 1,
    privacyLevel: 'semi_public',
    exteriorEdgesRequired: 1,
    sunAffinity: ['south'],
    terminal: false,
    ...overrides,
  };
}

function minimalTwoStoryGraph() {
  return {
    housePattern: 'two_story_upper_primary_compact',
    nodes: [
      makeNode({ key: 'entrance_room', role: 'entrance_room', type: 'entry', level: 1, stage: 'main_entrance', privacyDepth: 0, privacyLevel: 'public', requiredAdjacencies: ['common_area'] }),
      makeNode({ key: 'common_area', role: 'common_area', type: 'living_room', level: 1, stage: 'common_core', requiredAdjacencies: ['entrance_room', 'stair_core'] }),
      makeNode({ key: 'stair_core', role: 'stair_core', type: 'staircase', level: 1, stage: 'stair_core', privacyDepth: 2, privacyLevel: 'circulation', requiredAdjacencies: ['common_area', 'landing'] }),
      makeNode({ key: 'landing', role: 'landing', type: 'hallway', level: 2, stage: 'circulation_loop', privacyDepth: 2, privacyLevel: 'circulation', requiredAdjacencies: ['stair_core', 'primary_suite'] }),
      makeNode({ key: 'primary_suite', role: 'primary_suite', type: 'bedroom', level: 2, stage: 'private_extremities', privacyDepth: 4, privacyLevel: 'private', requiredAdjacencies: ['landing'], terminal: true }),
    ],
    edges: [
      { from: 'entrance_room', to: 'common_area', kind: 'required_adjacency' },
      { from: 'common_area', to: 'stair_core', kind: 'required_adjacency' },
      { from: 'stair_core', to: 'landing', kind: 'required_adjacency' },
      { from: 'landing', to: 'primary_suite', kind: 'required_adjacency' },
    ],
  };
}

// ---------------------------------------------------------------------------
// graphSchemaContract
// ---------------------------------------------------------------------------

describe('graphSchemaContract', () => {
  it('passes for a well-formed graph', () => {
    const graph = minimalTwoStoryGraph();
    const result = graphSchema.validate(graph);
    assert.equal(result.valid, true, `violations: ${result.violations.join('; ')}`);
    assert.equal(result.violations.length, 0);
  });

  it('fails when a node is missing the key field', () => {
    const graph = minimalTwoStoryGraph();
    delete graph.nodes[0].key;
    const result = graphSchema.validate(graph);
    assert.equal(result.valid, false);
    assert.ok(result.violations.some((v) => v.includes("missing required field 'key'")));
  });

  it('fails when duplicate keys exist', () => {
    const graph = minimalTwoStoryGraph();
    graph.nodes[1].key = graph.nodes[0].key; // duplicate
    const result = graphSchema.validate(graph);
    assert.equal(result.valid, false);
    assert.ok(result.violations.some((v) => v.includes('duplicate key')));
  });

  it('fails when housePattern is empty', () => {
    const graph = minimalTwoStoryGraph();
    graph.housePattern = '';
    const result = graphSchema.validate(graph);
    assert.equal(result.valid, false);
    assert.ok(result.violations.some((v) => v.includes('housePattern')));
  });

  it('fails when edge references unknown node key', () => {
    const graph = minimalTwoStoryGraph();
    graph.edges.push({ from: 'nonexistent', to: 'common_area', kind: 'required_adjacency' });
    const result = graphSchema.validate(graph);
    assert.equal(result.valid, false);
    assert.ok(result.violations.some((v) => v.includes('unknown node key')));
  });
});

// ---------------------------------------------------------------------------
// adjacencyContract
// ---------------------------------------------------------------------------

describe('adjacencyContract', () => {
  it('passes for a valid graph where all required adjacencies are met', () => {
    const graph = minimalTwoStoryGraph();
    const result = adjacency.validate(graph);
    assert.equal(result.valid, true, `violations: ${result.violations.join('; ')}`);
  });

  it('catches a missing required adjacency', () => {
    const graph = minimalTwoStoryGraph();
    // Remove the edge between entrance_room and common_area
    graph.edges = graph.edges.filter(
      (e) => !(e.from === 'entrance_room' && e.to === 'common_area')
    );
    const result = adjacency.validate(graph);
    assert.equal(result.valid, false);
    assert.ok(result.violations.some((v) => v.includes('entrance_room') && v.includes('common_area')));
  });

  it('catches a forbidden adjacency', () => {
    const graph = minimalTwoStoryGraph();
    // Make primary_suite forbid landing, but they are adjacent
    const suite = graph.nodes.find((n) => n.key === 'primary_suite');
    suite.forbiddenAdjacencies = ['landing'];
    const result = adjacency.validate(graph);
    assert.equal(result.valid, false);
    assert.ok(result.violations.some((v) => v.includes('forbiddenAdjacency') && v.includes('landing')));
  });
});

// ---------------------------------------------------------------------------
// landingHallContract
// ---------------------------------------------------------------------------

describe('landingHallContract', () => {
  it('passes for a valid 2-story graph', () => {
    const graph = minimalTwoStoryGraph();
    const result = landingHall.validate(graph);
    assert.equal(result.valid, true, `violations: ${result.violations.join('; ')}`);
  });

  it('catches missing stair_core in a 2-story graph', () => {
    const graph = minimalTwoStoryGraph();
    // Remove stair_core node and its edges
    graph.nodes = graph.nodes.filter((n) => n.role !== 'stair_core');
    graph.edges = graph.edges.filter((e) => e.from !== 'stair_core' && e.to !== 'stair_core');
    // Fix up requiredAdjacencies so adjacency contract is not the concern
    for (const n of graph.nodes) {
      n.requiredAdjacencies = n.requiredAdjacencies.filter((r) => r !== 'stair_core');
    }
    const result = landingHall.validate(graph);
    assert.equal(result.valid, false);
    assert.ok(result.violations.some((v) => v.includes('stair_core')));
  });

  it('catches missing landing in a 2-story graph', () => {
    const graph = minimalTwoStoryGraph();
    graph.nodes = graph.nodes.filter((n) => n.role !== 'landing');
    graph.edges = graph.edges.filter((e) => e.from !== 'landing' && e.to !== 'landing');
    const result = landingHall.validate(graph);
    assert.equal(result.valid, false);
    assert.ok(result.violations.some((v) => v.includes('landing')));
  });

  it('passes for a single-story graph without stair/landing', () => {
    const graph = {
      housePattern: 'single_story_ranch',
      nodes: [
        makeNode({ key: 'entrance_room', role: 'entrance_room', type: 'entry', level: 1, stage: 'main_entrance' }),
        makeNode({ key: 'common_area', role: 'common_area', type: 'living_room', level: 1 }),
      ],
      edges: [
        { from: 'entrance_room', to: 'common_area', kind: 'required_adjacency' },
      ],
    };
    const result = landingHall.validate(graph);
    assert.equal(result.valid, true);
  });
});

// ---------------------------------------------------------------------------
// variationProfileContract
// ---------------------------------------------------------------------------

describe('variationProfileContract', () => {
  it('passes for all 3 existing variation profiles', () => {
    for (const profile of VARIATION_PROFILES) {
      const result = validateProfile(profile);
      assert.equal(result.valid, true, `profile '${profile.id}' failed: ${result.violations.join('; ')}`);
    }
  });

  it('fails for a profile with invalid id prefix', () => {
    const bad = { ...VARIATION_PROFILES[0], id: 'bad_prefix' };
    const result = validateProfile(bad);
    assert.equal(result.valid, false);
    assert.ok(result.violations.some((v) => v.includes("start with 'variant_'")));
  });

  it('passes diversity check for the existing 3 profiles', () => {
    const result = validateProfileSet([...VARIATION_PROFILES]);
    assert.equal(result.valid, true, `violations: ${result.violations.join('; ')}`);
  });

  it('fails diversity check for identical profiles', () => {
    const dup = { ...VARIATION_PROFILES[0], twoStory: { ...VARIATION_PROFILES[0].twoStory, upperCore: { ...VARIATION_PROFILES[0].twoStory.upperCore } } };
    const dup2 = { ...VARIATION_PROFILES[0], id: 'variant_dup2', twoStory: { ...VARIATION_PROFILES[0].twoStory, upperCore: { ...VARIATION_PROFILES[0].twoStory.upperCore } } };
    const result = validateProfileSet([dup, dup2]);
    assert.equal(result.valid, false);
    assert.ok(result.violations.some((v) => v.includes('diversity')));
  });
});
