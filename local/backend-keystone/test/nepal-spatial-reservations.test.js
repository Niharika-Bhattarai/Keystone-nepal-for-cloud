'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {doorOnSharedEdge,exposedVerticalSegments,exposedHorizontalSegments,reserveWindow}=
  require('../lib/nepal/spatialReservations');
const {normalizeBrief}=require('../lib/nepal/normalizeBrief');
const {searchConcepts}=require('../lib/nepal/candidateSearch');

test('rooms need a shared wall long enough for the specified clear door width',()=>{
  const corridor=[4000,0,5000,6000];
  assert.deepEqual(doorOnSharedEdge([0,0,4000,1800],corridor),{
    axis:'vertical',x:4000,y1:450,y2:1350,clearWidthMm:900,
    status:'opening_reserved_swing_unverified'});
  assert.equal(doorOnSharedEdge([0,0,4000,1000],corridor),null);
  assert.equal(doorOnSharedEdge([0,6000,4000,7000],corridor),null);
});
test('stepped massing exposes only the portion of a wall actually facing outdoors',()=>{
  const room=[0,0,4000,6000],slabs=[room,[4000,3000,6000,6000]];
  assert.deepEqual(exposedVerticalSegments(room,slabs,'east'),[
    {x:4000,y1:0,y2:3000,face:'east'}]);
  const opening=reserveWindow(room,slabs,'east',2.4);
  assert.equal(opening?.clearWidthMm,2000);
  assert.ok(opening.y1>=300&&opening.y2<=2700);
  assert.equal(reserveWindow(room,slabs,'east',3.6),null);
});
test('a blocked side wall can use a real exterior end wall',()=>{
  const slabs=[[0,0,6000,6000]],living=[1000,0,4000,2500];
  assert.deepEqual(exposedVerticalSegments(living,slabs,'east'),[]);
  assert.deepEqual(exposedHorizontalSegments(living,slabs,'south'),[
    {y:0,x1:1000,x2:4000,face:'south'}]);
  assert.equal(reserveWindow(living,slabs,'south',1.2)?.face,'south');
});
test('selected rental hypotheses reserve room doors and physically exposed habitable windows',()=>{
  const brief=normalizeBrief(require('./fixtures/nepal/rental-3_5.json')).brief;
  const result=searchConcepts(brief,{provisionalSetbacksMm:[1000,1000,1000,1000]});
  assert.equal(result.candidates.length,3);
  for(const candidate of result.candidates){
    assert.equal(candidate.validation.blockers.filter(b=>b.code==='NO_PHYSICAL_EXTERIOR_WINDOW_RESERVATION').length,0);
    for(const level of candidate.levels){
      if(!level.rooms)continue;
      assert.ok(level.rooms.unitEntry.doorReservation);
      for(const room of level.rooms.rooms){
        assert.ok(room.doorReservation,room.id);
        if(room.provisionalNaturalLightOpeningSqM)
          assert.ok((room.windowReservations||[]).reduce((n,w)=>n+w.provisionalClearAreaSqM,0)>=
            room.provisionalNaturalLightOpeningSqM-0.001,room.id);
      }
    }
  }
  assert.ok(result.attempts.some(a=>a.status==='hypothesis'&&
    a.blockers.includes('NO_PHYSICAL_EXTERIOR_WINDOW_RESERVATION')));
});
