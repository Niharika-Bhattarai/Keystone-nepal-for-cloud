'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { base, runCase } = require('../scripts/benchmark/generation-coverage');
const { normalizeBrief } = require('../lib/tile/normalizeBrief');
const { resolveArchitectV2Support } = require('../lib/residential/v2/supportMatrix');
const { interpretBriefV2 } = require('../lib/residential/v2/interpretBriefV2');
const { buildCandidateFootprintsV2 } = require('../lib/residential/v2/candidateFootprintsV2');
const planHandler = require('../api/plan');
const candidateGeneration = require('../lib/residential/v2/candidateGeneration');
const refineHandler = require('../api/refine');
const { resizeCandidates } = require('../lib/refinementResize');
const { validateEditedPlan } = require('../lib/validateEditedPlan');
const { enrichPlanSpec } = require('../lib/buildingModel');
const { placeOpenings } = require('../lib/placeOpenings');
const { renderPlanSvg } = require('../lib/renderPlanSvg');
const { renderElevations } = require('../lib/renderElevationSvg');
const {roomArea} = require('../lib/planGeometry');

function generate(survey = base) {
  const brief = normalizeBrief(survey), support = resolveArchitectV2Support(brief);
  assert.ok(support.supported, support.reasons.join(', '));
  const interpretation = interpretBriefV2(brief, support);
  for (const footprint of buildCandidateFootprintsV2(brief, interpretation)) {
    const candidate = candidateGeneration.tryGenerateArchitectV2Candidate(brief, interpretation, footprint, survey);
    if (candidate.ok) return candidate.result.planSpec;
  }
  assert.fail('No validated candidate for fixture');
}

function invoke(handler, body) {
  return new Promise((resolve, reject) => {
    const res = { code: 200, setHeader() {}, status(code) { this.code = code; return this; },
      json(body) { resolve({ code: this.code, body }); return this; } };
    Promise.resolve(handler({ method:'POST', body, headers:{} }, res)).catch(reject);
  });
}

for (const bedrooms of ['2 Bed', '3 Bed']) test(`${bedrooms} one-storey retains all three bathrooms and three profiles`, () => {
  const result = runCase({ ...base, stories:'1 Story', bedrooms, totalArea:'1800', garage:'None' });
  assert.ok(result.accepted > 0);
  assert.equal(result.profiles.length, 3);
});

for (const garage of ['None','1 Car Garage','2 Car Garage']) test(`five-bedroom two-storey family validates with ${garage}`, () => {
  const survey = { ...base, bedrooms:'5 Bed', totalArea:'3200', garage };
  const plan = generate(survey);
  assert.equal(plan.levels.flatMap(l => l.rooms).filter(r => ['bedroom','primary_bedroom'].includes(r.type)).length, 5);
  assert.equal(plan.levels[0].rooms.filter(r => r.type === 'bedroom').length, 1);
  assert.deepEqual(validateEditedPlan(plan, survey), []);
});

for (const garage of ['1 Car Garage','2 Car Garage']) test(`three-bedroom single-storey family keeps every bedroom with ${garage}`, () => {
  const survey = {...base,stories:'1 Story',garage};
  const plan = generate(survey);
  assert.equal(plan.levels[0].rooms.filter(r=>['bedroom','primary_bedroom'].includes(r.type)).length,3);
  assert.deepEqual(validateEditedPlan(plan,survey),[]);
});

test('maximum outdoor flow supplies a fitted eight-foot sliding door in both drawings', () => {
  const survey = { ...base, indoorOutdoor:'Maximum (open to outdoors)' };
  const plan = generate(survey);
  const door = plan.levels[0].doors.find(d => d.indoorOutdoorOpening);
  assert.ok(door, 'the requested outdoor opening must survive wall fitting');
  assert.equal(door.width, 8);
  assert.equal(door.slidingDoor, true);
  assert.match(renderPlanSvg(plan), /data-opening="sliding-door"/);
  const elevationText = JSON.stringify(renderElevations(plan, survey));
  assert.match(elevationText, /sliding-door/);
  assert.match(elevationText, /width=\\"144\\" height=\\"126\\"/);
  assert.deepEqual(validateEditedPlan(plan, survey), []);
});

test('wide doorways survive final placement as four-foot openings', () => {
  const survey = { ...base, accessibilityNeeds:'Wide doorways' };
  const plan = generate(survey);
  assert.ok(plan.levels.every(l => l.doors.every(d => d.garageDoor || d.openThreshold || d.width >= 4)));
});

test('finished floor area excludes the full garage allowance on two-storey homes', () => {
  const survey = {...base,garage:'2 Car Garage'};
  const brief = normalizeBrief(survey);
  assert.equal(brief.footprintAreaSqFtTarget,brief.totalAreaSqFt+brief.garageAreaSqFtTarget);
  const plan = generate(survey);
  const finished = plan.levels.flatMap(l=>l.rooms).filter(r=>r.type!=='garage').reduce((sum,r)=>sum+roomArea(r),0);
  assert.ok(Math.abs(finished-2400)<=192,`Finished area ${finished} must match the survey tolerance`);
});

for (const bedrooms of ['2 Bed','3 Bed']) test(`compact 1200 sq ft home fits ${bedrooms} and all three baths`, () => {
  const survey = {...base,stories:'1 Story',totalArea:'1200',bedrooms,garage:'None'};
  const plan = generate(survey);
  assert.equal(plan.levels[0].rooms.filter(r=>['bathroom','primary_bathroom'].includes(r.type)).length,3);
  assert.deepEqual(validateEditedPlan(plan,survey),[]);
});

test('the standard brief returns at least three pairwise-diverse validated plans', async () => {
  const response = await invoke(planHandler, {surveyData:base});
  assert.equal(response.code,200);
  const plans = [response.body.planSpec,...response.body.alternatives.map(a=>a.planSpec)];
  assert.ok(plans.length>=3);
  assert.equal(response.body.diversityMetrics.valid,true);
  assert.equal(response.body.diversityMetrics.targetMet,true);
  for (const plan of plans) assert.deepEqual(validateEditedPlan(plan,base),[]);
});

test('front kitchen reaches the requested facade in every compass orientation', () => {
  for (const frontFacing of ['South','North','East','West']) {
    const survey = {...base,kitchenPlacement:'Front of House',frontFacing};
    const plan = generate(survey);
    assert.ok(plan.surveyCompliance.find(c=>c.field==='kitchenPlacement')?.fulfilled);
    assert.deepEqual(validateEditedPlan(plan,survey),[]);
  }
});

test('north and east elevation geometry is reversed without reversing captions', () => {
  const elevations = renderElevations(generate(base),base);
  const svg = JSON.stringify(elevations);
  assert.match(svg,/data-elevation-edge=\\"top\\" transform=\\"translate\([\d.]+ 0\) scale\(-1 1\)/);
  assert.match(svg,/data-elevation-edge=\\"right\\" transform=\\"translate\([\d.]+ 0\) scale\(-1 1\)/);
});

test('preflight explains lot and unsupported primary-suite requirements', () => {
  const {preflightSurvey} = require('../lib/surveyPreflight');
  const lot = preflightSurvey({...base,lotWidth:'20',lotDepth:'20'});
  assert.equal(lot.supported,false);
  assert.ok(lot.blockers.some(b=>b.code==='LOT_DOES_NOT_FIT'));
  const primary = preflightSurvey({...base,masterLocation:'Level 1 (Main)'});
  assert.equal(primary.supported,true);
  const unsupportedPrimary = preflightSurvey({...base,privateBaths:'2',masterLocation:'Level 1 (Main)'});
  assert.equal(unsupportedPrimary.supported,false);
  assert.ok(unsupportedPrimary.blockers.some(b=>b.field==='masterLocation'));
  assert.equal(preflightSurvey({...base,totalArea:'3200',features:'1 Study, 1 Library'}).supported,true);
});

test('preflight rejects malformed request bodies and accepts valid surveys', async () => {
  const handler = require('../api/plan_preflight');
  assert.equal((await invoke(handler,'{broken')).code,400);
  assert.equal((await invoke(handler,[])).code,400);
  const response = await invoke(handler,{surveyData:base});
  assert.equal(response.code,200);
  assert.equal(response.body.supported,true);
});

test('lot dimensions never fall back to an oversized footprint', () => {
  const brief = normalizeBrief({ ...base, lotWidth:'20', lotDepth:'20' });
  assert.equal(buildCandidateFootprintsV2(brief, interpretBriefV2(brief, resolveArchitectV2Support(brief))).length, 0);
});

test('the legacy-disable switch also blocks briefs declined before v2 generation', async () => {
  const previous = process.env.V2_DISABLE_LEGACY_FALLBACK;
  process.env.V2_DISABLE_LEGACY_FALLBACK = 'true';
  try {
    const response = await invoke(planHandler, { surveyData: { ...base, features:'3 Studies' } });
    assert.equal(response.code, 422);
    assert.equal(response.body.engine.generatorId, 'architect_v2');
    assert.equal(response.body.diagnostics.v2Support.supported, false);
    assert.ok(response.body.diagnostics.v2Support.reasons.includes('multiple_feature_rooms_not_supported'));
  } finally {
    if (previous === undefined) delete process.env.V2_DISABLE_LEGACY_FALLBACK;
    else process.env.V2_DISABLE_LEGACY_FALLBACK = previous;
  }
});

test('shared-wall resize transfers area to every adjacent room, without gaps', () => {
  const plan = { generatorId:'architect_v2', levels:[{ level:1, width:30, height:20, rooms:[
    { id:'living', type:'living_room', x:0, y:0, w:15, h:20 },
    { id:'a', type:'bedroom', x:15, y:0, w:15, h:10 },
    { id:'b', type:'bedroom', x:15, y:10, w:15, h:10 },
  ] }] };
  const changes = resizeCandidates(plan, 'living', 17, 20)[0];
  assert.equal(changes.length, 3);
  const next = refineHandler.__test.applyDiff(plan, changes);
  assert.deepEqual(next.levels[0].rooms.map(r => [r.x,r.w]), [[0,17],[17,13],[17,13]]);
  assert.equal(next.levels[0].rooms.reduce((sum,r) => sum+r.w*r.h,0), 600);
});

test('an exact resize succeeds on a real v2 plan without a Gemini key', async () => {
  const plan = generate(base);
  let instruction;
  const options = { brief: normalizeBrief(base), footprint:plan.buildingModel.footprint, surveyData:base };
  for (const room of plan.levels.flatMap(l => l.rooms)) {
    if (!['kitchen','living_room','dining_room'].includes(room.type)) continue;
    for (const [w,h] of [[room.w+2,room.h],[room.w-2,room.h],[room.w,room.h+2],[room.w,room.h-2]]) {
      for (const raw of resizeCandidates(plan,room.id,w,h)) {
        const sanitized = refineHandler.__test.sanitizeChangesDetailed(plan,raw);
        if (sanitized.rejectedChanges.length) continue;
        let edited = refineHandler.__test.applyDiff(plan,sanitized.changes);
        edited = enrichPlanSpec(edited,options);
        edited = placeOpenings(edited,base);
        edited = enrichPlanSpec(edited,options);
        if (!validateEditedPlan(edited,base).length && !refineHandler.__test.collectRefinementScopeIssues(plan,sanitized.changes,edited).length) {
          instruction = `resize ${room.type.replaceAll('_',' ')} to ${w} by ${h}`; break;
        }
      }
      if (instruction) break;
    }
    if (instruction) break;
  }
  assert.ok(instruction, 'fixture must have a physically feasible local edit');
  const previous = [process.env.GEMINI_API_KEY,process.env.GOOGLE_API_KEY];
  delete process.env.GEMINI_API_KEY; delete process.env.GOOGLE_API_KEY;
  try {
    const response = await invoke(refineHandler,{ currentPlanSpec:plan, refinementInstruction:instruction, surveyData:base });
    assert.equal(response.code,200,JSON.stringify(response.body));
    assert.deepEqual(validateEditedPlan(response.body.planSpec,base),[]);
    assert.equal(response.body.planSpec.totalAreaSqFt,plan.totalAreaSqFt);
    assert.notDeepEqual(response.body.planSpec.levels,plan.levels);
  } finally {
    for (const [i,key] of ['GEMINI_API_KEY','GOOGLE_API_KEY'].entries()) {
      if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i];
    }
  }
});
