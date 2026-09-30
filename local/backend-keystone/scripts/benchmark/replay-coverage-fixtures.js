'use strict';
const { createRunContext, assertExpectedBuild } = require('./coverage-run-context');
const { validateEditedPlan } = require('../../lib/validateEditedPlan');
const { validateVariationDiversity } = require('../../lib/residential/v2/variationDiversityValidator');
const baseline = require('../../test/fixtures/coverage/baseline-20260924.json');
const gaps = require('../../test/fixtures/coverage/known-gaps.json');

async function main() {
  const origin = process.argv[2] || 'http://127.0.0.1:8096';
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname)) throw new Error('Use an explicitly started local server');
  const fixtureSet = process.argv[3] || 'gaps';
  const cases = fixtureSet === 'structure' ? baseline.structure : fixtureSet === 'survey' ? baseline.survey : fixtureSet === 'gaps' ? gaps.cases : null;
  if (!cases) throw new Error('Fixture set must be gaps, structure or survey');
  const context = createRunContext(cases.map(r => r.survey), `replay-${fixtureSet}`);
  const build = await (await fetch(`${origin}/health`)).json();
  assertExpectedBuild(build);
  const results = [];
  for (const fixture of cases) {
    const request = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ surveyData: fixture.survey }), signal: AbortSignal.timeout(120000) };
    const preflight = await (await fetch(`${origin}/api/plan/preflight`, request)).json();
    const start = performance.now();
    const response = await fetch(`${origin}/api/plan`, { ...request, signal: AbortSignal.timeout(120000) });
    const body = await response.json();
    const plans = body.success && body.planSpec ? [body.planSpec, ...(body.alternatives || []).map(o => o.planSpec)] : [];
    const errors = plans.flatMap((plan, option) => validateEditedPlan(plan, fixture.survey).map(error => ({ option, error })));
    const diversity = plans.length > 1 ? validateVariationDiversity(plans) : null;
    const row = { id: fixture.id, survey: fixture.survey, historical: fixture.observed,
      status: response.status, options: plans.length, valid: plans.length > 0 && !errors.length,
      threeDistinct: plans.length >= 3 && !errors.length && diversity?.valid === true,
      errors, diversity, preflight, code: body.code || body.error?.code || null,
      blockers: body.diagnostics?.blockers || [], rejectedExamples: body.diagnostics?.rejectedCandidates?.slice(0, 3),
      elapsedMs: Math.round(performance.now() - start) };
    results.push(row);
    // Persist partial results too, so interrupted runs retain usable evidence.
    context.finish({ complete: false, origin, build, fixtureSet, expectedCases: cases.length, results });
    console.log(`${fixture.id}: HTTP ${row.status}, ${row.options} options, valid=${row.valid}, distinct=${row.threeDistinct}`);
  }
  const regressions = results.filter(r => (r.historical.valid && !r.valid) || (r.historical.threeDistinct && !r.threeDistinct));
  context.finish({ complete: true, origin, build, fixtureSet, expectedCases: cases.length, results,
    summary: { total: results.length, valid: results.filter(r => r.valid).length, threeDistinct: results.filter(r => r.threeDistinct).length, regressions: regressions.map(r => r.id) } });
  console.log(context.metadata.outputDirectory);
  if (regressions.length) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
