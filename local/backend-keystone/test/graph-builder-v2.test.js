'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveArchitectV2Support } = require('../lib/residential/v2/supportMatrix');
const { interpretBriefV2 } = require('../lib/residential/v2/interpretBriefV2');
const { buildProgramV2 } = require('../lib/residential/v2/programBuilderV2');

function makeBrief(overrides = {}) {
  return {
    totalAreaSqFt: 2400,
    stories: 2,
    bedrooms: 2,
    bathrooms: 2,
    shape: 'RECTANGULAR',
    lotContext: 'SUBURBAN',
    hasGarage: true,
    garageType: 'ONE_CAR',
    primaryLevel: 2,
    frontFacing: 'South',
    openConcept: true,
    kitchenRear: true,
    raw: {
      privateBaths: '1',
    },
    requestedFeatureItems: [],
    ...overrides,
  };
}

test('buildProgramV2 emits a graph with public nodes shallower than private nodes', () => {
  const brief = makeBrief();
  const support = resolveArchitectV2Support(brief);
  const interpretation = interpretBriefV2(brief, support);

  const program = buildProgramV2(brief, interpretation);
  const nodes = program.graph?.nodes || [];

  const entrance = nodes.find((node) => node.role === 'entrance_room');
  const common = nodes.find((node) => node.role === 'common_area');
  const primary = nodes.find((node) => node.role === 'primary_suite');

  assert.ok(nodes.length > 0, 'Expected graph nodes on the v2 program');
  assert.ok(entrance, 'Expected an entrance node');
  assert.ok(common, 'Expected a common area node');
  assert.ok(primary, 'Expected a primary suite node');
  assert.ok(entrance.privacyDepth < common.privacyDepth, 'Expected entrance to be shallower than common area');
  assert.ok(common.privacyDepth < primary.privacyDepth, 'Expected common area to be shallower than the primary suite');
});

test('buildProgramV2 treats study as a private extremity in the graph', () => {
  const brief = makeBrief({
    requestedFeatureItems: [{ canonicalType: 'study' }],
  });
  const support = resolveArchitectV2Support(brief);
  const interpretation = interpretBriefV2(brief, support);

  const program = buildProgramV2(brief, interpretation);
  const studyNode = (program.graph?.nodes || []).find((node) => node.type === 'study');

  assert.ok(studyNode, 'Expected a study node');
  assert.equal(studyNode.stage, 'private_extremities');
  assert.equal(studyNode.terminal, true);
  assert.ok(studyNode.privacyDepth >= 3, `Expected study depth to be private, got ${studyNode.privacyDepth}`);
});

test('buildProgramV2 treats library as a graph-native private extremity with stronger exterior expectations', () => {
  const brief = makeBrief({
    requestedFeatureItems: [{ canonicalType: 'library' }],
  });
  const support = resolveArchitectV2Support(brief);
  const interpretation = interpretBriefV2(brief, support);

  const program = buildProgramV2(brief, interpretation);
  const libraryNode = (program.graph?.nodes || []).find((node) => node.role === 'special_room');
  const upperLibrary = (program.levels.find((level) => Number(level?.level) === 2)?.rooms || [])
    .find((room) => room.type === 'library');

  assert.equal(support.supported, true, `Expected support matrix to keep the 2-bed library family on v2, got ${support.reasons?.join(', ')}`);
  assert.ok(libraryNode, 'Expected a graph-native special room node');
  assert.equal(libraryNode.type, 'library');
  assert.equal(libraryNode.stage, 'private_extremities');
  assert.equal(libraryNode.privacyLevel, 'private');
  assert.ok(libraryNode.exteriorEdgesRequired >= 2, `Expected library exterior requirement >= 2, got ${libraryNode.exteriorEdgesRequired}`);
  assert.ok(upperLibrary, 'Expected the 2-bed library room program to prefer upper support/loft reuse');
});

test('buildProgramV2 treats gym as a graph-native semi-private feature room on the routed 2-bed family', () => {
  const brief = makeBrief({
    requestedFeatureItems: [{ canonicalType: 'gym' }],
  });
  const support = resolveArchitectV2Support(brief);
  const interpretation = interpretBriefV2(brief, support);

  const program = buildProgramV2(brief, interpretation);
  const gymNode = (program.graph?.nodes || []).find((node) => node.role === 'special_room');
  const upperGym = (program.levels.find((level) => Number(level?.level) === 2)?.rooms || [])
    .find((room) => room.type === 'gym');

  assert.equal(support.supported, true, `Expected support matrix to keep the 2-bed gym family on v2, got ${support.reasons?.join(', ')}`);
  assert.ok(gymNode, 'Expected a graph-native gym node');
  assert.equal(gymNode.type, 'gym');
  assert.equal(gymNode.privacyLevel, 'semi_private');
  assert.equal(gymNode.exteriorEdgesRequired, 0);
  assert.ok(upperGym, 'Expected the 2-bed gym room program to reuse the upper support slot');
});

test('buildProgramV2 treats movie room as a graph-native semi-private feature room', () => {
  const brief = makeBrief({
    bedrooms: 3,
    bathrooms: 3,
    totalAreaSqFt: 3200,
    requestedFeatureItems: [{ canonicalType: 'movie_room' }],
  });
  const support = resolveArchitectV2Support(brief);
  const interpretation = interpretBriefV2(brief, support);

  const program = buildProgramV2(brief, interpretation);
  const movieNode = (program.graph?.nodes || []).find((node) => node.role === 'special_room');
  const lowerMovie = (program.levels.find((level) => Number(level?.level) === 1)?.rooms || [])
    .find((room) => room.type === 'movie_room');

  assert.equal(support.supported, true, `Expected support matrix to keep movie room on v2, got ${support.reasons?.join(', ')}`);
  assert.ok(movieNode, 'Expected a graph-native movie room node');
  assert.equal(movieNode.type, 'movie_room');
  assert.equal(movieNode.privacyLevel, 'semi_private');
  assert.ok(lowerMovie, 'Expected movie room to be placed on level 1');
});

test('buildProgramV2 treats wine cellar as a graph-native utility feature room on level 1', () => {
  const brief = makeBrief({
    bedrooms: 3,
    bathrooms: 3,
    totalAreaSqFt: 3000,
    requestedFeatureItems: [{ canonicalType: 'wine_cellar' }],
  });
  const support = resolveArchitectV2Support(brief);
  const interpretation = interpretBriefV2(brief, support);

  const program = buildProgramV2(brief, interpretation);
  const cellarNode = (program.graph?.nodes || []).find((node) => node.role === 'special_room');
  const lowerCellar = (program.levels.find((level) => Number(level?.level) === 1)?.rooms || [])
    .find((room) => room.type === 'wine_cellar');

  assert.equal(support.supported, true, `Expected support matrix to keep wine cellar on v2, got ${support.reasons?.join(', ')}`);
  assert.ok(cellarNode, 'Expected a graph-native wine cellar node');
  assert.equal(cellarNode.type, 'wine_cellar');
  assert.equal(cellarNode.privacyLevel, 'utility');
  assert.ok(lowerCellar, 'Expected wine cellar to be placed on level 1');
});

test('buildProgramV2 emits a graph for the two-story compact no-garage family', () => {
  const brief = makeBrief({
    hasGarage: false,
    garageType: 'NONE',
  });
  const support = resolveArchitectV2Support(brief);
  const interpretation = interpretBriefV2(brief, support);
  const program = buildProgramV2(brief, interpretation);
  const nodes = program.graph?.nodes || [];

  const garageNode = nodes.find((node) => node.role === 'garage');
  const laundryNode = nodes.find((node) => node.role === 'laundry');
  const lowerLandingNode = nodes.find((node) => node.role === 'lower_landing');

  assert.equal(support.supported, true, `Expected compact no-garage family to stay on v2, got ${support.reasons?.join(', ')}`);
  assert.equal(interpretation.housePattern, 'two_story_upper_primary_compact');
  assert.ok(nodes.length > 0, 'Expected a graph for compact no-garage family');
  assert.equal(garageNode, undefined, 'Expected no garage graph node on the compact no-garage family');
  assert.ok(laundryNode, 'Expected compact no-garage family to keep a laundry graph node');
  assert.ok(lowerLandingNode, 'Expected compact no-garage family to keep a lower landing graph node');
});

test('buildProgramV2 emits a graph for the two-story three-bed compact no-garage family', () => {
  const brief = makeBrief({
    bedrooms: 3,
    bathrooms: 3,
    hasGarage: false,
    garageType: 'NONE',
  });
  const support = resolveArchitectV2Support(brief);
  const interpretation = interpretBriefV2(brief, support);
  const program = buildProgramV2(brief, interpretation);
  const nodes = program.graph?.nodes || [];

  const garageNode = nodes.find((node) => node.role === 'garage');
  const secondaryBedroom2Node = nodes.find((node) => node.key === 'secondary_bedroom_2');
  const suiteBufferNode = nodes.find((node) => node.key === 'suite_buffer');

  assert.equal(support.supported, true, `Expected three-bed compact no-garage family to stay on v2, got ${support.reasons?.join(', ')}`);
  assert.equal(interpretation.housePattern, 'two_story_upper_primary_three_bed_compact');
  assert.equal(garageNode, undefined, 'Expected no garage graph node on three-bed compact no-garage family');
  assert.ok(secondaryBedroom2Node, 'Expected a second secondary bedroom graph node for the three-bed compact family');
  assert.ok(suiteBufferNode, 'Expected a suite buffer graph node for the three-bed compact family');
});

test('resolveArchitectV2Support keeps the 3-bed gym brief on v2 with the three-bed family pattern', () => {
  const brief = makeBrief({
    bedrooms: 3,
    bathrooms: 3,
    requestedFeatureItems: [{ canonicalType: 'gym' }],
  });

  const support = resolveArchitectV2Support(brief);
  const interpretation = interpretBriefV2(brief, support);
  const program = buildProgramV2(brief, interpretation);
  const upperGym = (program.levels.find((level) => Number(level?.level) === 2)?.rooms || [])
    .find((room) => room.type === 'gym');

  assert.equal(support.supported, true, `Expected support matrix to keep 3-bed gym on v2, got ${support.reasons?.join(', ')}`);
  assert.ok(
    interpretation.housePattern === 'two_story_upper_primary_with_garage_three_bed' ||
    interpretation.housePattern === 'two_story_upper_primary_three_bed_compact',
    `Expected a three-bed v2 pattern, got ${interpretation.housePattern}`
  );
  assert.ok(upperGym, 'Expected the 3-bed gym room program to place gym on level 2 for upper wellness swap');
});

test('buildProgramV2 keeps 3-bed no-garage gym on level 2 in the compact family', () => {
  const brief = makeBrief({
    bedrooms: 3,
    bathrooms: 3,
    hasGarage: false,
    garageType: 'NONE',
    requestedFeatureItems: [{ canonicalType: 'gym' }],
  });
  const support = resolveArchitectV2Support(brief);
  const interpretation = interpretBriefV2(brief, support);
  const program = buildProgramV2(brief, interpretation);

  const lowerGyms = (program.levels.find((level) => Number(level?.level) === 1)?.rooms || []).filter((room) => room.type === 'gym');
  const upperGyms = (program.levels.find((level) => Number(level?.level) === 2)?.rooms || []).filter((room) => room.type === 'gym');

  assert.equal(support.supported, true, `Expected 3-bed compact gym to stay on v2, got ${support.reasons?.join(', ')}`);
  assert.equal(interpretation.housePattern, 'two_story_upper_primary_three_bed_compact');
  assert.equal(lowerGyms.length, 0, 'Expected no level-1 gym on the compact three-bed family');
  assert.equal(upperGyms.length, 1, 'Expected one level-2 gym for upper wellness swap');
});

test('buildProgramV2 emits a graph-native special room for the 3-bed study family', () => {
  const brief = makeBrief({
    bedrooms: 3,
    bathrooms: 3,
    requestedFeatureItems: [{ canonicalType: 'study' }],
  });
  const support = resolveArchitectV2Support(brief);
  const interpretation = interpretBriefV2(brief, support);

  const program = buildProgramV2(brief, interpretation);
  const featureNode = (program.graph?.nodes || []).find((node) => node.role === 'special_room');
  const upperStudy = (program.levels.find((level) => Number(level?.level) === 2)?.rooms || [])
    .find((room) => room.type === 'study');

  assert.equal(support.supported, true, `Expected support matrix to keep the 3-bed study family on v2, got ${support.reasons?.join(', ')}`);
  assert.equal(interpretation.housePattern, 'two_story_upper_primary_with_garage_three_bed');
  assert.ok(featureNode, 'Expected a graph-native special room node');
  assert.equal(featureNode.type, 'study');
  assert.equal(featureNode.stage, 'private_extremities');
  assert.ok(featureNode.privacyDepth >= 3, `Expected special room depth to be private, got ${featureNode.privacyDepth}`);
  assert.ok(upperStudy, 'Expected the 3-bed study room program to place the requested study on level 2 for loft-first reuse');
});

test('buildProgramV2 preserves two consistent private-bath selections on the 3-bed study family', () => {
  const brief = makeBrief({
    bedrooms: 3,
    bathrooms: 3,
    raw: {
      privateBaths: '2',
      bedroomConfigs: [
        { privateBath: 'Yes', closet: 'Walk-in' },
        { privateBath: 'No', closet: 'Standard' },
        { privateBath: 'Yes', closet: 'Standard' },
      ],
    },
    requestedFeatureItems: [{ canonicalType: 'study' }],
  });
  const support = resolveArchitectV2Support(brief);
  const interpretation = interpretBriefV2(brief, support);
  const program = buildProgramV2(brief, interpretation);
  const graphNodes = program.graph?.nodes || [];

  const level1Bathrooms = (program.levels.find((level) => Number(level?.level) === 1)?.rooms || [])
    .filter((room) => room.type === 'bathroom');
  const level2Bathrooms = (program.levels.find((level) => Number(level?.level) === 2)?.rooms || [])
    .filter((room) => room.type === 'bathroom');
  const upperSharedBathNode = graphNodes.find((node) => node.key === 'shared_bath');
  const lowerSharedBathNode = graphNodes.find((node) => node.key === 'lower_shared_bath');
  const secondaryPrivateBathNode = graphNodes.find((node) => node.key === 'secondary_private_bath');
  const secondaryPrivateBathRoom = level2Bathrooms[0];

  assert.equal(support.supported, true, `Expected support matrix to keep the 2-private-bath study family on v2, got ${support.reasons?.join(', ')}`);
  assert.equal(interpretation.bathPlan.requestedPrivateBathBedrooms, 2);
  assert.equal(interpretation.bathPlan.primaryEnsuiteCount, 1);
  assert.equal(interpretation.bathPlan.secondaryPrivateBathCount, 1);
  assert.equal(interpretation.bathPlan.sharedBathCount, 1);
  assert.equal(level1Bathrooms.length, 1, 'Expected a shared bath on level 1');
  assert.equal(level2Bathrooms.length, 1, 'Expected one secondary private bath on level 2');
  assert.equal(upperSharedBathNode, undefined, 'Expected no graph-level upper shared bath node when the shared bath is intentionally on level 1');
  assert.ok(lowerSharedBathNode, 'Expected a graph-level lower shared bath node');
  assert.ok(secondaryPrivateBathNode, 'Expected a graph-level secondary private bath node');
  assert.equal(secondaryPrivateBathRoom?.bathroomUse, 'private');
  assert.ok(secondaryPrivateBathRoom?.attachedTo, 'Expected the upper private bath to be attached to a specific secondary bedroom');
});

test('buildProgramV2 emits a graph-backed lower shared bath buffer for the three-bed family', () => {
  const brief = makeBrief({
    bedrooms: 3,
    bathrooms: 3,
  });
  const support = resolveArchitectV2Support(brief);
  const interpretation = interpretBriefV2(brief, support);

  const program = buildProgramV2(brief, interpretation);
  const nodes = program.graph?.nodes || [];
  const lowerSharedBath = nodes.find((node) => node.role === 'lower_shared_bath');

  assert.ok(lowerSharedBath, 'Expected a lower shared bath node in the three-bed graph');
  assert.equal(lowerSharedBath.type, 'bathroom');
  assert.equal(lowerSharedBath.level, 1);
  assert.equal(lowerSharedBath.stage, 'buffer_nodes');
  assert.equal(lowerSharedBath.privacyLevel, 'semi_private');
});

test('buildProgramV2 resolves an orientation-aware preferred side for the primary suite', () => {
  const southBrief = makeBrief({ frontFacing: 'South' });
  const northBrief = makeBrief({ frontFacing: 'North' });

  const southProgram = buildProgramV2(southBrief, interpretBriefV2(southBrief, resolveArchitectV2Support(southBrief)));
  const northProgram = buildProgramV2(northBrief, interpretBriefV2(northBrief, resolveArchitectV2Support(northBrief)));

  const southPrimary = (southProgram.graph?.nodes || []).find((node) => node.role === 'primary_suite');
  const northPrimary = (northProgram.graph?.nodes || []).find((node) => node.role === 'primary_suite');

  assert.ok(southPrimary, 'Expected a south-facing primary suite node');
  assert.ok(northPrimary, 'Expected a north-facing primary suite node');
  assert.equal(southPrimary.resolvedPreferredSide, 'east');
  assert.equal(northPrimary.resolvedPreferredSide, 'west');
});
