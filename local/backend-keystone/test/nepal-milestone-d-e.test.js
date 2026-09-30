'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const raw=require('./fixtures/nepal/rental-3_5.json');
const {normalizeBrief}=require('../lib/nepal/normalizeBrief');
const {siteEnvelope,footprints}=require('../lib/nepal/siteEnvelope');
const {frameGrid}=require('../lib/nepal/frameGrid');
const {reserveCore}=require('../lib/nepal/corePlanner');
const {planHalfTurn}=require('../lib/nepal/stairProfile');
const {searchConcepts}=require('../lib/nepal/candidateSearch');
const brief=normalizeBrief(raw).brief;
test('rectangle site permits distinct L, U and full massing with explicit provisional setbacks',()=>{
  assert.throws(()=>siteEnvelope(brief),/explicit edge setbacks/);
  const env=siteEnvelope(brief,{setbacksMm:[1000,1000,1000,1000]});
  const options=footprints(env);
  assert.deepEqual(options.map(p=>p.family),['rectangle','L-northwest','L-northeast','U-north-court']);
  const court=options[3].openCourt;
  assert.ok(court.x2-court.x1>=3000&&court.y2-court.y1>=3000);
  assert.equal(new Set(options.map(p=>p.areaSqM)).size,3);
  assert.equal(env.legalStatus,'provisional_unverified');
});
test('submillimetre survey units are recorded but geometry snaps only at the 1 mm engine boundary',()=>{
  const modified=structuredClone(raw);modified.site.rectangle.width={value:11.2515,unit:'m'};
  const adjusted=normalizeBrief(modified).brief;
  const env=siteEnvelope(adjusted,{setbacksMm:[1000,1000,1000,1000]});
  assert.equal(env.site.x2,11252);
  assert.ok(Math.abs((env.site.x2/1000*11.25)-adjusted.site.measuredAreaSqM)<0.02);
});
test('grid columns have stable identifiers, core reaches all levels and rental entrances stay on shared landing',()=>{
  const options=footprints(siteEnvelope(brief,{setbacksMm:[1000,1000,1000,1000]}));
  const grid=frameGrid(options[0]);
  assert.ok(grid.columns.length>9);
  assert.equal(grid.engineerReviewed,false);
  const core=reserveCore({footprint:options[0],levels:brief.buildingProgram.levels});
  assert.equal(core.flights.length,3); assert.equal(core.rentalEntries.length,2);
  assert.ok(core.rentalEntries.every(e=>e.from==='shared-landing'));
  assert.ok(core.reservoir.netVolumeLitres>=8000);
  assert.equal(core.reservoir.location,'below-ground-stair-core');
  const hatch=core.reservoir.accessHatch.box,tank=core.reservoir.innerPlanBox;
  assert.ok(hatch.x1>=tank.x1&&hatch.x2<=tank.x2&&hatch.y1>=tank.y1&&hatch.y2<=tank.y2);
});
test('half-turn risers fit exact 3m rise and fail undersized cores',()=>{
  const s=planHalfTurn({riseMm:3000,core:[0,0,2600,5200]});
  assert.equal(s.flights.reduce((n,f)=>n+f.riserCount,0),s.risers);
  assert.equal(s.risers*s.riserMm,3000);
  assert.ok(s.flights.every(f=>f.riserCount<=15));
  assert.equal(s.headroomStatus,'unverified_until_beam_and_slab_geometry');
  const uneven=planHalfTurn({riseMm:3200,core:[0,0,2600,5200]});
  assert.equal(uneven.risers,17);
  assert.equal(uneven.flights[1].box.y2,uneven.landings[0].box.y1);
  assert.equal(uneven.flights[0].box.y2,uneven.landings[0].box.y1);
  assert.equal(s.arrivalLandings[0].box.y2,s.flights[0].box.y1);
  assert.equal(s.arrivalLandings[1].elevationMm,3000);
  assert.equal(s.requiredLengthMm,4690);
  assert.throws(()=>planHalfTurn({riseMm:3000,core:[0,0,2000,2200]}),/requires/);
});
test('independent unit entry aligns with the floor-level pad and columns avoid the clear corridor',()=>{
  const result=searchConcepts(brief,{provisionalSetbacksMm:[1000,1000,1000,1000]});
  for(const candidate of result.candidates){
    const arrival=candidate.core.flights[0].arrivalLandings[0].box;
    const corridor=candidate.levels[0].rooms.corridor;
    const crossHall=candidate.levels[0].rooms.crossHall;
    for(const level of candidate.levels.filter(l=>l.rooms)){
      const door=level.rooms.unitEntry.doorReservation;
      assert.ok(door.y1>=arrival.y1&&door.y2<=arrival.y2);
      assert.equal(door.clearWidthMm,1000);
    }
    const {routeColumnObstructions}=require('../lib/nepal/validateNepalPlan');
    assert.deepEqual(routeColumnObstructions(corridor,candidate.grid,'vertical'),[]);
    assert.deepEqual(routeColumnObstructions(crossHall,candidate.grid,'horizontal'),[]);
  }
});
test('reservoir cannot be smaller than delivery-truck minimum',()=>{
  const p=footprints(siteEnvelope(brief,{setbacksMm:[1000,1000,1000,1000]}))[0];
  assert.throws(()=>reserveCore({footprint:p,levels:brief.buildingProgram.levels,tankLitres:4000}),/at least 5,000/);
});
