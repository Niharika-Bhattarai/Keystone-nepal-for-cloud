'use strict';
// C5e: the exterior render prompt must not ask for an entry structure the plan
// does not have. Every style's finish spec carries a porch or portico type, but
// the generator places no outdoor structures (0 of 124 real plans have one), and
// the same prompt forbids adding porches the plan does not support.
const test = require('node:test'), assert = require('node:assert/strict');
const { buildPlanGroundedPrompt, buildStyleDescription } = require('../api/render');
const fixture = require('./fixtures/model3d-plan.json');

const prompt = (planSpec) => buildPlanGroundedPrompt({ surveyData: { materials: 'Craftsman (Wood & Stone)' }, planSpec });
const withoutRule = (text) => text.replace('Do not add or remove wings, porches, garages, bump-outs, dormers, or roof volumes that are not supported by the plan.', '');

test('a plan without a porch gets a plain entry, not the style\'s porch type', () => {
  const plan = structuredClone(fixture);
  assert.equal(plan.finishSpec.entryExpression.porchType, 'covered_with_columns');
  const text = prompt(plan);
  assert.doesNotMatch(text, /Entry: covered/);
  assert.doesNotMatch(text, /tapered craftsman columns/);
  assert.match(text, /Entry: the plan's main door with style-appropriate trim; no porch, portico or covered entry \(the plan has none\)/);
  assert.doesNotMatch(withoutRule(text), /porch cues|covered entry(?! \(the plan has none\))/);
});

test('a plan with a porch room keeps the style\'s entry expression', () => {
  const plan = structuredClone(fixture);
  plan.levels[0].rooms.push({ id: 'porch', type: 'covered_porch', label: 'Covered Porch', x: 0, y: 0, w: 8, h: 6 });
  assert.match(prompt(plan), /Entry: covered with columns with tapered craftsman columns/);
});

test('style fallbacks describe no porch or covered entry', () => {
  for (const budget of ['Mid ($200-300/sqft)', 'Luxury ($400+/sqft)']) {
    const text = buildStyleDescription('Modern Farmhouse (Board & Batten)', budget);
    assert.doesNotMatch(text, /porch|covered entry/i, text);
  }
});
