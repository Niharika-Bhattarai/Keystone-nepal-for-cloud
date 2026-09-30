'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeBrief } = require('../lib/tile/normalizeBrief');
const { computeFootprintCandidates } = require('../lib/tile/computeFootprint');
const planHandler = require('../api/plan');
const { SIZE_BAND_MATRIX } = require('../scripts/benchmark/sizeBandMatrix');
const { invoke } = require('../scripts/benchmark/survey-delivery-audit');
const { validateEditedPlan } = require('../lib/validateEditedPlan');

const {
  tryGenerateCandidate,
  rankAcceptedCandidates,
} = require('../lib/residential/v2/candidateGeneration');

const ZONE_VARIANTS = [0, 0.14, -0.12];
const NUM_CANDIDATES = 100;

function getScenario(areaSqFt, scenarioId) {
  const band = SIZE_BAND_MATRIX.find((item) => Number(item.areaSqFt) === Number(areaSqFt));
  assert.ok(band, `Missing size band ${areaSqFt}`);
  const scenario = band.scenarios.find((item) => String(item.id) === String(scenarioId));
  assert.ok(scenario, `Missing scenario ${scenarioId} for ${areaSqFt} sqft`);
  return scenario;
}

function getBestResult(areaSqFt, scenarioId) {
  const scenario = getScenario(areaSqFt, scenarioId);
  const brief = normalizeBrief(scenario.surveyData);
  const footprints = computeFootprintCandidates(brief, 2, NUM_CANDIDATES);
  const accepted = [];
  const softRejected = [];

  for (const footprint of footprints) {
    for (const zoneBias of ZONE_VARIANTS) {
      const briefVariant = zoneBias !== 0
        ? { ...brief, layoutVariantBias: zoneBias }
        : brief;
      const candidate = tryGenerateCandidate(briefVariant, footprint, scenario.surveyData);
      if (candidate.ok) {
        accepted.push(candidate.result);
      } else if (candidate.fallbackResult) {
        softRejected.push(candidate.fallbackResult);
      }
    }
  }

  const ranked = accepted.length
    ? rankAcceptedCandidates(accepted)
    : rankAcceptedCandidates(softRejected);

  assert.ok(ranked.length > 0, `No ranked candidates for ${areaSqFt} ${scenarioId}`);
  return ranked[0];
}

function roomByType(level, type) {
  return (level.rooms || []).find((room) => room.type === type) || null;
}

test('1500 starter-family study winner keeps a real study room', () => {
  const best = getBestResult(1500, 'study');
  const levels = Array.isArray(best.planSpec?.levels) ? best.planSpec.levels : [];
  const studyRooms = levels.flatMap((level) => (level.rooms || []).filter((room) => room.type === 'study'));

  assert.ok(studyRooms.length >= 1, 'Expected at least one study room in the 1500 sqft study scenario');
  assert.ok(
    !best.scoreIssues?.some((issue) => String(issue).includes('Feature requested')),
    `Unexpected feature-retention issue: ${(best.scoreIssues || []).join(', ')}`
  );
});

test('2700/3000/3200 delivered upper-primary winners fit flights and keep stair alignment stable', async () => {
  const expectations = [
    { areaSqFt: 2700, scenarioId: 'base', forbidEntryIssues: false },
    { areaSqFt: 3000, scenarioId: 'base', forbidEntryIssues: false, forbidMisalignmentIssue: true },
    { areaSqFt: 3000, scenarioId: 'study_guest', forbidEntryIssues: false },
    { areaSqFt: 3200, scenarioId: 'base', forbidEntryIssues: true },
    { areaSqFt: 3200, scenarioId: 'study_gym', forbidEntryIssues: false, forbidMisalignmentIssue: true },
  ];

  for (const expectation of expectations) {
    // These briefs now have v2 replacements. Test delivered, fully validated
    // plans rather than the old legacy helper's soft-rejected candidates.
    const survey = getScenario(expectation.areaSqFt, expectation.scenarioId).surveyData;
    const { status, body: best } = await invoke(survey);
    assert.equal(status, 200, `No delivered plan for ${expectation.areaSqFt} ${expectation.scenarioId}`);
    assert.equal(best.engine.generatorId, 'architect_v2');
    assert.deepEqual(validateEditedPlan(best.planSpec, survey), []);
    const issues = Array.isArray(best.scoreIssues) ? best.scoreIssues : [];
    const levels = Array.isArray(best.planSpec?.levels) ? best.planSpec.levels : [];
    const l1 = levels.find((level) => Number(level.level) === 1);
    const l2 = levels.find((level) => Number(level.level) === 2);

    assert.ok(l1, `Missing L1 for ${expectation.areaSqFt}`);
    assert.ok(l2, `Missing L2 for ${expectation.areaSqFt}`);
    assert.equal(l2?.stairCore?.layout?.valid, true);
    assert.ok(['top','bottom'].includes(l2.stairCore.layout.upperEndpoint.side), 'Upper landing must meet the end of the actual fitted flight');
    assert.ok(
      !issues.some((issue) => String(issue).startsWith('stairs_side_landing:L2:')),
      `Unexpected side landing issue for ${expectation.areaSqFt}: ${issues.join(', ')}`
    );

    const l1Stairs = roomByType(l1, 'stairs');
    const l2Stairs = roomByType(l2, 'stairs');
    assert.ok(l1Stairs && l2Stairs, `Missing stair rooms for ${expectation.areaSqFt}`);
    assert.equal(l1Stairs.x, l2Stairs.x, `Expected aligned stair x for ${expectation.areaSqFt}`);
    assert.equal(l1Stairs.y, l2Stairs.y, `Expected aligned stair y for ${expectation.areaSqFt}`);
    assert.equal(l1Stairs.w, l2Stairs.w, `Expected aligned stair width for ${expectation.areaSqFt}`);
    assert.equal(l1Stairs.h, l2Stairs.h, `Expected aligned stair height for ${expectation.areaSqFt}`);

    if (expectation.forbidMisalignmentIssue) {
      assert.ok(
        !issues.some((issue) => String(issue).startsWith('stairs_misaligned_between_levels:')),
        `Unexpected stair misalignment issue for ${expectation.areaSqFt}: ${issues.join(', ')}`
      );
    }

    if (expectation.forbidEntryIssues) {
      assert.ok(
        !issues.some((issue) => String(issue).startsWith('quality_entry_avg_steps:L1:')),
        `Unexpected entry avg steps issue for ${expectation.areaSqFt}: ${issues.join(', ')}`
      );
      assert.ok(
        !issues.some((issue) => String(issue).startsWith('quality_entry_max_steps:L1:')),
        `Unexpected entry max steps issue for ${expectation.areaSqFt}: ${issues.join(', ')}`
      );
    }
  }
});
