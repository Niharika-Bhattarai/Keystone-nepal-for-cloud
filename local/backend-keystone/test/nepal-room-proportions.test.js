'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalizeBrief}=require('../lib/nepal/normalizeBrief');
const {searchConcepts}=require('../lib/nepal/candidateSearch');
const {planFloorRooms}=require('../lib/nepal/roomPlanner');
const {validateSpatialHypothesis}=require('../lib/nepal/validateNepalPlan');

const setbacks=[1000,1000,1000,1000];
const owner=normalizeBrief(require('./fixtures/nepal/rectangle-2_5.json')).brief;
const rental=normalizeBrief(require('./fixtures/nepal/rental-3_5.json')).brief;

test('owner working plan separates oversized service and public-room areas without losing requested rooms',()=>{
  const result=searchConcepts(owner,{provisionalSetbacksMm:setbacks,workingCoverageLimit:0.7});
  assert.equal(result.candidates.length,3);
  for(const candidate of result.candidates){
    const ground=candidate.levels[0].rooms.rooms;
    const byType=type=>ground.find(room=>room.type===type);
    assert.ok(byType('puja').clearAreaSqM>=3.24&&byType('puja').clearAreaSqM<=5);
    assert.ok(byType('bathroom').clearAreaSqM<=5);
    assert.ok(byType('kitchen').clearAreaSqM<23);
    assert.equal(byType('kitchen').diningWithinKitchen,true);
    assert.ok(byType('livingRoom'));
    assert.equal(byType('dining'),undefined);
    for(const type of ['livingAnnex','utilityFlex'])
      assert.equal(byType(type).suggestedByPlanner,true);
    assert.equal(byType('livingAnnex').doorReservation.status,'open_portal_reserved_no_door');
    assert.ok(ground.every(room=>room.doorReservation));
    assert.ok(!candidate.validation.blockers.some(b=>b.code==='ROOM_SIZE_BELOW_PROVISIONAL_NBC206'));
    assert.ok(candidate.validation.blockers.some(b=>b.code==='SUGGESTED_SPACE_USE_FOR_OWNER_REVIEW'));
  }
});

test('rental and owner levels keep survey counts when a utility flex is proposed',()=>{
  const result=searchConcepts(rental,{provisionalSetbacksMm:setbacks,workingCoverageLimit:0.7});
  assert.equal(result.candidates.length,3);
  for(const candidate of result.candidates){
    for(let i=0;i<3;i++){
      const requested=rental.buildingProgram.levels[i];
      const rooms=candidate.levels[i].rooms.rooms;
      assert.equal(rooms.filter(r=>['bedroom','primaryBedroom','guestBedroom'].includes(r.type)).length,
        requested.bedrooms);
      assert.equal(rooms.filter(r=>r.type==='bathroom').length,requested.bathrooms);
      assert.equal(rooms.filter(r=>r.type==='kitchen').length,requested.kitchens);
      assert.equal(rooms.filter(r=>r.type==='livingRoom').length,requested.livingRooms);
      assert.ok(rooms.every(r=>r.doorReservation));
    }
    assert.ok(!candidate.validation.blockers.some(b=>b.code==='ROOM_SIZE_BELOW_PROVISIONAL_NBC206'));
  }
});

test('tightened floor still keeps both puja and annex large enough at the split threshold',()=>{
  const base=searchConcepts(owner,{provisionalSetbacksMm:setbacks}).candidates[0];
  const footprint={family:'rectangle',slabs:[[1000,1000,10250,10050]]};
  const rooms=planFloorRooms({level:owner.buildingProgram.levels[0],footprint,
    core:base.core,bearingDegrees:owner.site.north.bearingDegrees,order:'living-first'});
  assert.equal(rooms.ok,true);
  const puja=rooms.rooms.find(r=>r.type==='puja');
  const annex=rooms.rooms.find(r=>r.type==='livingAnnex');
  assert.ok(puja.areaSqM>=3.24);
  assert.ok(annex.areaSqM>=3);
  assert.ok(puja.box.y2-puja.box.y1>=1800);
  assert.ok(annex.box.y2-annex.box.y1>=1800);
});

test('minimum service-strip split leaves a 1.5 m utility zone and a usable bathroom',()=>{
  const base=searchConcepts(owner,{provisionalSetbacksMm:setbacks}).candidates[0];
  const footprint={family:'rectangle',slabs:[[1000,1000,10250,9500]]};
  const rooms=planFloorRooms({level:owner.buildingProgram.levels[0],footprint,
    core:base.core,bearingDegrees:owner.site.north.bearingDegrees,order:'living-first'});
  assert.equal(rooms.ok,true);
  const utility=rooms.rooms.find(r=>r.type==='utilityFlex');
  const bath=rooms.rooms.find(r=>r.type==='bathroom');
  assert.ok(utility.box.y2-utility.box.y1>=1800);
  assert.ok(bath.box.y2-bath.box.y1>=1200&&bath.box.y2-bath.box.y1<=1525);
  assert.ok(Math.max(bath.box.x2-bath.box.x1,bath.box.y2-bath.box.y1)<=2743);
  const model={...base,levels:[{...base.levels[0],rooms},...base.levels.slice(1)]};
  assert.ok(!validateSpatialHypothesis(model).blockers.some(b=>b.code==='ROOM_SIZE_BELOW_PROVISIONAL_NBC206'));
});
