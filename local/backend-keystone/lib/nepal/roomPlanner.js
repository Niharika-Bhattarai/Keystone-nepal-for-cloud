'use strict';
const {rect,areaSqM}=require('./areaLedger');
const {vastuFindings,FAVOR}=require('./vastuAllocator');
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
  const arrival=core.flights[0]?.arrivalLandings?.[0]?.box||core.entryPad;
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
  const arrival=core.flights[0]?.arrivalLandings?.[0]?.box||core.entryPad;
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
// Zone-first sequence (DESIGN-PRINCIPLES §4 "reserve scarce zones before packing
// rooms"): each strip slot is scored for each room's own Vaastu preference on this
// floor's true-north domain. Rooms whose preference varies most along the strip
// (the most to lose) choose first; rooms without a directional rule fill the rest
// in the default living/kitchen/bedroom priority. Works for any bearing.
function zoneFirstOrder(types,{mainX1,mainX2,ymin,ymax,slabs,bearingDegrees}){
  const n=types.length;if(n<2)return types;
  const slot=i=>rect([mainX1,ymin+Math.floor((ymax-ymin)*i/n),mainX2,ymin+Math.floor((ymax-ymin)*(i+1)/n)]);
  const share=(type,i)=>vastuFindings([{id:'z',type,box:slot(i)}],{bearingDegrees,domainBoxes:slabs})[0].preferredShare;
  const scored=types.map((type,index)=>{
    const shares=Array.from({length:n},(_,i)=>FAVOR[type]?share(type,i):0);
    return {type,index,shares,spread:Math.max(...shares)-Math.min(...shares)};
  });
  const order=Array(n).fill(null),taken=new Set();
  // A primary bedroom outranks secondary rooms with the same spread (core Vaastu tier).
  const core=t=>['puja','kitchen','primaryBedroom'].includes(t)?1:0;
  for(const item of [...scored].filter(s=>s.spread>1e-9)
    .sort((a,b)=>core(b.type)-core(a.type)||b.spread-a.spread||a.index-b.index)){
    const free=item.shares.map((v,i)=>[v,i]).filter(([,i])=>!order[i]);
    const [,best]=free.sort((a,b)=>b[0]-a[0]||a[1]-b[1])[0];
    order[best]=item.type;taken.add(item.index);
  }
  const rest=scored.filter(s=>!taken.has(s.index)).map(s=>s.type);
  return order.map(t=>t??rest.shift());
}
// Narrow house (buildable width below ~6.5 m, common on 5–7 m Kathmandu plots):
// there is no room for a corridor beside the stair, so the front zone beside
// the stair is a pass-through living room (or a lobby on floors without one),
// and behind the stair the full width is used: a 1 m side passage on the outer
// side serves rooms stacked one behind another. Service rooms pair up side by
// side where the width allows; an attached bath follows its bedroom.
const NARROW_MIN_FRONT_MM=2000,NARROW_MIN_REAR_ROOM_MM=2400;
const serviceMin={bathroom:1500,puja:1800,store:1500,laundry:1500};
function planNarrowFloor({level,footprint,core,bearingDegrees,order='living-first'}){
  const slabs=footprint.slabs.map(rect),b=rect(core.box);
  if(slabs.length!==1)return {ok:false,reason:'Narrow layout needs a single rectangular floor.'};
  const slab=slabs[0],west=core.side==='west';
  const xmin=slab.x1,xmax=slab.x2,ymin=slab.y1,ymax=slab.y2;
  const corridorWidth=CLEAR_CORRIDOR_MM+INTERIOR_WALL_MM;
  if((west?xmax-b.x2:b.x1-xmin)<NARROW_MIN_FRONT_MM)return {ok:false,reason:'Narrow layout: the strip beside the stair is under 2 m.'};
  const rearX1=west?xmin:xmin+corridorWidth,rearX2=west?xmax-corridorWidth:xmax;
  if(rearX2-rearX1<NARROW_MIN_REAR_ROOM_MM+INTERIOR_WALL_MM)return {ok:false,reason:'Narrow layout: rooms behind the stair would be under 2.4 m wide.'};
  const corridor=rect(west?[rearX2,b.y2,xmax,ymax]:[xmin,b.y2,rearX1,ymax]);
  const {main,service}=roomTypes(level);
  const frontType=main.includes('livingRoom')?'livingRoom':'lobby';
  const rest=main.filter((t,i)=>!(t==='livingRoom'&&i===main.indexOf('livingRoom')));
  const priority=order==='bedrooms-south'?{primaryBedroom:0,bedroom:0,guestBedroom:0,kitchen:1,dining:2,study:3}:
    {kitchen:0,dining:1,primaryBedroom:2,bedroom:2,guestBedroom:2,study:3};
  rest.sort((a,c)=>(priority[a]??4)-(priority[c]??4));
  const attached=Math.min(level.attachedBathrooms||0,rest.filter(t=>/edroom/.test(t)).length);
  const shared=[...Array(Math.max(0,level.bathrooms-attached)).fill('bathroom'),
    ...(level.specialRooms||[]).filter(t=>t==='puja'||SERVICE.has(t))];
  // Rows behind the stair: main rooms, an attached bath after each of the first
  // bedrooms, then shared service rooms two to a row where both fit.
  const rows=[];let baths=attached;
  for(const t of rest){rows.push([t]);if(baths>0&&/edroom/.test(t)){rows.push(['attachedBath']);baths--;}}
  const width=rearX2-rearX1;
  for(const t of shared)rows.push([t]);// each its own row, so every room opens off the passage
  const minOf=row=>Math.max(...row.map(t=>t==='attachedBath'?1500:serviceMin[t]||minimumHeight[t]||2280));
  const available=ymax-b.y2,need=rows.reduce((n,r)=>n+minOf(r),0);
  if(need>available)return {ok:false,reason:`Narrow layout: the rooms need ${(need/1000).toFixed(1)} m behind the stair; ${(available/1000).toFixed(1)} m is available.`};
  const isMain=row=>row.length===1&&!(row[0] in serviceMin)&&row[0]!=='attachedBath';
  const mains=rows.filter(isMain).length||1,extra=available-need;
  let y=b.y2;const rooms=[];
  const frontBox=rect(west?[b.x2,ymin,xmax,b.y2]:[xmin,ymin,b.x1,b.y2]);
  rooms.push({id:`${level.id}-${frontType}-front`,levelId:level.id,type:frontType,box:frontBox,areaSqM:areaSqM([frontBox]),
    entryFrom:'shared-floor-level-arrival',openingFace:'south',openingStatus:'legal_exposure_unverified',
    ...(frontType==='lobby'?{openConnection:true,suggestedByPlanner:true,useIntent:'stair_lobby_and_family_sitting'}:{})});
  let lastBedroom=null;
  rows.forEach((row,ri)=>{
    let depth=minOf(row)+(isMain(row)?Math.floor(extra/mains):0);
    if(ri===rows.length-1)depth=ymax-y;
    row.forEach((t,ci)=>{
      const x1=rearX1+Math.round(width*ci/row.length),x2=rearX1+Math.round(width*(ci+1)/row.length);
      const box=rect([x1,y,x2,y+depth]);
      const type=t==='attachedBath'?'bathroom':t;
      const room={id:`${level.id}-${type}-${ri+1}${row.length>1?String.fromCharCode(97+ci):''}`,levelId:level.id,type,box,
        areaSqM:areaSqM([box]),entryFrom:'unit-corridor',suggestedByPlanner:false,
        openingFace:west?'west':'east',openingStatus:'legal_exposure_unverified',
        ...(type==='kitchen'&&!level.separateDiningRoom?{diningWithinKitchen:true}:{}),
        ...(type==='puja'?{privacyIntent:'owner_only_behind_unit_entry'}:{})};
      if(t==='attachedBath'){room.entryFrom='primary-bedroom';room.attachedTo=lastBedroom?.id;
        if(lastBedroom?.type!=='primaryBedroom')room.entryFrom='unit-corridor';}
      if(/edroom/.test(type))lastBedroom=room;
      rooms.push(room);
    });
    y+=depth;
  });
  const arrival=core.flights[0]?.arrivalLandings?.[0]?.box||core.entryPad;
  const front=rooms[0];
  const unitEntryDoor=arrival&&doorOnSharedEdge(rect([b.x1,arrival.y1,b.x2,arrival.y2]),front.box,{clearWidthMm:1000,endClearanceMm:50});
  if(!unitEntryDoor)return {ok:false,reason:'Narrow layout: the stair arrival cannot open into the front room.'};
  let portal=doorOnSharedEdge(front.box,corridor,{clearWidthMm:1000,endClearanceMm:0});
  if(!portal)return {ok:false,reason:'Narrow layout: the front room has no route to the side passage.'};
  for(const room of rooms.slice(1)){
    const entry=room.entryFrom==='primary-bedroom'?rooms.find(r=>r.id===room.attachedTo):
      room.entryFrom==='kitchen'?rooms.find(r=>r.type==='kitchen'):null;
    const openPortal=room.openConnection||room.type==='kitchen';
    const door=doorOnSharedEdge(room.box,entry?.box||corridor,{clearWidthMm:openPortal?1200:room.type==='bathroom'?750:900});
    if(!door)return {ok:false,reason:`Narrow layout: ${room.id} has no door to the passage.`};
    room.doorReservation={...door,from:room.entryFrom,to:room.id,
      ...(openPortal?{status:'open_portal_reserved_no_door',openingStyle:room.type==='kitchen'?'decorative_arch_optional':'open_connection'}:{leafCount:1,material:'wood'})};
  }
  for(const room of rooms){
    if(['bedroom','primaryBedroom','guestBedroom','livingRoom','study','kitchen','dining'].includes(room.type)){
      room.provisionalNaturalLightOpeningSqM=room.areaSqM*(room.type==='kitchen'?1/8:1/10);
      room.provisionalVentilationOpeningSqM=room.areaSqM/16;
      room.apertureRuleSource='NBC 206:2024 PDF page 17, hilly-region normal residential';
      const window=[room.openingFace,'north','south',west?'east':'west'].map(face=>reserveWindow(room.box,slabs,face,
        room.provisionalNaturalLightOpeningSqM)).find(Boolean);
      if(window)room.windowReservation=window;else room.openingStatus='no_physical_exterior_window_reserved';
    }
  }
  return {ok:true,levelId:level.id,occupancy:level.occupancy,rooms,corridor,parking:null,balcony:null,layout:'narrow',
    attachedBathroomsPlaced:rooms.filter(r=>r.attachedTo).length,
    circulationPortal:{...portal,status:'open_portal_reserved_no_door',openingStyle:'open_connection',from:'living-room',to:'unit-corridor'},
    unitEntry:{from:'shared-floor-level-arrival',to:frontType==='livingRoom'?'living-room':'stair-lobby',
      doorReservation:{...unitEntryDoor,leafCount:1,material:'wood'},landingAlignmentStatus:'plan_overlap_reserved_vertical_clearance_unverified'},
    vastuFindings:vastuFindings(rooms,{bearingDegrees,domainBoxes:slabs}),
    unresolved:['Narrow-plot layout: the front room is a pass-through to the side passage; side-wall windows on shared-wall plot edges are not allowed and need light from the front, rear or a lightwell.']};
}
// Narrow house with the stair set back mid-depth (Kathmandu row-house type):
// one full-width room in front of the stair, a passage beside the stair (with a
// bath at its far end when there is width), one full-width room behind it.
// The stair landing opens onto the passage, so no room is a thoroughfare.
function planMidStairFloor({level,footprint,core,bearingDegrees}){
  const slabs=footprint.slabs.map(rect),b=rect(core.box);
  if(slabs.length!==1)return {ok:false,reason:'Mid-stair layout needs a single rectangular floor.'};
  const slab=slabs[0],west=core.side==='west',xmin=slab.x1,xmax=slab.x2,ymin=slab.y1,ymax=slab.y2;
  const strip=west?xmax-b.x2:b.x1-xmin;
  if(strip<1300)return {ok:false,reason:'Mid-stair layout: the passage beside the stair is under 1.3 m.'};
  const {main}=roomTypes(level);
  const mains=[...main].sort((a,c)=>(a==='livingRoom'?0:a==='kitchen'?1:2)-(c==='livingRoom'?0:c==='kitchen'?1:2));
  const services=[...Array(Math.max(0,level.bathrooms)).fill('bathroom'),...(level.specialRooms||[]).filter(t=>SERVICE.has(t)||t==='puja')];
  const cw=services.length&&strip-1500>=1300&&strip-1500<1500?strip-1500:Math.min(strip,1500);
  const px1=west?b.x2:b.x1-cw,px2=px1+cw;
  const sideX1=west?px2:xmin,sideX2=west?xmax:px1,sideW=sideX2-sideX1;// beside the stair, away from it
  const stackX1=west?xmin:px2,stackX2=west?px1:xmax;// behind the stair, on the stair side of the passage
  const front=ymin<b.y1-1?rect([xmin,ymin,xmax,b.y1]):null;
  const rearDepth=ymax-b.y2;
  const rooms=[];const add=(type,box,extra={})=>{rooms.push({id:`${level.id}-${type}-${rooms.length+1}`,levelId:level.id,type,box,areaSqM:areaSqM([box]),
    entryFrom:'unit-corridor',suggestedByPlanner:false,openingStatus:'legal_exposure_unverified',
    ...(type==='kitchen'&&!level.separateDiningRoom?{diningWithinKitchen:true}:{}),
    ...(type==='puja'?{privacyIntent:'owner_only_behind_unit_entry'}:{}),...extra});};
  const queue=[...mains];
  if(front&&queue.length){const t=queue.shift();if(front.y2-front.y1<(minimumHeight[t]||2280))return {ok:false,reason:'Mid-stair layout: the room in front of the stair is too shallow.'};
    add(t,front,{openingFace:'south'});}
  // services beside the stair (bath at the far end, nearest the wet stack behind)
  const svc=[...services];let sideY=b.y2;
  while(svc.length&&sideW>=(svc[0]==='puja'?1900:1500)){
    const t=svc[0],d=t==='puja'?1900:1600;if(sideY-d<b.y1+(rooms.some(r=>r.box.y1===b.y1)?0:0)-1)break;
    if(sideY-d<b.y1)break;
    add(t,rect([sideX1,sideY-d,sideX2,sideY]),{openingFace:west?'east':'west'});sideY-=d;svc.shift();
    if(sideY-b.y1<1500)break;
  }
  if(sideW>=1000&&sideY-b.y1>=1200)add('lobby',rect([sideX1,b.y1,sideX2,sideY]),{openConnection:true,suggestedByPlanner:true,
    useIntent:'stair_lobby_and_family_sitting',openingFace:west?'east':'west'});
  // behind the stair
  let corridor=rect([px1,b.y1,px2,b.y2]);
  if(queue.length===1&&!svc.length){
    if(rearDepth<(minimumHeight[queue[0]]||2280))return {ok:false,reason:'Mid-stair layout: the room behind the stair is too shallow.'};
    add(queue.shift(),rect([xmin,b.y2,xmax,ymax]),{openingFace:'north'});
  }else if(queue.length||svc.length){
    // the passage carries on to the back; rooms stack along it
    corridor=rect([px1,b.y1,px2,ymax]);
    const farX1=west?px2:xmin,farX2=west?xmax:px1,farW=farX2-farX1;
    const farSvc=farW>=1500?svc.filter(t=>t!=='puja'||farW>=1900):[];
    const nearList=[...queue,...svc.filter(t=>!farSvc.includes(t))];
    const minD=t=>t==='bathroom'?1500:t==='puja'?1900:SERVICE.has(t)?1500:(minimumHeight[t]||2280);
    const need=nearList.reduce((n,t)=>n+minD(t),0);
    if(stackX2-stackX1<1500)return {ok:false,reason:'Mid-stair layout: no width behind the stair for rooms.'};
    if(need>rearDepth)return {ok:false,reason:`Mid-stair layout: the rooms need ${(need/1000).toFixed(1)} m behind the stair; ${(rearDepth/1000).toFixed(1)} m is available.`};
    const mainsNear=nearList.filter(t=>!(t in serviceMin)).length||1,extra=rearDepth-need;let y=b.y2;
    nearList.forEach((t,i)=>{let d=minD(t)+(t in serviceMin?0:Math.floor(extra/mainsNear));if(i===nearList.length-1)d=ymax-y;
      add(t,rect([stackX1,y,stackX2,y+d]),{openingFace:i===nearList.length-1?'north':west?'west':'east'});y+=d;});
    let fy=ymax;
    for(const t of farSvc){const d=minD(t);if(fy-d<b.y2)return {ok:false,reason:'Mid-stair layout: service rooms do not fit behind the stair.'};
      add(t,rect([farX1,fy-d,farX2,fy]),{openingFace:'north'});fy-=d;}
  }
  if(queue.length&&!rooms.some(r=>r.type===queue[0]))return {ok:false,reason:`Mid-stair layout: ${mains.length} main rooms do not fit.`};
  const arrival=core.flights[0]?.arrivalLandings?.[0]?.box||core.entryPad;
  const unitEntryDoor=arrival&&doorOnSharedEdge(rect([b.x1,b.y1,b.x2,arrival.y2]),corridor,{clearWidthMm:1000,endClearanceMm:50});
  if(!unitEntryDoor)return {ok:false,reason:'Mid-stair layout: the landing cannot open onto the passage.'};
  for(const room of rooms){
    const openPortal=room.openConnection||room.type==='kitchen';
    const door=doorOnSharedEdge(room.box,corridor,{clearWidthMm:openPortal?1200:room.type==='bathroom'?750:900,
      endClearanceMm:openPortal||room.type==='bathroom'?50:150});
    if(!door)return {ok:false,reason:`Mid-stair layout: ${room.id} has no door to the passage.`};
    room.doorReservation={...door,from:'unit-corridor',to:room.id,
      ...(openPortal?{status:'open_portal_reserved_no_door',openingStyle:'open_connection'}:{leafCount:1,material:'wood'})};
    if(['bedroom','primaryBedroom','guestBedroom','livingRoom','study','kitchen','dining'].includes(room.type)){
      room.provisionalNaturalLightOpeningSqM=room.areaSqM*(room.type==='kitchen'?1/8:1/10);
      room.provisionalVentilationOpeningSqM=room.areaSqM/16;
      room.apertureRuleSource='NBC 206:2024 PDF page 17, hilly-region normal residential';
      const window=[room.openingFace,'south','north',west?'west':'east'].map(face=>reserveWindow(room.box,slabs,face,room.provisionalNaturalLightOpeningSqM)).find(Boolean);
      if(window)room.windowReservation=window;else room.openingStatus='no_physical_exterior_window_reserved';
    }
  }
  const attached=Math.min(level.attachedBathrooms||0,1);
  return {ok:true,levelId:level.id,occupancy:level.occupancy,rooms,corridor,parking:null,balcony:null,layout:'narrow-mid-stair',
    attachedBathroomsPlaced:0,circulationPortal:null,
    unitEntry:{from:'shared-floor-level-arrival',to:'unit-corridor',doorReservation:{...unitEntryDoor,leafCount:1,material:'wood'},
      landingAlignmentStatus:'plan_overlap_reserved_vertical_clearance_unverified'},
    vastuFindings:vastuFindings(rooms,{bearingDegrees,domainBoxes:slabs}),
    unresolved:['Mid-stair narrow layout: rooms take light from the front and rear walls; side walls on shared plot edges cannot have windows.',
      ...(attached?['Attached bath requested: on this narrow floor the bath opens from the passage.']:[])]};
}
// Wide, shallow house (building depth 6–7.5 m): rooms cannot stack behind the
// 4.6 m stair, so a 1.6 m gallery runs along the front from the stair landing
// and the rooms stand side by side behind it, each opening off the gallery and
// lit from the rear wall. Space behind the stair becomes a store/utility.
function planShallowFloor({level,footprint,core,bearingDegrees}){
  const slabs=footprint.slabs.map(rect),b=rect(core.box);
  if(slabs.length!==1)return {ok:false,reason:'Shallow layout needs a single rectangular floor.'};
  const slab=slabs[0],west=core.side==='west',xmin=slab.x1,xmax=slab.x2,ymin=slab.y1,ymax=slab.y2;
  const gallery=1600,depth=ymax-ymin-gallery;// the depth of the stair landing, so its door clears the corner column
  if(depth<2500)return {ok:false,reason:'Shallow layout: rooms behind the front gallery would be under 2.5 m deep.'};
  const rx1=west?b.x2:xmin,rx2=west?xmax:b.x1;
  const corridor=rect([rx1,ymin,rx2,ymin+gallery]);
  const {main}=roomTypes(level);
  const order=[...main].sort((a,c)=>(a==='livingRoom'?0:a==='kitchen'?1:2)-(c==='livingRoom'?0:c==='kitchen'?1:2));
  const services=[...Array(Math.max(0,level.bathrooms)).fill('bathroom'),...(level.specialRooms||[]).filter(t=>SERVICE.has(t)||t==='puja')];
  // living next to the stair, then kitchen with the wet rooms, then bedrooms
  const kitchenAt=order.indexOf('kitchen');
  const seq=kitchenAt>=0?[...order.slice(0,kitchenAt+1),...services,...order.slice(kitchenAt+1)]:[...order,...services];
  const minW=t=>t==='bathroom'?1500:t==='puja'?1900:SERVICE.has(t)?1500:t==='livingRoom'?3000:2800;
  const need=seq.reduce((n,t)=>n+minW(t),0),avail=rx2-rx1;
  if(need>avail)return {ok:false,reason:`Shallow layout: the rooms need ${(need/1000).toFixed(1)} m of frontage beside the stair; ${(avail/1000).toFixed(1)} m is available.`};
  const mains=seq.filter(t=>!(t in serviceMin)).length||1,extra=avail-need;
  const rooms=[];let x=west?rx1:rx2;
  seq.forEach((t,i)=>{let w=minW(t)+(t in serviceMin?0:Math.floor(extra/mains));if(i===seq.length-1)w=west?rx2-x:x-rx1;
    const box=west?rect([x,ymin+gallery,x+w,ymax]):rect([x-w,ymin+gallery,x,ymax]);x=west?x+w:x-w;
    rooms.push({id:`${level.id}-${t}-${i+1}`,levelId:level.id,type:t,box,areaSqM:areaSqM([box]),entryFrom:'unit-corridor',suggestedByPlanner:false,
      openingFace:'north',openingStatus:'legal_exposure_unverified',...(t==='kitchen'&&!level.separateDiningRoom?{diningWithinKitchen:true}:{}),
      ...(t==='puja'?{privacyIntent:'owner_only_behind_unit_entry'}:{})});});
  // store behind the stair, reached from the living room or kitchen beside it
  // (2 m deep so its door clears the two corner columns)
  if(ymax-b.y2>=2000&&['livingRoom','kitchen'].includes(rooms[0]?.type)){const nb=rect([b.x1,b.y2,b.x2,ymax]);const nextTo=rooms[0];
    rooms.push({id:`${level.id}-serviceNiche-rear`,levelId:level.id,type:'serviceNiche',box:nb,areaSqM:areaSqM([nb]),entryFrom:nextTo.type==='kitchen'?'kitchen':'living-room',
      suggestedByPlanner:true,openingFace:'north',openingStatus:'legal_exposure_unverified',useIntent:'store_behind_stair'});}
  const arrival=core.flights[0]?.arrivalLandings?.[0]?.box||core.entryPad;
  const unitEntryDoor=arrival&&doorOnSharedEdge(rect([b.x1,b.y1,b.x2,arrival.y2]),corridor,{clearWidthMm:1000,endClearanceMm:50});
  if(!unitEntryDoor)return {ok:false,reason:'Shallow layout: the stair landing cannot open onto the front gallery.'};
  for(const room of rooms){
    const entry=room.entryFrom==='kitchen'?rooms.find(r=>r.type==='kitchen'):room.entryFrom==='living-room'?rooms.find(r=>r.type==='livingRoom')||rooms[0]:null;
    const openPortal=room.type==='kitchen';
    const door=doorOnSharedEdge(room.box,entry?.box||corridor,{clearWidthMm:openPortal?1200:room.type==='bathroom'?750:900,endClearanceMm:50});
    if(!door){if(room.type==='serviceNiche'){rooms.splice(rooms.indexOf(room),1);continue;}
      return {ok:false,reason:`Shallow layout: ${room.id} has no door.`};}
    room.doorReservation={...door,from:room.entryFrom,to:room.id,...(openPortal?{status:'open_portal_reserved_no_door',openingStyle:'decorative_arch_optional'}:{leafCount:1,material:'wood'})};
    if(['bedroom','primaryBedroom','guestBedroom','livingRoom','study','kitchen','dining'].includes(room.type)){
      room.provisionalNaturalLightOpeningSqM=room.areaSqM*(room.type==='kitchen'?1/8:1/10);
      room.provisionalVentilationOpeningSqM=room.areaSqM/16;
      room.apertureRuleSource='NBC 206:2024 PDF page 17, hilly-region normal residential';
      const window=['north',west?'east':'west','south'].map(face=>reserveWindow(room.box,slabs,face,room.provisionalNaturalLightOpeningSqM)).find(Boolean);
      if(window)room.windowReservation=window;else room.openingStatus='no_physical_exterior_window_reserved';
    }
  }
  return {ok:true,levelId:level.id,occupancy:level.occupancy,rooms,corridor,parking:null,balcony:null,layout:'shallow-front-gallery',
    attachedBathroomsPlaced:0,circulationPortal:null,
    unitEntry:{from:'shared-floor-level-arrival',to:'unit-corridor',doorReservation:{...unitEntryDoor,leafCount:1,material:'wood'},
      landingAlignmentStatus:'plan_overlap_reserved_vertical_clearance_unverified'},
    vastuFindings:vastuFindings(rooms,{bearingDegrees,domainBoxes:slabs}),
    unresolved:['Shallow-plot layout: a front gallery serves rooms side by side; rooms are lit from the rear wall, the gallery from the front.',
      ...(level.attachedBathrooms?['Attached bath requested: on this shallow floor baths open from the gallery.']:[])]};
}
function planFloorRooms(args){
  if(args.core.position!=='middle'&&(args.buildingDepthMm??Infinity)<7500)return planShallowFloor(args);
  if(args.core.position==='middle')return planMidStairFloor(args);
  const {footprint,core}=args,b=rect(core.box),slabs=footprint.slabs.map(rect);
  const xmin=Math.min(...slabs.map(s=>s.x1)),xmax=Math.max(...slabs.map(s=>s.x2));
  const strip=(core.side==='west'?xmax-b.x2:b.x1-xmin)-(CLEAR_CORRIDOR_MM+INTERIOR_WALL_MM);
  // Narrow layouts are for narrow buildings; a partial top floor of a normal
  // house keeps the strip planner (and its puja re-planning) even when small.
  const narrowBuilding=(args.buildingWidthMm??xmax-xmin)<6500+INTERIOR_WALL_MM;
  if(!narrowBuilding)return planStripFloor(args);
  if(strip<2500)return planNarrowFloor(args);
  const r=planStripFloor(args);
  // Strip layout too tight (e.g. many rooms on a small floor): try the narrow
  // stacked layout before giving up.
  if(!r.ok&&strip<3500&&slabs.length===1&&!args.pujaInMainStrip){const n=planNarrowFloor(args);if(n.ok)return n;}
  return r;
}
function planStripFloor({level,footprint,core,bearingDegrees,order='living-first',
  groundParking=null,pujaInMainStrip=false,toiletBoxesAdjacent=[],pujaBoxesBelow=[],avoidColumnBoxes=[]}) {
  if(level.occupancy==='owner'&&level.bedrooms===3&&level.bathrooms===1&&
    level.attachedBathrooms===1&&!level.livingRooms&&!level.kitchens){
    const owner=planOwnerBedroomFloor({level,footprint,core,bearingDegrees,pujaBoxesBelow});
    if(owner)return owner;
  }
  // A whole 2-bedroom home on one owner floor (e.g. a single-storey house) uses
  // the same compact two-by-two flat as a rental floor; the single-strip planner
  // below cannot stack living, kitchen and bedrooms along one frontage.
  const ownerFlat=level.occupancy==='owner'&&level.bedrooms===2&&!level.attachedBathrooms;
  if((level.occupancy==='rental'&&(level.bedrooms===2||level.bedrooms===1&&groundParking?.bikes>0)||ownerFlat)&&
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
  let types=main.map((type,index)=>({type,index})).sort((a,b)=>
    (priority[a.type]??4)-(priority[b.type]??4)||a.index-b.index).map(item=>item.type);
  if(order==='vastu-zones')types=zoneFirstOrder(types,{mainX1,mainX2,ymin,ymax,slabs,bearingDegrees});
  // Owner convention: the unit entrance opens into living. Keep living in the slot
  // at the stair arrival and zone-order only the remaining rooms.
  if(order==='vastu-zones-entry'&&types.includes('livingRoom')){
    const rest=types.filter((t,i)=>i!==types.indexOf('livingRoom'));
    const first=Math.floor((ymax-ymin)/types.length);
    types=['livingRoom',...zoneFirstOrder(rest,{mainX1,mainX2,ymin:ymin+first,ymax,slabs,bearingDegrees})];
  }
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
  const directLiving=(order==='living-first'||order==='vastu-zones-entry')&&living&&living.box.y1===ymin&&
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
  const arrival=core.flights[0]?.arrivalLandings?.[0]?.box||core.entryPad;
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
module.exports={roomTypes,planFloorRooms,planNarrowFloor,PUJA_MAIN_STRIP_MIN_WIDTH_MM,overlapSqM};
