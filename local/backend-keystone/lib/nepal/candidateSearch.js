'use strict';
const crypto=require('node:crypto');
const {siteEnvelope,footprints,partialTopFootprint}=require('./siteEnvelope');
const {frameGrid}=require('./frameGrid');
const {reserveCore}=require('./corePlanner');
const {planFloorRooms,PUJA_MAIN_STRIP_MIN_WIDTH_MM,overlapSqM}=require('./roomPlanner');
const {measureAreaLedger}=require('./areaLedger');
const {resolveRulePack}=require('./rules/resolveRulePack');
const {validateSpatialHypothesis,roomGridCrossings,columnsInsideRoom,
  MAIN_GRID_ROOM_TYPES}=require('./validateNepalPlan');
const {vastuFindings}=require('./vastuAllocator');
const {buildWallGeometry}=require('./wallGeometry');
const {doorOnSharedEdge,reserveWindow}=require('./spatialReservations');
const {rect}=require('./areaLedger');
const {COLUMN_WIDTH_MM,INTERIOR_WALL_MM,CLEAR_CORRIDOR_MM}=require('./constructionProfile');
const {attachResidentialDetails}=require('./residentialDetails');
const {reserveRainChajjas}=require('./rainChajja');
function gridTargetVariants(base,partitionLines){
  const centers=base.yAxesMm.slice(1,-1),clearance=(COLUMN_WIDTH_MM+INTERIOR_WALL_MM)/2;
  const choices=centers.map((center,index)=>base.fixedRowAxisIndices.includes(index+1)?[center]:
    [center,...[...new Set(partitionLines.flatMap(line=>
    [Math.round(line-clearance),Math.round(line+clearance)]))]
    .filter(value=>Math.abs(value-center)<=1000)
    .sort((a,b)=>Math.abs(a-center)-Math.abs(b-center)||a-b).slice(0,4)]);
  const combinations=choices.reduce((rows,options)=>rows.flatMap(row=>options.map(n=>[...row,n])),[[]]);
  return combinations.sort((a,b)=>a.reduce((s,n,i)=>s+Math.abs(n-centers[i]),0)-
    b.reduce((s,n,i)=>s+Math.abs(n-centers[i]),0)).slice(0,64);
}
function reserveWindowGroup(box,slabs,face,requiredAreaSqM,avoidBoxes){
  const windows=[];let remaining=requiredAreaSqM;
  for(let i=0;i<4&&remaining>0.001;i++){
    const options={avoidBoxes:[...avoidBoxes,...windows.map(w=>w.axis==='vertical'?
      rect([w.x-229,w.y1,w.x+229,w.y2]):rect([w.x1,w.y-229,w.x2,w.y+229]))]};
    const full=reserveWindow(box,slabs,face,remaining,options);
    const next=full||reserveWindow(box,slabs,face,Math.max(0.55,remaining/2),options);
    if(!next)break;
    windows.push(next);remaining-=next.provisionalClearAreaSqM;
  }
  return remaining<=0.001?windows:[];
}
function coordinateOpenings(level,core,grid,site){
  const columns=grid.columns.map(column=>{const h=column.widthMm/2;
    return rect([column.xMm-h,column.yMm-h,column.xMm+h,column.yMm+h]);});
  const arrival=core.flights[0].arrivalLandings[0].box,b=rect(core.box);
  const living=level.rooms.rooms.find(r=>r.entryFrom==='shared-floor-level-arrival');
  const entry=doorOnSharedEdge(rect([b.x1,arrival.y1,b.x2,arrival.y2]),
    living?.box||level.rooms.corridor,{clearWidthMm:1000,endClearanceMm:50,avoidBoxes:columns});
  if(!entry)throw new Error(`${level.id}: Floor-level unit entry cannot avoid a planning column.`);
  level.rooms.unitEntry.doorReservation={...entry,from:'shared-floor-level-arrival',
    to:living?'living-room':level.rooms.unitEntry.to,
    leafCount:1,material:'wood'};
  if(level.rooms.circulationPortal){
    const portal=doorOnSharedEdge(living?.box||level.rooms.corridor,
      level.rooms.crossHall||level.rooms.corridor,
      {clearWidthMm:level.rooms.crossHall?1200:1000,
        endClearanceMm:level.rooms.crossHall?(living?100:150):0,
        avoidBoxes:columns});
    if(!portal)throw new Error(`${level.id}: Open living-to-room route conflicts with a column.`);
    level.rooms.circulationPortal={...portal,status:'open_portal_reserved_no_door',
      openingStyle:'open_connection',from:living?'living-room':'family-landing',
      to:level.rooms.crossHall?'cross-hall':'unit-corridor'};
  }
  if(level.rooms.crossHallPortal){
    const portal=doorOnSharedEdge(level.rooms.crossHall,level.rooms.corridor,
      {clearWidthMm:900,endClearanceMm:0,avoidBoxes:columns});
    if(!portal)throw new Error(`${level.id}: Cross-hall route conflicts with a column.`);
    level.rooms.crossHallPortal={...portal,status:'open_portal_reserved_no_door',
      openingStyle:'open_connection',from:'cross-hall',to:'unit-corridor'};
  }
  if(level.rooms.balcony){
    const door=doorOnSharedEdge(level.rooms.balcony.box,
      level.rooms.crossHall||level.rooms.corridor,
      {clearWidthMm:900,endClearanceMm:level.rooms.crossHall?0:150,
        avoidBoxes:columns});
    if(!door)throw new Error(`${level.id}: First-floor balcony door conflicts with a column.`);
    level.rooms.balcony.doorReservation={...door,leafCount:1,material:'wood',
      from:level.rooms.crossHall?'cross-hall':'unit-corridor',to:'first-floor-balcony'};
  }
  const entryCenter=(entry.y1+entry.y2)/2;
  for(const room of level.rooms.rooms){
    const neighbor=room.entryFrom==='living-room'?level.rooms.rooms.find(r=>r.type==='livingRoom'):
      room.entryFrom==='primary-bedroom'?level.rooms.rooms.find(r=>r.type==='primaryBedroom'):
        room.entryFrom==='near-bedroom'?level.rooms.rooms.find(r=>r.type==='bedroom'):
        room.entryFrom==='kitchen'?level.rooms.rooms.find(r=>r.type==='kitchen'):
          room.entryFrom==='cross-hall'?level.rooms.crossHall:
      level.rooms.corridor;
    const door=room.entryFrom==='shared-floor-level-arrival'?entry:
      doorOnSharedEdge(room.box,neighbor.box||neighbor,{
      clearWidthMm:room.openConnection||room.type==='kitchen'?1200:room.type==='bathroom'?750:900,
      endClearanceMm:room.type==='bathroom'?50:150,
      avoidBoxes:columns,
      preferredCenterMm:room.type==='livingRoom'?entryCenter:null});
    if(!door)throw new Error(`${level.id}: ${room.id} has no column-free entrance interval.`);
    room.doorReservation={...door,from:room.entryFrom,to:room.id,
      ...(room.openConnection||room.type==='kitchen'?{status:'open_portal_reserved_no_door',
        openingStyle:room.type==='kitchen'?'decorative_arch_optional':'open_connection'}:
        {leafCount:1,material:'wood'})};
    if(room.provisionalNaturalLightOpeningSqM){
      const groups=[room.openingFace,'south','north'].map(face=>reserveWindowGroup(room.box,
        level.footprint.slabs,face,room.provisionalNaturalLightOpeningSqM,columns))
        .filter(group=>group.length&&group.every(w=>windowBoundaryDistanceMm(w,site)>0))
        .sort((a,b)=>Number(windowBoundaryDistanceMm(b[0],site)>=1500)-
          Number(windowBoundaryDistanceMm(a[0],site)>=1500));
      room.windowReservations=groups[0]||[];
      room.windowReservation=room.windowReservations[0]||null;
      if(!room.windowReservation)room.openingStatus='no_physical_exterior_window_reserved';
    }
  }
  // A door from the open kitchen/dining suite to the rear service strip is
  // preferable to forcing both a daylight window and a door into the narrow
  // kitchen wall. The route and boundary permission still need site review.
  if(level.rooms.occupancy==='owner'&&level.rooms.parking){
    const service=level.rooms.rooms.find(r=>r.type==='diningAnnex')||
      level.rooms.rooms.find(r=>r.type==='kitchen');
    if(service&&site.y2-service.box.y2>=1200){
      const windows=(service.windowReservations||[]).map(w=>w.axis==='horizontal'?
        rect([w.x1-50,w.y-229,w.x2+50,w.y+229]):
        rect([w.x-229,w.y1-50,w.x+229,w.y2+50]));
      const outside=rect([service.box.x1,service.box.y2,service.box.x2,site.y2]);
      const exit=doorOnSharedEdge(service.box,outside,{clearWidthMm:900,
        endClearanceMm:100,avoidBoxes:[...columns,...windows]});
      if(exit)service.serviceExitDoor={...exit,leafCount:1,material:'wood',
        from:'kitchen-dining-suite',to:'rear-service-strip',
        status:'exterior_service_exit_reserved_route_and_swing_unverified'};
    }
  }
}
function windowBoundaryDistanceMm(window,site){
  if(!window)return null;
  return {west:window.x-site.x1,east:site.x2-window.x,
    south:window.y-site.y1,north:site.y2-window.y}[window.face];
}
function assessBoundaryOpenings(level,site){
  for(const room of level.rooms?.rooms||[]){
    for(const window of room.windowReservations||[]){
      const distance=windowBoundaryDistanceMm(window,site);
      if(distance<1500){
        window.boundaryClearanceMm=distance;
        window.boundaryGuidanceStatus='below_1500mm_reference_guidance';
        room.openingStatus='provisional_boundary_clearance_shortfall';
      }else{
        window.boundaryClearanceMm=distance;
        window.boundaryGuidanceStatus='meets_1500mm_reference_guidance_municipal_adoption_unverified';
      }
    }
  }
}
function score(candidate) {
  const findings=[candidate.core.vastuFinding,candidate.core.reservoir.vastuFinding,
    ...candidate.levels.flatMap(l=>l.rooms?.vastuFindings||[])];
  const avg=types=>{const f=findings.filter(x=>types.includes(x.type));
    return f.length?f.reduce((s,x)=>s+x.preferredShare,0)/f.length:0;};
  const livingLevels=candidate.levels.filter(l=>l.rooms?.rooms.some(r=>r.type==='livingRoom'));
  const facing=livingLevels.length?livingLevels.filter(l=>{
    const e=l.rooms.unitEntry.doorReservation,
      d=l.rooms.rooms.find(r=>r.type==='livingRoom').doorReservation;
    return l.rooms.unitEntry.to==='living-room'||
      Math.max(0,Math.min(e.y2,d.y2)-Math.max(e.y1,d.y1))>=800;
  }).length/livingLevels.length:0;
  return [avg(['puja','kitchen','primaryBedroom','stair']),avg(['livingRoom','bathroom','undergroundReservoir']),
    facing,-candidate.ledger.grossBuiltSqM];
}
const PHYSICAL_PLACEMENT_BLOCKERS=new Set(['NO_PHYSICAL_EXTERIOR_WINDOW_RESERVATION',
  'ROOM_OVERLAP','ROOM_SIZE_BELOW_PROVISIONAL_NBC206','MAIN_ROOM_GRID_CELL_NOT_MET',
  'COLUMN_IN_ROOM_CLEAR_AREA','CIRCULATION_COLUMN_OBSTRUCTION',
  'PARKING_AND_GATE_NOT_PLACED','ENTRY_NOT_FACING_LIVING']);
function compare(a,b) {
  const physicalCount=c=>c.validation.blockers.filter(x=>PHYSICAL_PLACEMENT_BLOCKERS.has(x.code)).length;
  const delta=physicalCount(a)-physicalCount(b);
  if(delta)return delta;
  for(let i=0;i<a.score.length;i++)if(a.score[i]!==b.score[i])return b.score[i]-a.score[i];
  return a.id.localeCompare(b.id);}
// Owner instruction (2026-09-30): a partial top floor may grow up to 65% of a full floor.
function searchConcepts(brief,{provisionalSetbacksMm,workingCoverageLimit=null,
  partialTopMaxShare=0.65,
  tankLitres=brief.buildingProgram.services?.groundReservoirLitres||8000,
  maxCandidates=3}={}) {
  if(!Number.isSafeInteger(maxCandidates)||maxCandidates<1||maxCandidates>24)
    throw new RangeError('Review candidate count must be between 1 and 24');
  const rulePack=resolveRulePack(brief);
  const envelope=siteEnvelope(brief,{setbacksMm:provisionalSetbacksMm,reviewed:false});
  const attempts=[],candidates=[],levels=brief.buildingProgram.levels;
  for(const footprint of footprints(envelope,{compactRectangle:
    !brief.buildingProgram.rental?.intended&&
    envelope.buildable.x2-envelope.buildable.x1>=9000}))for(const side of ['west','east'])for(const order of
    ['living-first','kitchen-south','bedrooms-south']) {
    const id=`${footprint.family}-${side}-${order}`;
    try {
      const core=reserveCore({footprint,levels,side,tankLitres});
      core.vastuFinding=vastuFindings([{id:core.id,type:'stair',box:core.box}],
        {bearingDegrees:brief.site.north.bearingDegrees,domainBoxes:footprint.slabs})[0];
      core.reservoir.vastuFinding=vastuFindings([{id:core.reservoir.id,type:'undergroundReservoir',
        box:core.reservoir.innerPlanBox}],{bearingDegrees:brief.site.north.bearingDegrees,
        domainBoxes:footprint.slabs})[0];
      const plannedLevels=[];
      for(const level of levels){
        const floorprint=level.kind==='partial'?partialTopFootprint(footprint,core,
          level.targetAreaSqM,{preferredDepthMm:level.specialRooms?.includes('puja')?7600:0}):footprint;
        const hasRooms=['bedrooms','bathrooms','kitchens','livingRooms'].some(k=>level[k]>0)||
          (level.specialRooms?.length||0)>0;
        // V06 from the other side: bathrooms planned on this floor can see a puja
        // placed on the floor below (the owner bedroom floor moves its attached bath).
        const pujaBoxesBelow=(plannedLevels.at(-1)?.rooms?.rooms||[])
          .filter(r=>r.type==='puja').map(r=>r.box);
        const planArgs={level,core,bearingDegrees:brief.site.north.bearingDegrees,order,
          groundParking:level.id===levels[0].id?brief.buildingProgram.parking:null,pujaBoxesBelow};
        let rooms=hasRooms?planFloorRooms({...planArgs,footprint:floorprint}):null;
        if(rooms&&!rooms.ok)throw new Error(`${level.id}: ${rooms.reason}`);
        // V06: if the puja lands over a toilet on the floor below, retry it in the
        // main strip, widening a partial top floor up to the owner's area cap.
        const toiletsBelow=(plannedLevels.at(-1)?.rooms?.rooms||[])
          .filter(r=>r.type==='bathroom').map(r=>r.box);
        const pujaOverToilet=plan=>(plan?.rooms||[]).filter(r=>r.type==='puja')
          .reduce((sum,p)=>sum+toiletsBelow.reduce((n,t)=>n+overlapSqM(p.box,t),0),0);
        let floorprintUsed=floorprint,pujaReplan=null;
        if(rooms&&pujaOverToilet(rooms)>=0.01){
          const corridorMm=CLEAR_CORRIDOR_MM+INTERIOR_WALL_MM;
          const needWidthMm=core.box.x2-core.box.x1+corridorMm+PUJA_MAIN_STRIP_MIN_WIDTH_MM;
          const fullAreaSqM=footprint.areaSqM;
          try{
            // Put the widened edge on a column line (column face flush with the slab
            // edge, as on the full floors) rather than a few mm off an axis.
            const fx1=Math.min(...footprint.slabs.map(b=>b.x1)),fx2=Math.max(...footprint.slabs.map(b=>b.x2));
            const half=COLUMN_WIDTH_MM/2;
            let axisWidths=[];
            try{axisWidths=frameGrid(footprint,{protectedCore:core.box}).xAxesMm.map(a=>
              core.side==='west'?a+half-fx1:fx2-(a-half)).filter(w=>w>=needWidthMm);}catch{}
            const widthMm=axisWidths.length?Math.min(...axisWidths):needWidthMm;
            const wider=level.kind==='partial'?partialTopFootprint(footprint,core,level.targetAreaSqM,
              {preferredDepthMm:level.specialRooms?.includes('puja')?7600:0,minWidthMm:widthMm}):floorprint;
            const withinCap=wider.areaSqM<=partialTopMaxShare*fullAreaSqM+1e-9;
            const retry=withinCap&&planFloorRooms({...planArgs,footprint:wider,pujaInMainStrip:true,
              toiletBoxesAdjacent:toiletsBelow});
            pujaReplan={ruleId:'V06',reason:'service-bay puja was above a toilet on the floor below',
              originalAreaSqM:floorprint.areaSqM,proposedAreaSqM:wider.areaSqM,
              minimumWidthMm:needWidthMm,widthMm,edgeOnColumnLine:axisWidths.length>0,
              areaCapSqM:partialTopMaxShare*fullAreaSqM,areaCapShare:partialTopMaxShare,
              fullFloorAreaSqM:fullAreaSqM,status:!withinCap?'rejected_area_cap':
                !retry?.ok?`rejected_${retry?.reason||'no_plan'}`:
                pujaOverToilet(retry)>=0.01?'rejected_still_over_toilet':'applied'};
            if(pujaReplan.status==='applied'){rooms=retry;floorprintUsed=wider;}
          }catch(error){pujaReplan={ruleId:'V06',status:`rejected_${error.message}`};}
        }
        plannedLevels.push({id:level.id,kind:level.kind,footprint:floorprintUsed,rooms,
          ...(pujaReplan?{pujaReplan}:{}),
          rainChajjas:reserveRainChajjas(floorprint,envelope.site),
          hasRequestedRooms:hasRooms,attachedBathroomsRequested:level.attachedBathrooms});
      }
      const partitionLines=[...new Set(plannedLevels.flatMap(l=>l.rooms?.rooms.flatMap(r=>
        [r.box.y1,r.box.y2])||[]))];
      const gridOptions={protectedCorridor:plannedLevels.find(l=>l.rooms)?.rooms.corridor,
        protectedCore:core.box,
        partitionLinesMm:partitionLines};
      const baseline=frameGrid(footprint,gridOptions);
      let selected=null,lastGridError=null;
      for(const rowAxisTargetsMm of gridTargetVariants(baseline,partitionLines)){
        try{
          const grid=frameGrid(footprint,{...gridOptions,rowAxisTargetsMm});
          const floorModels=structuredClone(plannedLevels);
          for(const level of floorModels)if(level.rooms){
            coordinateOpenings(level,core,grid,envelope.site);
            assessBoundaryOpenings(level,envelope.site);
            level.walls=buildWallGeometry({footprint:level.footprint,rooms:level.rooms.rooms,
              corridor:level.rooms.corridor,core,grid,
              openParking:level.rooms.parking?.box,
              openBalcony:level.rooms.balcony?.box,
              balconyDoor:level.rooms.balcony?.doorReservation,
              unitEntryDoor:level.rooms.unitEntry.doorReservation,
              circulationPortal:level.rooms.circulationPortal,
              crossHall:level.rooms.crossHall,
              crossHallPortal:level.rooms.crossHallPortal,
              siteEntryDoor:level.id===levels[0].id?core.siteEntry:null});
          }
          const physicalDeficits=floorModels.reduce((n,l)=>n+(l.rooms?.rooms.filter(r=>
            r.provisionalNaturalLightOpeningSqM&&!r.windowReservations?.length).length||0)+
            (l.walls?.openingColumnConflicts.length||0)+(l.walls?.columnWallConflicts.length||0),0);
          const roomRowCrossings=floorModels.reduce((n,l)=>n+(l.rooms?.rooms.filter(r=>
            MAIN_GRID_ROOM_TYPES.has(r.type)&&roomGridCrossings(r,grid).yAxesMm.length).length||0),0);
          const inRoomColumns=floorModels.reduce((n,l)=>n+(l.rooms?.rooms.reduce((sum,room)=>
            sum+columnsInsideRoom(room,grid).length,0)||0),0);
          const deficits=physicalDeficits*1000+inRoomColumns*100+roomRowCrossings;
          if(!selected||deficits<selected.deficits)selected={grid,floorModels,deficits};
          if(deficits===0)break;
        }catch(error){lastGridError=error;}
      }
      if(!selected)throw lastGridError||new Error('No column-coordinated grid fits the rooms.');
      const {grid,floorModels}=selected;
      const ledger=measureAreaLedger({site:envelope.site,levels:floorModels.map(l=>({id:l.id,
        categories:{conceptFootprint:l.footprint.slabs}}))});
      if(workingCoverageLimit!=null&&ledger.groundCoverageRatio>workingCoverageLimit+1e-10)
        throw new Error(`Ground coverage ${(ledger.groundCoverageRatio*100).toFixed(1)}% exceeds the ${(workingCoverageLimit*100).toFixed(1)}% working concept cap.`);
      const candidate={id,family:footprint.family,coreSide:side,order,envelope,grid,core,levels:floorModels,
        ledger,rulePack,workingCoverageLimit,parkingRequested:brief.buildingProgram.parking,
        designStatus:'spatial_hypothesis_not_a_floor_plan'};
      attachResidentialDetails(candidate,brief);
      candidate.vastuConflicts=core.reservoir.vastuFinding.preferredShare<0.5 ?
        [{ruleId:'V20',message:'Under-stair ground reservoir departs from the Jain-led northeast underground-water preference; owner under-stair request retained for spatial testing.'}] : [];
      candidate.score=score(candidate);
      candidate.validation=validateSpatialHypothesis(candidate);
      candidate.geometryHash=crypto.createHash('sha256').update(JSON.stringify(floorModels.map(l=>({
        slabs:l.footprint.slabs,parking:l.rooms?.parking?.box,
        rooms:l.rooms?.rooms.map(r=>({type:r.type,box:r.box}))})))).digest('hex');
      candidates.push(candidate);attempts.push({id,status:'hypothesis',blockers:candidate.validation.blockers.map(b=>b.code)});
    } catch(error) {attempts.push({id,status:'rejected',reason:error.message});}
  }
  candidates.sort(compare);
  const chosen=[];
  for(const candidate of candidates){if(chosen.some(x=>x.geometryHash===candidate.geometryHash))continue;
    chosen.push(candidate);if(chosen.length===maxCandidates)break;}
  const variations=[];
  for(let i=0;i<chosen.length;i++)for(let j=i+1;j<chosen.length;j++){
    const a=chosen[i],b=chosen[j],changes=[];
    if(a.family!==b.family)changes.push('footprint family');
    if(a.coreSide!==b.coreSide)changes.push('shared stair side');
    if(a.order!==b.order)changes.push('room adjacency sequence');
    variations.push({a:a.id,b:b.id,changes});
  }
  return {candidates:chosen,attempts,variations,rulePackVersion:rulePack.version,
    status:'unverified_concepts_only',generationAvailable:false};
}
module.exports={searchConcepts};
