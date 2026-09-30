'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalizeBrief}=require('../lib/nepal/normalizeBrief');
const {searchConcepts}=require('../lib/nepal/candidateSearch');
const {routeColumnObstructions}=require('../lib/nepal/validateNepalPlan');

function reviewedBrief(file){
  const raw=structuredClone(require(`./fixtures/nepal/${file}.json`));
  for(const level of raw.buildingProgram.levels)
    level.specialRooms=level.specialRooms.filter(room=>room!=='puja');
  raw.buildingProgram.levels.at(-1).specialRooms.push('puja');
  return normalizeBrief(raw).brief;
}
const options={provisionalSetbacksMm:[1000,1000,1000,1000],
  workingCoverageLimit:0.7,maxCandidates:6};

test('owner review puts bike bay at entrance, opens unit entry to living and attaches the first-floor bath',()=>{
  const candidate=searchConcepts(reviewedBrief('rectangle-2_5'),options).candidates[0];
  assert.equal(candidate.order,'living-first');
  const [ground,first]=candidate.levels;
  assert.equal(ground.rooms.unitEntry.to,'living-room');
  assert.equal(ground.rooms.rooms.find(r=>r.type==='livingRoom').entryFrom,
    'shared-floor-level-arrival');
  assert.ok(ground.rooms.circulationPortal);
  assert.ok(ground.rooms.parking);
  assert.ok(ground.rooms.rooms.some(r=>r.serviceExitDoor?.to==='rear-service-strip'));
  assert.ok(ground.rooms.parking.box.x2-ground.rooms.parking.box.x1>=2400);
  assert.ok(ground.rooms.parking.box.y2-ground.rooms.parking.box.y1>=3500);
  const bath=first.rooms.rooms.find(r=>r.attachedTo);
  assert.equal(bath.doorReservation.from,'primary-bedroom');
  assert.equal(bath.box.x2-bath.box.x1,1500);
  assert.equal(bath.box.y2-bath.box.y1,2600);
  assert.equal(first.rooms.rooms.filter(r=>r.type==='bedroom').length,2);
  assert.ok(first.rooms.rooms.filter(r=>r.type==='bedroom').every(r=>r.clearAreaSqM<14));
  assert.ok(first.rooms.balcony?.doorReservation);
  assert.ok(!candidate.validation.blockers.some(b=>['COLUMN_IN_ROOM_CLEAR_AREA',
    'ATTACHED_BATHROOM_ACCESS_UNVERIFIED','ENTRY_NOT_FACING_LIVING'].includes(b.code)));
});

test('dedicated stair bay has four corner grid axes and contains the delivery-sized tank',()=>{
  const candidate=searchConcepts(reviewedBrief('rectangle-2_5'),options).candidates[0];
  const core=candidate.core.box,grid=candidate.grid,half=grid.columnWidthMm/2;
  for(const x of [core.x1+half,core.x2-half])assert.ok(grid.xAxesMm.includes(x));
  for(const y of [core.y1+half,core.y2-half])assert.ok(grid.yAxesMm.includes(y));
  assert.ok(core.y2-core.y1-grid.columnWidthMm<=4267);
  const tank=candidate.core.reservoir;
  assert.ok(tank.innerPlanBox.x1>=core.x1&&tank.innerPlanBox.x2<=core.x2);
  assert.ok(tank.innerPlanBox.y1>=core.y1&&tank.innerPlanBox.y2<=core.y2);
  assert.ok(tank.netVolumeLitres>=8000);
});

test('rental review front door reaches living before the service rooms',()=>{
  const candidate=searchConcepts(reviewedBrief('rental-3_5'),options).candidates[0];
  assert.ok(!candidate.validation.blockers.some(b=>b.code==='CIRCULATION_COLUMN_OBSTRUCTION'));
  for(const level of candidate.levels.filter(l=>l.rooms?.rooms.some(r=>r.type==='livingRoom'))){
    assert.equal(level.rooms.unitEntry.to,'living-room');
    assert.ok(level.rooms.circulationPortal);
    assert.ok(!candidate.validation.blockers.some(b=>b.levelId===level.id&&
      b.code==='ENTRY_NOT_FACING_LIVING'));
  }
});

test('a column that leaves less than one metre around a hall is reported',()=>{
  assert.deepEqual(routeColumnObstructions({x1:0,y1:0,x2:1200,y2:3000},
    {columnWidthMm:350,columns:[{id:'C-1',xMm:600,yMm:1500}]},'vertical'),['C-1']);
});

test('flush neighbour faces never receive a reserved window',()=>{
  const result=searchConcepts(reviewedBrief('rental-3_5'),
    {provisionalSetbacksMm:[1500,1500,0,0],maxCandidates:6});
  assert.ok(result.candidates.length>0);
  for(const candidate of result.candidates)for(const level of candidate.levels)
    for(const room of level.rooms?.rooms||[])for(const window of room.windowReservations||[]){
      assert.notEqual(window.face,'west');
      assert.notEqual(window.face,'north');
      assert.ok(window.boundaryClearanceMm>=1500);
    }
});
