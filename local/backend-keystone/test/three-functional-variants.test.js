'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { VARIATION_PROFILES } = require('../lib/residential/v2/variationProfiles');
const { planVariations } = require('../lib/residential/v2/variationPlannerV2');
const { normalizeBrief } = require('../lib/tile/normalizeBrief');
const { resolveArchitectV2Support } = require('../lib/residential/v2/supportMatrix');
const { interpretBriefV2 } = require('../lib/residential/v2/interpretBriefV2');
const { buildCandidateFootprintsV2 } = require('../lib/residential/v2/candidateFootprintsV2');

describe('three functional variant identities', () => {
  it('VARIATION_PROFILES has exactly 3 profiles with distinct functionalIds', () => {
    assert.equal(VARIATION_PROFILES.length, 3);
    const ids = VARIATION_PROFILES.map((p) => p.functionalId);
    assert.deepEqual(ids.sort(), ['front_core_compact', 'rear_service_pivot', 'side_spine_daylight']);
  });

  it('each profile has functionalId, functionalLabel, and functionalDescription', () => {
    for (const profile of VARIATION_PROFILES) {
      assert.ok(profile.functionalId, `missing functionalId on ${profile.id}`);
      assert.ok(profile.functionalLabel, `missing functionalLabel on ${profile.id}`);
      assert.ok(profile.functionalDescription, `missing functionalDescription on ${profile.id}`);
    }
  });

  it('each profile has lowerFloor configuration with stairAnchor', () => {
    for (const profile of VARIATION_PROFILES) {
      const lf = profile.twoStory?.lowerFloor;
      assert.ok(lf, `missing twoStory.lowerFloor on ${profile.id}`);
      assert.ok(lf.stairAnchor, `missing stairAnchor on ${profile.id}`);
      assert.ok(lf.publicZoneBias, `missing publicZoneBias on ${profile.id}`);
      assert.ok(lf.serviceEntryRelation, `missing serviceEntryRelation on ${profile.id}`);
    }
  });

  it('stairAnchors are distinct across profiles', () => {
    const anchors = VARIATION_PROFILES.map((p) => p.twoStory.lowerFloor.stairAnchor);
    assert.equal(new Set(anchors).size, 3, `Expected 3 distinct stairAnchors, got ${anchors}`);
  });

  it('functionalId maps to correct profile identity', () => {
    const map = {};
    for (const p of VARIATION_PROFILES) map[p.id] = p.functionalId;
    assert.equal(map.variant_a_compact_core, 'front_core_compact');
    assert.equal(map.variant_b_daylight_wing, 'side_spine_daylight');
    assert.equal(map.variant_c_service_spine, 'rear_service_pivot');
  });
});

describe('footprints carry functional identity', () => {
  it('two-story garage footprints have functionalId from their profile', () => {
    const brief = normalizeBrief({
      totalArea: '2400', stories: '2 Stories', bedrooms: '2 Bed',
      bathrooms: '2 Bath', shape: 'Rectangular', garage: '1 Car Garage',
      frontFacing: 'South', materials: 'Craftsman (Wood & Stone)',
      openConcept: 'Open Concept (Combined)', masterLocation: 'Level 2 (Upper)',
      kitchenPlacement: 'Rear of House', features: '',
    });
    const v2 = resolveArchitectV2Support(brief);
    assert.ok(v2.supported, 'brief should be v2 supported');
    const interp = interpretBriefV2(brief, v2);
    const footprints = buildCandidateFootprintsV2(brief, interp);

    const functionalIds = new Set(footprints.map((fp) => fp.functionalId));
    assert.ok(functionalIds.has('front_core_compact'));
    assert.ok(functionalIds.has('side_spine_daylight'));
    assert.ok(functionalIds.has('rear_service_pivot'));
    assert.equal(functionalIds.size, 3, `Expected 3 distinct functionalIds, got ${functionalIds.size}`);
  });

  it('every footprint has both variationId and functionalId', () => {
    const brief = normalizeBrief({
      totalArea: '2400', stories: '2 Stories', bedrooms: '3 Bed',
      bathrooms: '3 Bath', shape: 'Rectangular', garage: '1 Car Garage',
      frontFacing: 'South', materials: 'Craftsman (Wood & Stone)',
      openConcept: 'Open Concept (Combined)', masterLocation: 'Level 2 (Upper)',
      kitchenPlacement: 'Rear of House', features: '',
    });
    const v2 = resolveArchitectV2Support(brief);
    const interp = interpretBriefV2(brief, v2);
    const footprints = buildCandidateFootprintsV2(brief, interp);

    for (const fp of footprints) {
      assert.ok(fp.variationId, `missing variationId on footprint ${fp.widthFt}x${fp.heightFt}`);
      assert.ok(fp.functionalId, `missing functionalId on footprint ${fp.widthFt}x${fp.heightFt}`);
      assert.ok(fp.functionalLabel, `missing functionalLabel on footprint ${fp.widthFt}x${fp.heightFt}`);
    }
  });
});

describe('planVariations returns profiles with functional identity', () => {
  it('two-story profiles include functionalId', () => {
    const profiles = planVariations({ stories: 2 }, { stories: 2 });
    assert.equal(profiles.length, 3);
    for (const p of profiles) {
      assert.ok(p.functionalId, `missing functionalId on ${p.id}`);
    }
  });

  it('same payload returns same profile order (determinism)', () => {
    const brief = { stories: 2 };
    const interp = { stories: 2 };
    const run1 = planVariations(brief, interp).map((p) => p.id);
    const run2 = planVariations(brief, interp).map((p) => p.id);
    const run3 = planVariations(brief, interp).map((p) => p.id);
    assert.deepEqual(run1, run2);
    assert.deepEqual(run2, run3);
  });
});
