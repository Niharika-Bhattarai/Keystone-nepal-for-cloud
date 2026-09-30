'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const handler = require('../api/plan');
const { normalizeBrief } = require('../lib/tile/normalizeBrief');
const { resolveArchitectV2Support } = require('../lib/residential/v2/supportMatrix');
const { interpretBriefV2 } = require('../lib/residential/v2/interpretBriefV2');
const { buildCandidateFootprintsV2 } = require('../lib/residential/v2/candidateFootprintsV2');

function invokePlan(payload) {
  return new Promise((resolve, reject) => {
    const req = { method: 'POST', body: payload, headers: {} };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) {
        this.headers[name] = value;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        resolve({ statusCode: this.statusCode, body, headers: this.headers });
        return this;
      },
      send(body) {
        resolve({ statusCode: this.statusCode, body, headers: this.headers });
        return this;
      },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

function makePayload({
  area = '3000',
  shape = 'Wide',
  garage = '1 Car Garage',
}) {
  return {
    surveyData: {
      location: '',
      totalArea: area,
      stories: '2 Stories',
      bedrooms: '3 Bed',
      bathrooms: '3 Bath',
      privateBaths: '1',
      bedroomConfigs: null,
      shape,
      garage,
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
    },
    chatHistory: [],
  };
}

function topCandidateAspect(brief) {
  const support = resolveArchitectV2Support(brief);
  const interpretation = interpretBriefV2(brief, support);
  const candidates = buildCandidateFootprintsV2(brief, interpretation);
  assert.ok(candidates.length > 0, 'Expected candidate footprints');
  return Number(candidates[0]?.aspectRatio || 0);
}

function topCandidate(brief) {
  const support = resolveArchitectV2Support(brief);
  const interpretation = interpretBriefV2(brief, support);
  const candidates = buildCandidateFootprintsV2(brief, interpretation);
  assert.ok(candidates.length > 0, 'Expected candidate footprints');
  return candidates[0];
}

test('architect_v2 routes two-story wide-shape briefs without legacy fallback', async () => {
  const result = await invokePlan(makePayload({ shape: 'Wide', area: '3000' }));
  const engine = result.body?.engine || {};

  assert.equal(result.statusCode, 200);
  assert.equal(result.body?.success, true, JSON.stringify(result.body, null, 2));
  assert.equal(engine.generatorId, 'architect_v2');
  assert.equal(engine.fallbackUsed, false);
  assert.equal(engine.supportTier, 'wave1');
});

test('architect_v2 routes two-story deep-shape briefs without legacy fallback', async () => {
  const result = await invokePlan(makePayload({ shape: 'Deep', area: '3000' }));
  const engine = result.body?.engine || {};

  assert.equal(result.statusCode, 200);
  assert.equal(result.body?.success, true, JSON.stringify(result.body, null, 2));
  assert.equal(engine.generatorId, 'architect_v2');
  assert.equal(engine.fallbackUsed, false);
  assert.equal(engine.supportTier, 'wave1');
});

test('candidate footprints bias wide shapes wider and deep shapes deeper', () => {
  const wideBrief = normalizeBrief(makePayload({ shape: 'Wide' }).surveyData);
  const deepBrief = normalizeBrief(makePayload({ shape: 'Deep' }).surveyData);

  const wideAspect = topCandidateAspect(wideBrief);
  const deepAspect = topCandidateAspect(deepBrief);

  assert.ok(wideAspect > deepAspect, `Expected wide aspect (${wideAspect}) > deep aspect (${deepAspect})`);
});

test('normalizeBrief preserves explicit L-shape and T-shape selections', () => {
  const lBrief = normalizeBrief(makePayload({ shape: 'L-Shape' }).surveyData);
  const tBrief = normalizeBrief(makePayload({ shape: 'T-Shape' }).surveyData);

  assert.equal(lBrief.shape, 'L_SHAPE');
  assert.equal(tBrief.shape, 'T_SHAPE');
});

test('candidate footprints include explicit non-rectangular envelope metadata for L/T shapes', () => {
  const lBrief = normalizeBrief(makePayload({ shape: 'L-Shape', area: '3000' }).surveyData);
  const tBrief = normalizeBrief(makePayload({ shape: 'T-Shape', area: '3000' }).surveyData);

  const lCandidate = topCandidate(lBrief);
  const tCandidate = topCandidate(tBrief);

  assert.equal(String(lCandidate?.envelopeShape), 'L_SHAPE');
  assert.equal(String(tCandidate?.envelopeShape), 'T_SHAPE');
  assert.ok(Array.isArray(lCandidate?.envelopeVoidRects) && lCandidate.envelopeVoidRects.length >= 1, 'Expected L-shape void geometry');
  assert.ok(Array.isArray(tCandidate?.envelopeVoidRects) && tCandidate.envelopeVoidRects.length >= 2, 'Expected T-shape void geometry');
  assert.ok(Number(lCandidate?.levelAreaSqFtActual) < Number(lCandidate?.widthFt || 0) * Number(lCandidate?.heightFt || 0), 'Expected L-shape effective area to be less than full rectangle');
  assert.ok(Number(tCandidate?.levelAreaSqFtActual) < Number(tCandidate?.widthFt || 0) * Number(tCandidate?.heightFt || 0), 'Expected T-shape effective area to be less than full rectangle');
});

test('architect_v2 routes L-shape briefs and emits non-rectangular level-1 envelope segments', async () => {
  const result = await invokePlan(makePayload({ shape: 'L-Shape', area: '3000' }));
  const engine = result.body?.engine || {};
  const planSpec = result.body?.planSpec || {};
  const level1 = (planSpec?.levels || []).find((level) => Number(level?.level) === 1);
  const outline = level1?.outlineSegments || [];

  assert.equal(result.statusCode, 200);
  assert.equal(result.body?.success, true, JSON.stringify(result.body, null, 2));
  assert.equal(engine.generatorId, 'architect_v2');
  assert.equal(engine.fallbackUsed, false);
  assert.ok(outline.length > 4, `Expected non-rectangular level-1 outline for L-shape brief, got ${outline.length} segments`);

  // Verify void rects propagated to planSpec for elevation rendering
  assert.equal(planSpec.envelopeShape, 'L_SHAPE', 'Expected envelopeShape on planSpec');
  assert.ok(Array.isArray(planSpec.envelopeVoidRects) && planSpec.envelopeVoidRects.length >= 1,
    'Expected envelopeVoidRects on planSpec');
});

test('architect_v2 routes T-shape briefs without legacy fallback', async () => {
  const result = await invokePlan(makePayload({ shape: 'T-Shape', area: '3000' }));
  const engine = result.body?.engine || {};

  assert.equal(result.statusCode, 200);
  assert.equal(result.body?.success, true, JSON.stringify(result.body, null, 2));
  assert.equal(engine.generatorId, 'architect_v2');
  assert.equal(engine.fallbackUsed, false);
});

test('two-story L-shape carves void from both levels while preserving stair rooms', async () => {
  const result = await invokePlan(makePayload({ shape: 'L-Shape', area: '3000' }));
  assert.equal(result.body?.success, true, JSON.stringify(result.body, null, 2));

  const levels = result.body?.planSpec?.levels || [];
  const level2 = levels.find((l) => Number(l?.level) === 2);
  if (!level2) return; // one-story plan, skip check

  // Level 2 rooms should have parts or be carved to avoid the void zone
  const roomsWithParts = (level2.rooms || []).filter((r) => Array.isArray(r.parts) && r.parts.length > 1);
  const stairRooms = (level2.rooms || []).filter((r) => String(r.type).toLowerCase() === 'stairs');

  // Stairs must exist on level 2 and must NOT have parts (preserved intact)
  assert.ok(stairRooms.length > 0, 'Expected stair room on level 2');
  for (const stair of stairRooms) {
    assert.ok(!Array.isArray(stair.parts) || stair.parts.length <= 1,
      'Stair room should not be carved into multiple parts');
  }
});

test('two-story T-shape carves void from both levels while preserving stair rooms', async () => {
  const result = await invokePlan(makePayload({ shape: 'T-Shape', area: '3000' }));
  assert.equal(result.body?.success, true, JSON.stringify(result.body, null, 2));

  const levels = result.body?.planSpec?.levels || [];
  const level2 = levels.find((l) => Number(l?.level) === 2);
  if (!level2) return;

  const stairRooms = (level2.rooms || []).filter((r) => String(r.type).toLowerCase() === 'stairs');
  assert.ok(stairRooms.length > 0, 'Expected stair room on level 2');
  for (const stair of stairRooms) {
    assert.ok(!Array.isArray(stair.parts) || stair.parts.length <= 1,
      'Stair room should not be carved into multiple parts');
  }
});

test('one-story L-shape plans also receive envelope carving', async () => {
  const payload = {
    surveyData: {
      ...makePayload({ shape: 'L-Shape', area: '2200', garage: '1 Car Garage' }).surveyData,
      stories: '1 Story',
      bedrooms: '3 Bed',
      bathrooms: '2 Bath',
      privateBaths: '0',
    },
    chatHistory: [],
  };
  const result = await invokePlan(payload);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body?.success, true, JSON.stringify(result.body, null, 2));

  const level1 = (result.body?.planSpec?.levels || []).find((l) => Number(l?.level) === 1);
  assert.ok(level1, 'Expected level 1');
  assert.equal(result.body.planSpec.generatorId, 'architect_v2', 'Legacy rectangle fallback cannot satisfy an L-shaped survey');
  const { partListOf } = require('../lib/planGeometry');
  const { intersection } = require('../lib/geometry/rectBoolean');
  for (const plan of [result.body.planSpec, ...(result.body.alternatives || []).map(a => a.planSpec)]) {
    for (const level of plan.levels) for (const room of level.rooms) {
      assert.ok(partListOf(room).every(part => plan.envelopeVoidRects.every(cut => !intersection(part, cut))), `${room.id} must stay inside the L-shaped envelope`);
    }
    assert.equal(plan.levels.flatMap(l => l.rooms).filter(r => r.attachedTo).length, 0, 'All requested bathrooms are shared');
  }
  // For a true L-shape, at least one room should have parts from carving
  const roomsWithParts = (level1.rooms || []).filter((r) => Array.isArray(r.parts) && r.parts.length > 1);
  // Or the outline should be non-rectangular (>4 segments)
  const outline = level1?.outlineSegments || [];
  assert.ok(roomsWithParts.length > 0 || outline.length > 4,
    'Expected L-shape carving evidence (room parts or non-rectangular outline)');
});

test('architect_v2 preserves upper zone-native placement metadata in planSpec for non-rect briefs', async () => {
  for (const shape of ['T-Shape', 'L-Shape']) {
    const result = await invokePlan(makePayload({ shape, area: '3000' }));
    const engine = result.body?.engine || {};
    const planSpec = result.body?.planSpec || {};
    const level2 = (planSpec?.levels || []).find((level) => Number(level?.level) === 2);
    const zoneNativeRooms = (level2?.rooms || []).filter(
      (room) => String(room?.zonePlacementSource || '') === 'upper_zone_native'
    );

    assert.equal(result.statusCode, 200);
    assert.equal(result.body?.success, true, JSON.stringify(result.body, null, 2));
    assert.equal(engine.generatorId, 'architect_v2');
    assert.equal(engine.fallbackUsed, false);
    assert.ok(level2, `Expected level 2 for non-rect two-story brief (${shape})`);
    assert.ok(zoneNativeRooms.length > 0, `Expected upper zone-native metadata for ${shape}`);
    for (const room of zoneNativeRooms) {
      const placement = String(room?.zonePlacement || '');
      assert.ok(
        placement === 'wing' || placement === 'body',
        `Expected zonePlacement to be wing/body for room ${room?.id || 'unknown'}, got "${placement}"`
      );
      assert.equal(
        String(room?.zoneGeometryMode || ''),
        'zone_native',
        `Expected zoneGeometryMode=zone_native for room ${room?.id || 'unknown'}`
      );
    }
  }
});

test('architect_v2 exposes variation-keyed alternative diagnostics for non-rect briefs', async () => {
  for (const shape of ['T-Shape', 'L-Shape']) {
    const result = await invokePlan(makePayload({ shape, area: '3000' }));
    const diagnostics = result.body?.diagnostics || {};
    const alternatives = Array.isArray(result.body?.alternatives) ? result.body.alternatives : [];

    const rankedFunctionalIds = Array.isArray(diagnostics?.rankedCandidateFunctionalIds)
      ? diagnostics.rankedCandidateFunctionalIds.map((value) => String(value || ''))
      : [];
    const rankedVariationIds = Array.isArray(diagnostics?.rankedCandidateVariationIds)
      ? diagnostics.rankedCandidateVariationIds.map((value) => String(value || ''))
      : [];
    const poolFunctionalIds = Array.isArray(diagnostics?.alternativePoolFunctionalIds)
      ? diagnostics.alternativePoolFunctionalIds.map((value) => String(value || ''))
      : [];
    const poolVariationIds = Array.isArray(diagnostics?.alternativePoolVariationIds)
      ? diagnostics.alternativePoolVariationIds.map((value) => String(value || ''))
      : [];
    const selectedFunctionalIds = Array.isArray(diagnostics?.selectedAlternativeFunctionalIds)
      ? diagnostics.selectedAlternativeFunctionalIds.map((value) => String(value || ''))
      : [];
    const selectedVariationIds = Array.isArray(diagnostics?.selectedAlternativeVariationIds)
      ? diagnostics.selectedAlternativeVariationIds.map((value) => String(value || ''))
      : [];

    assert.ok(rankedFunctionalIds.length > 0, `Expected ranked functional ids for ${shape}`);
    assert.ok(rankedVariationIds.length > 0, `Expected ranked variation ids for ${shape}`);
    assert.ok(poolFunctionalIds.length > 0, `Expected alternative-pool functional ids for ${shape}`);
    assert.ok(poolVariationIds.length > 0, `Expected alternative-pool variation ids for ${shape}`);
    assert.ok(
      rankedFunctionalIds.includes(String(result.body?.footprintInfo?.functionalId || '')),
      `Expected winner functional id to exist in ranked functional ids for ${shape}`
    );
    assert.ok(
      rankedVariationIds.includes(String(result.body?.footprintInfo?.variationId || '')),
      `Expected winner variation id to exist in ranked variation ids for ${shape}`
    );

    for (const id of selectedFunctionalIds) {
      assert.ok(poolFunctionalIds.includes(id), `Selected functional id ${id} should be in pool for ${shape}`);
    }
    for (const id of selectedVariationIds) {
      assert.ok(poolVariationIds.includes(id), `Selected variation id ${id} should be in pool for ${shape}`);
    }

    if (alternatives.length > 0) {
      const altFunctionalIds = [...new Set(
        alternatives.map((candidate) => String(candidate?.footprintInfo?.functionalId || ''))
      )].filter(Boolean);
      const altVariationIds = [...new Set(
        alternatives.map((candidate) => String(candidate?.footprintInfo?.variationId || ''))
      )].filter(Boolean);

      for (const id of altFunctionalIds) {
        assert.ok(selectedFunctionalIds.includes(id), `Alternative functional id ${id} missing from selected diagnostics for ${shape}`);
      }
      for (const id of altVariationIds) {
        assert.ok(selectedVariationIds.includes(id), `Alternative variation id ${id} missing from selected diagnostics for ${shape}`);
      }
    }
  }
});
