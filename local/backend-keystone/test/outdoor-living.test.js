'use strict';
// Outdoor living (a covered porch, deck, screened porch or patio) is built
// outside the house against a public room, reached by its own sliding door,
// drawn on the plan and built in the 3D model. It adds no finished area.
process.env.V2_DISABLE_LEGACY_FALLBACK = 'true';
const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/plan');
const { validateEditedPlan } = require('../lib/validateEditedPlan');
const { renderPlanSvg } = require('../lib/renderPlanSvg');
const { buildModel } = require('../lib/model3d/buildModel');
const { preflightSurvey } = require('../lib/surveyPreflight');
const { base } = require('../scripts/benchmark/studio-full-coverage.cjs');

const configs = [{ privateBath: 'Yes', closet: 'Walk-in' }, { privateBath: 'No', closet: 'Standard' }, { privateBath: 'No', closet: 'Standard' }];
const plan = (survey) => new Promise((resolve, reject) => {
  const res = { statusCode: 200, setHeader() {}, status(n) { this.statusCode = n; return this; }, json(b) { resolve(b); return this; } };
  Promise.resolve(handler({ method: 'POST', body: { surveyData: survey }, headers: {} }, res)).catch(reject);
});
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

for (const [choice, type, stories] of [['Open deck', 'open_deck', '2 Stories'], ['Covered porch', 'covered_porch', '1 Story'],
  ['Screened porch', 'screened_porch', '2 Stories'], ['Patio', 'patio', '1 Story']]) {
  test(`${choice}: outside the house, off a public room, with its own door, drawn and built`, async () => {
    const survey = { ...base, stories, outdoorLiving: choice, outdoorArea: '200', bedroomConfigs: configs,
      ...(stories === '1 Story' ? { masterLocation: 'Level 1 (Main)', bathrooms: '2 Bath', totalArea: '1800', garage: '2 Car Garage' } : {}) };
    assert.equal(preflightSurvey(survey).supported, true, 'preflight accepts it');
    const body = await plan(survey);
    assert.ok(body.success, 'generates');
    const spec = body.planSpec;
    assert.deepEqual(validateEditedPlan(spec, survey), []);
    const ground = spec.levels.find((l) => l.level === 1);
    const [o] = ground.outdoor || [];
    assert.ok(o && o.type === type, 'the structure is recorded on the ground floor');
    assert.ok(Math.abs(o.w * o.h - 200) <= 40, `about the requested area (${o.w} x ${o.h})`);
    for (const r of ground.rooms) for (const p of r.parts?.length ? r.parts : [r]) assert.ok(!overlaps(o, p), `clear of ${r.id}`);
    const host = ground.rooms.find((r) => r.id === o.hostRoomId);
    assert.ok(['living_room', 'dining_room', 'kitchen'].includes(host?.type), 'reached from a public room');
    assert.ok(ground.doors.some((d) => d.outdoorLivingDoor && d.slidingDoor && [d.a, d.b].includes(host.id)), 'through a sliding door');
    assert.ok(spec.surveyCompliance.find((c) => c.field === 'outdoorLiving')?.fulfilled, 'the survey check passes');
    assert.match(renderPlanSvg(spec), /class="outdoor-living"/, 'drawn on the plan');
    const model = buildModel(spec);
    assert.equal(model.meta.site.outdoor[0]?.type, type, 'built in 3D');
    assert.equal(Boolean(model.meta.site.outdoor[0].covered), type === 'covered_porch' || type === 'screened_porch');
  });
}
