'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeBrief } = require('../lib/tile/normalizeBrief');
const { shareWall } = require('../lib/planGeometry');
const { resolveArchitectV2Support } = require('../lib/residential/v2/supportMatrix');
const { interpretBriefV2 } = require('../lib/residential/v2/interpretBriefV2');
const { buildProgramV2 } = require('../lib/residential/v2/programBuilderV2');
const { buildRealmGraphV2 } = require('../lib/residential/v2/graph/graphBuilderV2');
const { buildCandidateFootprintsV2 } = require('../lib/residential/v2/candidateFootprintsV2');
const {
  assembleOrthogonalPlanV2,
  attachRoomToBranch,
  applyWingAwarePlacement,
  resolveWingZoneModel,
  deriveZoneNativeRect,
} = require('../lib/residential/v2/orthogonalAssembler');
const { SHARED_UPPER_CIRCULATION_ENGINE_ID } = require('../lib/residential/v2/clusterBuilders');

function touchesSide(room, level, side) {
  if (!room || !level) return false;
  if (side === 'north') return Number(room.y) === 0;
  if (side === 'south') return Number(room.y) + Number(room.h) === Number(level.height);
  if (side === 'west') return Number(room.x) === 0;
  if (side === 'east') return Number(room.x) + Number(room.w) === Number(level.width);
  return false;
}

function overlapArea(a, b) {
  const ax = Number(a?.x || 0);
  const ay = Number(a?.y || 0);
  const aw = Number(a?.w || 0);
  const ah = Number(a?.h || 0);
  const bx = Number(b?.x || 0);
  const by = Number(b?.y || 0);
  const bw = Number(b?.w || 0);
  const bh = Number(b?.h || 0);
  const xOverlap = Math.min(ax + aw, bx + bw) - Math.max(ax, bx);
  const yOverlap = Math.min(ay + ah, by + bh) - Math.max(ay, by);
  if (xOverlap <= 0 || yOverlap <= 0) return 0;
  return xOverlap * yOverlap;
}

test('attachRoomToBranch rotates into a perpendicular wing when the preferred side would exceed 25 ft', () => {
  const cluster = [
    { id: 'common_area', x: 0, y: 0, w: 16, h: 12 },
  ];

  const result = attachRoomToBranch(cluster, { id: 'next_room', w: 12, h: 10 }, {
    preferredSide: 'east',
    maxCrossSectionFt: 25,
  });

  assert.notEqual(result.side, 'east', 'Expected the attachment to rotate away from the oversize east wing');
  assert.ok(result.bounds.w <= 25, `Expected branch width <= 25 ft, got ${result.bounds.w}`);
});

test('applyWingAwarePlacement nudges non-structural rooms out of envelope void zones for L-shape footprints', () => {
  const layout = {
    levels: [
      {
        level: 1,
        width: 40,
        height: 30,
        rooms: [
          { id: 'living', type: 'living_room', x: 30, y: 0, w: 10, h: 10 },
          { id: 'stairs_l1', type: 'stairs', x: 16, y: 10, w: 6, h: 12 },
        ],
      },
    ],
  };
  const footprint = {
    envelopeShape: 'L_SHAPE',
    envelopeVoidRects: [{ x: 30, y: 0, w: 10, h: 10 }],
  };

  const placed = applyWingAwarePlacement(layout, footprint);
  const level1 = placed.levels[0];
  const living = level1.rooms.find((room) => String(room.id) === 'living');
  const stairs = level1.rooms.find((room) => String(room.id) === 'stairs_l1');

  assert.ok(living, 'Expected living room to remain in output');
  const livingOverlapsVoid =
    Number(living.x) < 40 &&
    Number(living.x) + Number(living.w) > 30 &&
    Number(living.y) < 10 &&
    Number(living.y) + Number(living.h) > 0;
  assert.equal(livingOverlapsVoid, false, 'Expected living room to be nudged out of the L-shape void area');

  assert.equal(Number(stairs.x), 16, 'Expected stairs x-position to remain unchanged');
  assert.equal(Number(stairs.y), 10, 'Expected stairs y-position to remain unchanged');
});

test('applyWingAwarePlacement keeps rectangular footprints unchanged', () => {
  const layout = {
    levels: [
      {
        level: 1,
        width: 40,
        height: 30,
        rooms: [
          { id: 'living', type: 'living_room', x: 0, y: 0, w: 20, h: 12 },
          { id: 'kitchen', type: 'kitchen', x: 20, y: 0, w: 20, h: 12 },
        ],
      },
    ],
  };
  const footprint = {
    envelopeShape: 'RECTANGULAR',
    envelopeVoidRects: [],
  };

  const placed = applyWingAwarePlacement(layout, footprint);
  assert.deepEqual(placed, layout);
});

test('deriveZoneNativeRect scales oversized geometry to fit inside the target zone', () => {
  const placed = deriveZoneNativeRect(
    { x: 0, y: 0, w: 24, h: 16 },
    { x: 0, y: 0, w: 14, h: 10 },
    40,
    30,
    [],
    { minWidth: 10, minHeight: 8 }
  );

  assert.ok(Number(placed.w) <= 14, `Expected width to fit zone: ${placed.w}`);
  assert.ok(Number(placed.h) <= 10, `Expected height to fit zone: ${placed.h}`);
  assert.ok(Number(placed.w) >= 10, `Expected width to respect minimum practical width: ${placed.w}`);
  assert.ok(Number(placed.h) >= 8, `Expected height to respect minimum practical height: ${placed.h}`);
});

test('resolveWingZoneModel returns body/wing zones for top-right L-shape notch', () => {
  const model = resolveWingZoneModel(
    {
      envelopeShape: 'L_SHAPE',
      envelopeVoidRects: [{ x: 30, y: 0, w: 10, h: 10 }],
    },
    40,
    30
  );
  assert.ok(model, 'Expected a zone model for L-shape');
  assert.equal(model.shape, 'L_SHAPE');
  assert.deepEqual(model.wingRect, { x: 0, y: 0, w: 30, h: 10 });
  assert.deepEqual(model.bodyRect, { x: 0, y: 10, w: 40, h: 20 });
});

test('applyWingAwarePlacement uses zone preference so bedroom relocates to T-shape wing zone', () => {
  const layout = {
    levels: [
      {
        level: 2,
        width: 42,
        height: 30,
        rooms: [
          { id: 'bed_1', type: 'bedroom', x: 32, y: 0, w: 10, h: 10 }, // overlaps top-right void
          { id: 'stair_2', type: 'stairs', x: 16, y: 14, w: 6, h: 12 },
        ],
      },
    ],
  };
  const footprint = {
    envelopeShape: 'T_SHAPE',
    envelopeVoidRects: [
      { x: 0, y: 0, w: 14, h: 14 },
      { x: 28, y: 0, w: 14, h: 14 },
    ],
  };

  const placed = applyWingAwarePlacement(layout, footprint);
  const level2 = placed.levels[0];
  const bedroom = level2.rooms.find((room) => room.id === 'bed_1');
  assert.ok(bedroom, 'Expected bedroom to remain in output');

  const centerX = Number(bedroom.x) + Number(bedroom.w) / 2;
  const centerY = Number(bedroom.y) + Number(bedroom.h) / 2;
  const inWingZone = centerX >= 14 && centerX <= 28 && centerY >= 0 && centerY <= 14;
  assert.equal(inWingZone, true, 'Expected bedroom center to relocate into T-shape wing (stem) zone');
});

test('assembleOrthogonalPlanV2 keeps the three-bed upper landing cluster keyed to graph nodes', () => {
  const surveyData = {
    location: '',
    totalArea: '2400',
    stories: '2 Stories',
    bedrooms: '3 Bed',
    bathrooms: '3 Bath',
    privateBaths: '1',
    bedroomConfigs: null,
    shape: 'Rectangular',
    garage: '1 Car Garage',
    materials: 'Craftsman (Wood & Stone)',
    openConcept: 'Open Concept (Combined)',
    masterLocation: 'Level 2 (Upper)',
    kitchenPlacement: 'Rear of House',
    features: '',
    frontFacing: 'South',
    lotContext: 'Suburban standard lot',
    laundryLocation: 'Level 1 (near garage/mud)',
    ceilingHeight: 'Standard (9 ft)',
    indoorOutdoor: 'Moderate (some connection)',
    naturalLight: 'Balanced windows',
    accessibilityNeeds: 'None',
    budgetTier: 'Mid ($200-300/sqft)',
    freeformWishes: '',
  };

  const brief = normalizeBrief(surveyData);
  const support = resolveArchitectV2Support(brief);
  const interpretation = interpretBriefV2(brief, support);
  const program = buildProgramV2(brief, interpretation);
  const graph = buildRealmGraphV2(brief, interpretation, program.levels);
  const layout = assembleOrthogonalPlanV2({
    brief,
    interpretation,
    footprint: { widthFt: 40, heightFt: 30, totalAreaSqFt: 2400 },
    program,
    graph,
  });

  const level2 = layout.levels.find((level) => Number(level?.level) === 2);
  const byId = new Map((level2?.rooms || []).map((room) => [String(room.id), room]));
  const landingRoom = byId.get(String(level2?.stairCore?.landingRoomId || ''));

  assert.ok(landingRoom, 'Expected the upper landing room referenced by stairCore');
  assert.equal(String(landingRoom?.type), 'hallway');

  const graphNodeRoomIds = new Map((graph?.nodes || []).map((node) => [String(node.key), String(node.roomId)]));
  const sharedBath = byId.get(graphNodeRoomIds.get('shared_bath'));
  const secondaryA = byId.get(graphNodeRoomIds.get('secondary_bedroom_1'));
  const secondaryB = byId.get(graphNodeRoomIds.get('secondary_bedroom_2'));
  const storageUpper = byId.get(graphNodeRoomIds.get('storage_upper'));
  const suiteBuffer = byId.get(graphNodeRoomIds.get('suite_buffer'));
  const primaryBath = byId.get(graphNodeRoomIds.get('primary_bath_buffer'));

  assert.ok(sharedBath && shareWall(sharedBath, landingRoom, 2), 'Expected shared bath to share a wall with the landing');
  assert.ok(secondaryA && shareWall(secondaryA, landingRoom, 2), 'Expected secondary bedroom 1 to share a wall with the landing');
  assert.ok(secondaryB && shareWall(secondaryB, landingRoom, 2), 'Expected secondary bedroom 2 to share a wall with the landing');
  assert.ok(storageUpper, 'Expected the upper support room to use the graph storage_upper node id');
  assert.ok(shareWall(storageUpper, landingRoom, 2), 'Expected storage_upper to cluster off the landing');
  assert.ok(suiteBuffer, 'Expected the east-side support strip to use a graph-backed suite_buffer node id');
  assert.ok(primaryBath && shareWall(primaryBath, suiteBuffer, 2), 'Expected suite_buffer to share a wall with the primary bath');
});

test('assembleOrthogonalPlanV2 keeps the lower stair hall keyed to the graph instead of a synthetic room id', () => {
  const surveyData = {
    location: '',
    totalArea: '1800',
    stories: '2 Stories',
    bedrooms: '2 Bed',
    bathrooms: '2 Bath',
    privateBaths: '1',
    bedroomConfigs: null,
    shape: 'Rectangular',
    garage: '1 Car Garage',
    materials: 'Craftsman (Wood & Stone)',
    openConcept: 'Open Concept (Combined)',
    masterLocation: 'Level 2 (Upper)',
    kitchenPlacement: 'Rear of House',
    features: '',
    frontFacing: 'South',
    lotContext: 'Suburban standard lot',
    laundryLocation: 'Level 1 (near garage/mud)',
    ceilingHeight: 'Standard (9 ft)',
    indoorOutdoor: 'Moderate (some connection)',
    naturalLight: 'Balanced windows',
    accessibilityNeeds: 'None',
    budgetTier: 'Mid ($200-300/sqft)',
    freeformWishes: '',
  };

  const brief = normalizeBrief(surveyData);
  const support = resolveArchitectV2Support(brief);
  const interpretation = interpretBriefV2(brief, support);
  const program = buildProgramV2(brief, interpretation);
  const graph = buildRealmGraphV2(brief, interpretation, program.levels);
  const layout = assembleOrthogonalPlanV2({
    brief,
    interpretation,
    footprint: { widthFt: 34, heightFt: 28, totalAreaSqFt: 1800 },
    program,
    graph,
  });

  const level1 = layout.levels.find((level) => Number(level?.level) === 1);
  const byId = new Map((level1?.rooms || []).map((room) => [String(room.id), room]));
  const graphNodeRoomIds = new Map((graph?.nodes || []).map((node) => [String(node.key), String(node.roomId)]));
  const lowerLanding = byId.get(graphNodeRoomIds.get('lower_landing'));
  const stairs = byId.get(graphNodeRoomIds.get('stair_core_lower'));
  const commonArea = byId.get(graphNodeRoomIds.get('common_area'));
  const mudroom = byId.get(graphNodeRoomIds.get('mudroom'));
  const laundry = byId.get(graphNodeRoomIds.get('laundry'));
  const entry = byId.get(graphNodeRoomIds.get('entrance_room'));

  assert.ok(lowerLanding, 'Expected the lower stair hall to use the graph lower_landing node id');
  assert.equal(String(lowerLanding?.type), 'hallway');
  assert.equal(String(level1?.stairCore?.hallRoomId), String(lowerLanding?.id), 'Expected stairCore to reference the graph-backed lower landing');
  assert.ok(stairs && shareWall(stairs, lowerLanding, 2), 'Expected the lower landing to share a wall with the lower stair core');
  assert.ok(commonArea, 'Expected a lower-floor common area room');
  assert.ok(mudroom && laundry && entry, 'Expected mudroom, laundry, and entry to exist on level 1');
  assert.equal(Number(mudroom?.x), Number(laundry?.x), 'Expected mudroom and laundry to share one service stack x-origin');
  assert.equal(Number(mudroom?.w), Number(laundry?.w), 'Expected mudroom and laundry to share one service stack width');
  assert.ok(Number(entry?.y) >= Number(laundry?.y || 0), 'Expected the entry to stay at the bottom of the service stack');
});

test('assembleOrthogonalPlanV2 builds the lower public and service clusters from graph-backed adjacency and side hints', () => {
  const surveyData = {
    location: '',
    totalArea: '2400',
    stories: '2 Stories',
    bedrooms: '3 Bed',
    bathrooms: '3 Bath',
    privateBaths: '1',
    bedroomConfigs: null,
    shape: 'Rectangular',
    garage: '1 Car Garage',
    materials: 'Craftsman (Wood & Stone)',
    openConcept: 'Open Concept (Combined)',
    masterLocation: 'Level 2 (Upper)',
    kitchenPlacement: 'Rear of House',
    features: '',
    frontFacing: 'South',
    lotContext: 'Suburban standard lot',
    laundryLocation: 'Level 1 (near garage/mud)',
    ceilingHeight: 'Standard (9 ft)',
    indoorOutdoor: 'Moderate (some connection)',
    naturalLight: 'Balanced windows',
    accessibilityNeeds: 'None',
    budgetTier: 'Mid ($200-300/sqft)',
    freeformWishes: '',
  };

  const brief = normalizeBrief(surveyData);
  const support = resolveArchitectV2Support(brief);
  const interpretation = interpretBriefV2(brief, support);
  const program = buildProgramV2(brief, interpretation);
  const graph = buildRealmGraphV2(brief, interpretation, program.levels);
  const layout = assembleOrthogonalPlanV2({
    brief,
    interpretation,
    footprint: { widthFt: 40, heightFt: 30, totalAreaSqFt: 2400 },
    program,
    graph,
  });

  const level1 = layout.levels.find((level) => Number(level?.level) === 1);
  const byId = new Map((level1?.rooms || []).map((room) => [String(room.id), room]));
  const graphNodeRoomIds = new Map((graph?.nodes || []).map((node) => [String(node.key), String(node.roomId)]));

  const entry = byId.get(graphNodeRoomIds.get('entrance_room'));
  const commonArea = byId.get(graphNodeRoomIds.get('common_area'));
  const kitchen = byId.get(graphNodeRoomIds.get('farmhouse_kitchen'));
  const dining = byId.get(graphNodeRoomIds.get('dining_room'));
  const garage = byId.get(graphNodeRoomIds.get('garage'));
  const mudroom = byId.get(graphNodeRoomIds.get('mudroom'));
  const laundry = byId.get(graphNodeRoomIds.get('laundry'));
  const lowerSharedBath = byId.get(graphNodeRoomIds.get('lower_shared_bath'));
  const lowerLanding = byId.get(graphNodeRoomIds.get('lower_landing'));
  const stairs = byId.get(graphNodeRoomIds.get('stair_core_lower'));

  assert.ok(commonArea && dining && shareWall(commonArea, dining, 2), 'Expected dining room to share a wall with the common area');
  assert.ok(kitchen && dining && shareWall(kitchen, dining, 2), 'Expected kitchen and dining room to form one public cluster');

  assert.ok(mudroom && laundry && shareWall(mudroom, laundry, 2), 'Expected laundry to stay attached to the mudroom');
  assert.ok(lowerSharedBath, 'Expected the lower shared bath to use a graph-backed node id');
  assert.ok(lowerSharedBath && lowerLanding && shareWall(lowerSharedBath, lowerLanding, 2), 'Expected the lower shared bath to attach to the lower landing');
  assert.ok(lowerLanding && stairs && shareWall(lowerLanding, stairs, 2), 'Expected lower landing to stay attached to the stair core');
  assert.equal(Number(mudroom?.x), Number(laundry?.x), 'Expected mudroom and laundry to share one service stack x-origin');
  assert.equal(Number(mudroom?.w), Number(laundry?.w), 'Expected mudroom and laundry to share one service stack width');
  assert.ok(entry && lowerSharedBath && shareWall(entry, lowerSharedBath, 2), 'Expected the entry to anchor directly below the lower shared bath');
  assert.ok(Number(lowerLanding?.w) >= 5, `Expected at least five feet of lower circulation beside the wider stair core, got ${lowerLanding?.w}`);
  assert.ok(Number(mudroom?.h) >= 6, `Expected mudroom depth >= 6 ft, got ${mudroom?.h}`);
  assert.ok(Number(laundry?.h) >= 6, `Expected laundry depth >= 6 ft, got ${laundry?.h}`);
  assert.ok(Number(entry?.h) >= 6, `Expected entry depth >= 6 ft, got ${entry?.h}`);

  assert.ok(touchesSide(garage, level1, 'west'), 'Expected garage to stay on the west edge');
  assert.ok(touchesSide(entry, level1, 'south'), 'Expected entry to stay on the south/front edge');
  assert.ok(touchesSide(kitchen, level1, 'north'), 'Expected kitchen to keep north light');
  assert.ok(touchesSide(commonArea, level1, 'east'), 'Expected common area to keep east-side exposure');
});

test('assembleOrthogonalPlanV2 keeps all routed two-story garage families on one shared upper circulation engine', () => {
  const baseSurveyData = {
    location: '',
    totalArea: '2400',
    stories: '2 Stories',
    bedrooms: '2 Bed',
    bathrooms: '2 Bath',
    privateBaths: '1',
    bedroomConfigs: null,
    shape: 'Rectangular',
    garage: '1 Car Garage',
    materials: 'Craftsman (Wood & Stone)',
    openConcept: 'Open Concept (Combined)',
    masterLocation: 'Level 2 (Upper)',
    kitchenPlacement: 'Rear of House',
    features: '',
    frontFacing: 'South',
    lotContext: 'Suburban standard lot',
    laundryLocation: 'Level 1 (near garage/mud)',
    ceilingHeight: 'Standard (9 ft)',
    indoorOutdoor: 'Moderate (some connection)',
    naturalLight: 'Balanced windows',
    accessibilityNeeds: 'None',
    budgetTier: 'Mid ($200-300/sqft)',
    freeformWishes: '',
  };

  const variants = [
    { bedrooms: '2 Bed', bathrooms: '2 Bath', features: '' },
    { bedrooms: '3 Bed', bathrooms: '3 Bath', features: '' },
    { bedrooms: '2 Bed', bathrooms: '2 Bath', features: '1 Study' },
    { bedrooms: '2 Bed', bathrooms: '2 Bath', features: '1 Library' },
    { bedrooms: '2 Bed', bathrooms: '2 Bath', features: '1 Gym' },
  ];

  for (const variant of variants) {
    const brief = normalizeBrief({ ...baseSurveyData, ...variant });
    const support = resolveArchitectV2Support(brief);
    const interpretation = interpretBriefV2(brief, support);
    const program = buildProgramV2(brief, interpretation);
    const graph = buildRealmGraphV2(brief, interpretation, program.levels);
    const layout = assembleOrthogonalPlanV2({
      brief,
      interpretation,
      footprint: { widthFt: 40, heightFt: 30, totalAreaSqFt: 2400 },
      program,
      graph,
    });

    const level2 = layout.levels.find((level) => Number(level?.level) === 2);
    assert.equal(
      String(level2?.stairCore?.graphEngineId || ''),
      SHARED_UPPER_CIRCULATION_ENGINE_ID,
      `Expected ${interpretation.housePattern} to use the shared upper circulation engine`
    );
  }
});

test('assembleOrthogonalPlanV2 reuses the 2-bed upper support slot for library and gym requests', () => {
  const baseSurveyData = {
    location: '',
    totalArea: '2400',
    stories: '2 Stories',
    bedrooms: '2 Bed',
    bathrooms: '2 Bath',
    privateBaths: '1',
    bedroomConfigs: null,
    shape: 'Rectangular',
    garage: '1 Car Garage',
    materials: 'Craftsman (Wood & Stone)',
    openConcept: 'Open Concept (Combined)',
    masterLocation: 'Level 2 (Upper)',
    kitchenPlacement: 'Rear of House',
    features: '',
    frontFacing: 'South',
    lotContext: 'Suburban standard lot',
    laundryLocation: 'Level 1 (near garage/mud)',
    ceilingHeight: 'Standard (9 ft)',
    indoorOutdoor: 'Moderate (some connection)',
    naturalLight: 'Balanced windows',
    accessibilityNeeds: 'None',
    budgetTier: 'Mid ($200-300/sqft)',
    freeformWishes: '',
  };

  for (const featureLabel of ['1 Library', '1 Gym']) {
    const brief = normalizeBrief({ ...baseSurveyData, features: featureLabel });
    const support = resolveArchitectV2Support(brief);
    const interpretation = interpretBriefV2(brief, support);
    const program = buildProgramV2(brief, interpretation);
    const graph = buildRealmGraphV2(brief, interpretation, program.levels);
    const layout = assembleOrthogonalPlanV2({
      brief,
      interpretation,
      footprint: { widthFt: 40, heightFt: 30, totalAreaSqFt: 2400 },
      program,
      graph,
    });

    const level2 = layout.levels.find((level) => Number(level?.level) === 2);
    const featureType = featureLabel.toLowerCase().includes('library') ? 'library' : 'gym';
    const featureRoom = (level2?.rooms || []).find((room) => String(room?.type) === featureType);
    const loftRoom = (level2?.rooms || []).find((room) => String(room?.type) === 'loft');
    const landingRoom = (level2?.rooms || []).find((room) => String(room?.id) === String(level2?.stairCore?.landingRoomId || ''));

    assert.ok(featureRoom, `Expected ${featureType} to occupy the upper support slot`);
    assert.equal(loftRoom, undefined, `Expected no leftover loft after placing ${featureType}`);
    assert.ok(landingRoom && shareWall(featureRoom, landingRoom, 2), `Expected ${featureType} to stay attached to the landing-led upper circulation`);
    assert.ok(touchesSide(featureRoom, level2, 'north') || touchesSide(featureRoom, level2, 'west'), `Expected ${featureType} to retain exterior exposure in the upper support slot`);
  }
});

test('assembleOrthogonalPlanV2 keeps L-shape three-bed upper rooms non-overlapping around the landing core', () => {
  const surveyData = {
    location: '',
    totalArea: '3000',
    stories: '2 Stories',
    bedrooms: '3 Bed',
    bathrooms: '3 Bath',
    privateBaths: '1',
    bedroomConfigs: null,
    shape: 'L-Shape',
    garage: '1 Car Garage',
    materials: 'Craftsman (Wood & Stone)',
    openConcept: 'Open Concept (Combined)',
    masterLocation: 'Level 2 (Upper)',
    kitchenPlacement: 'Rear of House',
    features: '',
    frontFacing: 'South',
    lotContext: 'Suburban standard lot',
    laundryLocation: 'Level 1 (near garage/mud)',
    ceilingHeight: 'Standard (9 ft)',
    indoorOutdoor: 'Moderate (some connection)',
    naturalLight: 'Balanced windows',
    accessibilityNeeds: 'None',
    budgetTier: 'Mid ($200-300/sqft)',
    freeformWishes: '',
  };

  const brief = normalizeBrief(surveyData);
  const support = resolveArchitectV2Support(brief);
  const interpretation = interpretBriefV2(brief, support);
  const program = buildProgramV2(brief, interpretation);
  const graph = buildRealmGraphV2(brief, interpretation, program.levels);
  const footprint = buildCandidateFootprintsV2(brief, interpretation)[0];

  const layout = assembleOrthogonalPlanV2({
    brief,
    interpretation,
    footprint,
    program,
    graph,
  });

  const level2 = layout.levels.find((level) => Number(level?.level) === 2);
  assert.ok(level2, 'Expected level 2 for two-story L-shape brief');

  const rooms = (level2.rooms || []).filter((room) => {
    const type = String(room?.type || '').toLowerCase();
    return type !== 'stairs' && type !== 'hallway';
  });

  for (let i = 0; i < rooms.length; i += 1) {
    for (let j = i + 1; j < rooms.length; j += 1) {
      const overlapSqFt = overlapArea(rooms[i], rooms[j]);
      assert.equal(
        overlapSqFt,
        0,
        `Expected no level-2 overlap between ${rooms[i].id} and ${rooms[j].id}; got ${overlapSqFt} sqft`
      );
    }
  }
});

test('assembleOrthogonalPlanV2 seeds T-shape upper secondary bedroom with zone-native wing intent', () => {
  const surveyData = {
    location: '',
    totalArea: '3000',
    stories: '2 Stories',
    bedrooms: '3 Bed',
    bathrooms: '3 Bath',
    privateBaths: '1',
    bedroomConfigs: null,
    shape: 'T-Shape',
    garage: '1 Car Garage',
    materials: 'Craftsman (Wood & Stone)',
    openConcept: 'Open Concept (Combined)',
    masterLocation: 'Level 2 (Upper)',
    kitchenPlacement: 'Rear of House',
    features: '',
    frontFacing: 'South',
    lotContext: 'Suburban standard lot',
    laundryLocation: 'Level 1 (near garage/mud)',
    ceilingHeight: 'Standard (9 ft)',
    indoorOutdoor: 'Moderate (some connection)',
    naturalLight: 'Balanced windows',
    accessibilityNeeds: 'None',
    budgetTier: 'Mid ($200-300/sqft)',
    freeformWishes: '',
  };

  const brief = normalizeBrief(surveyData);
  const support = resolveArchitectV2Support(brief);
  const interpretation = interpretBriefV2(brief, support);
  const program = buildProgramV2(brief, interpretation);
  const graph = buildRealmGraphV2(brief, interpretation, program.levels);
  const footprint = buildCandidateFootprintsV2(brief, interpretation)[0];
  const zoneModel = resolveWingZoneModel(footprint, Number(footprint?.widthFt || 0), Number(footprint?.heightFt || 0));
  assert.ok(zoneModel?.wingRect, 'Expected T-shape wing zone model');

  const layout = assembleOrthogonalPlanV2({
    brief,
    interpretation,
    footprint,
    program,
    graph,
  });
  const level2 = layout.levels.find((level) => Number(level?.level) === 2);
  assert.ok(level2, 'Expected level 2 in two-story layout');

  const graphNodeRoomIds = new Map((graph?.nodes || []).map((node) => [String(node.key), String(node.roomId)]));
  const topSecondary = (level2.rooms || []).find((room) => String(room?.id) === graphNodeRoomIds.get('secondary_bedroom_2'));
  assert.ok(topSecondary, 'Expected graph-backed secondary_bedroom_2 room on level 2');
  assert.equal(topSecondary.zonePlacementSource, 'upper_zone_native');
  assert.equal(topSecondary.zonePlacement, 'wing');

  for (const voidRect of footprint.envelopeVoidRects || []) {
    assert.equal(
      overlapArea(topSecondary, voidRect),
      0,
      'Expected zone-native upper secondary bedroom to avoid footprint void overlap'
    );
  }
});

test('assembleOrthogonalPlanV2 stamps zone-native metadata on non-rect upper feature-swap rooms', () => {
  const surveyData = {
    location: '',
    totalArea: '3000',
    stories: '2 Stories',
    bedrooms: '3 Bed',
    bathrooms: '3 Bath',
    privateBaths: '1',
    bedroomConfigs: null,
    shape: 'T-Shape',
    garage: '1 Car Garage',
    materials: 'Craftsman (Wood & Stone)',
    openConcept: 'Open Concept (Combined)',
    masterLocation: 'Level 2 (Upper)',
    kitchenPlacement: 'Rear of House',
    features: '1 Study',
    frontFacing: 'South',
    lotContext: 'Suburban standard lot',
    laundryLocation: 'Level 1 (near garage/mud)',
    ceilingHeight: 'Standard (9 ft)',
    indoorOutdoor: 'Moderate (some connection)',
    naturalLight: 'Balanced windows',
    accessibilityNeeds: 'None',
    budgetTier: 'Mid ($200-300/sqft)',
    freeformWishes: '',
  };

  const brief = normalizeBrief(surveyData);
  const support = resolveArchitectV2Support(brief);
  const interpretation = interpretBriefV2(brief, support);
  const program = buildProgramV2(brief, interpretation);
  const graph = buildRealmGraphV2(brief, interpretation, program.levels);
  const footprint = buildCandidateFootprintsV2(brief, interpretation)[0];
  const layout = assembleOrthogonalPlanV2({
    brief,
    interpretation,
    footprint,
    program,
    graph,
  });

  const level2 = layout.levels.find((level) => Number(level?.level) === 2);
  assert.ok(level2, 'Expected level 2');
  const studyRoom = (level2.rooms || []).find((room) => String(room?.type) === 'study');
  assert.ok(studyRoom, 'Expected study room on upper level for this non-rect feature brief');
  assert.equal(studyRoom.zonePlacementSource, 'upper_zone_native');
  assert.equal(studyRoom.zoneGeometryMode, 'zone_native');
});

test('assembleOrthogonalPlanV2 preserves non-rect upper zone-native metadata across all functional variants', () => {
  const surveyData = {
    location: '',
    totalArea: '3000',
    stories: '2 Stories',
    bedrooms: '3 Bed',
    bathrooms: '3 Bath',
    privateBaths: '1',
    bedroomConfigs: null,
    shape: 'L-Shape',
    garage: '1 Car Garage',
    materials: 'Craftsman (Wood & Stone)',
    openConcept: 'Open Concept (Combined)',
    masterLocation: 'Level 2 (Upper)',
    kitchenPlacement: 'Rear of House',
    features: '',
    frontFacing: 'South',
    lotContext: 'Suburban standard lot',
    laundryLocation: 'Level 1 (near garage/mud)',
    ceilingHeight: 'Standard (9 ft)',
    indoorOutdoor: 'Moderate (some connection)',
    naturalLight: 'Balanced windows',
    accessibilityNeeds: 'None',
    budgetTier: 'Mid ($200-300/sqft)',
    freeformWishes: '',
  };

  const brief = normalizeBrief(surveyData);
  const support = resolveArchitectV2Support(brief);
  const interpretation = interpretBriefV2(brief, support);
  const program = buildProgramV2(brief, interpretation);
  const graph = buildRealmGraphV2(brief, interpretation, program.levels);
  const footprints = buildCandidateFootprintsV2(brief, interpretation);

  const byFunctional = new Map();
  for (const fp of footprints) {
    const functionalId = String(fp?.functionalId || '');
    if (!functionalId) continue;
    if (!byFunctional.has(functionalId)) {
      byFunctional.set(functionalId, fp);
    }
  }

  assert.deepEqual(
    [...byFunctional.keys()].sort(),
    ['front_core_compact', 'rear_service_pivot', 'side_spine_daylight'],
    'Expected one candidate per functional variant'
  );

  for (const [functionalId, footprint] of byFunctional.entries()) {
    const layout = assembleOrthogonalPlanV2({
      brief,
      interpretation,
      footprint,
      program,
      graph,
    });

    const level2 = layout.levels.find((level) => Number(level?.level) === 2);
    assert.ok(level2, `Expected level 2 for ${functionalId}`);
    const zoneNativeRooms = (level2.rooms || []).filter(
      (room) => String(room?.zonePlacementSource || '') === 'upper_zone_native'
    );
    assert.ok(zoneNativeRooms.length > 0, `Expected zone-native upper rooms for ${functionalId}`);
    for (const room of zoneNativeRooms) {
      assert.equal(String(room?.zoneGeometryMode || ''), 'zone_native');
    }
  }
});

test('assembleOrthogonalPlanV2 keeps suite buffer adjacent to primary bath across non-rect functional variants', () => {
  const surveyData = {
    location: '',
    totalArea: '3000',
    stories: '2 Stories',
    bedrooms: '3 Bed',
    bathrooms: '3 Bath',
    privateBaths: '1',
    bedroomConfigs: null,
    shape: 'L-Shape',
    garage: '1 Car Garage',
    materials: 'Craftsman (Wood & Stone)',
    openConcept: 'Open Concept (Combined)',
    masterLocation: 'Level 2 (Upper)',
    kitchenPlacement: 'Rear of House',
    features: '',
    frontFacing: 'South',
    lotContext: 'Suburban standard lot',
    laundryLocation: 'Level 1 (near garage/mud)',
    ceilingHeight: 'Standard (9 ft)',
    indoorOutdoor: 'Moderate (some connection)',
    naturalLight: 'Balanced windows',
    accessibilityNeeds: 'None',
    budgetTier: 'Mid ($200-300/sqft)',
    freeformWishes: '',
  };

  const brief = normalizeBrief(surveyData);
  const support = resolveArchitectV2Support(brief);
  const interpretation = interpretBriefV2(brief, support);
  const program = buildProgramV2(brief, interpretation);
  const graph = buildRealmGraphV2(brief, interpretation, program.levels);
  const footprints = buildCandidateFootprintsV2(brief, interpretation);
  const roomIdsByKey = new Map((graph?.nodes || []).map((node) => [String(node.key), String(node.roomId)]));

  const byFunctional = new Map();
  for (const fp of footprints) {
    const functionalId = String(fp?.functionalId || '');
    if (!functionalId || byFunctional.has(functionalId)) continue;
    byFunctional.set(functionalId, fp);
  }
  assert.equal(byFunctional.size, 3, 'Expected three functional variants');

  for (const [functionalId, footprint] of byFunctional.entries()) {
    const layout = assembleOrthogonalPlanV2({
      brief,
      interpretation,
      footprint,
      program,
      graph,
    });
    const level2 = layout.levels.find((level) => Number(level?.level) === 2);
    assert.ok(level2, `Expected level 2 for ${functionalId}`);
    const byId = new Map((level2.rooms || []).map((room) => [String(room.id), room]));
    const primaryBath = byId.get(roomIdsByKey.get('primary_bath_buffer'));
    const suiteBuffer = byId.get(roomIdsByKey.get('suite_buffer'));
    assert.ok(primaryBath, `Expected primary bath for ${functionalId}`);
    assert.ok(suiteBuffer, `Expected suite buffer for ${functionalId}`);
    assert.ok(shareWall(primaryBath, suiteBuffer, 2), `Expected suite buffer to stay adjacent to primary bath for ${functionalId}`);
  }
});

test('assembleOrthogonalPlanV2 keeps secondary private bath landing-adjacent with zone-native metadata across non-rect variants', () => {
  const surveyData = {
    location: '',
    totalArea: '3000',
    stories: '2 Stories',
    bedrooms: '3 Bed',
    bathrooms: '3 Bath',
    privateBaths: '2',
    bedroomConfigs: [
      { privateBath: 'Yes', closet: 'Walk-in' },
      { privateBath: 'Yes', closet: 'Standard' },
      { privateBath: 'No', closet: 'Standard' },
    ],
    shape: 'T-Shape',
    garage: '1 Car Garage',
    materials: 'Craftsman (Wood & Stone)',
    openConcept: 'Open Concept (Combined)',
    masterLocation: 'Level 2 (Upper)',
    kitchenPlacement: 'Rear of House',
    features: '',
    frontFacing: 'South',
    lotContext: 'Suburban standard lot',
    laundryLocation: 'Level 1 (near garage/mud)',
    ceilingHeight: 'Standard (9 ft)',
    indoorOutdoor: 'Moderate (some connection)',
    naturalLight: 'Balanced windows',
    accessibilityNeeds: 'None',
    budgetTier: 'Mid ($200-300/sqft)',
    freeformWishes: '',
  };

  const brief = normalizeBrief(surveyData);
  const support = resolveArchitectV2Support(brief);
  const interpretation = interpretBriefV2(brief, support);
  const program = buildProgramV2(brief, interpretation);
  const graph = buildRealmGraphV2(brief, interpretation, program.levels);
  const footprints = buildCandidateFootprintsV2(brief, interpretation);
  const roomIdsByKey = new Map((graph?.nodes || []).map((node) => [String(node.key), String(node.roomId)]));
  const secondaryPrivateBathId = roomIdsByKey.get('secondary_private_bath');
  assert.ok(secondaryPrivateBathId, 'Expected graph to include secondary_private_bath room id');

  const byFunctional = new Map();
  for (const fp of footprints) {
    const functionalId = String(fp?.functionalId || '');
    if (!functionalId || byFunctional.has(functionalId)) continue;
    byFunctional.set(functionalId, fp);
  }
  assert.equal(byFunctional.size, 3, 'Expected three functional variants');

  for (const [functionalId, footprint] of byFunctional.entries()) {
    const layout = assembleOrthogonalPlanV2({
      brief,
      interpretation,
      footprint,
      program,
      graph,
    });
    const level2 = layout.levels.find((level) => Number(level?.level) === 2);
    assert.ok(level2, `Expected level 2 for ${functionalId}`);
    const byId = new Map((level2.rooms || []).map((room) => [String(room.id), room]));
    const secondaryPrivateBath = byId.get(String(secondaryPrivateBathId));
    const landing = byId.get(String(level2?.stairCore?.landingRoomId || ''));
    assert.ok(secondaryPrivateBath, `Expected secondary private bath on ${functionalId}`);
    assert.ok(landing, `Expected landing on ${functionalId}`);
    assert.ok(
      shareWall(secondaryPrivateBath, landing, 2),
      `Expected secondary private bath to remain landing-adjacent on ${functionalId}`
    );
    assert.equal(String(secondaryPrivateBath.zonePlacementSource || ''), 'upper_zone_native');
    assert.equal(String(secondaryPrivateBath.zoneGeometryMode || ''), 'zone_native');
  }
});
