'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalizeBrief}=require('../lib/nepal/normalizeBrief');
const {searchConcepts}=require('../lib/nepal/candidateSearch');
const {runSpatialStudy,renderSpatialStudy}=require('../lib/nepal/spatialStudy');
function candidate(size){
  const raw=structuredClone(require('./fixtures/nepal/rectangle-2_5.json'));
  for(const l of raw.buildingProgram.levels)l.specialRooms=l.specialRooms.filter(s=>s!=='puja');
  raw.buildingProgram.levels.at(-1).specialRooms.push('puja');
  if(size){raw.site.rectangle.width.value=size;raw.site.rectangle.depth.value=size;
    raw.site.sideLengths.forEach(s=>s.value=size);raw.site.declaredArea={value:size*size,unit:'sq_m'};}
  return searchConcepts(normalizeBrief(raw).brief,{provisionalSetbacksMm:Array(4).fill(size?1500:1000),
    workingCoverageLimit:.7,maxCandidates:1}).candidates[0];
}
test('polygon worker adds contained projecting balcony and reports small-plot court failure honestly',async()=>{
  const c=candidate(),{studies:[s]}=await runSpatialStudy([c]);
  assert.ok(s.balconyCount>0);assert.ok(s.projectedCoverageRatio<=.7);
  assert.equal(s.court,null);assert.equal(s.courtStatus,'no_feasible_court_in_search');
  assert.ok(Object.keys(s.courtAttempts).length>0);
  for(const l of s.levels){
    assert.deepEqual(l.rooms.map(r=>r.id).sort(),c.levels.find(x=>x.id===l.id).rooms.rooms.map(r=>r.id).sort());
    for(const b of l.balconies){assert.ok(b.depthMm>=914);assert.ok(b.guard);assert.ok(b.door);}
  }
});
test('stack service search retains rooms and exposes remaining architectural defects',async()=>{
  const c=candidate(16),{studies:[s]}=await runSpatialStudy([c]);
  assert.equal(s.courtStatus,'continuous_open_to_sky');
  assert.equal(s.voidUse,'bathroom_service_shaft');
  assert.ok(s.levels.some(l=>l.replannedAroundCourt));
  assert.ok(s.levels.every(l=>!l.issues.some(i=>i.code==='COLUMN_INSIDE_ROOM')));
  assert.ok(s.levels.every(l=>!l.issues.some(i=>i.code==='OVERSIZED_BATHROOM_REQUIRES_REPLANNING')));
  for(const l of s.levels)for(const r of l.rooms.filter(r=>r.type==='bathroom')){
    assert.ok(l.openings.some(o=>o.roomId===r.id&&o.kind==='service-shaft-window'));
  }
  for(const l of s.levels){
    const required=c.levels.find(x=>x.id===l.id).rooms.rooms.filter(r=>!r.suggestedByPlanner).map(r=>r.id);
    assert.ok(required.every(id=>l.rooms.some(r=>r.id===id)));
  }
  assert.ok(s.projectedCoverageRatio<=.7);
  assert.match(renderSpatialStudy({studies:[s]}),/not a validated house/);
});
