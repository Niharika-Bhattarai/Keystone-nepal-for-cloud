'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SIZE_BAND_MATRIX } = require('../scripts/benchmark/sizeBandMatrix');
const { invoke, auditPlan } = require('../scripts/benchmark/run_architectural_audit');
const base = { ...SIZE_BAND_MATRIX.find(b => b.areaSqFt === 2400).scenarios[0].surveyData, features: '1 Study' };

test('editor rendering rejects overlaps and returns regenerated geometry for valid plans', async () => {
  const { body } = await invoke(base);
  const handler = require('../api/plan_svg');
  const render = planSpec => {
    let result;
    const res = { code: 200, status(code) { this.code = code; return this; },
      json(payload) { result = { status: this.code, body: payload }; return this; } };
    handler({ body: { planSpec, surveyData: base } }, res);
    return result;
  };
  const valid = render(body.planSpec);
  assert.equal(valid.status, 200, JSON.stringify(valid.body.diagnostics));
  assert.deepEqual(auditPlan(valid.body.planSpec, base), []);
  const broken = structuredClone(body.planSpec);
  const rooms = broken.levels[0].rooms;
  const room = rooms.find(r => r.type === 'kitchen');
  room.x = rooms.find(r => r.type === 'living_room').x;
  room.y = rooms.find(r => r.type === 'living_room').y;
  const rejected = render(broken);
  assert.equal(rejected.status, 422);
  assert.equal(rejected.body.svg, undefined);
  assert.ok(rejected.body.diagnostics.validationErrors.length);
});

test('full-width opening and stair checks hold for primary and alternate plans', async () => {
  const cases = [
    {}, { shape: 'L-Shaped', totalArea: '3000' }, { shape: 'T-Shaped', totalArea: '3000' },
    { accessibilityNeeds: 'Wide doorways', frontFacing: 'East' },
    { bedrooms: '2 Bed', bathrooms: '3 Bath', accessibilityNeeds: 'Wide doorways' },
    { features: '1 Gym', garage: 'No Garage', accessibilityNeeds: 'Wide doorways' },
    { naturalLight: 'Privacy first (fewer windows)' },
  ];
  for (const overrides of cases) {
    const survey = { ...base, ...overrides };
    const {status,body} = await invoke(survey);
    assert.equal(status,200,JSON.stringify({overrides,engine:body.engine}));
    assert.equal(body.engine.generatorId,'architect_v2');
    for (const option of [body,...body.alternatives]) assert.deepEqual(auditPlan(option.planSpec,survey),[]);
    for (const level of body.planSpec.levels) for (const room of level.rooms) {
      if (['bedroom','primary_bedroom','guest_bedroom'].includes(room.type)) {
        assert.ok(level.windows.some(w => w.roomId === room.id), `${room.id} requires exterior glazing`);
      }
    }
  }
});

test('upstairs laundry is honored in every returned option', async () => {
  const survey={...base,laundryLocation:'Level 2 (near bedrooms)'};
  const {status,body}=await invoke(survey);
  assert.equal(status,200);
  for(const option of [body,...body.alternatives]) {
    const rooms=option.planSpec.levels.flatMap(l=>l.rooms.filter(r=>r.type==='laundry').map(r=>({r,level:l.level})));
    assert.equal(rooms.length,1);assert.equal(rooms[0].level,2);
    assert.deepEqual(auditPlan(option.planSpec,survey),[]);
  }
});

test('four-bedroom four-bathroom families retain both shared baths and two distinct ensuites', async () => {
  for (const area of ['3000', '3200']) for (const features of ['', '1 Study', ...(area === '3200' ? ['1 Study, 1 Gym'] : [])]) {
    const survey = { ...base, totalArea: area, bedrooms: '4 Bed', bathrooms: '4 Bath', privateBaths: '2', garage: '2 Car Garage', features };
    const { status, body } = await invoke(survey);
    assert.equal(status, 200, JSON.stringify(body.diagnostics));
    assert.equal(body.engine.generatorId, 'architect_v2');
    for (const option of [body, ...body.alternatives]) {
      assert.deepEqual(auditPlan(option.planSpec, survey), []);
      const rooms = option.planSpec.levels.flatMap(level => level.rooms);
      const baths = rooms.filter(room => ['bathroom', 'primary_bathroom'].includes(room.type));
      assert.equal(baths.length, 4);
      assert.equal(new Set(baths.map(room => room.id)).size, 4);
      assert.equal(baths.filter(room => room.bathroomUse === 'shared').length, 2);
      assert.equal(new Set(baths.filter(room => room.attachedTo).map(room => room.attachedTo)).size, 2);
      if (features) assert.equal(rooms.filter(room => room.type === 'study').length, 1);
      if (features.includes('Gym')) assert.equal(rooms.filter(room => room.type === 'gym').length, 1);
    }
  }
});

test('freeform edits cannot bypass final validation or leave stale room quantities',async()=>{
  for(const wish of ['resize kitchen to 14x16','resize kitchen to 40x40']){
    const survey={...base,freeformWishes:wish};
    const {status,body}=await invoke(survey);
    assert.equal(status,200);
    assert.ok(['applied','not_applied'].includes(body.planSpec.surveyFulfillment.freeformWishes.status));
    assert.deepEqual(auditPlan(body.planSpec,survey),[]);
    for(const level of body.planSpec.levels)for(const room of level.rooms){
      const area=room.parts?.length?room.parts.reduce((n,p)=>n+p.w*p.h,0):room.w*room.h;
      assert.equal(room.heightMeta.areaSqFt,area);
    }
  }
});

test('architecturally rejected candidates are never returned as a successful fallback',async()=>{
  const survey=SIZE_BAND_MATRIX.find(b=>b.areaSqFt===3000).scenarios[0].surveyData;
  const {status,body}=await invoke(survey);
  if(status===200){assert.equal(body.phase==='phase_1_quality_gated_selection_fallback',false);assert.deepEqual(auditPlan(body.planSpec,survey),[]);}
  else{assert.equal(status,422);assert.equal(body.code,'NO_VALID_LAYOUT');assert.equal(body.planSpec,undefined);assert.equal(body.svg,undefined);}
});
