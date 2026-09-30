'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { base } = require('../scripts/benchmark/generation-coverage');
const { invoke } = require('../scripts/benchmark/survey-delivery-audit');
const { validateEditedPlan } = require('../lib/validateEditedPlan');

test('v2 replaces the six single-storey no-garage briefs previously delivered only by legacy', async () => {
  const previous = process.env.V2_DISABLE_LEGACY_FALLBACK;
  process.env.V2_DISABLE_LEGACY_FALLBACK = 'true';
  try {
    for (const [beds, area] of [[2,1200],[3,1800],[3,2400],[3,3200],[4,1800],[5,3200]]) {
      const survey = { ...base, stories:'1 Story', bedrooms:`${beds} Bed`, totalArea:String(area), garage:'None', masterLocation:'Level 1 (Main)' };
      const { status, body } = await invoke(survey);
      assert.equal(status, 200, `${beds} bedrooms at ${area} sq ft`);
      assert.equal(body.engine.generatorId, 'architect_v2');
      assert.equal(body.engine.fallbackUsed, false);
      for (const plan of [body.planSpec, ...body.alternatives.map(option => option.planSpec)]) {
        assert.deepEqual(validateEditedPlan(plan, survey), []);
        assert.equal(plan.levels.flatMap(level => level.rooms).filter(room => ['primary_bedroom','bedroom'].includes(room.type)).length, beds);
      }
      if (beds === 4) {
        assert.ok(body.alternatives.length >= 2, 'compact four-bedroom brief needs three distinct options');
        assert.equal(body.diversityMetrics.valid, true);
      }
    }
  } finally {
    if (previous === undefined) delete process.env.V2_DISABLE_LEGACY_FALLBACK;
    else process.env.V2_DISABLE_LEGACY_FALLBACK = previous;
  }
});
