'use strict';
const {rect,areaSqM}=require('./areaLedger');
const {vastuFindings}=require('./vastuAllocator');
const {doorOnSharedEdge,reserveWindow}=require('./spatialReservations');
const {INTERIOR_WALL_MM,EXTERIOR_WALL_MM,CLEAR_CORRIDOR_MM}=require('./constructionProfile');
// 1,800 mm clear puja plus one exterior wall and half a partition to the corridor.
const PUJA_MAIN_STRIP_MIN_WIDTH_MM=1800+EXTERIOR_WALL_MM+INTERIOR_WALL_MM/2;
const overlapSqM=(a,b)=>Math.max(0,Math.min(a.x2,b.x2)-Math.max(a.x1,b.x1))*
  Math.max(0,Math.min(a.y2,b.y2)-Math.max(a.y1,b.y1))/1e6;
const SERVICE=new Set(['puja','store','laundry']);
const minimumHeight={bedroom:2280,primaryBedroom:2280,guestBedroom:2280,
  livingRoom:2500,kitchen:2080,study:2280,dining:2280};
function roomTypes(level) {
  const main=[];
  for(let i=0;i<level.livingRooms;i++)main.push('livingRoom');
  for(let i=0;i<level.kitchens;i++)main.push('kitchen');
  if(level.separateDiningRoom)main.push('dining');
  for(let i=0;i<level.bedrooms;i++)main.push(i===0&&level.occupancy==='owner'&&!level.secondaryBedroomsOnly?'primaryBedroom':
    i===level.bedrooms-1&&level.specialRooms?.includes('guestBedroom')?'guestBedroom':'bedroom');
  if(level.specialRooms?.includes('study'))main.push('study');
  const service=[...Array(level.bathrooms).fill('bathroom'),...(level.specialRooms||[]).filter(s=>SERVICE.has(s)&&s!=='puja')];
  return {main,service};
}
// Rental flat beside the shared stair. With one bedroom and requested ground
// bikes (owner instruction 2026-10-01: give up a ground room for parking), the
// outer front bay becomes an open bike bay and the kitchen moves to the rear row.
function planCompactRental({level,footprint,core,bearingDegrees,groundParking=null}){
  const slabs=footprint.slabs.map(rect),b=rect(core.box);
  if(slabs.length!==1)return null;
  const slab=slabs[0],west=core.side==='west',y0=slab.y1,y1=b.y2,y2=slab.y2;
  const mainX1=west?b.x2:slab.x1,mainX2=west?slab.x2:b.x1;
  if(mainX2-mainX1<5000||y2-y1<4100)return null;
  const coreAxis=west?b.x2-175:b.x1+175,
    outerAxis=west?slab.x2-175:slab.x1+175,
    publicSplit=Math.round((coreAxis+outerAxis)/2)+(west?175:-175),
    bedroomSplit=publicSplit;
  const hallY2=y1+CLEAR_CORRIDOR_MM+INTERIOR_WALL_MM;
  const crossHall=rect([mainX1,y1,mainX2,hallY2]);
  const livingBox=rect(west?[b.x2,y0,publicSplit,y1]:
    [publicSplit,y0,b.x1,y1]);
  const kitchenBox=rect(west?[publicSplit,y0,mainX2,y1]:
    [mainX1,y0,publicSplit,y1]);
  const nearBedroom=rect(west?[mainX1,hallY2,bedroomSplit,y2]:
    [bedroomSplit,hallY2,mainX2,y2]);
  const farBedroom=rect(west?[bedroomSplit,hallY2,mainX2,y2]:
    [mainX1,hallY2,bedroomSplit,y2]);
  // The cross hall alone serves the bedrooms and WC. Keeping a narrow
  // longitudinal passage in this bay puts a grid column through its clear
  // route; the remaining rear bay is a private flex space off bedroom 2.
  const bathBox=rect([b.x1,y1,b.x2,y1+1525]);
  const utilityBox=rect([b.x1,y1+1525,b.x2,y2]);
  const bikeBay=level.bedrooms===1&&groundParking?.bikes>0;
  if(bikeBay&&(kitchenBox.x2-kitchenBox.x1<2400||y1-y0<3500))return null;
  const parking=bikeBay?{box:kitchenBox,bikesRequested:groundParking.bikes,
    carsRequested:groundParking.cars||0,type:'roofed_open_ground_bay',
    replacesRoom:'second ground-floor rental bedroom (moved to an upper owner floor)',
    status:'geometric_bay_only_gate_manoeuvring_and_coverage_unverified'}:null;
  const items=bikeBay?[
    ['livingRoom',livingBox,'shared-floor-level-arrival'],
    ['kitchen',nearBedroom,'cross-hall'],
    ['bedroom',farBedroom,'cross-hall'],
    ['bathroom',bathBox,'cross-hall'],
    ['serviceNiche',utilityBox,'kitchen']]:[
    ['livingRoom',livingBox,'shared-floor-level-arrival'],
    ['kitchen',kitchenBox,'living-room'],
    ['bedroom',nearBedroom,'cross-hall'],
    ['bedroom',farBedroom,'cross-hall'],
    ['bathroom',bathBox,'cross-hall'],
    ['serviceNiche',utilityBox,'near-bedroom']];
  const rooms=items.map(([type,box,entryFrom],i)=>({
    id:`${level.id}-${type}-${i+1}`,levelId:level.id,type,box,
    areaSqM:areaSqM([box]),entryFrom,
    ...(type==='kitchen'?{diningWithinKitchen:true}:{}),
    ...(type==='serviceNiche'?{suggestedByPlanner:true}:{}),
    openingFace:west?'east':'west',openingStatus:'legal_exposure_unverified'}));
  const living=rooms[0];
  const arrival=core.flights[0]?.arrivalLandings?.[0]?.box;
  const unitEntryDoor=arrival&&doorOnSharedEdge(
    rect([b.x1,arrival.y1,b.x2,arrival.y2]),living.box,
    {clearWidthMm:1000,endClearanceMm:50});
  const circulationPortal=doorOnSharedEdge(living.box,crossHall,
    {clearWidthMm:1200,endClearanceMm:100});
  if(!unitEntryDoor||!circulationPortal)
    return {ok:false,reason:'Rental living/cross-hall access does not fit the stair-side bay.'};
  for(const room of rooms){
    if(['livingRoom','kitchen','bedroom'].includes(room.type)){
      room.provisionalNaturalLightOpeningSqM=room.areaSqM*(room.type==='kitchen'?1/8:1/10);
      room.provisionalVentilationOpeningSqM=room.areaSqM/16;
      room.apertureRuleSource='NBC 206:2024 PDF page 17, hilly-region normal residential';
    }
    const target=room.entryFrom==='shared-floor-level-arrival'?null:
      room.entryFrom==='living-room'?living.box:
        room.entryFrom==='cross-hall'?crossHall:
          room.entryFrom==='near-bedroom'?rooms[2].box:
            room.entryFrom==='kitchen'?rooms.find(r=>r.type==='kitchen').box:null;
    const open=room.type==='kitchen';
    const door=target?doorOnSharedEdge(room.box,target,{
      clearWidthMm:open?1200:room.type==='bathroom'?750:900,
      endClearanceMm:room.type==='bathroom'?50:150}):unitEntryDoor;
    if(!door)return {ok:false,reason:`${room.id} cannot be reached from ${room.entryFrom}.`};
    room.doorReservation={...door,from:room.entryFrom,to:room.id,
      ...(open?{status:'open_portal_reserved_no_door',openingStyle:'decorative_arch_optional'}:
        {leafCount:1,material:'wood'})};
    if(room.provisionalNaturalLightOpeningSqM){
      room.windowReservation=[room.openingFace,'south','north'].map(face=>
        reserveWindow(room.box,slabs,face,room.provisionalNaturalLightOpeningSqM)).find(Boolean)||null;
      if(!room.windowReservation)room.openingStatus='no_physical_exterior_window_reserved';
    }
  }
  return {ok:true,levelId:level.id,occupancy:level.occupancy,rooms,corridor:null,crossHall,parking,
    circulationPortal:{...circulationPortal,status:'open_portal_reserved_no_door',
      openingStyle:'open_connection',from:'living-room',to:'cross-hall'},
    unitEntry:{from:'shared-floor-level-arrival',to:'living-room',doorReservation:{
      ...unitEntryDoor,leafCount:1,material:'wood'}},
    vastuFindings:vastuFindings(rooms,{bearingDegrees,domainBoxes:slabs}),
    unresolved:['Door swings, parking, legal openings and egress remain unverified.']};
}
// Attached bath on the owner bedroom floor: 1,500 x 2,600 mm at the start of the
// primary-bedroom band by default. Alternatives are searched only when that box
// would stack over a puja on the floor below (V06) or overlap the NE/centre
// toilet-excluded zones (V13); they are ranked by puja overlap, then NE/centre
// overlap, then NW/W share (V12), then the smallest change from the default.
// The primary bedroom keeps at least 2,800 mm of its band width.
const ATTACHED_BATH_DEFAULT={widthMm:1500,lengthMm:2600,end:'start'};
const BATH_MIN_CLEAR_MM=1200,BATH_MIN_CLEAR_SQM=2.8,ALCOVE_MIN_CLEAR_MM=1200,ALCOVE_MIN_CLEAR_SQM=2.0;
// side 'outer': bath and open alcove on the far exterior wall (default).
// side 'inner': bath and alcove against the family foyer; the alcove becomes the
// bedroom's entry vestibule (door from the foyer, open portal into the bedroom).
function attachedBathLayout({west,mainX1,mainX2,y0,y1,widthMm,lengthMm,end,side='outer'}){
  const atMaxX=west===(side==='outer');
  const bathX1=atMaxX?mainX2-widthMm:mainX1,bathX2=atMaxX?mainX2:mainX1+widthMm;
  const [bathY1,bathY2]=end==='start'?[y0,y0+lengthMm]:[y1-lengthMm,y1];
  const [alcoveY1,alcoveY2]=end==='start'?[bathY2,y1]:[y0,bathY1];
  return {side,bathBox:rect([bathX1,bathY1,bathX2,bathY2]),alcoveBox:rect([bathX1,alcoveY1,bathX2,alcoveY2]),
    primaryBox:rect(atMaxX?[mainX1,y0,bathX1,y1]:[bathX2,y0,mainX2,y1])};
}
function placeAttachedBath({west,mainX1,mainX2,y0,y1,slabs,bearingDegrees,pujaBoxesBelow}){
  const args={west,mainX1,mainX2,y0,y1};
  const pujaOverlap=box=>pujaBoxesBelow.reduce((sum,p)=>sum+overlapSqM(box,p),0);
  const zones=box=>vastuFindings([{id:'bath',type:'bathroom',box}],{bearingDegrees,domainBoxes:slabs})[0];
  const excluded=box=>{const z=zones(box).zoneAreasSqM;return z.NE+z.C;};
  const initial=attachedBathLayout({...args,...ATTACHED_BATH_DEFAULT});
  const initialOverlap=pujaOverlap(initial.bathBox),initialExcluded=excluded(initial.bathBox);
  if(initialOverlap<0.01&&initialExcluded<0.01)return {...initial,replan:null};
  // Conservative clear sizes: the bath/alcove take the 229 mm exterior wall on
  // the outer face and the band end at y0 is treated as exterior as well.
  const clear=(box,atStart,side)=>[box.x2-box.x1-(side==='outer'?EXTERIOR_WALL_MM+INTERIOR_WALL_MM/2:INTERIOR_WALL_MM),
    box.y2-box.y1-INTERIOR_WALL_MM/2-(atStart?EXTERIOR_WALL_MM:INTERIOR_WALL_MM/2)];
  const options=[];
  for(const side of ['outer','inner'])for(const end of ['start','end'])for(const widthMm of [1500,1600,1800])
    for(let lengthMm=2600;lengthMm>=2200;lengthMm-=50){
      // An inner bath needs the band end for its exterior (ventilation) wall.
      if(side==='inner'&&end!=='start')continue;
      const layout=attachedBathLayout({...args,widthMm,lengthMm,end,side});
      const [bw,bl]=clear(layout.bathBox,end==='start',side),[aw,al]=clear(layout.alcoveBox,end!=='start',side);
      if(Math.min(bw,bl)<BATH_MIN_CLEAR_MM||bw*bl/1e6<BATH_MIN_CLEAR_SQM+0.05)continue;
      if(Math.min(aw,al)<ALCOVE_MIN_CLEAR_MM||aw*al/1e6<ALCOVE_MIN_CLEAR_SQM)continue;
      if(layout.primaryBox.x2-layout.primaryBox.x1<2800)continue;
      const finding=zones(layout.bathBox);
      // Entering the bedroom through a vestibule is a larger change than resizing.
      options.push({layout,side,end,widthMm,lengthMm,pujaOverlapSqM:pujaOverlap(layout.bathBox),
        excludedZoneSqM:excluded(layout.bathBox),preferredShare:finding.preferredShare,
        change:Math.abs(widthMm-1500)+Math.abs(lengthMm-2600)+(end==='start'?0:1)+(side==='inner'?10000:0)});
    }
  options.sort((a,b)=>a.pujaOverlapSqM-b.pujaOverlapSqM||a.excludedZoneSqM-b.excludedZoneSqM||
    b.preferredShare-a.preferredShare||a.change-b.change);
  const best=options[0];
  const round=n=>Math.round(n*100)/100;
  const improves=best&&(best.pujaOverlapSqM<initialOverlap-1e-9||
    best.pujaOverlapSqM<=initialOverlap+1e-9&&best.excludedZoneSqM<initialExcluded-1e-9);
  const replan={ruleIds:['V06','V13','V12'],
    reason:[initialOverlap>=0.01&&'attached bath was above a puja on the floor below',
      initialExcluded>=0.01&&'attached bath overlapped the NE/centre toilet-excluded zones']
      .filter(Boolean).join('; '),
    original:{...ATTACHED_BATH_DEFAULT,box:initial.bathBox,pujaOverlapSqM:round(initialOverlap),
      excludedZoneSqM:round(initialExcluded)},
    optionsTested:options.length,
    status:!best?'rejected_no_fitting_option':!improves?'rejected_no_improvement':
      best.pujaOverlapSqM>=0.01?'applied_still_over_puja':'applied',
    ...(best?{proposed:{side:best.side,end:best.end,widthMm:best.widthMm,lengthMm:best.lengthMm,box:best.layout.bathBox,
      pujaOverlapSqM:round(best.pujaOverlapSqM),excludedZoneSqM:round(best.excludedZoneSqM),
      preferredShare:round(best.preferredShare)}}:{})};
  return replan.status.startsWith('applied')?{...best.layout,replan}:{...initial,replan};
}
function planOwnerBedroomFloor({level,footprint,core,bearingDegrees,pujaBoxesBelow=[]}){
  const slabs=footprint.slabs.map(rect),b=rect(core.box);
  if(slabs.length!==1)return null;
  const slab=slabs[0],west=core.side==='west',y0=slab.y1,y1=b.y2,y2=slab.y2;
  const near=west?b.x2:b.x1,far=west?slab.x2:slab.x1;
  if(slab.x2-slab.x1<8700||y2-y1<4100)return null;
  const foyerWidth=2000;
  const corridor=rect(west?[near,y0,near+foyerWidth,y1]:
    [near-foyerWidth,y0,near,y1]);
  const crossHall=rect(west?[near,y1,far,y1+1000]:
    [far,y1,near,y1+1000]);
  const mainX1=west?corridor.x2:far,mainX2=west?far:corridor.x1;
  const coreAxis=west?b.x2-175:b.x1+175,
    outerAxis=west?slab.x2-175:slab.x1+175,
    bedroomSplit=Math.round((coreAxis+outerAxis)/2)+(west?175:-175);
  const {primaryBox,bathBox,alcoveBox,side:bathSide,replan:bathReplan}=placeAttachedBath({west,mainX1,mainX2,
    y0,y1,slabs,bearingDegrees,pujaBoxesBelow});
  const vestibule=bathSide==='inner';
  const bedroomA=rect(west?[near,y1+1000,bedroomSplit,y2]:
    [bedroomSplit,y1+1000,near,y2]);
  const bedroomB=rect(west?[bedroomSplit,y1+1000,far,y2]:
    [far,y1+1000,bedroomSplit,y2]);
  const balcony={box:rect(b.x1===slab.x1?[b.x1,y1,b.x2,y2]:
    [b.x1,y1,b.x2,y2]),status:'open_first_floor_balcony_rail_and_drainage_unverified'};
  const items=[
    ['primaryBedroom',primaryBox,vestibule?'primary-alcove':'unit-corridor'],
    ['bathroom',bathBox,'primary-bedroom'],
    ['primaryAlcove',alcoveBox,vestibule?'unit-corridor':'primary-bedroom'],
    ['bedroom',bedroomA,'cross-hall'],
    ['bedroom',bedroomB,'cross-hall']];
  const rooms=items.map(([type,box,entryFrom],i)=>({
    id:`${level.id}-${type}-${i+1}`,levelId:level.id,type,box,
    areaSqM:areaSqM([box]),entryFrom,
    ...(type==='bathroom'?{attachedTo:`${level.id}-primaryBedroom-1`}:{}),
    ...(type==='primaryAlcove'?vestibule?{suggestedByPlanner:true,
      useIntent:'bedroom_entry_vestibule_with_door_from_family_foyer'}:{openConnection:true,suggestedByPlanner:true,
      useIntent:'open_bedroom_alcove_not_an_assumed_closet'}:{}),
    ...(type==='primaryBedroom'&&vestibule?{openConnection:true}:{}),
    openingFace:west?'east':'west',openingStatus:'legal_exposure_unverified'}));
  const arrival=core.flights[0]?.arrivalLandings?.[0]?.box;
  const unitEntryDoor=arrival&&doorOnSharedEdge(
    rect([b.x1,arrival.y1,b.x2,arrival.y2]),corridor,
    {clearWidthMm:1000,endClearanceMm:50});
  const circulationPortal=doorOnSharedEdge(corridor,crossHall,
    {clearWidthMm:1200,endClearanceMm:150});
  const balconyDoor=doorOnSharedEdge(balcony.box,crossHall,
    {clearWidthMm:900,endClearanceMm:0});
  if(!unitEntryDoor||!circulationPortal||!balconyDoor)
    return {ok:false,reason:'Owner family landing or balcony access does not fit this bay.'};
  for(const room of rooms){
    if(['primaryBedroom','bedroom'].includes(room.type)){
      room.provisionalNaturalLightOpeningSqM=room.areaSqM/10;
      room.provisionalVentilationOpeningSqM=room.areaSqM/16;
      room.apertureRuleSource='NBC 206:2024 PDF page 17, hilly-region normal residential';
    }
    const target=room.entryFrom==='primary-bedroom'?rooms[0].box:
      room.entryFrom==='primary-alcove'?rooms[2].box:
      room.entryFrom==='cross-hall'?crossHall:corridor;
    const door=doorOnSharedEdge(room.box,target,{
      clearWidthMm:room.type==='bathroom'?750:room.openConnection?1200:900,
      endClearanceMm:room.type==='bathroom'?50:room.openConnection?0:150});
    if(!door)return {ok:false,reason:`${room.id} cannot be entered from ${room.entryFrom}.`};
    room.doorReservation={...door,from:room.entryFrom,to:room.id,
      ...(room.openConnection?{status:'open_portal_reserved_no_door',
        openingStyle:'open_connection'}:{leafCount:1,material:'wood'})};
    if(room.provisionalNaturalLightOpeningSqM){
      room.windowReservation=[room.openingFace,'south','north'].map(face=>
        reserveWindow(room.box,slabs,face,room.provisionalNaturalLightOpeningSqM)).find(Boolean)||null;
      if(!room.windowReservation)room.openingStatus='no_physical_exterior_window_reserved';
    }
  }
  balcony.doorReservation={...balconyDoor,leafCount:1,material:'wood',
    from:'cross-hall',to:'first-floor-balcony'};
  return {ok:true,levelId:level.id,occupancy:level.occupancy,rooms,corridor,crossHall,
    balcony,attachedBathroomsPlaced:1,...(bathReplan?{bathReplan}:{}),
    circulationPortal:{...circulationPortal,status:'open_portal_reserved_no_door',
      openingStyle:'open_connection',from:'family-landing',to:'cross-hall'},
    unitEntry:{from:'shared-floor-level-arrival',to:'family-landing',doorReservation:{
      ...unitEntryDoor,leafCount:1,material:'wood'}},
    vastuFindings:vastuFindings(rooms,{bearingDegrees,domainBoxes:slabs}),
    unresolved:['Family landing furniture fit, balcony guard and bath detailing remain unverified.']};
}
function planFloorRooms({level,footprint,core,bearingDegrees,order='living-first',
  groundParking=null,pujaInMainStrip=false,toiletBoxesAdjacent=[],pujaBoxesBelow=[],avoidColumnBoxes=[]}) {
  if(level.occupancy==='owner'&&level.bedrooms===3&&level.bathrooms===1&&
    level.attachedBathrooms===1&&!level.livingRooms&&!level.kitchens){
    const owner=planOwnerBedroomFloor({level,footprint,core,bearingDegrees,pujaBoxesBelow});
    if(owner)return owner;
  }
  if(level.occupancy==='rental'&&(level.bedrooms===2||level.bedrooms===1&&groundParking?.bikes>0)&&
    level.bathrooms===1&&level.livingRooms===1&&level.kitchens===1&&!level.specialRooms?.length&&
    order==='living-first'){
    const compact=planCompactRental({level,footprint,core,bearingDegrees,groundParking});
    if(compact)return compact;
  }
  const b=rect(core.box),slabs=footprint.slabs.map(rect);
  const xmin=Math.min(...slabs.map(s=>s.x1)),xmax=Math.max(...slabs.map(s=>s.x2));
  const ymin=Math.min(...slabs.map(s=>s.y1)),ymax=Math.max(...slabs.map(s=>s.y2));
  // Two 102 mm nominal partition halves leave 1000 mm clear between them.
  const corridorWidth=CLEAR_CORRIDOR_MM+INTERIOR_WALL_MM,side=core.side;
  const mainX1=side==='west'?b.x2+corridorWidth:xmin;
  const mainX2=side==='west'?xmax:b.x1-corridorWidth;
  let corridor=rect(side==='west'?[b.x2,ymin,mainX1,ymax]:[mainX2,ymin,b.x1,ymax]);
  const width=mainX2-mainX1;
  const {main,service}=roomTypes(level);
  const ownerBedroomFloor=level.occupancy==='owner'&&level.bedrooms===3&&
    level.attachedBathrooms===1&&level.bathrooms===1&&
    !level.livingRooms&&!level.kitchens;
  if(ownerBedroomFloor)service.splice(service.indexOf('bathroom'),1);
  if(width<(main.length?2500:1000)||areaSqM([corridor],slabs)>1e-9)
    return {ok:false,reason:'A continuous, 1 m unit corridor does not fit beside the stair core.'};
  if(level.specialRooms?.includes('puja')&&!level.livingRooms&&level.occupancy!=='owner')
    return {ok:false,reason:'A private puja room requires an owner-only unit.'};
  // Requested only when the service-bay puja would stack over a toilet (V06).
  const pujaInMain=pujaInMainStrip&&level.specialRooms?.includes('puja')&&
    !level.livingRooms&&!main.length&&width>=PUJA_MAIN_STRIP_MIN_WIDTH_MM;
  if(pujaInMainStrip&&!pujaInMain)
    return {ok:false,reason:'Puja does not fit in the main strip of this floor.'};
  const pujaInService=level.specialRooms?.includes('puja')&&!pujaInMain&&
    (width<4300||!level.livingRooms);
  if(pujaInService)service.push('puja');
  const priority=order==='bedrooms-south'?{bedroom:0,guestBedroom:0,primaryBedroom:0,kitchen:1,dining:2,livingRoom:3,study:4}:
    order==='kitchen-south'?{kitchen:0,dining:1,livingRoom:2,bedroom:3,guestBedroom:3,primaryBedroom:3,study:4}:
      {livingRoom:0,kitchen:1,dining:2,bedroom:3,guestBedroom:3,primaryBedroom:3,study:4};
  const types=main.map((type,index)=>({type,index})).sort((a,b)=>
    (priority[a.type]??4)-(priority[b.type]??4)||a.index-b.index).map(item=>item.type);
  // Kitchen and dining are one space by default. A distinct dining room is
  // attempted only when the owner explicitly asks for one on this level.
  const minimum=types.reduce((s,t)=>s+(minimumHeight[t]||2000),0);
  if(minimum>ymax-ymin) return {ok:false,reason:'Requested habitable rooms need more frontage length than this footprint provides.'};
  const extra=ymax-ymin-minimum;
  const weights=types.length===3&&['livingRoom','kitchen','dining'].every(t=>types.includes(t))?
    {livingRoom:0.45,kitchen:0.30,dining:0.25}:null;
  const depths=types.map((type,i)=>(minimumHeight[type]||2000)+(weights?
    Math.floor(extra*weights[type]):Math.floor(extra/types.length)));
  if(depths.length)depths[depths.length-1]+=ymax-ymin-depths.reduce((sum,n)=>sum+n,0);
  if(types.length===2&&types.includes('livingRoom')&&types.includes('kitchen')){
    const bikeBay=groundParking?.bikes>0&&level.occupancy==='owner'&&
      level.bedrooms===0&&order==='living-first';
    const firstDepth=bikeBay?b.y2-ymin:
      b.y2-ymin-(types[0]==='kitchen'?400:0);
    if(firstDepth>=minimumHeight[types[0]]&&ymax-ymin-firstDepth>=minimumHeight[types[1]]){
      depths[0]=firstDepth;depths[1]=ymax-ymin-firstDepth;
    }
  }
  // Bedrooms on a partial (terrace) floor stop at the stair-core row so no fixed
  // frame column stands inside them; the rest of the strip stays open terrace.
  if(level.kind==='partial'&&types.length&&types.every(t=>/bedroom/i.test(t))&&
    b.y2-ymin>=types.length*2280&&b.y2<ymax){
    const each=Math.floor((b.y2-ymin)/types.length);
    types.forEach((t,i)=>{depths[i]=i===types.length-1?b.y2-ymin-each*i:each;});
  }
  if(ownerBedroomFloor){
    depths[0]=b.y2-ymin;
    depths[1]=Math.floor((ymax-b.y2)/2);
    depths[2]=ymax-b.y2-depths[1];
  }
  let y=ymin;const rooms=[];
  for(let i=0;i<types.length;i++){
    const type=types[i],height=depths[i];
    let box=rect([mainX1,y,mainX2,y+height]);y+=height;
    if(areaSqM([box],slabs)>1e-9)return {ok:false,reason:`${type} would extend outside the ${footprint.family} footprint.`};
    if(type==='livingRoom'&&level.specialRooms?.includes('puja')&&!pujaInService){
      if(width<4300||height<2500)return {ok:false,reason:'Living and puja rooms do not fit side by side.'};
      const pujaWidth=2100;
      const outerX1=side==='west'?mainX2-pujaWidth:mainX1;
      const outerX2=outerX1+pujaWidth;
      let pujaY1=box.y1,pujaY2=box.y2;
      if(height>=4160){
        // Both boxes remain usable after their nominal 102/229 mm walls.
        const pujaDepth=Math.min(2200,Math.floor(height/2));
        const options=[rect([outerX1,box.y1,outerX2,box.y1+pujaDepth]),
          rect([outerX1,box.y2-pujaDepth,outerX2,box.y2])];
        options.sort((a,b)=>vastuFindings([{id:'puja',type:'puja',box:b}],
          {bearingDegrees,domainBoxes:slabs})[0].preferredShare-
          vastuFindings([{id:'puja',type:'puja',box:a}],
            {bearingDegrees,domainBoxes:slabs})[0].preferredShare);
        pujaY1=options[0].y1;pujaY2=options[0].y2;
      }
      const pujaBox=rect([outerX1,pujaY1,outerX2,pujaY2]);
      box=rect(side==='west'?[mainX1,box.y1,mainX2-pujaWidth,box.y2]:
        [mainX1+pujaWidth,box.y1,mainX2,box.y2]);
      rooms.push({id:`${level.id}-puja`,levelId:level.id,type:'puja',box:pujaBox,
        areaSqM:areaSqM([pujaBox]),entryFrom:'living-room',openingFace:side==='west'?'east':'west',
        openingStatus:'legal_exposure_unverified'});
      if(pujaY2-pujaY1<height){
        const annexBox=rect([outerX1,pujaY1===box.y1?pujaY2:box.y1,
          outerX2,pujaY1===box.y1?box.y2:pujaY1]);
        rooms.push({id:`${level.id}-living-annex`,levelId:level.id,type:'livingAnnex',
          box:annexBox,areaSqM:areaSqM([annexBox]),entryFrom:'living-room',
          suggestedByPlanner:true,openConnection:true,openingFace:side==='west'?'east':'west',
          openingStatus:'legal_exposure_unverified'});
      }
    }
    if(ownerBedroomFloor&&type==='primaryBedroom'){
      const bathX1=side==='west'?mainX2-1500:mainX1,
        bathX2=side==='west'?mainX2:mainX1+1500,bathEnd=box.y1+2600;
      const bathBox=rect([bathX1,box.y1,bathX2,bathEnd]);
      const annexBox=rect([bathX1,bathEnd,bathX2,box.y2]);
      box=rect(side==='west'?[mainX1,box.y1,bathX1,box.y2]:
        [bathX2,box.y1,mainX2,box.y2]);
      rooms.push({id:`${level.id}-attached-bathroom`,levelId:level.id,type:'bathroom',
        box:bathBox,areaSqM:areaSqM([bathBox]),entryFrom:'primary-bedroom',
        attachedTo:`${level.id}-${type}-${i+1}`,openingFace:side==='west'?'east':'west',
        openingStatus:'legal_exposure_unverified'});
      rooms.push({id:`${level.id}-primary-alcove`,levelId:level.id,type:'primaryAlcove',
        box:annexBox,areaSqM:areaSqM([annexBox]),entryFrom:'primary-bedroom',
        openConnection:true,suggestedByPlanner:true,
        useIntent:'open_bedroom_alcove_not_an_assumed_closet',
        openingStatus:'legal_exposure_unverified'});
    }
    if(type==='kitchen'&&groundParking?.bikes>0&&level.occupancy==='owner'&&
      level.bedrooms===0&&level.livingRooms===1&&order==='living-first'&&
      mainX2-mainX1>=5200){
      const coreAxis=side==='west'?b.x2-175:b.x1+175;
      const outerAxis=side==='west'?xmax-175:xmin+175;
      const split=Math.round((coreAxis+outerAxis)/2)+
        (side==='west'?175:-175);
      const annexBox=rect(side==='west'?[split,box.y1,mainX2,box.y2]:
        [mainX1,box.y1,split,box.y2]);
      box=rect(side==='west'?[mainX1,box.y1,split,box.y2]:
        [split,box.y1,mainX2,box.y2]);
      rooms.push({id:`${level.id}-dining-annex`,levelId:level.id,type:'diningAnnex',
        box:annexBox,areaSqM:areaSqM([annexBox]),entryFrom:'kitchen',
        openConnection:true,suggestedByPlanner:true,
        useIntent:'open_dining_zone_of_combined_kitchen_dining',
        openingFace:side==='west'?'east':'west',
        openingStatus:'legal_exposure_unverified'});
    }
    rooms.push({id:`${level.id}-${type}-${i+1}`,levelId:level.id,type,box,
      areaSqM:areaSqM([box]),entryFrom:'unit-corridor',suggestedByPlanner:false,
      ...(type==='kitchen'&&!level.separateDiningRoom?{diningWithinKitchen:true}:{}),
      openingFace:side==='west'?'east':'west',
      openingStatus:'legal_exposure_unverified'});
  }
  if(pujaInMain){
    const depth=Math.min(2200,ymax-ymin),options=[];
    for(let y1=ymin;y1+depth<=ymax;y1+=300)options.push(rect([mainX1,y1,mainX2,y1+depth]));
    options.push(rect([mainX1,ymax-depth,mainX2,ymax]));
    const share=box=>vastuFindings([{id:'puja',type:'puja',box}],
      {bearingDegrees,domainBoxes:slabs})[0].preferredShare;
    const toilet=box=>toiletBoxesAdjacent.reduce((sum,t)=>sum+overlapSqM(box,t),0);
    // A known frame column must not stand wholly inside the puja (as the
    // COLUMN_IN_ROOM_CLEAR_AREA validator counts it); columns in its walls are normal.
    const hitsColumn=box=>avoidColumnBoxes.some(c=>c.x1>box.x1+INTERIOR_WALL_MM/2&&
      c.x2<box.x2-INTERIOR_WALL_MM/2&&c.y1>box.y1+INTERIOR_WALL_MM/2&&c.y2<box.y2-INTERIOR_WALL_MM/2);
    const pujaBox=options.filter(box=>areaSqM([box],slabs)<=1e-9&&!hitsColumn(box))
      .map(box=>({box,toilet:toilet(box),share:share(box)}))
      .sort((a,b)=>a.toilet-b.toilet||b.share-a.share||a.box.y1-b.box.y1)[0]?.box;
    if(!pujaBox)return {ok:false,reason:'Puja does not fit in the main strip of this floor.'};
    rooms.push({id:`${level.id}-puja-main`,levelId:level.id,type:'puja',box:pujaBox,
      areaSqM:areaSqM([pujaBox]),entryFrom:'unit-corridor',suggestedByPlanner:false,
      privacyIntent:'owner_only_behind_unit_entry',
      placementNote:'Main strip chosen so the puja is not above or below a toilet (V06).',
      openingFace:side==='west'?'east':'west',openingStatus:'legal_exposure_unverified'});
  }
  const serviceX1=side==='west'?b.x1:b.x1,serviceX2=b.x2;
  const serviceY1=b.y2;
  const serviceTop=Math.max(serviceY1,...slabs.filter(s=>s.x1<=serviceX1&&s.x2>=serviceX2&&
    s.y1<=serviceY1&&s.y2>serviceY1).map(s=>s.y2));
  const balcony=ownerBedroomFloor&&serviceTop-serviceY1>=4200?
    {box:rect([serviceX1,serviceTop-2600,serviceX2,serviceTop]),
      status:'open_first_floor_balcony_rail_and_drainage_unverified'}:null;
  if(ownerBedroomFloor&&balcony)service.push('utilityFlex');
  const serviceHeight=(balcony?.box.y1||serviceTop)-serviceY1;
  if(service.length&&serviceHeight/service.length<1200)
    return {ok:false,reason:'Bathrooms and special rooms do not fit beside the stair landing.'};
  // A typical 5 x 8-9 ft W/C uses the narrow dimension across its depth;
  // the balance of this service strip remains explicit usable area.
  const bathDepth=Math.min(1525,serviceHeight-1800);
  let serviceZones;
  if(service.length===2&&service[0]==='bathroom'&&service[1]==='puja'&&serviceHeight>=3580){
    serviceZones=[{type:'bathroom',low:serviceY1,high:serviceY1+bathDepth},
      {type:'puja',low:serviceY1+bathDepth,high:serviceTop}];
  }else if(service.length===2&&service.every(type=>type==='bathroom')&&
    rooms.some(r=>r.type==='primaryBedroom')&&rooms.some(r=>r.type==='guestBedroom')&&
    rooms.find(r=>r.type==='primaryBedroom').box.y2>serviceY1+1600&&
    rooms.find(r=>r.type==='primaryBedroom').box.y2<serviceTop-1600){
    const partition=rooms.find(r=>r.type==='primaryBedroom').box.y2;
    serviceZones=[{type:'bathroom',low:serviceY1,high:partition},
      {type:'bathroom',low:partition,high:serviceTop}];
  }else if(service.length===1&&service[0]==='bathroom'&&serviceHeight>=3300&&
    serviceX2-serviceX1>=2000){
    serviceZones=[{type:'bathroom',low:serviceY1,high:serviceY1+bathDepth},
      {type:'utilityFlex',low:serviceY1+bathDepth,high:serviceTop,suggestedByPlanner:true}];
  }else serviceZones=service.map((type,i)=>({type,low:serviceY1+
    Math.floor(serviceHeight*i/service.length),
    high:serviceY1+Math.floor(serviceHeight*(i+1)/service.length)}));
  for(let i=0;i<serviceZones.length;i++){
    const {type,low,high,suggestedByPlanner}=serviceZones[i];
    const box=rect([serviceX1,low,serviceX2,high]);
    if(areaSqM([box],slabs)>1e-9)return {ok:false,reason:`${type} would extend outside the footprint.`};
    if(type==='puja'&&Math.min(box.x2-box.x1,box.y2-box.y1)<1800)
      return {ok:false,reason:'Puja room is too narrow in this subdivision.'};
    rooms.push({id:`${level.id}-${type}-${i+1}`,levelId:level.id,type,box,
      areaSqM:areaSqM([box]),entryFrom:'unit-corridor',suggestedByPlanner:Boolean(suggestedByPlanner),
      ...(type==='puja'?{privacyIntent:'owner_only_behind_unit_entry'}:{}),
      ...(type==='puja'&&pujaInService?{
        placementNote:'Narrow main strip; puja placed in the service bay for owner Vaastu review.'}:{}),
      openingFace:side==='west'?'west':'east',
      openingStatus:'legal_exposure_unverified'});
  }
  // The first occupied room absorbs the entry-side strip. The residual route
  // begins beyond living, with a real open connection between the two zones.
  const living=rooms.find(r=>r.type==='livingRoom');
  const directLiving=order==='living-first'&&living&&living.box.y1===ymin&&
    living.box.y2<ymax&&
    !rooms.some(r=>r.type==='puja'&&r.entryFrom==='living-room');
  let circulationPortal=null;
  let parking=null;
  if(directLiving){
    living.box=rect(side==='west'?[b.x2,ymin,mainX2,living.box.y2]:
      [mainX1,ymin,b.x1,living.box.y2]);
    if(groundParking?.bikes>0&&level.occupancy==='owner'&&level.bedrooms===0&&
      level.kitchens===1&&level.livingRooms===1){
      const parkingWidth=Math.min(3000,mainX2-mainX1-2700);
      if(parkingWidth>=2400&&living.box.y2-ymin>=3500){
        const bay=side==='west'?rect([mainX2-parkingWidth,ymin,mainX2,living.box.y2]):
          rect([mainX1,ymin,mainX1+parkingWidth,living.box.y2]);
        living.box=rect(side==='west'?[b.x2,ymin,bay.x1,living.box.y2]:
          [bay.x2,ymin,b.x1,living.box.y2]);
        parking={box:bay,bikesRequested:groundParking.bikes,carsRequested:groundParking.cars||0,
          type:'roofed_open_ground_bay',
          status:'geometric_bay_only_gate_manoeuvring_and_coverage_unverified'};
      }
    }
    living.areaSqM=areaSqM([living.box]);
    living.entryFrom='shared-floor-level-arrival';
    corridor=rect([corridor.x1,living.box.y2,corridor.x2,ymax]);
    circulationPortal=doorOnSharedEdge(living.box,corridor,{clearWidthMm:1000,
      endClearanceMm:0});
    if(!circulationPortal)return {ok:false,reason:'The living room has no open route to the remaining rooms.'};
    circulationPortal={...circulationPortal,status:'open_portal_reserved_no_door',
      openingStyle:'open_connection',from:'living-room',to:'unit-corridor'};
  }
  const arrival=core.flights[0]?.arrivalLandings?.[0]?.box;
  const unitEntryDoor=arrival&&doorOnSharedEdge(
    rect([b.x1,arrival.y1,b.x2,arrival.y2]),directLiving?living.box:corridor,
    {clearWidthMm:1000,endClearanceMm:50});
  if(!unitEntryDoor)return {ok:false,reason:'Shared stair floor-level arrival pad cannot connect to the unit with a 1,000 mm opening.'};
  for(const room of rooms){
    if(['bedroom','primaryBedroom','guestBedroom','livingRoom','study','kitchen','dining',
      'diningAnnex'].includes(room.type)){
      room.provisionalNaturalLightOpeningSqM=room.areaSqM*(room.type==='kitchen'?1/8:1/10);
      room.provisionalVentilationOpeningSqM=room.areaSqM/16;
      room.apertureRuleSource='NBC 206:2024 PDF page 17, hilly-region normal residential';
    }
    const entry=room.entryFrom==='living-room'?living:
      room.entryFrom==='primary-bedroom'?rooms.find(r=>r.type==='primaryBedroom'):
        room.entryFrom==='kitchen'?rooms.find(r=>r.type==='kitchen'):null;
    const openPortal=room.openConnection||room.type==='kitchen';
    const door=room.entryFrom==='shared-floor-level-arrival'?unitEntryDoor:
      doorOnSharedEdge(room.box,entry?.box||corridor,
      {clearWidthMm:openPortal?1200:room.type==='bathroom'?750:900});
    if(!door)return {ok:false,reason:`${room.id} has no door-width shared edge to its ${room.entryFrom}.`};
    room.doorReservation={...door,from:room.entryFrom,to:room.id,
      ...(openPortal?{status:'open_portal_reserved_no_door',openingStyle:room.type==='kitchen'?
        'decorative_arch_optional':'open_connection'}:{leafCount:1,material:'wood'})};
    if(room.provisionalNaturalLightOpeningSqM){
      const window=[room.openingFace,'south','north'].map(face=>reserveWindow(room.box,slabs,face,
        room.provisionalNaturalLightOpeningSqM)).find(Boolean);
      if(window)room.windowReservation=window;
      else room.openingStatus='no_physical_exterior_window_reserved';
    }
  }
  // The ground floor enters from the lower pad; upper levels arrive on the
  // same plan location from the second flight. The intermediate landing is
  // at half-storey elevation and must never serve a unit entrance.
  const findings=vastuFindings(rooms,{bearingDegrees,domainBoxes:slabs});
  const balconyDoor=balcony&&doorOnSharedEdge(balcony.box,corridor,
    {clearWidthMm:900,endClearanceMm:150});
  if(balcony&&!balconyDoor)return {ok:false,reason:'First-floor balcony has no accessible door from the family route.'};
  if(balcony)balcony.doorReservation={...balconyDoor,leafCount:1,material:'wood',
    from:'unit-corridor',to:'first-floor-balcony'};
  return {ok:true,levelId:level.id,occupancy:level.occupancy,rooms,corridor,parking,balcony,
    attachedBathroomsPlaced:ownerBedroomFloor?1:0,
    circulationPortal,unitEntry:{from:'shared-floor-level-arrival',to:directLiving?'living-room':'unit-corridor',doorReservation:{...unitEntryDoor,
      leafCount:1,material:'wood'},
      landingAlignmentStatus:'plan_overlap_reserved_vertical_clearance_unverified'},vastuFindings:findings,
    unresolved:['Door swings, arrival-pad vertical clearance, clear routes and all exterior opening legality must be checked against drawn walls and municipal rules.']};
}
module.exports={roomTypes,planFloorRooms,PUJA_MAIN_STRIP_MIN_WIDTH_MM,overlapSqM};
