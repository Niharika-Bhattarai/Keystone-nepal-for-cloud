'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalizeBrief}=require('../lib/nepal/normalizeBrief');
const {searchConcepts}=require('../lib/nepal/candidateSearch');
const {COLUMN_WIDTH_MM,INTERIOR_WALL_MM,EXTERIOR_WALL_MM}=require('../lib/nepal/constructionProfile');

function options(raw){
  const normalized=normalizeBrief(raw);
  assert.deepEqual(normalized.invalid,[]);
  return searchConcepts(normalized.brief,{provisionalSetbacksMm:[1000,1000,1000,1000],
    workingCoverageLimit:0.7}).candidates;
}

test('selected concepts reserve 350 mm columns, nominal brick walls and a clear corridor',()=>{
  for(const fixture of ['rectangle-2_5','rental-3_5'])for(const candidate of options(
    require(`./fixtures/nepal/${fixture}.json`))){
    assert.ok(candidate.grid.columns.every(c=>c.widthMm===COLUMN_WIDTH_MM));
    for(const level of candidate.levels.filter(l=>l.rooms)){
      assert.equal(level.walls.nominalInteriorWallMm,INTERIOR_WALL_MM);
      assert.equal(level.walls.nominalExteriorWallMm,EXTERIOR_WALL_MM);
      assert.ok(level.walls.corridorClearWidthMm>=1000);
      assert.ok(level.walls.walls.some(w=>w.kind==='exterior'&&w.thicknessMm===229));
      assert.ok(level.walls.walls.some(w=>w.kind==='interior'&&w.thicknessMm===102));
      assert.deepEqual(level.walls.columnWallConflicts,[]);
      assert.deepEqual(level.walls.openingColumnConflicts,[]);
      const holes=level.walls.walls.flatMap(w=>w.openingBoxes);
      if(level.id===candidate.levels[0].id)
        assert.ok(holes.some(h=>h.opening===candidate.core.siteEntry),'ground site-entry wall void');
      for(const room of level.rooms.rooms){
        assert.ok(room.clearAreaSqM<room.areaSqM,room.id);
        assert.ok(holes.some(h=>h.opening===room.doorReservation),room.id);
        if(room.windowReservation)assert.ok(holes.some(h=>h.opening===room.windowReservation),room.id);
      }
      assert.ok(!candidate.validation.blockers.some(b=>b.levelId===level.id&&
        ['ROOM_SIZE_BELOW_PROVISIONAL_NBC206','OPENING_OVERLAPS_COLUMN',
          'WALL_CROSSES_COLUMN_CORE'].includes(b.code)));
    }
  }
});

test('kitchen and dining share one room by default; a separate room requires an explicit floor choice',()=>{
  const raw=require('./fixtures/nepal/rectangle-2_5.json');
  for(const candidate of options(raw)){
    const rooms=candidate.levels[0].rooms.rooms;
    assert.equal(rooms.filter(r=>r.type==='dining').length,0);
    assert.equal(rooms.find(r=>r.type==='kitchen').diningWithinKitchen,true);
  }
  const requested=structuredClone(raw);
  requested.buildingProgram.levels[0].separateDiningRoom=true;
  for(const candidate of options(requested)){
    const rooms=candidate.levels[0].rooms.rooms;
    assert.equal(rooms.filter(r=>r.type==='dining').length,1);
    assert.equal(rooms.find(r=>r.type==='kitchen').diningWithinKitchen,undefined);
  }
});

test('narrow frontage keeps a puja room in the service bay without inventing a wide living strip',()=>{
  const raw=structuredClone(require('./fixtures/nepal/rectangle-2_5.json'));
  raw.site.rectangle.width.value=9.5;
  raw.site.sideLengths[0].value=9.5;raw.site.sideLengths[2].value=9.5;
  raw.site.declaredArea={value:106.875,unit:'sq_m'};
  for(const candidate of options(raw)){
    const puja=candidate.levels[0].rooms.rooms.find(r=>r.type==='puja');
    assert.match(puja.placementNote,/service bay/);
    assert.ok(Math.min(puja.clearBox.x2-puja.clearBox.x1,
      puja.clearBox.y2-puja.clearBox.y1)>=1800);
    assert.ok(!candidate.validation.blockers.some(b=>b.code==='ROOM_SIZE_BELOW_PROVISIONAL_NBC206'));
  }
});

test('living-first rental entries face a living doorway across the reserved corridor',()=>{
  const candidates=options(require('./fixtures/nepal/rental-3_5.json'));
  for(const candidate of candidates.filter(c=>c.order==='living-first')){
    for(const level of candidate.levels.filter(l=>l.rooms))
      assert.ok(level.rooms.entryLivingFacingOverlapMm>=800);
    assert.ok(!candidate.validation.blockers.some(b=>b.code==='ENTRY_NOT_FACING_LIVING'));
  }
  assert.ok(candidates.some(c=>c.order==='bedrooms-south'&&
    c.validation.blockers.some(b=>b.code==='ENTRY_NOT_FACING_LIVING')));
});

test('owner residential conventions are explicit design intent, and requested balconies remain unresolved',()=>{
  const raw=structuredClone(require('./fixtures/nepal/rectangle-2_5.json'));
  raw.buildingProgram.balconies=['ground','first'];
  for(const candidate of options(raw)){
    const ground=candidate.levels[0],first=candidate.levels[1];
    assert.equal(ground.residentialDetails.requestedBalcony,true);
    assert.equal(ground.residentialDetails.rainChajja.reservationCount,4);
    assert.equal(ground.residentialDetails.rainChajja.status,
      'geometric_projection_reserved_legal_structure_unverified');
    assert.deepEqual(ground.residentialDetails.kitchenBalconyPreferredDepthMm,[914,1219]);
    assert.equal(first.residentialDetails.bedroomBalcony,
      'optional_if_site_structure_and_daylight_permit');
    assert.ok(candidate.validation.blockers.some(b=>
      b.code==='REQUESTED_BALCONY_NOT_PLACED'&&b.levelId==='ground'));
    assert.ok(first.rooms.balcony?.doorReservation);
    assert.ok(candidate.validation.blockers.some(b=>
      b.code==='BALCONY_GUARD_DRAINAGE_AND_PROJECTION_UNVERIFIED'&&b.levelId==='first'));
    const living=ground.rooms.rooms.find(r=>r.type==='livingRoom');
    assert.equal(living.furnishingIntent.sofa,'seven_seat_corner');
    assert.equal(living.furnishingIntent.geometryStatus,'not_placed_or_clearance_checked');
    assert.deepEqual(living.finishIntent.walls,['plaster','putty','paint']);
    const kitchen=ground.rooms.rooms.find(r=>r.type==='kitchen');
    assert.equal(kitchen.furnishingIntent.counterTopHeightMm,1000);
    assert.equal(kitchen.furnishingIntent.dining,'combined_in_this_room');
    const bath=ground.rooms.rooms.find(r=>r.type==='bathroom');
    assert.equal(bath.finishIntent.bathtubDefault,false);
    assert.equal(bath.finishIntent.wallTileHeightMm,1500);
    assert.equal(bath.finishIntent.showerWallTile,'full_height_to_ceiling');
    assert.equal(first.residentialDetails.tulsiMuth,'not_applicable');
    assert.equal(candidate.levels.at(-1).residentialDetails.tulsiMuth,
      'preferred_on_topmost_safe_balcony_not_placed');
  }
});

test('top half-floor puja remains in owner space and door hierarchy is explicit',()=>{
  const raw=structuredClone(require('./fixtures/nepal/rectangle-2_5.json'));
  raw.buildingProgram.levels[0].specialRooms=[];
  raw.buildingProgram.levels[2].specialRooms=['puja'];
  for(const candidate of options(raw)){
    assert.equal(candidate.core.siteEntry.leafCount,2);
    assert.equal(candidate.core.siteEntry.material,'wood');
    const ground=candidate.levels[0].rooms;
    assert.equal(ground.unitEntry.doorReservation.clearWidthMm,1000);
    assert.equal(ground.unitEntry.doorReservation.leafCount,1);
    assert.equal(ground.rooms.find(r=>r.type==='bathroom').doorReservation.clearWidthMm,750);
    const kitchen=ground.rooms.find(r=>r.type==='kitchen');
    assert.equal(kitchen.doorReservation.status,'open_portal_reserved_no_door');
    assert.equal(kitchen.doorReservation.openingStyle,'decorative_arch_optional');
    const puja=candidate.levels.at(-1).rooms.rooms.find(r=>r.type==='puja');
    assert.equal(puja.privacyIntent,'owner_only_behind_unit_entry');
    assert.ok(!candidate.levels[0].rooms.rooms.some(r=>r.type==='puja'));
    assert.ok(!candidate.validation.blockers.some(b=>b.code==='PUJA_GUEST_ACCESS_REVIEW'));
    assert.ok(candidate.validation.blockers.some(b=>b.code==='PUJA_PRIVATE_ENTRY_LOCK_UNVERIFIED'));
  }
});
