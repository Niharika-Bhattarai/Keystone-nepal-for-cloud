'use strict';
process.env.V2_DISABLE_LEGACY_FALLBACK = 'true';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeCases } = require('../scripts/benchmark/studio-full-coverage.cjs');
const { invoke } = require('../scripts/benchmark/survey-delivery-audit');
const { validateEditedPlan } = require('../lib/validateEditedPlan');
const { validateVariationDiversityV2 } = require('../lib/residential/v2/diversityMetricV2');

const cases = makeCases();
for (const id of ['struct-0189', 'struct-0192', 'struct-0197', 'struct-0222', 'struct-0225', 'struct-0342', 'struct-0372', 'struct-0347', 'struct-0377', 'struct-0503', 'struct-0533',
  'struct-0655', 'struct-0656', 'struct-0685', 'struct-0686',
  'struct-1138', 'struct-1144', 'struct-1148', 'struct-1198', 'struct-1204', 'struct-1208',
  'struct-1444', 'struct-1448', 'struct-1504', 'struct-1508', 'struct-1750', 'struct-1810']) {
  test(`${id}: family delivers three valid, architecturally different options`, async () => {
    const survey = cases.find(c => c.id === id).survey;
    const { body } = await invoke(survey);
    assert.equal(body.success, true, JSON.stringify(body.diagnostics));
    const plans = [body.planSpec, ...body.alternatives.map(a => a.planSpec)];
    assert.ok(plans.length >= 3, `Only ${plans.length} options`);
    for (const plan of plans) assert.deepEqual(validateEditedPlan(plan, survey), []);
    assert.equal(validateVariationDiversityV2(plans).valid, true);
  });
}
