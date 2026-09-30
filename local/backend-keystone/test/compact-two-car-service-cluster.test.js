'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeBrief } = require('../lib/tile/normalizeBrief');
const { resolveArchitectV2Support } = require('../lib/residential/v2/supportMatrix');
const { interpretBriefV2 } = require('../lib/residential/v2/interpretBriefV2');
const { buildCandidateFootprintsV2 } = require('../lib/residential/v2/candidateFootprintsV2');
const { validateFurnitureGeometry, validateRequiredFurniture } = require('../lib/furnitureGeometry');
const { tryGenerateArchitectV2Candidate } = require('../lib/residential/v2/candidateGeneration');
const gaps = require('./fixtures/coverage/known-gaps.json').cases.slice(0, 2);

test('compact two-car service columns fit real laundry appliances with door approaches in all facings', () => {
  for (const fixture of gaps) for (const frontFacing of ['South', 'North', 'East', 'West']) {
    const survey = { ...fixture.survey, frontFacing };
    const brief = normalizeBrief(survey);
    const interpretation = interpretBriefV2(brief, resolveArchitectV2Support(brief));
    const footprint = buildCandidateFootprintsV2(brief, interpretation).find(f => f.widthFt === 44 && f.heightFt === 28);
    assert.ok(footprint);
    const result = tryGenerateArchitectV2Candidate(brief, interpretation, footprint, survey, { captureRejectedPlan: true });
    const plan = result.result?.planSpec || result.rejectedPlan;
    assert.ok(plan, JSON.stringify(result.diagnostics));
    const level = plan.levels.find(l => l.level === 1);
    const laundry = level.rooms.find(r => r.type === 'laundry');
    const appliances = level.furniture.filter(f => f.roomId === laundry.id && ['washer', 'dryer', 'stacked_washer_dryer'].includes(f.kind));
    assert.ok(appliances.some(f => ['washer', 'stacked_washer_dryer'].includes(f.kind)), `${fixture.id}/${frontFacing}: washer`);
    assert.ok(appliances.some(f => ['dryer', 'stacked_washer_dryer'].includes(f.kind)), `${fixture.id}/${frontFacing}: dryer`);
    assert.ok(appliances.every(f => f.w >= 3 && f.h >= 3));
    assert.deepEqual(validateFurnitureGeometry(level, ['laundry']), []);
    assert.deepEqual(validateRequiredFurniture(plan), []);
  }
});
