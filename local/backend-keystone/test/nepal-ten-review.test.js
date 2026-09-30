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
  // Synthetic levels carry no slabs, so no exterior stack can be proven.
  assert.deepEqual(v.drainRoutes.map(r=>[r.roomId,r.status]),[['f-kit','no_route_found']]);
  candidate.levels[2].rooms.rooms[0].box=b(500,3000,2500,5000);
  candidate.levels[1].rooms.rooms[0].box=b(4000,4000,6000,6000);
  const moved=verticalStackFacts(candidate);
  assert.deepEqual(moved.pujaStair.map(x=>[x.pujaId,x.relation,x.overlapSqM]),[['t-puja','stair_below',1.5]]);
  assert.deepEqual(moved.pujaToilet.map(x=>[x.pujaId,x.relation,x.sharedEdgeMm]),[['f-puja','shares_wall',2000]]);
  // No found conflict does not prove separation: door sightlines are unmeasured.
  candidate.levels[1].rooms.rooms[0].box=b(0,5000,1000,7000);
  assert.equal(verticalStackFacts(candidate).facts['puja.toilet_conflict'],null);
});

test('offset wet rooms get a reserved drain route: shared-wall branch first, exterior stack only past exterior faces below',()=>{
  const {verticalStackFacts}=require('../lib/nepal/validateNepalPlan');
  const b=(x1,y1,x2,y2)=>({x1,y1,x2,y2});
  const room=(id,type,box)=>({id,type,box});
  const level=(id,slab,rooms)=>({id,footprint:{slabs:[slab]},rooms:{rooms}});
  const candidate={levels:[
    level('g',b(0,0,10000,8000),[room('g-bath','bathroom',b(0,0,2000,2000))]),
    level('f',b(0,0,10000,8000),[room('f-bath1','bathroom',b(0,0,2000,2000)),
      room('f-bath2','bathroom',b(0,2000,2000,4500)),room('f-bath3','bathroom',b(8000,3000,10000,5000)),
      room('f-kit','kitchen',b(4000,3000,6000,5000))]),
    level('t',b(0,0,6000,6000),[room('t-bath','bathroom',b(4000,5000,6000,6000))])]};
  const routes=Object.fromEntries(verticalStackFacts(candidate).drainRoutes.map(r=>[r.roomId,r]));
  assert.deepEqual([routes['f-bath2'].kind,routes['f-bath2'].toRoomId,routes['f-bath2'].horizontalRunMm],
    ['branch_to_adjacent_stack','f-bath1',1250]);
  assert.deepEqual([routes['f-bath3'].kind,routes['f-bath3'].planFace,routes['f-bath3'].horizontalRunMm],
    ['new_stack_on_exterior_wall','east',1000]);
  // An interior kitchen with no stacked neighbour has no route and stays a C17 finding.
  assert.equal(routes['f-kit'].status,'no_route_found');
  // The partial top's east/north faces sit over the full floor below: no exterior drop there.
  assert.equal(routes['t-bath'].status,'no_route_found');
});

test('owner bedroom floor moves its attached bath off the ground puja below (V06) and reports NE toilets (V13)',()=>{
  const raw=structuredClone(require('./fixtures/nepal/rectangle-2_5.json'));
  const candidates=searchConcepts(normalizeBrief(raw).brief,{provisionalSetbacksMm:[1000,1000,1000,1000],
    workingCoverageLimit:0.7,maxCandidates:6}).candidates;
  assert.equal(candidates.length,4);
  for(const candidate of candidates){
    const [ground,first]=candidate.levels,replan=first.rooms.bathReplan;
    const puja=ground.rooms.rooms.find(r=>r.type==='puja');
    const bath=first.rooms.rooms.find(r=>r.attachedTo);
    assert.equal(candidate.validation.verticalStack.pujaToilet.length,0,candidate.id);
    assert.ok(Math.max(0,Math.min(puja.box.x2,bath.box.x2)-Math.max(puja.box.x1,bath.box.x1))*
      Math.max(0,Math.min(puja.box.y2,bath.box.y2)-Math.max(puja.box.y1,bath.box.y1))<1e4,candidate.id);
    // The moved bath and the alcove left beside it keep usable clear sizes and doors.
    assert.ok(!candidate.validation.blockers.some(b=>b.code==='ROOM_SIZE_BELOW_PROVISIONAL_NBC206'&&
      b.levelId==='first'),candidate.id);
    assert.equal(bath.doorReservation.from,'primary-bedroom');
    const v13=candidate.validation.blockers.filter(b=>b.code==='TOILET_IN_NE_OR_CENTER');
    assert.deepEqual(v13.map(b=>b.excludedZoneSqM),
      candidate.validation.toiletZones.excluded.map(x=>x.excludedZoneSqM));
    if(candidate.order==='living-first'){
      assert.equal(replan.status,'applied',candidate.id);
      assert.equal(replan.original.pujaOverlapSqM,3.3);
      assert.equal(replan.proposed.pujaOverlapSqM,0);
      assert.ok(replan.proposed.excludedZoneSqM<=replan.original.excludedZoneSqM);
    }
  }
  // West core: an outer-wall bath cannot leave the NE without landing over the ground
  // puja, so the floor is reworked with the bath against the family foyer and the
  // alcove as the bedroom's entry vestibule (owner instruction 2026-09-30).
  for(const id of ['rectangle-west-living-first','rectangle-west-bedrooms-south']){
    const c=candidates.find(x=>x.id===id),first=c.levels[1].rooms;
    assert.deepEqual([first.bathReplan.status,first.bathReplan.proposed.side],['applied','inner'],id);
    const [primary,bath,alcove]=['primaryBedroom','bathroom','primaryAlcove'].map(t=>first.rooms.find(r=>r.type===t));
    assert.deepEqual([alcove.doorReservation.from,primary.doorReservation.from,bath.doorReservation.from],
      ['unit-corridor','primary-alcove','primary-bedroom'],id);
    assert.equal(primary.doorReservation.status,'open_portal_reserved_no_door');
    assert.ok(primary.clearAreaSqM>12,id);
  }
  for(const c of candidates){
    assert.equal(c.validation.toiletZones.facts['bathrooms.avoid_ne_center'],true,c.id);
    assert.ok(!c.validation.blockers.some(b=>b.code==='TOILET_IN_NE_OR_CENTER'),c.id);
  }
});

test('toilet zone facts measure each bathroom against NE/centre and stay unknown without bathrooms',()=>{
  const {toiletZoneFacts}=require('../lib/nepal/validateNepalPlan');
  const finding=(roomId,zones,preferredShare)=>({roomId,type:'bathroom',preferredShare,
    zoneAreasSqM:{NE:0,N:0,NW:0,E:0,C:0,W:0,SE:0,S:0,SW:0,...zones}});
  const level=(id,findings)=>({id,rooms:{rooms:[],vastuFindings:findings}});
  const facts=toiletZoneFacts({levels:[level('a',[finding('a-nw',{NW:3},1),
    finding('a-mix',{C:0.5,W:2.5},2.5/3)]),level('b',[finding('b-edge',{NE:0.005,E:3},0)])]});
  assert.deepEqual(facts.excluded,[{levelId:'a',roomId:'a-mix',excludedZoneSqM:0.5,
    excludedZoneShare:0.17,zonesSqM:{NE:0,C:0.5}}]);
  assert.deepEqual(facts.outsidePreferred.map(x=>x.roomId),['a-mix','b-edge']);
  assert.deepEqual(facts.facts,{'bathrooms.avoid_ne_center':false,'bathrooms.all_in_nw_w':false});
  assert.deepEqual(toiletZoneFacts({levels:[level('a',[])]}).facts,
    {'bathrooms.avoid_ne_center':null,'bathrooms.all_in_nw_w':null});
});

test('rental top-floor puja is moved off the bathroom stack by widening within the owner area cap',()=>{
  const rental=concepts('rental-3_5');
  assert.equal(rental.length,6);
  for(const candidate of rental){
    const top=candidate.levels.at(-1),replan=top.pujaReplan;
    assert.equal(replan.status,'applied',candidate.id);
    assert.equal(replan.edgeOnColumnLine,true);
    assert.ok(replan.widthMm>=replan.minimumWidthMm);
    assert.ok(replan.proposedAreaSqM<=0.65*replan.fullFloorAreaSqM);
    assert.ok(replan.proposedAreaSqM>replan.originalAreaSqM);
    assert.equal(candidate.validation.verticalStack.pujaToilet.length,0);
    const puja=top.rooms.rooms.find(room=>room.type==='puja');
    assert.ok(Math.min(puja.clearBox.x2-puja.clearBox.x1,puja.clearBox.y2-puja.clearBox.y1)>=1800);
    assert.ok(!candidate.validation.blockers.some(b=>b.code==='ROOM_SIZE_BELOW_PROVISIONAL_NBC206'&&b.roomId===puja.id));
  }
  for(const candidate of concepts('rectangle-2_5'))
    assert.ok(candidate.levels.every(level=>!level.pujaReplan),candidate.id);
});

test('a tighter top-floor cap keeps the puja/toilet conflict visible instead of hiding it',()=>{
  const raw=structuredClone(require('./fixtures/nepal/rental-3_5.json'));
  for(const level of raw.buildingProgram.levels)
    level.specialRooms=level.specialRooms.filter(room=>room!=='puja');
  raw.buildingProgram.levels.at(-1).specialRooms.push('puja');
  const candidates=searchConcepts(normalizeBrief(raw).brief,{provisionalSetbacksMm:[1000,1000,1000,1000],
    workingCoverageLimit:0.7,maxCandidates:6,partialTopMaxShare:0.5}).candidates;
  assert.equal(candidates.length,6);
  for(const candidate of candidates){
    assert.equal(candidate.levels.at(-1).pujaReplan.status,'rejected_area_cap');
    assert.ok(candidate.validation.blockers.some(b=>b.code==='PUJA_TOILET_SEPARATION_NOT_MET'));
  }
});

test('ranking puts core-Vaastu conflicts after physical defects and before the preference score',()=>{
  const {compare}=require('../lib/nepal/candidateSearch');
  const c=(id,codes,score)=>({id,score,validation:{blockers:codes.map(code=>({code}))}});
  const better=c('a-conflict-free',[],[0.2,0,0,-90]);
  const decorative=c('b-high-score',['TOILET_IN_NE_OR_CENTER'],[1,1,1,-80]);
  const physical=c('c-physical',['ROOM_OVERLAP'],[1,1,1,-80]);
  assert.deepEqual([decorative,physical,better].sort(compare).map(x=>x.id),
    ['a-conflict-free','b-high-score','c-physical']);
  // Review-only findings (e.g. C17 routes) do not reorder candidates.
  const routed=c('d-routed',['OFFSET_WET_ROOM_DRAIN_ROUTE_UNVERIFIED'],[0.3,0,0,-90]);
  assert.deepEqual([better,routed].sort(compare).map(x=>x.id),['d-routed','a-conflict-free']);
});
