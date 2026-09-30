'use strict';

const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {bindBedroomMeasurements,resolveBedroomMeasurements}=require('../lib/geometry/bedroomMeasurements');
const {bedroomArchitecturePolicy}=require('./helpers/bedroomArchitecturePolicy');
const {relocationOptions}=require('./helpers/verifyBedroomClosetRepair');
const {proposeBedroomApproachRepair}=require('../lib/geometry/repairBedroomApproach');
const {proposeBedroomClosetRepair}=require('../lib/geometry/repairBedroomCloset');
const {rebuildRepairedPlan}=require('../lib/geometry/rebuildRepairedPlan');
const {validateEditedPlan}=require('../lib/validateEditedPlan');
const {buildFloorPassageModel}=require('../lib/geometry/floorPassageModel');
const {computePlanQualityMetrics}=require('../lib/planQualityMetrics');
const {normalizeBrief}=require('../lib/tile/normalizeBrief');
function fixture(name) {
  const i=JSON.parse(fs.readFileSync(path.join(__dirname,`fixtures/bedroom-approach-repair/matrix-${name}-level-2-input.json`)));
  const level=i.plan.levels[1],bed=level.furniture.find(f=>f.id===i.options.request.bedId);
  i.plan.levels[1]=bindBedroomMeasurements(level,{bedroomId:bed.roomId,bedId:bed.id,source:{kind:'assumed',reference:'Rebuild test fixture'},policy:bedroomArchitecturePolicy(i)});
  i.options={...relocationOptions(i),allowQuarterTurns:true,nightstandPlacement:'head_sides',coordinateDresser:name.startsWith('West'),maxCandidates:4000,maxRouteChecks:64};
  const result=(name.startsWith('West')?proposeBedroomApproachRepair:proposeBedroomClosetRepair)(i.plan,i.survey,i.options);
  assert.equal(result.status,'repaired');return {...i,plan:JSON.parse(JSON.stringify(result.proposedPlan))};
}
for(const name of ['West-standard-1-option-3','North-standard-1-option-4']) test(`rebuild metadata/sheets after serialized repair without regenerating geometry: ${name}`,()=>{
  const i=fixture(name),before=structuredClone(i),rebuilt=rebuildRepairedPlan(i.plan,i.survey,i.options);
  assert.equal(rebuilt.status,'rebuilt',rebuilt.reason);assert.deepEqual(i,before);
  const p=rebuilt.proposedPlan;
  assert.equal(rebuilt.productionReady,false);assert.equal(rebuilt.constructionVerified,false);
  assert.deepEqual(validateEditedPlan(p,i.survey),[]);
  assert.deepEqual(p.stairCore,i.plan.stairCore);assert.deepEqual(p.verticalModel,i.plan.verticalModel);
  assert.deepEqual(p.furniture,i.plan.furniture);
  for(const [n,level] of p.levels.entries()) {
    const original=i.plan.levels[n];
    for(const key of ['doors','windows','furniture','stairCore','stairAssemblyIds','openingScheduleBook','bedroomMeasurementBook','verticalProfile'])assert.deepEqual(level[key],original[key]);
    assert.deepEqual(buildFloorPassageModel(level),buildFloorPassageModel(original));
    for(const room of level.rooms) {
      const expected=structuredClone(original.rooms.find(r=>r.id===room.id));
      for(const key of ['zone','openingIntent','adjacencyIntent','heightMeta'])expected[key]=room[key];
      assert.deepEqual(room,expected);
    }
    assert.deepEqual(resolveBedroomMeasurements(level).errors,[]);
  }
  assert.deepEqual(p.qualityMetrics,computePlanQualityMetrics(p,normalizeBrief(i.survey)));
  assert.match(rebuilt.sheets.normalSvg,/<svg/);assert.match(rebuilt.sheets.renderedSvg,/<svg/);
  assert.match(p.elevations.frontSvg,/<svg/);assert.ok(p.estimate);
  if(name.startsWith('North')) {
    const closet=p.levels[1].rooms.find(r=>r.ownerBedroomId===p.levels[1].furniture.find(f=>f.id===i.options.request.bedId).roomId);
    assert.notDeepEqual(closet.adjacencyIntent,i.plan.levels[1].rooms.find(r=>r.id===closet.id).adjacencyIntent);
  }
  const again=rebuildRepairedPlan(JSON.parse(JSON.stringify(p)),i.survey,i.options);
  assert.equal(again.status,'rebuilt');assert.deepEqual(again.proposedPlan,p);
});
test('rebuild retains explicit room locks and refuses stale measurements, mirrors or datums',()=>{
  const i=fixture('North-standard-1-option-4');
  i.plan.levels[0].rooms.find(r=>r.type==='kitchen').protected=true;
  let result=rebuildRepairedPlan(i.plan,i.survey,i.options);assert.equal(result.status,'rebuilt');
  assert.equal(result.proposedPlan.levels[0].rooms.find(r=>r.type==='kitchen').protected,true);
  for(const mutate of [p=>{delete p.levels[1].bedroomMeasurementBook;},p=>{p.furniture[1].items.pop();},
    p=>{p.levels[1].verticalProfile.floorZFt+=1;},p=>{p.levels[1].bedroomMeasurementBook.records[0].policy.windows[0].binding.x+=1;}]) {
    const changed=structuredClone(i.plan);mutate(changed);result=rebuildRepairedPlan(changed,i.survey,i.options);
    assert.equal(result.status,'not_checked');assert.equal(result.proposedPlan,undefined);assert.equal(result.sheets,undefined);
  }
  assert.equal(rebuildRepairedPlan(i.plan,i.survey).status,'disabled');
});
