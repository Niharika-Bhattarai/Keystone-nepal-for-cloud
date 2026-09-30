'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getAdapter, listRegisteredPatterns, PATTERN_ADAPTER_MAP } = require('../lib/residential/v2/familyAdapterRegistry');

describe('familyAdapterRegistry', () => {
  it('returns adapter for all known two-story garage patterns', () => {
    const patterns = [
      'two_story_upper_primary_with_garage',
      'two_story_upper_primary_with_garage_three_bed',
      'two_story_upper_primary_with_garage_study',
    ];
    for (const pattern of patterns) {
      const adapter = getAdapter(pattern);
      assert.ok(adapter, `expected adapter for ${pattern}`);
      assert.equal(typeof adapter.assembleLayout, 'function');
    }
  });

  it('returns adapter for all known two-story compact patterns', () => {
    const patterns = [
      'two_story_upper_primary_compact',
      'two_story_upper_primary_three_bed_compact',
    ];
    for (const pattern of patterns) {
      const adapter = getAdapter(pattern);
      assert.ok(adapter, `expected adapter for ${pattern}`);
      assert.equal(typeof adapter.assembleLayout, 'function');
    }
  });

  it('returns adapter for one-story patterns', () => {
    const patterns = [
      'one_story_central_core_compact',
      'one_story_split_bedroom_compact',
      'one_story_large_split_bedroom_compact',
      'one_story_central_core_with_garage',
      'one_story_split_bedroom_with_garage',
      'one_story_large_split_bedroom_with_garage',
    ];
    for (const pattern of patterns) {
      const adapter = getAdapter(pattern);
      assert.ok(adapter, `expected adapter for ${pattern}`);
      assert.equal(typeof adapter.assembleLayout, 'function');
    }
  });

  it('returns null for unknown patterns', () => {
    assert.equal(getAdapter('nonexistent_pattern'), null);
    assert.equal(getAdapter(''), null);
    assert.equal(getAdapter(undefined), null);
  });

  it('listRegisteredPatterns returns all 15 patterns including one-story large-family and main-floor suite variants', () => {
    const patterns = listRegisteredPatterns();
    assert.equal(patterns.length, 15);
    assert.ok(patterns.includes('two_story_main_primary_with_garage_three_bed'));
    assert.ok(patterns.includes('two_story_main_primary_with_garage'));
    assert.ok(patterns.includes('two_story_upper_primary_with_garage'));
    assert.ok(patterns.includes('two_story_upper_primary_with_garage_four_bed'));
    assert.ok(patterns.includes('two_story_upper_primary_four_bed_compact'));
    assert.ok(patterns.includes('one_story_central_core_compact'));
    assert.ok(patterns.includes('one_story_split_bedroom_compact'));
    assert.ok(patterns.includes('one_story_large_split_bedroom_compact'));
    assert.ok(patterns.includes('one_story_central_core_with_garage'));
    assert.ok(patterns.includes('one_story_split_bedroom_with_garage'));
    assert.ok(patterns.includes('one_story_large_split_bedroom_with_garage'));
  });

  it('two-story garage and compact use different adapters', () => {
    const garage = getAdapter('two_story_upper_primary_with_garage');
    const compact = getAdapter('two_story_upper_primary_compact');
    assert.notEqual(garage, compact);
  });

  it('all adapters in PATTERN_ADAPTER_MAP export assembleLayout function', () => {
    for (const [pattern, adapter] of Object.entries(PATTERN_ADAPTER_MAP)) {
      assert.equal(typeof adapter.assembleLayout, 'function', `${pattern} adapter missing assembleLayout`);
    }
  });
});
