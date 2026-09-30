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
// Cross-level (section) relationships: catalog V06 (puja/toilet), V07 (puja/stair)
// and C17 (wet-service coordination). Plan boxes are compared between consecutive
// levels; overlaps under 0.01 m² (e.g. shared edges) are treated as touching only.
const WET_TYPES=new Set(['bathroom','kitchen','laundry']);
const STACK_TOLERANCE_SQM=0.01;
const overlapSqM=(a,b)=>Math.max(0,Math.min(a.x2,b.x2)-Math.max(a.x1,b.x1))*
  Math.max(0,Math.min(a.y2,b.y2)-Math.max(a.y1,b.y1))/1e6;
const sharedEdgeMm=(a,b)=>{
  if(a.x2===b.x1||b.x2===a.x1)return Math.max(0,Math.min(a.y2,b.y2)-Math.max(a.y1,b.y1));
  if(a.y2===b.y1||b.y2===a.y1)return Math.max(0,Math.min(a.x2,b.x2)-Math.max(a.x1,b.x1));
  return 0;
};
const round2=n=>Math.round(n*100)/100;
// C17 repair ("move routing"): a wet room with no wet room below gets a reserved
// drain route. Preferred: a branch through a shared wall into a neighbouring wet
// room that does stack. Otherwise: a new stack on one of its exterior faces, but
// only if that face is also outside every lower floor (a stack must not drop
// through a room below). Faces are drawing-frame sides (x1 = 'west' of the sheet),
// not compass directions. Slopes, pipe sizes, outfall and access are not designed.
const inside=(p,box)=>p.x>box.x1&&p.x<box.x2&&p.y>box.y1&&p.y<box.y2;
function exteriorFaces(box,levelsBelowAndSelf){
  const cx=(box.x1+box.x2)/2,cy=(box.y1+box.y2)/2;
  return [['west',{x:box.x1-1,y:cy},cx-box.x1],['east',{x:box.x2+1,y:cy},box.x2-cx],
    ['south',{x:cx,y:box.y1-1},cy-box.y1],['north',{x:cx,y:box.y2+1},box.y2-cy]]
    .filter(([,probe])=>levelsBelowAndSelf.every(l=>(l.footprint?.slabs||[]).length&&
      !l.footprint.slabs.some(slab=>inside(probe,slab))))
    .map(([face,,runMm])=>({face,runMm:Math.round(runMm)}));
}
function offsetDrainRoute(levels,item,wetStack){
  const index=levels.findIndex(l=>l.id===item.levelId),level=levels[index];
  const room=(level.rooms?.rooms||[]).find(r=>r.id===item.roomId);
  const stacked=new Set(wetStack.filter(w=>w.levelId===level.id&&w.overWetShare>0).map(w=>w.roomId));
  const cx=(room.box.x1+room.box.x2)/2,cy=(room.box.y1+room.box.y2)/2;
  const neighbours=(level.rooms?.rooms||[]).filter(r=>stacked.has(r.id)&&sharedEdgeMm(room.box,r.box)>0)
    .map(r=>({toRoomId:r.id,sharedEdgeMm:sharedEdgeMm(room.box,r.box),
      horizontalRunMm:Math.round(r.box.x1===room.box.x2?room.box.x2-cx:r.box.x2===room.box.x1?cx-room.box.x1:
        r.box.y1===room.box.y2?room.box.y2-cy:cy-room.box.y1)}))
    .sort((a,b)=>a.horizontalRunMm-b.horizontalRunMm);
  const base={levelId:item.levelId,roomId:item.roomId,type:item.type,
    unverified:['pipe size and fall (NBC 208 adoption review)','sunken slab or raised floor depth for the branch',
      'outfall, trap/vent and cleanout access']};
  if(neighbours.length)return {...base,status:'route_reserved',kind:'branch_to_adjacent_stack',
    ...neighbours[0]};
  const faces=exteriorFaces(room.box,levels.slice(0,index+1)).sort((a,b)=>a.runMm-b.runMm);
  if(faces.length)return {...base,status:'route_reserved',kind:'new_stack_on_exterior_wall',
    planFace:faces[0].face,horizontalRunMm:faces[0].runMm,dropsPastLevelIds:levels.slice(0,index).map(l=>l.id),
    unverified:[...base.unverified,'external stack position against lower-floor windows and doors']};
  return {...base,status:'no_route_found'};
}
function verticalStackFacts(candidate){
  const levels=candidate.levels,roomsOf=l=>l?.rooms?.rooms||[];
  const coreLevels=new Set(candidate.core?.levelIds||[]);
  const pujaToilet=[],pujaStair=[],wetStack=[];
  levels.forEach((level,i)=>{
    for(const puja of roomsOf(level).filter(r=>r.type==='puja')){
      for(const bath of roomsOf(level).filter(r=>r.type==='bathroom')){
        const edge=sharedEdgeMm(puja.box,bath.box);
        if(edge>0)pujaToilet.push({relation:'shares_wall',levelId:level.id,pujaId:puja.id,
          toiletRoomId:bath.id,sharedEdgeMm:edge});
      }
      for(const [relation,other] of [['toilet_below',levels[i-1]],['toilet_above',levels[i+1]]])
        for(const bath of roomsOf(other).filter(r=>r.type==='bathroom')){
          const area=overlapSqM(puja.box,bath.box);
          if(area>=STACK_TOLERANCE_SQM)pujaToilet.push({relation,levelId:level.id,pujaId:puja.id,
            otherLevelId:other.id,toiletRoomId:bath.id,overlapSqM:round2(area)});
        }
      for(const [relation,other] of [['stair_below',levels[i-1]],['stair_above',levels[i+1]]]){
        if(!other||!coreLevels.has(other.id)||!candidate.core?.box)continue;
        const area=overlapSqM(puja.box,candidate.core.box);
        if(area>=STACK_TOLERANCE_SQM)pujaStair.push({relation,levelId:level.id,pujaId:puja.id,
          otherLevelId:other.id,coreId:candidate.core.id,overlapSqM:round2(area)});
      }
    }
    if(i===0)return;
    const wetBelow=roomsOf(levels[i-1]).filter(r=>WET_TYPES.has(r.type));
    for(const room of roomsOf(level).filter(r=>WET_TYPES.has(r.type))){
      const area=(room.box.x2-room.box.x1)*(room.box.y2-room.box.y1)/1e6;
      const over=wetBelow.reduce((sum,r)=>sum+overlapSqM(room.box,r.box),0);
      wetStack.push({levelId:level.id,roomId:room.id,type:room.type,belowLevelId:levels[i-1].id,
        overWetShare:round2(Math.min(1,over/area)),
        overWetRoomIds:wetBelow.filter(r=>overlapSqM(room.box,r.box)>=STACK_TOLERANCE_SQM).map(r=>r.id)});
    }
  });
  const drainRoutes=wetStack.filter(item=>item.overWetShare===0)
    .map(item=>offsetDrainRoute(levels,item,wetStack));
  const hasPuja=levels.some(l=>roomsOf(l).some(r=>r.type==='puja'));
  return {toleranceSqM:STACK_TOLERANCE_SQM,pujaToilet,pujaStair,wetStack,drainRoutes,
    facts:{
      // Door/sightline facing is not measured, so absence of a found conflict stays unknown.
      'puja.toilet_conflict':!hasPuja?null:pujaToilet.length?true:null,
      'puja.stair_overlap':!hasPuja?null:pujaStair.length>0},
    unmeasured:['V06 puja/toilet door sightline facing','V06 bathroom vs separate WC distinction (bathrooms treated as containing a WC)',
      'C17 pipe routes, falls, shafts and maintenance access']};
}
// Catalog V13 (no toilets in NE or centre) and V12 (NW/W preferred), measured per
// bathroom on its own floor's 3x3 domain. Bathrooms are treated as containing a WC.
const TOILET_EXCLUDED_ZONES=['NE','C'];
function toiletZoneFacts(candidate){
  const bathrooms=candidate.levels.flatMap(level=>(level.rooms?.vastuFindings||[])
    .filter(f=>f.type==='bathroom').map(f=>({level,f})));
  const excluded=[],outsidePreferred=[];
  for(const {level,f} of bathrooms){
    const total=Object.values(f.zoneAreasSqM).reduce((a,b)=>a+b,0);
    const zones=Object.fromEntries(TOILET_EXCLUDED_ZONES.map(z=>[z,round2(f.zoneAreasSqM[z])]));
    const areaSqM=TOILET_EXCLUDED_ZONES.reduce((sum,z)=>sum+f.zoneAreasSqM[z],0);
    if(areaSqM>=STACK_TOLERANCE_SQM)excluded.push({levelId:level.id,roomId:f.roomId,
      excludedZoneSqM:round2(areaSqM),excludedZoneShare:round2(areaSqM/total),zonesSqM:zones});
    if(f.preferredShare<1-1e-9)outsidePreferred.push({levelId:level.id,roomId:f.roomId,
      preferredShare:round2(f.preferredShare)});
  }
  return {toleranceSqM:STACK_TOLERANCE_SQM,domain:'floor-footprint',excluded,outsidePreferred,
    facts:{
      'bathrooms.avoid_ne_center':bathrooms.length?excluded.length===0:null,
      'bathrooms.all_in_nw_w':bathrooms.length?outsidePreferred.length===0:null},
    unmeasured:['V13/V12 boundary tolerance and mandala domain need consultant review',
      'bathroom vs separate WC distinction (bathrooms treated as containing a WC)']};
}
// NBC 105:2025 configuration checks the engine can only flag, not decide
// (catalog S04 weak/soft storey, S05 vertical/offset irregularity, S06 torsion).
// Gorkha 2015 damage surveys single out open ground storeys and upper-floor
// offsets in Kathmandu RC houses. Values are plan-geometry evidence for the engineer.
const boxArea=b=>(b.x2-b.x1)*(b.y2-b.y1);
function centroidOf(boxes){const a=boxes.reduce((n,b)=>n+boxArea(b),0);
  return {x:boxes.reduce((n,b)=>n+boxArea(b)*(b.x1+b.x2)/2,0)/a,
    y:boxes.reduce((n,b)=>n+boxArea(b)*(b.y1+b.y2)/2,0)/a,areaMm2:a};}
function structuralConfigurationFacts(candidate){
  const levels=candidate.levels,out={openGroundBays:[],upperOffsets:[]};
  const ground=levels[0],slabs=ground?.footprint?.slabs||[];
  const parking=ground?.rooms?.parking?.box;
  if(parking&&slabs.length){
    const floor=centroidOf(slabs),bay=centroidOf([parking]);
    const xs=slabs.flatMap(b=>[b.x1,b.x2]),ys=slabs.flatMap(b=>[b.y1,b.y2]);
    const width=Math.max(...xs)-Math.min(...xs),depth=Math.max(...ys)-Math.min(...ys);
    out.openGroundBays.push({levelId:ground.id,box:parking,
      floorShare:round2(bay.areaMm2/floor.areaMm2),
      bayOffsetShare:{x:round2(Math.abs(bay.x-floor.x)/width),y:round2(Math.abs(bay.y-floor.y)/depth)},
      note:'open bay without infill beside infilled bays: soft/weak storey and torsion need analysis'});
  }
  levels.forEach((level,i)=>{
    if(!i||!level.footprint?.slabs?.length||!levels[i-1].footprint?.slabs?.length)return;
    const above=centroidOf(level.footprint.slabs),below=centroidOf(levels[i-1].footprint.slabs);
    const ratio=above.areaMm2/below.areaMm2;
    if(ratio>0.999)return;
    const xs=levels[i-1].footprint.slabs.flatMap(b=>[b.x1,b.x2]),ys=levels[i-1].footprint.slabs.flatMap(b=>[b.y1,b.y2]);
    out.upperOffsets.push({levelId:level.id,belowLevelId:levels[i-1].id,areaRatio:round2(ratio),
      centroidOffsetShare:{x:round2(Math.abs(above.x-below.x)/(Math.max(...xs)-Math.min(...xs))),
        y:round2(Math.abs(above.y-below.y)/(Math.max(...ys)-Math.min(...ys)))}});
  });
  return out;
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
  const verticalStack=verticalStackFacts(candidate);
  for(const conflict of verticalStack.pujaToilet)
    blockers.push({code:'PUJA_TOILET_SEPARATION_NOT_MET',ruleId:'V06',...conflict});
  for(const conflict of verticalStack.pujaStair)
    blockers.push({code:'PUJA_STAIR_VERTICAL_OVERLAP',ruleId:'V07',...conflict});
  const toiletZones=toiletZoneFacts(candidate);
  for(const item of toiletZones.excluded)
    blockers.push({code:'TOILET_IN_NE_OR_CENTER',ruleId:'V13',...item});
  const unrouted=verticalStack.drainRoutes.filter(r=>r.status!=='route_reserved');
  if(unrouted.length)blockers.push({code:'WET_ROOM_NOT_OVER_WET_ZONE_REVIEW',ruleId:'C17',
    rooms:unrouted.map(({levelId,roomId,type})=>({levelId,roomId,type}))});
  const routed=verticalStack.drainRoutes.filter(r=>r.status==='route_reserved');
  if(routed.length)blockers.push({code:'OFFSET_WET_ROOM_DRAIN_ROUTE_UNVERIFIED',ruleId:'C17',
    routes:routed.map(({levelId,roomId,kind,toRoomId,planFace,horizontalRunMm})=>
      ({levelId,roomId,kind,...(toRoomId?{toRoomId}:{planFace}),horizontalRunMm}))});
  const configuration=structuralConfigurationFacts(candidate);
  for(const bay of configuration.openGroundBays)
    blockers.push({code:'OPEN_GROUND_BAY_SOFT_STOREY_AND_TORSION_REVIEW',ruleIds:['S04','S06'],...bay});
  for(const offset of configuration.upperOffsets)
    blockers.push({code:'UPPER_FLOOR_SETBACK_IRREGULARITY_REVIEW',ruleId:'S05',...offset});
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
    eligibility:'unverified_concept_only',blockers,verticalStack,toiletZones,configuration};
}
module.exports={validateSpatialHypothesis,verticalStackFacts,toiletZoneFacts,structuralConfigurationFacts,roomGridCrossings,columnsInsideRoom,
  routeColumnObstructions,MAIN_GRID_ROOM_TYPES};
