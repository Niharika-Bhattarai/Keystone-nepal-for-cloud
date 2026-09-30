'use strict';
const MAIN_GRID_ROOM_TYPES=new Set(['bedroom','primaryBedroom','guestBedroom','kitchen']);
function roomGridCrossings(room,grid){
  // A column-axis line well inside the usable box means this room covers
  // multiple structural cells. Near-edge axes await constructed-wall detail.
  const margin=grid.columnWidthMm||300;
  const xAxesMm=grid.xAxesMm.filter(x=>x>room.box.x1+margin&&x<room.box.x2-margin);
  const yAxesMm=grid.yAxesMm.filter(y=>y>room.box.y1+margin&&y<room.box.y2-margin);
  return {xAxesMm,yAxesMm};
}
function columnsInsideRoom(room,grid){
  const box=room.clearBox||room.box,half=grid.columnWidthMm/2;
  return grid.columns.filter(c=>c.xMm-half>box.x1&&c.xMm+half<box.x2&&
    c.yMm-half>box.y1&&c.yMm+half<box.y2).map(c=>c.id);
}
function routeColumnObstructions(route,grid,orientation){
  if(!route)return [];
  const half=grid.columnWidthMm/2,wallHalf=51;
  const crossLow=(orientation==='vertical'?route.x1:route.y1)+wallHalf;
  const crossHigh=(orientation==='vertical'?route.x2:route.y2)-wallHalf;
  return grid.columns.filter(column=>{
    const cross=orientation==='vertical'?column.xMm:column.yMm;
    const along=orientation==='vertical'?column.yMm:column.xMm;
    const alongLow=orientation==='vertical'?route.y1:route.x1;
    const alongHigh=orientation==='vertical'?route.y2:route.x2;
    if(along+half<=alongLow||along-half>=alongHigh||
      cross+half<=crossLow||cross-half>=crossHigh)return false;
    return Math.max(0,cross-half-crossLow,crossHigh-(cross+half))<1000;
  }).map(column=>column.id);
}
function validateSpatialHypothesis(candidate) {
  const blockers=[];
  for(const level of candidate.levels){
    if(level.kind==='partial')blockers.push({code:'PARTIAL_TOP_TERRACE_ENCLOSURE_UNVERIFIED',
      levelId:level.id,message:'The partial slab and enclosing wall extent are not separated yet.'});
    if(level.residentialDetails?.requestedBalcony&&!level.rooms?.balcony)
      blockers.push({code:'REQUESTED_BALCONY_NOT_PLACED',levelId:level.id,
        preferredKitchenDepthMm:level.residentialDetails.kitchenBalconyPreferredDepthMm});
    if(level.rooms?.balcony)blockers.push({code:'BALCONY_GUARD_DRAINAGE_AND_PROJECTION_UNVERIFIED',
      levelId:level.id});
    if(!level.rooms){if(level.hasRequestedRooms)blockers.push({code:'ROOMS_NOT_PLACED',levelId:level.id});continue;}
    const rooms=level.rooms.rooms;
    if(level.id===candidate.levels[0].id&&level.rooms.occupancy==='owner'&&
      rooms.some(room=>room.type==='kitchen')&&
      !rooms.some(room=>room.serviceExitDoor))
      blockers.push({code:'KITCHEN_REAR_SERVICE_EXIT_NOT_PLACED',levelId:level.id});
    if(rooms.some(room=>room.serviceExitDoor))
      blockers.push({code:'KITCHEN_SERVICE_EXIT_ROUTE_AND_BOUNDARY_UNVERIFIED',
        levelId:level.id});
    const living=rooms.find(room=>room.type==='livingRoom');
    if(living){
      const entry=level.rooms.unitEntry.doorReservation,door=living.doorReservation;
      const facingOverlapMm=level.rooms.unitEntry.to==='living-room'?entry.clearWidthMm:
        Math.max(0,Math.min(entry.y2,door.y2)-Math.max(entry.y1,door.y1));
      level.rooms.entryLivingFacingOverlapMm=facingOverlapMm;
      if(facingOverlapMm<800)
        blockers.push({code:'ENTRY_NOT_FACING_LIVING',levelId:level.id,facingOverlapMm});
    }
    for(const room of rooms){
      const interiorColumns=columnsInsideRoom(room,candidate.grid);
      if(interiorColumns.length)blockers.push({code:'COLUMN_IN_ROOM_CLEAR_AREA',
        levelId:level.id,roomId:room.id,columnIds:interiorColumns});
      if(room.type==='puja'){
        const topmostOwner=[...candidate.levels].reverse().find(l=>l.rooms?.occupancy==='owner');
        if(level.id!==topmostOwner?.id)blockers.push({code:'PUJA_NOT_ON_HIGHEST_OWNER_FLOOR',
          levelId:level.id,roomId:room.id});
        if(room.entryFrom==='living-room')blockers.push({code:'PUJA_GUEST_ACCESS_REVIEW',
          levelId:level.id,roomId:room.id});
        else blockers.push({code:'PUJA_PRIVATE_ENTRY_LOCK_UNVERIFIED',
          levelId:level.id,roomId:room.id});
      }
      const clear=room.clearBox||room.box;
      const short=Math.min(clear.x2-clear.x1,clear.y2-clear.y1);
      const clearAreaSqM=room.clearAreaSqM??room.areaSqM;
      const kitchen=room.type==='kitchen',bath=room.type==='bathroom';
      const flex=['utilityFlex','livingAnnex','primaryAlcove','diningAnnex'].includes(room.type);
      const minDimension=bath?1200:kitchen?1800:room.type==='puja'?1800:
        room.type==='serviceNiche'?1000:room.type==='primaryAlcove'?1200:flex?1500:2000;
      const minArea=bath?2.8:kitchen?5:room.type==='puja'?3.24:
        room.type==='serviceNiche'?1.5:room.type==='primaryAlcove'?2.0:flex?3:6;
      if(short<minDimension||clearAreaSqM<minArea)
        blockers.push({code:'ROOM_SIZE_BELOW_PROVISIONAL_NBC206',levelId:level.id,
          roomId:room.id,shortDimensionMm:short,clearAreaSqM});
    }
    if(level.walls){
      if(level.walls.corridorClearWidthMm<1000)
        blockers.push({code:'CORRIDOR_CLEAR_WIDTH_BELOW_WORKING_TARGET',levelId:level.id,
          clearWidthMm:level.walls.corridorClearWidthMm});
      if(level.walls.columnWallConflicts.length)
        blockers.push({code:'WALL_CROSSES_COLUMN_CORE',levelId:level.id,
          conflicts:level.walls.columnWallConflicts});
      if(level.walls.openingColumnConflicts.length)
        blockers.push({code:'OPENING_OVERLAPS_COLUMN',levelId:level.id,
          conflicts:level.walls.openingColumnConflicts});
    }
    const routeObstructions=[
      ...routeColumnObstructions(level.rooms.corridor,candidate.grid,'vertical'),
      ...routeColumnObstructions(level.rooms.crossHall,candidate.grid,'horizontal')];
    if(routeObstructions.length)blockers.push({code:'CIRCULATION_COLUMN_OBSTRUCTION',
      levelId:level.id,columnIds:[...new Set(routeObstructions)]});
    const suggested=rooms.filter(room=>room.suggestedByPlanner).map(room=>room.id);
    if(suggested.length)blockers.push({code:'SUGGESTED_SPACE_USE_FOR_OWNER_REVIEW',levelId:level.id,
      roomIds:suggested});
    const crossedRooms=rooms.filter(room=>MAIN_GRID_ROOM_TYPES.has(room.type)).map(room=>({
      roomId:room.id,...roomGridCrossings(room,candidate.grid)})).filter(room=>
      room.xAxesMm.length||room.yAxesMm.length);
    if(crossedRooms.length)blockers.push({code:'MAIN_ROOM_GRID_CELL_NOT_MET',levelId:level.id,
      rooms:crossedRooms});
    for(let i=0;i<rooms.length;i++)for(let j=i+1;j<rooms.length;j++){
      const a=rooms[i].box,b=rooms[j].box;
      if(Math.min(a.x2,b.x2)>Math.max(a.x1,b.x1)&&Math.min(a.y2,b.y2)>Math.max(a.y1,b.y1))
        blockers.push({code:'ROOM_OVERLAP',levelId:level.id,ids:[rooms[i].id,rooms[j].id]});
    }
    if(rooms.some(room=>room.openingStatus!=='verified'))
      blockers.push({code:'DAYLIGHT_AND_OPENINGS_UNVERIFIED',levelId:level.id});
    for(const room of rooms.filter(room=>room.provisionalNaturalLightOpeningSqM&&
      !(room.windowReservations?.length||room.windowReservation)))
      blockers.push({code:'NO_PHYSICAL_EXTERIOR_WINDOW_RESERVATION',levelId:level.id,roomId:room.id,
        requiredClearAreaSqM:room.provisionalNaturalLightOpeningSqM});
    for(const room of rooms.filter(room=>(room.windowReservations||[room.windowReservation])
      .some(w=>w?.boundaryGuidanceStatus==='below_1500mm_reference_guidance')))
      blockers.push({code:'WINDOW_NEIGHBOR_CLEARANCE_BELOW_REFERENCE',levelId:level.id,
        roomId:room.id,clearanceMm:room.windowReservation.boundaryClearanceMm,
        reference:'MoFAGA/PLGSP 2023 resource book, physical PDF page 56; local adoption unverified'});
    if(level.attachedBathroomsRequested>(level.rooms.attachedBathroomsPlaced||0))
      blockers.push({code:'ATTACHED_BATHROOM_ACCESS_UNVERIFIED',levelId:level.id,
        requested:level.attachedBathroomsRequested});
  }
  if(!candidate.rulePack.permitRulesReady)blockers.push({code:'MUNICIPAL_RULES_UNVERIFIED'});
  if(!candidate.grid.engineerReviewed)blockers.push({code:'RC_FRAME_NOT_ENGINEERED'});
  if(candidate.levels[0]?.rooms?.occupancy==='rental')
    blockers.push({code:'GROUND_RENTAL_FRAME_CONFIGURATION_REVIEW'});
  if(candidate.core.flights.some(f=>f.headroomStatus!=='verified'))blockers.push({code:'STAIR_HEADROOM_UNVERIFIED'});
  if(!candidate.doorAndWallGeometryVerified)blockers.push({code:'DOORS_WALLS_AND_EGRESS_UNVERIFIED'});
  if(!candidate.reservoirEngineered)blockers.push({code:'RESERVOIR_NOT_ENGINEERED'});
  if((candidate.parkingRequested?.bikes||0)+(candidate.parkingRequested?.cars||0)>0){
    const parking=candidate.levels[0]?.rooms?.parking;
    if(!parking)blockers.push({code:'PARKING_AND_GATE_NOT_PLACED',requested:candidate.parkingRequested});
    else{
      const width=parking.box.x2-parking.box.x1,depth=parking.box.y2-parking.box.y1;
      if((candidate.parkingRequested.cars||0)>0&&(width<3000||depth<5000))
        blockers.push({code:'CAR_BAY_BELOW_WORKING_SIZE',widthMm:width,depthMm:depth});
      blockers.push({code:'PARKING_GATE_AND_MANOEUVRING_UNVERIFIED',widthMm:width,depthMm:depth});
      blockers.push({code:'ROOFED_PARKING_COVERAGE_TREATMENT_UNVERIFIED'});
    }
  }
  return {structuralGeometryOkay:!blockers.some(b=>[
    'ROOM_OVERLAP','COLUMN_IN_ROOM_CLEAR_AREA','CIRCULATION_COLUMN_OBSTRUCTION',
    'WALL_CROSSES_COLUMN_CORE','OPENING_OVERLAPS_COLUMN'].includes(b.code)),
    eligibility:'unverified_concept_only',blockers};
}
module.exports={validateSpatialHypothesis,roomGridCrossings,columnsInsideRoom,
  routeColumnObstructions,MAIN_GRID_ROOM_TYPES};
