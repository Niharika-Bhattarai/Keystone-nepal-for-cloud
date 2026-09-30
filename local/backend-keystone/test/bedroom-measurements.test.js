'use strict';

const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {bindBedroomMeasurements,resolveBedroomMeasurements}=require('../lib/geometry/bedroomMeasurements');
const {bedroomArchitecturePolicy}=require('./helpers/bedroomArchitecturePolicy');
const {relocationOptions}=require('./helpers/verifyBedroomClosetRepair');
const {proposeBedroomApproachRepair}=require('../lib/geometry/repairBedroomApproach');
const {proposeBedroomClosetRepair}=require('../lib/geometry/repairBedroomCloset');
const {validateEditedPlan}=require('../lib/validateEditedPlan');
const {stripPlanSpecForValidation}=require('../lib/residential/v2/candidateGeneration');
const {validatePlanSpecSchema}=require('../lib/validateSchema');
function input(name='West-standard-1-option-3') {
  const i=JSON.parse(fs.readFileSync(path.join(__dirname,`fixtures/bedroom-approach-repair/matrix-${name}-level-2-input.json`)));
  const level=i.plan.levels[1],bed=level.furniture.find(f=>f.id===i.options.request.bedId);
  const policy=bedroomArchitecturePolicy(i);
  i.options={...relocationOptions(i),allowQuarterTurns:true,nightstandPlacement:'head_sides',coordinateDresser:name.startsWith('West'),maxCandidates:4000,maxRouteChecks:64};
  i.plan.levels[1]=bindBedroomMeasurements(level,{bedroomId:bed.roomId,bedId:bed.id,source:{kind:'assumed',reference:'Regression fixture dimensions'},policy});
  return i;
}
test('JSON persistence and schema projection retain measurements and provenance',()=>{
  const i=input(),restored=JSON.parse(JSON.stringify(i.plan));
  assert.deepEqual(resolveBedroomMeasurements(restored.levels[1]).errors,[]);
  const projected=stripPlanSpecForValidation(restored);
  assert.deepEqual(projected.levels[1].bedroomMeasurementBook,i.plan.levels[1].bedroomMeasurementBook);
  assert.equal(validatePlanSpecSchema(projected).valid,true);
  assert.deepEqual(validateEditedPlan(restored,i.survey),[]); // Binding validity is not a layout pass.
});
test('measurement binding is immutable and supports explicit replacement after review',()=>{
  const i=input(),level=i.plan.levels[1],before=structuredClone(level),record=level.bedroomMeasurementBook.records[0];
  const replacement=structuredClone(record);replacement.source={kind:'project_specification',reference:'Furniture schedule A'};
  replacement.policy.furniture[0].heightFt=2.1;
  const rebound=bindBedroomMeasurements(level,replacement);
  assert.deepEqual(level,before);assert.equal(rebound.bedroomMeasurementBook.records.length,1);
  assert.equal(rebound.bedroomMeasurementBook.records[0].source.kind,'project_specification');
});
test('translations, quarter turns and array reordering retain dimensional identities',()=>{
  const i=input(),level=i.plan.levels[1],bed=level.furniture.find(f=>f.id===i.options.request.bedId);
  bed.x+=.25;[bed.w,bed.h]=[bed.h,bed.w];bed.rotation=90;
  level.furniture.reverse();level.windows.reverse();level.rooms.reverse();
  assert.deepEqual(resolveBedroomMeasurements(level).errors,[]);
});
test('stale floor, ownership, size, inventory and window bindings fail closed',()=>{
  for(const mutate of [l=>{l.level=7;},l=>{l.bedroomMeasurementBook.records.push(structuredClone(l.bedroomMeasurementBook.records[0]));},
    l=>{l.furniture.find(f=>f.id===l.bedroomMeasurementBook.records[0].bedId).w+=.5;},
    l=>{l.furniture.find(f=>f.id===l.bedroomMeasurementBook.records[0].bedId).roomId='other';},
    l=>{l.windows.find(w=>w.roomId===l.bedroomMeasurementBook.records[0].bedroomId).x+=1;},
    l=>{l.furniture=l.furniture.filter(f=>f.id!==l.bedroomMeasurementBook.records[0].bedId);},
    l=>{l.rooms.find(r=>r.id===l.bedroomMeasurementBook.records[0].bedroomId).type='office';}]) {
    const i=input();mutate(i.plan.levels[1]);const resolved=resolveBedroomMeasurements(i.plan.levels[1]);
    assert.ok(resolved.errors.length);assert.deepEqual(resolved.records,[]);
    assert.ok(validateEditedPlan(i.plan,i.survey).some(e=>e.includes('Bedroom measurements')));
  }
});
test('unsupported, incomplete or non-finite persisted records fail schema and resolver checks',()=>{
  for(const mutate of [l=>{l.bedroomMeasurementBook=null;},l=>{l.bedroomMeasurementBook.version=2;},
    l=>{l.bedroomMeasurementBook.records[0].source.reference=' ';},l=>{l.bedroomMeasurementBook.records[0].policy.furniture[0].heightFt=Infinity;},
    l=>{l.bedroomMeasurementBook.records[0].policy.windows[0].binding.width=0;}]) {
    const i=input();mutate(i.plan.levels[1]);
    assert.ok(resolveBedroomMeasurements(i.plan.levels[1]).errors.length);
    assert.equal(validatePlanSpecSchema(stripPlanSpecForValidation(i.plan)).valid,false);
  }
});
test('saved measurements drive both repairs without passing a policy again',()=>{
  for(const name of ['West-standard-1-option-3','North-standard-1-option-4']) {
    const i=input(name),snapshot=structuredClone(i);
    const repair=name.startsWith('West')?proposeBedroomApproachRepair:proposeBedroomClosetRepair;
    const result=repair(i.plan,i.survey,i.options);
    assert.equal(result.status,'repaired',result.reason);assert.equal(result.architecturalValidation.status,'clear');
    assert.deepEqual(result.measurementSource,{kind:'assumed',reference:'Regression fixture dimensions'});
    assert.deepEqual(result.proposedPlan.levels[1].bedroomMeasurementBook,i.plan.levels[1].bedroomMeasurementBook);
    assert.deepEqual(i,snapshot);
  }
});
test('explicit policies cannot weaken or override a persisted specification',()=>{
  const i=input(),policy=structuredClone(i.plan.levels[1].bedroomMeasurementBook.records[0].policy);policy.headboardMaxGapFt=1;
  for(const repair of [proposeBedroomApproachRepair,proposeBedroomClosetRepair]) {
    const result=repair(i.plan,i.survey,{...i.options,architecturePolicy:policy});
    assert.equal(result.status,'not_checked');assert.equal(result.proposedPlan,undefined);
    assert.equal(result.errors[0].code,'BEDROOM_MEASUREMENTS_OVERRIDE');
  }
});
test('unmeasured legacy levels remain compatible',()=>{
  const i=input();delete i.plan.levels[1].bedroomMeasurementBook;
  assert.deepEqual(resolveBedroomMeasurements(i.plan.levels[1]),{records:[],errors:[]});
  assert.deepEqual(validateEditedPlan(i.plan,i.survey),[]);
});

module.exports={input};
