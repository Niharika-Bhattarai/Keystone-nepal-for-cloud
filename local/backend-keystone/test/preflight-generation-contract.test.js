'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { preflightSurvey } = require('../lib/surveyPreflight');
const { structureCases, base } = require('../scripts/benchmark/generation-coverage');
const { invoke } = require('../scripts/benchmark/survey-delivery-audit');

test('every preflight-blocked brief in the fixed grid is refused in v2-only mode', async () => {
  const previous = process.env.V2_DISABLE_LEGACY_FALLBACK;
  process.env.V2_DISABLE_LEGACY_FALLBACK = 'true';
  try {
    let blocked = 0;
    const grid = structureCases();
    assert.equal(grid.length, 96);
    for (const survey of [...grid, {...base,lotWidth:'20',lotDepth:'20'}, {...base,features:'1 Study, 1 Gym'}]) {
      const preflight = preflightSurvey(survey);
      if (preflight.supported) continue;
      blocked++;
      const {status,body} = await invoke(survey);
      assert.equal(status, 422, JSON.stringify(survey));
      assert.equal(body.planSpec, undefined);
    }
    assert.ok(blocked > 0, 'The fixture must exercise refusals');
  } finally {
    if (previous === undefined) delete process.env.V2_DISABLE_LEGACY_FALLBACK;
    else process.env.V2_DISABLE_LEGACY_FALLBACK = previous;
  }
});

test('Square is eligible while an unsupported main-floor primary explains an alternative', () => {
  const square = preflightSurvey({ ...base, shape: 'Square' });
  assert.equal(square.supported, true);

  // A second en-suite is outside the main-floor suite's family.
  const mainFloorPrimary = preflightSurvey({ ...base, bedrooms: '3 Bed', bathrooms: '3 Bath', privateBaths: '2', masterLocation: 'Level 1 (Main)' });
  assert.equal(mainFloorPrimary.supported, false);
  assert.match(mainFloorPrimary.blockers.find(item => item.field === 'masterLocation')?.message || '', /upstairs primary suite.*one storey/i);
});
