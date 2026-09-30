'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalizeBrief}=require('../lib/nepal/normalizeBrief');
const {searchConcepts}=require('../lib/nepal/candidateSearch');

function concepts(file){
  const raw=structuredClone(require(`./fixtures/nepal/${file}.json`));
  for(const level of raw.buildingProgram.levels)
    level.specialRooms=level.specialRooms.filter(room=>room!=='puja');
  raw.buildingProgram.levels.at(-1).specialRooms.push('puja');
  const normalized=normalizeBrief(raw);
  assert.deepEqual(normalized.invalid,[]);
  assert.deepEqual(normalized.unsupported,[]);
  return searchConcepts(normalized.brief,{provisionalSetbacksMm:[1000,1000,1000,1000],
    workingCoverageLimit:0.7,maxCandidates:6}).candidates;
}

test('numbered review set contains ten measured layouts with top owner puja and honest column findings',()=>{
  const owner=concepts('rectangle-2_5'),rental=concepts('rental-3_5');
  assert.equal(owner.length,4);
  assert.equal(rental.length,6);
  assert.equal(new Set([...owner,...rental].map(c=>c.geometryHash)).size,10);
  for(const candidate of [...owner,...rental]){
    assert.ok(candidate.levels.at(-1).rooms.rooms.some(room=>room.type==='puja'));
    assert.equal(candidate.core.siteEntry.clearWidthMm,1200);
    assert.ok(candidate.validation.blockers.some(b=>b.code==='PARTIAL_TOP_TERRACE_ENCLOSURE_UNVERIFIED'));
  }
  assert.ok(rental.some(c=>c.order==='living-first'&&
    !c.validation.blockers.some(b=>b.code==='COLUMN_IN_ROOM_CLEAR_AREA')));
  assert.ok(owner.some(c=>c.order==='living-first'&&c.levels[0].rooms.parking&&
    !c.validation.blockers.some(b=>b.code==='COLUMN_IN_ROOM_CLEAR_AREA')));
});

test('section checks report puja/toilet (V06), puja/stair (V07) and offset wet rooms (C17)',()=>{
  const {verticalStackFacts}=require('../lib/nepal/validateNepalPlan');
  const b=(x1,y1,x2,y2)=>({x1,y1,x2,y2});
  const room=(id,type,box)=>({id,type,box});
  const candidate={core:{id:'core',box:b(0,0,2000,4000),levelIds:['g','f','t']},levels:[
    {id:'g',rooms:{rooms:[room('g-bath','bathroom',b(2000,0,4000,2000)),room('g-kit','kitchen',b(4000,0,7000,3000))]}},
    {id:'f',rooms:{rooms:[room('f-puja','puja',b(2000,0,4000,2000)),room('f-bath','bathroom',b(4000,2000,6000,4000)),
      room('f-kit','kitchen',b(7000,0,9000,3000))]}},
    {id:'t',rooms:{rooms:[room('t-puja','puja',b(1000,4000,3000,6000))]}}]};
  const v=verticalStackFacts(candidate);
  assert.deepEqual(v.pujaToilet.map(x=>[x.pujaId,x.relation,x.toiletRoomId,x.overlapSqM??x.sharedEdgeMm]),
    [['f-puja','toilet_below','g-bath',4]]);
  // t-puja only touches the core edge at y=4000: touching is not overlap.
  assert.deepEqual(v.pujaStair,[]);
  assert.equal(v.facts['puja.toilet_conflict'],true);
  assert.equal(v.facts['puja.stair_overlap'],false);
  assert.deepEqual(v.wetStack.map(x=>[x.roomId,x.overWetShare]),[['f-bath',0.5],['f-kit',0]]);
  candidate.levels[2].rooms.rooms[0].box=b(500,3000,2500,5000);
  candidate.levels[1].rooms.rooms[0].box=b(4000,4000,6000,6000);
  const moved=verticalStackFacts(candidate);
  assert.deepEqual(moved.pujaStair.map(x=>[x.pujaId,x.relation,x.overlapSqM]),[['t-puja','stair_below',1.5]]);
  assert.deepEqual(moved.pujaToilet.map(x=>[x.pujaId,x.relation,x.sharedEdgeMm]),[['f-puja','shares_wall',2000]]);
  // No found conflict does not prove separation: door sightlines are unmeasured.
  candidate.levels[1].rooms.rooms[0].box=b(0,5000,1000,7000);
  assert.equal(verticalStackFacts(candidate).facts['puja.toilet_conflict'],null);
});

test('generated owner layouts expose a ground puja under a first-floor bathroom',()=>{
  const raw=structuredClone(require('./fixtures/nepal/rectangle-2_5.json'));
  const candidates=searchConcepts(normalizeBrief(raw).brief,{provisionalSetbacksMm:[1000,1000,1000,1000],
    workingCoverageLimit:0.7,maxCandidates:6}).candidates;
  for(const candidate of candidates){
    const v6=candidate.validation.blockers.filter(b=>b.code==='PUJA_TOILET_SEPARATION_NOT_MET');
    assert.equal(v6.length>0,candidate.order==='living-first',candidate.id);
    for(const finding of v6)assert.deepEqual([finding.ruleId,finding.relation,finding.overlapSqM],['V06','toilet_above',3.3]);
  }
});
