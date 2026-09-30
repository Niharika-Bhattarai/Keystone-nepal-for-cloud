'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeBrief } = require('../lib/tile/normalizeBrief');
const { resolveArchitectV2Support } = require('../lib/residential/v2/supportMatrix');
const { interpretBriefV2 } = require('../lib/residential/v2/interpretBriefV2');
const { buildCandidateFootprintsV2 } = require('../lib/residential/v2/candidateFootprintsV2');

function buildSurveyData(totalArea) {
  return {
    location: '',
    totalArea: String(totalArea),
    stories: '2 Stories',
    bedrooms: '2 Bed',
    bathrooms: '2 Bath',
    privateBaths: '1',
    bedroomConfigs: null,
    shape: 'Rectangular',
    garage: '1 Car Garage',
    materials: 'Craftsman (Wood & Stone)',
    openConcept: 'Open Concept (Combined)',
    masterLocation: 'Level 2 (Upper)',
    kitchenPlacement: 'Rear of House',
    features: '',
    frontFacing: 'South',
    lotContext: 'Suburban standard lot',
    laundryLocation: 'Level 1 (near garage/mud)',
    ceilingHeight: 'Standard (9 ft)',
    indoorOutdoor: 'Moderate (some connection)',
    naturalLight: 'Balanced windows',
    accessibilityNeeds: 'None',
    budgetTier: 'Mid ($200-300/sqft)',
    freeformWishes: '',
  };
}

function buildNoGarageSurveyData(totalArea) {
  return {
    ...buildSurveyData(totalArea),
    garage: 'No Garage',
  };
}

test('buildCandidateFootprintsV2 keeps two-story depth in the stair-safe band and still produces large-area options', () => {
  const brief = normalizeBrief(buildSurveyData(4200));
  const support = resolveArchitectV2Support(brief);
  const interpretation = interpretBriefV2(brief, support);
  const candidates = buildCandidateFootprintsV2(brief, interpretation);

  assert.ok(candidates.length >= 6, `Expected multiple v2 candidates for 4200 sqft, got ${candidates.length}`);
  // The compact search stays in the original stair-safe band. Deeper
  // envelopes are a separate, later-ranked budget (the ground floor caps its
  // stair room at 16 ft, so the upper reservation stays a real stair).
  const compact = candidates.filter((candidate) => !candidate.expandedDepthSearch);
  assert.ok(compact.length >= 6, `Expected multiple compact candidates, got ${compact.length}`);
  for (const candidate of candidates) {
    if (!candidate.expandedDepthSearch) assert.ok(candidate.heightFt <= 32, `Expected compact two-story depth <= 32 ft, got ${candidate.heightFt}`);
    assert.ok(candidate.widthFt >= 34, `Expected two-story garage width >= 34 ft, got ${candidate.widthFt}`);
  }
  const firstDeep = candidates.findIndex((candidate) => candidate.expandedDepthSearch);
  assert.ok(firstDeep === -1 || candidates.slice(firstDeep).every((candidate) => candidate.expandedDepthSearch), 'Deeper candidates rank after the compact band');
});

test('buildCandidateFootprintsV2 still produces compact candidates for near-wave1 sizes', () => {
  const brief = normalizeBrief(buildSurveyData(2500));
  const support = resolveArchitectV2Support(brief);
  const interpretation = interpretBriefV2(brief, support);
  const candidates = buildCandidateFootprintsV2(brief, interpretation);

  assert.ok(candidates.length >= 6, `Expected multiple v2 candidates for 2500 sqft, got ${candidates.length}`);
  const hasClassicFootprint = candidates.some((candidate) => Number(candidate.widthFt) === 44 && Number(candidate.heightFt) === 30);
  assert.ok(hasClassicFootprint, 'Expected the candidate list to keep the classic 44x30 footprint for continuity around 2500 sqft');
});

test('buildCandidateFootprintsV2 emits all three two-story variation profiles', () => {
  const brief = normalizeBrief(buildSurveyData(2400));
  const support = resolveArchitectV2Support(brief);
  const interpretation = interpretBriefV2(brief, support);
  const candidates = buildCandidateFootprintsV2(brief, interpretation);

  const variationIds = new Set(candidates.map((candidate) => String(candidate?.variationId || '')));
  assert.ok(variationIds.has('variant_a_compact_core'), 'Expected compact-core variation candidates');
  assert.ok(variationIds.has('variant_b_daylight_wing'), 'Expected daylight-wing variation candidates');
  assert.ok(variationIds.has('variant_c_service_spine'), 'Expected service-spine variation candidates');
});

test('buildCandidateFootprintsV2 keeps two-story no-garage compact depths in the assembler-safe band', () => {
  const brief = normalizeBrief(buildNoGarageSurveyData(1800));
  const support = resolveArchitectV2Support(brief);
  const interpretation = interpretBriefV2(brief, support);
  const candidates = buildCandidateFootprintsV2(brief, interpretation);

  assert.ok(candidates.length >= 6, `Expected multiple v2 candidates for 1800 sqft no-garage, got ${candidates.length}`);
  for (const candidate of candidates) {
    assert.ok(candidate.heightFt >= 28, `Expected no-garage two-story depth >= 28 ft, got ${candidate.heightFt}`);
    assert.ok(candidate.heightFt <= 32, `Expected no-garage two-story depth <= 32 ft, got ${candidate.heightFt}`);
    assert.ok(candidate.widthFt >= 28, `Expected no-garage two-story width >= 28 ft, got ${candidate.widthFt}`);
  }
});

test('buildCandidateFootprintsV2 emits explicit L-shape footprint metadata with carved effective area', () => {
  const brief = normalizeBrief({
    ...buildSurveyData(3000),
    shape: 'L-Shape',
  });
  const support = resolveArchitectV2Support(brief);
  const interpretation = interpretBriefV2(brief, support);
  const candidates = buildCandidateFootprintsV2(brief, interpretation);

  assert.ok(candidates.length > 0, 'Expected candidates for L-shape brief');
  for (const candidate of candidates) {
    assert.equal(String(candidate?.envelopeShape), 'L_SHAPE');
    assert.ok(Array.isArray(candidate?.envelopeVoidRects) && candidate.envelopeVoidRects.length >= 1);
    assert.ok(Number(candidate?.levelAreaSqFtActual) < Number(candidate?.widthFt || 0) * Number(candidate?.heightFt || 0));
  }
});

test('buildCandidateFootprintsV2 emits explicit T-shape footprint metadata with carved effective area', () => {
  const brief = normalizeBrief({
    ...buildSurveyData(3000),
    shape: 'T-Shape',
  });
  const support = resolveArchitectV2Support(brief);
  const interpretation = interpretBriefV2(brief, support);
  const candidates = buildCandidateFootprintsV2(brief, interpretation);

  assert.ok(candidates.length > 0, 'Expected candidates for T-shape brief');
  for (const candidate of candidates) {
    assert.equal(String(candidate?.envelopeShape), 'T_SHAPE');
    assert.ok(Array.isArray(candidate?.envelopeVoidRects) && candidate.envelopeVoidRects.length >= 2);
    assert.ok(Number(candidate?.levelAreaSqFtActual) < Number(candidate?.widthFt || 0) * Number(candidate?.heightFt || 0));
  }
});
