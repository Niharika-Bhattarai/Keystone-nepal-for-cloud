'use strict';

const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {proposeBedroomApproachRepair}=require('../lib/geometry/repairBedroomApproach');
const {proposeBedroomClosetRepair}=require('../lib/geometry/repairBedroomCloset');
const {bedroomArchitecturePolicy}=require('./helpers/bedroomArchitecturePolicy');
const {relocationOptions}=require('./helpers/verifyBedroomClosetRepair');
const {verifyBedroomFurnitureRepair}=require('./helpers/verifyBedroomFurnitureRepair');
function load(n=3) {
  const input=JSON.parse(fs.readFileSync(path.join(__dirname,`fixtures/bedroom-approach-repair/matrix-West-standard-1-option-${n}-level-2-input.json`)));
  input.options={...relocationOptions(input),architecturePolicy:bedroomArchitecturePolicy(input),allowQuarterTurns:true,
    nightstandPlacement:'head_sides',coordinateDresser:true,maxCandidates:4000,maxRouteChecks:64};
  return input;
}
for(const n of [3,4]) test(`west option ${n} passes with original room, closet and window geometry`,()=>{
  const input=load(n),snapshot=structuredClone(input);
  const result=proposeBedroomApproachRepair(input.plan,input.survey,input.options);
  assert.deepEqual(input,snapshot); verifyBedroomFurnitureRepair(input,result);
  const dresser=result.changes.find(c=>c.furnitureId.includes('dresser'));
  assert.ok(dresser); assert.equal(dresser.after.rotation,90);
  assert.ok(dresser.displacementFt<=8); assert.ok(result.dresserSlotCount<=20000);
  assert.ok(result.candidateCount<=4000&&result.routeCheckCount<=64);
  const restored=JSON.parse(JSON.stringify(result.proposedPlan));
  const again=proposeBedroomApproachRepair(restored,input.survey,input.options);
  assert.equal(again.status,'unchanged'); assert.equal(again.architecturalValidation.status,'clear');
});

test('dresser movement needs explicit opt-in, measurements and one unambiguous dresser',()=>{
  for(const repair of [proposeBedroomApproachRepair,proposeBedroomClosetRepair]) {
    const input=load();
    for(const patch of [{coordinateDresser:'yes'},{architecturePolicy:undefined},{architecturePolicy:null},
      {maxDresserSlots:0},{maxDresserSlots:100001},{maxDresserSlots:Infinity}]) {
      const result=repair(input.plan,input.survey,{...input.options,...patch});
      assert.equal(result.status,'not_checked'); assert.equal(result.proposedPlan,undefined);
    }
    const level=input.plan.levels[1]; level.furniture=level.furniture.filter(f=>f.kind!=='dresser');
    input.plan.furniture.find(f=>f.level===2).items=structuredClone(level.furniture);
    const result=repair(input.plan,input.survey,input.options);
    assert.equal(result.status,'not_checked'); assert.equal(result.proposedPlan,undefined);
  }
});

test('bed/dresser candidates, raw dresser slots and route checks each obey their caps',()=>{
  const input=load();
  for(const patch of [{maxCandidates:1},{maxDresserSlots:1},{maxRouteChecks:1}]) {
    const result=proposeBedroomApproachRepair(input.plan,input.survey,{...input.options,...patch});
    assert.equal(result.status,'search_limit'); assert.equal(result.proposedPlan,undefined);
    assert.ok(result.candidateCount<=(patch.maxCandidates||4000));
    assert.ok(result.dresserSlotCount<=(patch.maxDresserSlots||20000));
    assert.ok(result.routeCheckCount<=(patch.maxRouteChecks||64));
  }
});

test('stronger side policy is preserved and failed attempts do not change the input',()=>{
  const input=load(4); input.options.request.sidePolicy='both';
  const snapshot=structuredClone(input),result=proposeBedroomApproachRepair(input.plan,input.survey,input.options);
  assert.deepEqual(input,snapshot);
  if(result.status==='repaired') {verifyBedroomFurnitureRepair(input,result);assert.equal(result.after.accessibleSides.length,2);}
  else {assert.ok(['search_limit','search_exhausted'].includes(result.status));assert.equal(result.proposedPlan,undefined);}
});

test('closet reservation attempts share the same raw dresser-slot budget',()=>{
  const input=load(),snapshot=structuredClone(input);
  const result=proposeBedroomClosetRepair(input.plan,input.survey,{...input.options,maxDresserSlots:1});
  assert.equal(result.status,'search_limit'); assert.equal(result.dresserSlotCount,1);
  assert.equal(result.proposedPlan,undefined); assert.deepEqual(input,snapshot);
});
