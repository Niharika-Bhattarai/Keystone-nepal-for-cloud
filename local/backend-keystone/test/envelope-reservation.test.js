'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { applyFootprintShapeToLayout } = require('../lib/residential/v2/orthogonalAssembler');
const { validatePlanSpec } = require('../lib/validatePlan');
const { validateBedroomBathroomAccess } = require('../lib/surveyRequirements');
const { partListOf, roomArea } = require('../lib/planGeometry');
const { intersection, unionArea } = require('../lib/geometry/rectBoolean');
const footprint = { envelopeShape: 'L_SHAPE', envelopeVoidRects: [{ x: 43, y: 0, w: 9, h: 8 }], levelAreaSqFtActual: 968 };

test('exact carving keeps odd room boundaries and hallways outside exterior voids', () => {
  const room = { id: 'odd', type: 'hallway', x: 37, y: 0, w: 15, h: 12 };
  const source = { levels: [{ level: 1, width: 52, height: 20, rooms: [room] }] };
  const carved = applyFootprintShapeToLayout(source, footprint).levels[0].rooms[0];
  assert.equal(carved.x, 37);
  assert.equal(carved.x + carved.w, 52);
  assert.equal(roomArea(carved), 15 * 12 - 9 * 8);
  assert.ok(partListOf(carved).every(part => !intersection(part, footprint.envelopeVoidRects[0])));
  assert.deepEqual(source.levels[0].rooms[0], room, 'Input geometry must not be mutated');
});

test('stairs crossing a void are rejected instead of clipped or exempted', () => {
  const source = { levels: [{ level: 1, rooms: [{ id: 'stair', type: 'stairs', x: 40, y: 0, w: 8, h: 16 }] }] };
  assert.throws(() => applyFootprintShapeToLayout(source, footprint), /Envelope reservation: stair stair/);
  assert.equal(source.levels[0].rooms[0].w, 8);
});

test('refinement cannot move a hallway or stair into a preserved exterior void', () => {
  for (const type of ['hallway', 'stairs']) {
    const plan = { stories: 1, totalAreaSqFt: 1000, envelopeVoidRects: footprint.envelopeVoidRects,
      levels: [{ level: 1, width: 52, height: 20, rooms: [{ id: 'moved', type, x: 43, y: 0, w: 9, h: 8 }], doors: [], windows: [] }] };
    assert.ok(validatePlanSpec(plan, {}).some(e => e.includes('Envelope reservation: room moved')));
  }
});

test('private suite storage may be reached through the ensuite but cannot lead to a shared hall', () => {
  const plan = { levels: [{ rooms: [{ id: 'bed', type: 'primary_bedroom' },
    { id: 'bath', type: 'primary_bathroom', attachedTo: 'bed' }, { id: 'closet', type: 'closet' },
    { id: 'store', type: 'storage' }, { id: 'hall', type: 'hallway' }], doors: [
    { a: 'bed', b: 'bath' }, { a: 'bath', b: 'closet' }, { a: 'closet', b: 'store' }, { a: 'bed', b: 'hall' },
  ] }] };
  assert.deepEqual(validateBedroomBathroomAccess(plan), []);
  plan.levels[0].doors.push({ a: 'store', b: 'hall' });
  assert.ok(validateBedroomBathroomAccess(plan).some(e => /opens outside/.test(e)));
});

test('T-shaped rooms and full stair cores fit retained regions before carving in every orientation', () => {
  const { base } = require('../scripts/benchmark/generation-coverage');
  const { normalizeBrief } = require('../lib/tile/normalizeBrief');
  const { resolveArchitectV2Support } = require('../lib/residential/v2/supportMatrix');
  const { interpretBriefV2 } = require('../lib/residential/v2/interpretBriefV2');
  const { buildProgramV2 } = require('../lib/residential/v2/programBuilderV2');
  const { buildCandidateFootprintsV2 } = require('../lib/residential/v2/candidateFootprintsV2');
  const { twoStoryNorthTGarage } = require('../lib/residential/v2/patterns/twoStoryNorthTGarage');
  const { tryGenerateArchitectV2Candidate } = require('../lib/residential/v2/candidateGeneration');
  const { validateEditedPlan } = require('../lib/validateEditedPlan');
  for (const features of ['None', '1 Study']) for (const frontFacing of ['North', 'South', 'East', 'West']) {
    const survey = { ...base, totalArea: '3000', shape: 'T-Shape', frontFacing, features };
    const brief = normalizeBrief(survey), interpretation = interpretBriefV2(brief, resolveArchitectV2Support(brief));
    let delivered = false;
    for (const fp of buildCandidateFootprintsV2(brief, interpretation)) {
      const program = buildProgramV2(brief, interpretation, fp);
      const raw = twoStoryNorthTGarage({ brief, footprint: fp, program });
      if (!raw) continue;
      for (const level of raw.levels) {
        const parts = level.rooms.flatMap(partListOf);
        assert.equal(unionArea(parts), fp.levelAreaSqFtActual, 'Every retained square foot is allocated once');
        assert.equal(parts.reduce((sum, r) => sum + r.w * r.h, 0), unionArea(parts), 'No room overlap');
        assert.ok(parts.every(part => fp.envelopeVoidRects.every(cut => !intersection(part, cut))));
        for (const spec of program.levels.find(l => l.level === level.level).rooms) {
          assert.equal(level.rooms.filter(r => r.id === spec.id).length, 1, `Missing or duplicated requested room ${spec.id}`);
        }
      }
      const candidate = tryGenerateArchitectV2Candidate(brief, interpretation, fp, survey, { skipElevation: true });
      if (!candidate.ok) continue;
      const plan = candidate.result.planSpec;
      assert.deepEqual(validateEditedPlan(plan, survey), []);
      const garage = plan.levels[0].rooms.find(r => r.type === 'garage');
      assert.ok(Math.max(garage.w, garage.h) >= 20 && Math.min(garage.w, garage.h) >= 14);
      assert.ok(plan.levels.every(l => l.stairCore.layout.valid));
      delivered = true;
      break;
    }
    assert.ok(delivered, `No contained T-shaped layout facing ${frontFacing}, features ${features}`);
  }
});
