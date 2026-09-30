'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { planVariations, ONE_STORY_PROFILES } = require('../lib/residential/v2/variationPlannerV2');
const { VARIATION_PROFILES } = require('../lib/residential/v2/variationProfiles');

describe('variationPlannerV2', () => {
  it('two-story brief returns 3 profiles with existing IDs', () => {
    const profiles = planVariations({ stories: 2 }, { stories: 2 });
    assert.equal(profiles.length, 3);
    assert.equal(profiles[0].id, 'variant_a_compact_core');
    assert.equal(profiles[1].id, 'variant_b_daylight_wing');
    assert.equal(profiles[2].id, 'variant_c_service_spine');
  });

  it('one-story brief returns 3 profiles with new IDs', () => {
    const profiles = planVariations({ stories: 1 }, { stories: 1 });
    assert.equal(profiles.length, 3);
    assert.equal(profiles[0].id, 'variant_d_wide_front_living');
    assert.equal(profiles[1].id, 'variant_e_deep_garden_spine');
    assert.equal(profiles[2].id, 'variant_f_central_hub');
  });

  it('all returned profiles have id, label, theme fields', () => {
    const twoStory = planVariations({ stories: 2 }, {});
    const oneStory = planVariations({ stories: 1 }, {});
    for (const p of [...twoStory, ...oneStory]) {
      assert.ok(typeof p.id === 'string' && p.id.length > 0, `id missing: ${JSON.stringify(p)}`);
      assert.ok(typeof p.label === 'string' && p.label.length > 0, `label missing: ${JSON.stringify(p)}`);
      assert.ok(typeof p.theme === 'string' && p.theme.length > 0, `theme missing: ${JSON.stringify(p)}`);
    }
  });

  it('one-story profiles have oneStory sub-object with required fields', () => {
    const profiles = planVariations({ stories: 1 }, {});
    for (const p of profiles) {
      assert.ok(p.oneStory, `oneStory missing on ${p.id}`);
      assert.ok(typeof p.oneStory.publicZoneRatio === 'number');
      assert.ok(typeof p.oneStory.wingStyle === 'string');
      assert.ok(typeof p.oneStory.servicePosition === 'string');
      assert.ok(typeof p.oneStory.targetAspect === 'number');
      assert.ok(Array.isArray(p.oneStory.depthOffsets));
      assert.ok(Array.isArray(p.oneStory.widthOffsets));
    }
  });

  it('two-story profiles are backward-compatible with VARIATION_PROFILES', () => {
    const profiles = planVariations({ stories: 2 }, {});
    for (let i = 0; i < 3; i++) {
      assert.deepStrictEqual(profiles[i], VARIATION_PROFILES[i]);
    }
  });

  it('one-story profiles have distinct targetAspect values', () => {
    const profiles = planVariations({ stories: 1 }, {});
    const aspects = profiles.map(p => p.oneStory.targetAspect);
    const unique = new Set(aspects);
    assert.equal(unique.size, 3, `Expected 3 distinct aspects, got: ${aspects}`);
  });
});
