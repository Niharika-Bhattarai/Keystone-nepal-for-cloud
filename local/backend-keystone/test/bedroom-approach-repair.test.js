'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {proposeBedroomApproachRepair}=require('../lib/geometry/repairBedroomApproach');
const {validateEditedPlan}=require('../lib/validateEditedPlan');
const {buildFloorPassageModel}=require('../lib/geometry/floorPassageModel');
const {checkBedroomApproach}=require('../lib/geometry/bedroomApproach');
const {bedClearanceEnvelope,doorClearances,intersects}=require('../lib/furnitureGeometry');
const {containsRect,subtract}=require('../lib/geometry/rectBoolean');
const folder=path.join(__dirname,'fixtures/bedroom-approach-repair');
const load=name=>JSON.parse(fs.readFileSync(path.join(folder,name+'-input.json')));
const west='matrix-West-standard-1-option-2-level-2';
const successes=new Set([west,'matrix-East-standard-1-option-2-level-2']);
function verifyProposal(input,result){
  const proposed=result.proposedPlan,level=proposed.levels.find(l=>l.level===2),request=input.options.request;
  assert.deepEqual(validateEditedPlan(proposed,input.survey),[]);
  const after=checkBedroomApproach(level,request);assert.equal(after.status,'clear');
  assert.equal(after.sidePolicy,request.sidePolicy);assert.equal(after.clearWidthFt,request.clearWidthFt);
  assert.equal(result.constructionVerified,false);assert.equal(result.doorSwingVerified,false);
  const model=buildFloorPassageModel(level);assert.deepEqual(model.errors,[]);
  const bed=level.furniture.find(f=>f.id===request.bedId),room=level.rooms.find(r=>r.id===bed.roomId);
  const parts=model.roomClear.find(r=>r.roomId===room.id).parts;
  assert.ok(containsRect(parts,bedClearanceEnvelope(bed,room)));
  for(const item of level.furniture.filter(f=>f.roomId===room.id)){
    assert.ok(containsRect(parts,item));assert.ok(!doorClearances(room,level).some(z=>intersects(item,z)));
  }
  // Exact full-plan comparison allows ONLY the declared furniture coordinates
  // and their aggregate mirror to change. No omissions, resized objects or
  // hidden edits to surveys, rooms, closets, doors, windows or stairs.
  const expected=structuredClone(input.plan),expectedLevel=expected.levels.find(l=>l.level===2);
  const delta=result.changes[0];
  for(const change of result.changes){
    const item=expectedLevel.furniture.find(f=>f.id===change.furnitureId);
    assert.ok(item.id===bed.id||item.kind==='nightstand');
    if(!input.options.allowQuarterTurns){
      assert.ok(Math.abs(change.after.x-change.before.x-(delta.after.x-delta.before.x))<1e-8);
      assert.ok(Math.abs(change.after.y-change.before.y-(delta.after.y-delta.before.y))<1e-8);
    }
    const beforeSize=[item.w,item.h].sort((a,b)=>a-b),afterSize=[change.after.w,change.after.h].sort((a,b)=>a-b);
    assert.deepEqual(afterSize,beforeSize);
    Object.assign(item,change.after);
  }
  expected.furniture.find(f=>f.level===2).items=structuredClone(expectedLevel.furniture);
  assert.deepEqual(proposed,expected);
  const used=new Set(after.allowedRoomIds),free=subtract([
    ...model.roomClear.filter(r=>used.has(r.roomId)).flatMap(r=>r.parts),
    ...model.openings.filter(o=>o.rooms.every(id=>used.has(id))).map(o=>o.clear),
  ],level.furniture.filter(f=>used.has(f.roomId)));
  for(const side of after.sides.filter(s=>s.status==='clear'))for(let i=1;i<side.path.length;i++){
    const a=side.path[i-1],b=side.path[i],r=request.clearWidthFt/2;
    assert.ok(a.x===b.x||a.y===b.y);
    assert.ok(containsRect(free,{x:Math.min(a.x,b.x)-r,y:Math.min(a.y,b.y)-r,w:Math.abs(a.x-b.x)+r*2,h:Math.abs(a.y-b.y)+r*2}));
  }
}

for(const file of fs.readdirSync(folder).filter(f=>f.endsWith('-input.json'))){
  const name=file.replace('-input.json','');
  test(`saved failure ${name} keeps its original contract through bounded repair`,()=>{
    const input=load(name),snapshot=structuredClone(input);
    const result=proposeBedroomApproachRepair(input.plan,input.survey,input.options);
    assert.deepEqual(input,snapshot);
    assert.ok(result.candidateCount<=input.options.maxCandidates||result.candidateCount<=2000);
    if(successes.has(name)){assert.equal(result.status,'repaired');verifyProposal(input,result);}
    else {assert.equal(result.status,'search_limit');assert.equal(result.proposedPlan,undefined);}
  });
}

test('disabled, invalid or unbounded requests never return a repair proposal',()=>{
  const input=load(west);
  assert.equal(proposeBedroomApproachRepair(input.plan,input.survey).status,'disabled');
  for(const patch of [{enabled:'yes'},{maxCandidates:0},{maxCandidates:Infinity},{maxRouteChecks:0},
    {gridStepFt:0.001},{maxDisplacementFt:1000},{allowQuarterTurns:'yes'},{nightstandPlacement:'remove'},
    {request:{...input.options.request,sidePolicy:undefined}},
    {request:{...input.options.request,maxNodes:1000000}}]){
    const result=proposeBedroomApproachRepair(input.plan,input.survey,{...input.options,...patch});
    assert.equal(result.status,'not_checked');assert.equal(result.proposedPlan,undefined);
  }
  assert.equal(proposeBedroomApproachRepair(input.plan,{},input.options).status,'not_checked');
});

test('quarter turns repair the saved west wide-door case without changing physical furniture sizes',()=>{
  const input=load('matrix-West-wide-1-option-2-level-2');
  input.options={...input.options,allowQuarterTurns:true,maxCandidates:4000,maxRouteChecks:64};
  const original=structuredClone(input);
  const result=proposeBedroomApproachRepair(input.plan,input.survey,input.options);
  assert.equal(result.status,'repaired');assert.equal(result.quarterTurns,1);
  verifyProposal(input,result);assert.deepEqual(input,original);
  const before=input.plan.levels[1].furniture.filter(f=>result.changes.some(c=>c.furnitureId===f.id));
  const after=result.proposedPlan.levels[1].furniture.filter(f=>result.changes.some(c=>c.furnitureId===f.id));
  const bedA=before.find(f=>f.id===input.options.request.bedId),bedB=after.find(f=>f.id===bedA.id);
  for(const item of before){
    const next=after.find(f=>f.id===item.id);
    const ox=item.x+item.w/2-bedA.x-bedA.w/2,oy=item.y+item.h/2-bedA.y-bedA.h/2;
    assert.ok(Math.abs(next.x+next.w/2-bedB.x-bedB.w/2+oy)<1e-8);
    assert.ok(Math.abs(next.y+next.h/2-bedB.y-bedB.h/2-ox)<1e-8);
  }
});

test('explicit head-side nightstand placement preserves inventory and stays stable on repeat',()=>{
  const input=load('matrix-West-wide-1-option-2-level-2');
  input.options={...input.options,allowQuarterTurns:true,nightstandPlacement:'head_sides',maxCandidates:4000,maxRouteChecks:64};
  const result=proposeBedroomApproachRepair(input.plan,input.survey,input.options);
  assert.equal(result.status,'repaired');verifyProposal(input,result);
  const level=result.proposedPlan.levels[1],bed=level.furniture.find(f=>f.id===input.options.request.bedId);
  const stands=level.furniture.filter(f=>f.roomId===bed.roomId&&f.kind==='nightstand');assert.equal(stands.length,2);
  // Undo the bed's rotation around its centre to independently check head-side offsets.
  const center={x:bed.x+bed.w/2,y:bed.y+bed.h/2};
  const unrotate=item=>{let r={...item};for(let i=0;i<(4-bed.rotation/90)%4;i++)r={...r,x:center.x-(r.y+r.h-center.y),y:center.y+(r.x-center.x),w:r.h,h:r.w};return r;};
  const base=unrotate(bed),leftRight=stands.map(unrotate).sort((a,b)=>a.x-b.x);
  assert.ok(Math.abs(leftRight[0].x+leftRight[0].w+0.35-base.x)<1e-8);
  assert.ok(Math.abs(leftRight[1].x-base.x-base.w-0.35)<1e-8);
  assert.ok(leftRight.every(f=>Math.abs(f.y-base.y-0.5)<1e-8));
  const restored=JSON.parse(JSON.stringify(result.proposedPlan));
  assert.equal(proposeBedroomApproachRepair(restored,input.survey,input.options).status,'unchanged');
});

test('head-side placement refuses ambiguous inventory and unsupported orientation',()=>{
  const input=load(west);
  const stand=input.plan.levels[1].furniture.find(f=>f.kind==='nightstand'&&f.roomId==='architect_v2_bedroom_16');
  input.plan.levels[1].furniture=input.plan.levels[1].furniture.filter(f=>f.id!==stand.id);
  input.plan.furniture[1].items=structuredClone(input.plan.levels[1].furniture);
  assert.equal(proposeBedroomApproachRepair(input.plan,input.survey,{...input.options,nightstandPlacement:'head_sides'}).status,'not_checked');
  const bad=load(west);bad.plan.levels[1].furniture.find(f=>f.kind==='nightstand'&&f.roomId==='architect_v2_bedroom_16').rotation=45;
  assert.equal(proposeBedroomApproachRepair(bad.plan,bad.survey,{...bad.options,allowQuarterTurns:true}).status,'not_checked');
});

test('half-turn proposal keeps rigid furniture relationships and repeats without another move',()=>{
  const input=load('matrix-East-standard-1-option-2-level-2');
  input.options={...input.options,allowQuarterTurns:true,maxCandidates:4000,maxRouteChecks:64};
  const result=proposeBedroomApproachRepair(input.plan,input.survey,input.options);
  assert.equal(result.status,'repaired');assert.equal(result.quarterTurns,2);verifyProposal(input,result);
  const originalBed=input.plan.levels[1].furniture.find(f=>f.id===input.options.request.bedId);
  const updatedBed=result.proposedPlan.levels[1].furniture.find(f=>f.id===originalBed.id);
  for(const change of result.changes){
    const a=change.before,b=change.after;
    assert.ok(Math.abs((a.x+a.w/2-originalBed.x-originalBed.w/2)+(b.x+b.w/2-updatedBed.x-updatedBed.w/2))<1e-8);
    assert.ok(Math.abs((a.y+a.h/2-originalBed.y-originalBed.h/2)+(b.y+b.h/2-updatedBed.y-updatedBed.h/2))<1e-8);
  }
  assert.equal(proposeBedroomApproachRepair(JSON.parse(JSON.stringify(result.proposedPlan)),input.survey,input.options).status,'unchanged');
});

test('a larger requested footprint cannot be hidden by moving furniture or lowering the side policy',()=>{
  const input=load(west);
  const result=proposeBedroomApproachRepair(input.plan,input.survey,{...input.options,request:{...input.options.request,clearWidthFt:4,sidePolicy:'both'}});
  assert.equal(result.status,'blocked');assert.equal(result.candidateCount,0);assert.equal(result.proposedPlan,undefined);
  const both=proposeBedroomApproachRepair(input.plan,input.survey,{...input.options,request:{...input.options.request,sidePolicy:'both'},maxCandidates:200,maxRouteChecks:8});
  if(both.status==='repaired'){
    assert.equal(both.after.sidePolicy,'both');assert.equal(both.after.sides.filter(s=>s.status==='clear').length,2);
  }else{assert.equal(both.proposedPlan,undefined);assert.ok(['search_limit','search_exhausted'].includes(both.status));}
});

test('failed search returns no partial edit and an accepted proposal is stable after JSON restore',()=>{
  const input=load(west),before=structuredClone(input);
  const limited=proposeBedroomApproachRepair(input.plan,input.survey,{...input.options,maxCandidates:1});
  assert.equal(limited.status,'search_limit');assert.equal(limited.candidateCount,1);assert.equal(limited.proposedPlan,undefined);
  assert.deepEqual(input,before);
  const repaired=proposeBedroomApproachRepair(input.plan,input.survey,input.options);
  const restored=JSON.parse(JSON.stringify(repaired.proposedPlan));
  const repeated=proposeBedroomApproachRepair(restored,input.survey,input.options);
  assert.equal(repeated.status,'unchanged');assert.equal(repeated.candidateCount,0);
  assert.deepEqual(validateEditedPlan(restored,input.survey),[]);
});

test('aggregate furniture mismatches and stale schedules cannot be hidden by a repair',()=>{
  for(const mutation of [p=>{p.furniture[1].items[0].x+=1;},p=>{p.levels[1].doors[0].width+=0.5;}]){
    const input=load(west);mutation(input.plan);
    const result=proposeBedroomApproachRepair(input.plan,input.survey,input.options);
    assert.equal(result.status,'not_checked');assert.equal(result.proposedPlan,undefined);
  }
});

test('north wall mismatch is not fixed by pushing the bed into its closet access reservation',()=>{
  const input=load('matrix-North-standard-1-option-4-level-2');
  const level=input.plan.levels[1],bed=level.furniture.find(f=>f.id===input.options.request.bedId),room=level.rooms.find(r=>r.id===bed.roomId);
  const moved={...bed,y:0.3020833333333333};
  assert.ok(containsRect(buildFloorPassageModel(level).roomClear.find(r=>r.roomId===room.id).parts,moved));
  assert.ok(doorClearances(room,level).some(zone=>intersects(moved,zone)));
  const result=proposeBedroomApproachRepair(input.plan,input.survey,{...input.options,maxCandidates:10000,maxDisplacementFt:12,gridStepFt:0.5});
  assert.equal(result.status,'search_exhausted');assert.equal(result.proposedPlan,undefined);
  assert.ok(result.rejections.door_zone>0);assert.ok(result.rejections.finished_room_or_bed_envelope>0);
});
