'use strict';

// Exercise the deployed HTTP contract, including the actual fallback policy.
// Start a local server first; arguments are origin and report destination.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { structureCases } = require('./generation-coverage');
const { validateEditedPlan } = require('../../lib/validateEditedPlan');
const { validateVariationDiversity } = require('../../lib/residential/v2/variationDiversityValidator');

async function main() {
  const origin = process.argv[2] || 'http://localhost:8094';
  const destination = path.resolve(process.argv[3] || '../tmp/http-generation-audit.json');
  const cases = structureCases();
  const build = await (await fetch(`${origin}/health`)).json();
  const results = [];
  const failures = {};
  for (const [index, surveyData] of cases.entries()) {
    const preflightResponse = await fetch(`${origin}/api/plan/preflight`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ surveyData }),
    });
    if (!preflightResponse.ok) throw new Error(`Preflight failed: HTTP ${preflightResponse.status}`);
    const preflight = await preflightResponse.json();
    const started = performance.now();
    const response = await fetch(`${origin}/api/plan`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ surveyData }), signal: AbortSignal.timeout(120000),
    });
    const body = await response.json();
    const options = body.success && body.planSpec
      ? [body.planSpec, ...(body.alternatives || []).map(option => option.planSpec)] : [];
    const errors = options.flatMap((plan, option) => validateEditedPlan(plan, surveyData).map(error => ({ option, error })));
    const diversity = options.length > 1 ? validateVariationDiversity(options) : null;
    const row = { surveyData, status: response.status, elapsedMs: Math.round(performance.now() - started),
      options: options.length, valid: options.length > 0 && errors.length === 0,
      threeDistinct: options.length >= 3 && diversity?.valid === true, errors,
      preflight: { supported: preflight.supported, matrixEligible: preflight.v2Support?.supported,
        legacyFallbackEnabled: preflight.legacyFallbackEnabled, blockers: preflight.blockers },
      engine: body.engine, failureCode: body.error?.code || body.code || null,
      blockers: body.diagnostics?.blockers || [] };
    results.push(row);
    if (!row.valid) {
      const reasons = row.blockers.map(blocker => blocker.code);
      for (const reason of reasons.length ? reasons : [row.failureCode || `HTTP_${row.status}`]) failures[reason] = (failures[reason] || 0) + 1;
    }
    console.log(`${index + 1}/${cases.length}: ${row.status}, ${row.options} options, valid=${row.valid}, threeDistinct=${row.threeDistinct}`);
  }
  const preflight = await (await fetch(`${origin}/api/plan/preflight`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ surveyData: cases[0] }),
  })).json();
  const report = { date: new Date().toISOString(), build, origin,
    gridId: 'structure-96-three-bathrooms-v1', gridSha256: createHash('sha256').update(JSON.stringify(cases)).digest('hex'),
    fixedParameters: { bathrooms: '3 Bath', privateBaths: '1', features: 'None', shape: 'Rectangular', ...Object.fromEntries(Object.entries(cases[0]).filter(([key]) => !['totalArea','stories','bedrooms','garage','masterLocation'].includes(key))) },
    legacyFallbackEnabled: preflight.legacyFallbackEnabled,
    total: results.length, http200: results.filter(row => row.status === 200).length,
    validDelivered: results.filter(row => row.valid).length, threeDistinct: results.filter(row => row.valid && row.threeDistinct).length,
    failures, results };
  const subset = predicate => {
    const rows = results.filter(predicate);
    return { total: rows.length, validDelivered: rows.filter(row=>row.valid).length,
      threeDistinct: rows.filter(row=>row.valid&&row.threeDistinct).length,
      deliveryRate: rows.length ? rows.filter(row=>row.valid).length/rows.length : null };
  };
  // Eligibility is the support matrix's current capability declaration, not
  // proof that a brief is architecturally feasible or that room fitting succeeds.
  report.subsets = { all: subset(()=>true), matrixEligible: subset(row=>row.preflight.matrixEligible),
    preflightEligible: subset(row=>row.preflight.supported) };
  report.preflightContract = {
    blockedButDelivered: results.filter(row=>!row.preflight.supported&&row.status===200).map(row=>row.surveyData),
    // With fallback enabled, supported:false means v2-ineligible; a valid legacy
    // replacement can still be legitimate. The hard invariant applies in v2-only mode.
    violations: results.filter(row=>!row.preflight.legacyFallbackEnabled&&!row.preflight.supported&&row.status===200).length,
  };
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ gridSha256:report.gridSha256, subsets:report.subsets, preflightContract:report.preflightContract, destination }));
  if(report.preflightContract.violations) process.exitCode=1;
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
