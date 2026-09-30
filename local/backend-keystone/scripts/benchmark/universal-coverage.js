'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { base } = require('./generation-coverage');
const { SURVEY_FIELDS } = require('../../lib/surveyFieldRegistry');
const domain = require('../../test/fixtures/coverage/domain-v1.json');
const baseline = require('../../test/fixtures/coverage/baseline-20260924.json');
const { createRunContext, assertExpectedBuild } = require('./coverage-run-context');
const { compareMetrics } = require('../../lib/residential/v2/diversityMetricV2');
const {buildSurveyFulfillment}=require('../../lib/surveyFulfillment');
const { classifyGenerationResult, summarizeCoverage } = require('../../lib/generationDiagnostics');
const { validateEditedPlan } = require('../../lib/validateEditedPlan');
const { validateVariationDiversity } = require('../../lib/residential/v2/variationDiversityValidator');
const { validateOriginalSurveyCounts } = require('../../lib/surveyRequirements');

function structuralCases() {
  const rows = [];
  const d = domain.structural;
  for (const state of d.storeyPrimaryStates) for (const beds of d.bedrooms) for (const baths of d.bathrooms) for (const area of d.areas) for (const garage of d.garages) {
    rows.push({ id: `structure-${rows.length + 1}`, survey: { ...base, ...state,
      bedrooms: `${beds} Bed`, bathrooms: `${baths} Bath`, totalArea: String(area), garage,
      privateBaths: baths === 1 ? '0' : '1' } });
  }
  return rows;
}
function categoricalAxes() {
  return [
    ...domain.categoricalFields.map(field => ({ field, values: SURVEY_FIELDS[field].values.filter(value => !domain.compatibilityShapes.includes(value)) })),
    ...domain.featureChips.map(feature => ({ field: `feature:${feature}`, values: [false, true] })),
    { field: 'legacyShape', values: [null, ...domain.compatibilityShapes] },
  ];
}
const pairKey = (i, a, j, b) => `${i}:${a}|${j}:${b}`;
function pairwiseCases() {
  const axes = categoricalAxes();
  // Legacy shape is exercised separately; combining it as an override would
  // falsely count a visible Square value that never reaches the actual survey.
  const active = axes.filter(a => a.field !== 'legacyShape');
  const uncovered = new Map();
  for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) {
    for (let a = 0; a < active[i].values.length; a++) for (let b = 0; b < active[j].values.length; b++) uncovered.set(pairKey(i, a, j, b), [i, a, j, b]);
  }
  const allPairs = [...uncovered.keys()];
  const cases = [];
  while (uncovered.size) {
    const [i, a, j, b] = uncovered.values().next().value;
    const selected = new Map([[i, a], [j, b]]);
    for (let k = 0; k < active.length; k++) {
      if (selected.has(k)) continue;
      let best = 0, bestScore = -1;
      for (let v = 0; v < active[k].values.length; v++) {
        let score = 0;
        for (const [other, value] of selected) {
          const key = other < k ? pairKey(other, value, k, v) : pairKey(k, v, other, value);
          if (uncovered.has(key)) score++;
        }
        if (score > bestScore) { best = v; bestScore = score; }
      }
      selected.set(k, best);
    }
    const coveredPairs = [];
    for (let x = 0; x < active.length; x++) for (let y = x + 1; y < active.length; y++) {
      const key = pairKey(x, selected.get(x), y, selected.get(y));
      if (uncovered.delete(key)) coveredPairs.push(key);
    }
    const survey = { ...base, totalArea: '3200', privateBaths: '1' };
    const featureList = [];
    const selections = {};
    active.forEach((axis, index) => {
      const value = axis.values[selected.get(index)];
      selections[axis.field] = value;
      if (axis.field.startsWith('feature:')) { if (value) featureList.push(`1 ${axis.field.slice(8)}`); }
      else survey[axis.field] = value;
    });
    survey.features = featureList.join(', ');
    survey.outdoorArea = survey.outdoorLiving === 'None' ? '0' : '160';
    cases.push({ id: `pairwise-${cases.length + 1}`, survey, selections, coveredPairs });
  }
  return { axes: active, cases, totalPairs: allPairs.length, coveredPairs: allPairs, uncoveredPairs: [] };
}
function stressCases() {
  const patches = [
    ['compact-two-car-front-kitchen', { totalArea: '1800', garage: '2 Car Garage', kitchenPlacement: 'Front of House' }],
    ['wide-tall-l', { totalArea: '3200', accessibilityNeeds: 'Wide doorways', ceilingHeight: 'Tall (10 ft)', shape: 'L-Shaped' }],
    ['wide-tall-t', { totalArea: '3200', accessibilityNeeds: 'Wide doorways', ceilingHeight: 'Tall (10 ft)', shape: 'T-Shaped' }],
    ['main-primary-private-baths-garage', { totalArea: '3200', masterLocation: 'Level 1 (Main)', privateBaths: '2', garage: '2 Car Garage' }],
    ['basement-wheelchair-two-storey', { foundationType: 'Full basement', accessibilityNeeds: 'Wheelchair accessible' }],
    ['outdoor-small-lot-rotated', { outdoorLiving: 'Open deck', outdoorArea: '160', lotWidth: '30', lotDepth: '40', frontFacing: 'West' }],
    ['vault-upper-stair', { ceilingHeight: 'Cathedral / Vaulted', laundryLocation: 'Level 2 (near bedrooms)' }],
    ['all-feature-rooms', { totalArea: '10000', bathrooms: '5 Bath', features: domain.featureChips.map(f => `1 ${f}`).join(', ') }],
  ];
  return patches.map(([id, patch]) => ({ id, survey: { ...base, ...patch } }));
}
async function main() {
  const mode = process.argv[2] || 'inventory';
  const pairwise = pairwiseCases();
  const sets = { historical: baseline.structure, structural: structuralCases(), pairwise: pairwise.cases, stress: stressCases(),
    compatibility: domain.compatibilityShapes.map(shape => ({ id: `legacy-${shape}`, survey: { ...base, totalArea: '3200', shape } })) };
  if (mode === 'inventory') {
    const context = createRunContext(sets, 'domain-inventory');
    context.finish({ complete: true, domainId: domain.domainId, counts: Object.fromEntries(Object.entries(sets).map(([key, rows]) => [key, rows.length])), pairwise, sets });
    console.log(context.metadata.outputDirectory);
    return;
  }
  const cases = sets[mode];
  if (!cases) throw new Error(`Choose inventory or one of ${Object.keys(sets).join(', ')}`);
  const origin = process.argv[3] || 'http://127.0.0.1:8096';
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) throw new Error('Use a local server');
  const context = createRunContext(cases.map(r => r.survey), `universal-${mode}`);
  const build = await (await fetch(`${origin}/health`)).json();
  assertExpectedBuild(build);
  const results = [];
  for (const fixture of cases) {
    const started = performance.now();
    let row;
    try {
      const post = async endpoint => fetch(`${origin}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ surveyData: fixture.survey }), signal: AbortSignal.timeout(120000) });
      const preflightResponse = await post('/api/plan/preflight');
      if (!preflightResponse.ok) throw new Error(`Preflight HTTP ${preflightResponse.status}`);
      const preflight = await preflightResponse.json();
      const response = await post('/api/plan');
      const body = await response.json();
      const plans = body.success && body.planSpec ? [body.planSpec, ...(body.alternatives || []).map(o => o.planSpec)] : [];
      const errors = plans.flatMap((plan, option) => [
        ...validateEditedPlan(plan, fixture.survey), ...validateOriginalSurveyCounts(plan, fixture.survey),
      ].map(error => ({ option, error })));
      const diversity = plans.length > 1 ? validateVariationDiversity(plans) : null;
      const diversityComparison = compareMetrics(plans);
      // Recompute from returned geometry and the submitted survey; never trust
      // a copied response ledger as independent evidence.
      const fulfillment=plans.map(plan=>buildSurveyFulfillment(plan,fixture.survey).summary);
      row = { id: fixture.id, survey: fixture.survey, historical: fixture.observed, preflight,
        status: response.status, options: plans.length, valid: plans.length > 0 && !errors.length,
        threeDistinct: plans.length >= 3 && !errors.length && diversity?.valid === true, errors, diversity,
        diversityComparison,
        fulfillment,
        allFieldsVerified:plans.length>0&&fulfillment.every(summary=>summary.complete),
        threeDistinctV2: plans.length >= 3 && !errors.length && diversityComparison.v2ValidPairs === diversityComparison.pairCount,
        code: body.code || null, blockers: body.diagnostics?.blockers || [], triedCandidateCount: body.diagnostics?.triedCandidateCount ?? null };
      row.classification = classifyGenerationResult({ ...row, body });
    } catch (error) {
      row = { id: fixture.id, survey: fixture.survey, valid: false, threeDistinct: false, options: 0,
        classification: error.name === 'TimeoutError' ? 'time_budget_exceeded' : 'transport_or_validation_error', error: error.message };
    }
    row.elapsedMs = Math.round(performance.now() - started);
    results.push(row);
    context.finish({ complete: false, expectedCases: cases.length, mode, domainId: domain.domainId, origin, build, summary: summarizeCoverage(results), results });
    console.log(`${results.length}/${cases.length} ${row.id}: ${row.classification}, ${row.options} options`);
  }
  const summary = summarizeCoverage(results);
  const report = context.finish({ complete: true, expectedCases: cases.length, mode, domainId: domain.domainId, origin, build, summary, results });
  fs.writeFileSync(path.join(context.metadata.outputDirectory, 'unresolved-inputs.json'), JSON.stringify(results.filter(r => !r.threeDistinct).map(r => ({ id: r.id, survey: r.survey, classification: r.classification })), null, 2));
  console.log(JSON.stringify({ summary, outputDirectory: report.provenance.outputDirectory }));
  if (results.some(r => r.classification === 'invalid_delivery' || r.historical?.valid && !r.valid || r.historical?.threeDistinct && !r.threeDistinct)) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { structuralCases, categoricalAxes, pairwiseCases, stressCases };
