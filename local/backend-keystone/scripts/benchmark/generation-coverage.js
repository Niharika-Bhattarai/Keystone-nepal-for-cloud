'use strict';

// Reproducible v2 coverage without falling through to the legacy generator.
// Uses exactly the candidate construction and validation used by /api/plan.
const fs = require('node:fs');
const path = require('node:path');
const { normalizeBrief } = require('../../lib/tile/normalizeBrief');
const { resolveArchitectV2Support } = require('../../lib/residential/v2/supportMatrix');
const { interpretBriefV2 } = require('../../lib/residential/v2/interpretBriefV2');
const { buildCandidateFootprintsV2 } = require('../../lib/residential/v2/candidateFootprintsV2');
const { tryGenerateArchitectV2Candidate } = require('../../lib/residential/v2/candidateGeneration');

const base = {
  totalArea: '2400', stories: '2 Stories', bedrooms: '3 Bed', bathrooms: '3 Bath',
  privateBaths: '1', garage: '1 Car Garage', features: 'None', shape: 'Rectangular',
  frontFacing: 'South', lotContext: 'Suburban standard lot',
  openConcept: 'Open Concept (Combined)', masterLocation: 'Level 2 (Upper)',
  kitchenPlacement: 'Rear of House', laundryLocation: 'Level 1 (near garage/mud)',
  materials: 'Craftsman (Wood & Stone)', ceilingHeight: 'Standard (9 ft)',
  indoorOutdoor: 'Moderate (some connection)', naturalLight: 'Balanced windows',
  accessibilityNeeds: 'None', budgetTier: 'Mid ($200-300/sqft)',
};

function runCase(surveyData) {
  const brief = normalizeBrief(surveyData);
  const support = resolveArchitectV2Support(brief);
  if (!support.supported) return { surveyData, supported: false, reasons: support.reasons, accepted: 0 };
  const interpretation = interpretBriefV2(brief, support);
  const errors = new Map();
  const accepted = [];
  for (const footprint of buildCandidateFootprintsV2(brief, interpretation)) {
    const candidate = tryGenerateArchitectV2Candidate(brief, interpretation, footprint, surveyData);
    if (candidate.ok) accepted.push(candidate.result);
    else for (const diagnostic of candidate.diagnostics || []) {
      for (const error of diagnostic.errors || diagnostic.hardErrors || []) errors.set(error, (errors.get(error) || 0) + 1);
    }
  }
  return {
    surveyData, supported: true, family: support.housePattern, accepted: accepted.length,
    profiles: [...new Set(accepted.map(c => c.planSpec.variationId))],
    failures: [...errors].sort((a, b) => b[1] - a[1]).slice(0, 12),
  };
}

function structureCases() {
  const cases = [];
  for (const stories of [1, 2]) for (const bedrooms of [2, 3, 4, 5]) {
    for (const area of [1200, 1800, 2400, 3200]) for (const garage of ['None', '1 Car Garage', '2 Car Garage']) {
      cases.push({ ...base, stories: `${stories} Stories`, bedrooms: `${bedrooms} Bed`, totalArea: String(area), garage,
        masterLocation: stories === 1 ? 'Level 1 (Main)' : 'Level 2 (Upper)' });
    }
  }
  return cases;
}

if (require.main === module) {
  const out = path.resolve(process.argv[2] || '../tmp/generation-coverage.json');
  const cases = structureCases();
  const results = [];
  for (const [i, survey] of cases.entries()) {
    results.push(runCase(survey));
    if ((i + 1) % 12 === 0) process.stdout.write(`${i + 1}/${cases.length}\n`);
  }
  const report = { date: new Date().toISOString(), total: results.length,
    generated: results.filter(r => r.accepted > 0).length,
    threeProfiles: results.filter(r => r.profiles?.length >= 3).length, results };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify({ total: report.total, generated: report.generated, threeProfiles: report.threeProfiles, out }) + '\n');
}
module.exports = { base, runCase, structureCases };
