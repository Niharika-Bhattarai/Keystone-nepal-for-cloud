'use strict';
const {rect,areaSqM}=require('./areaLedger');
const {planHalfTurn}=require('./stairProfile');
function reserveCore({footprint,levels,side='west',tankLitres=8000,stairWidthMm=1000}) {
  if(!Number.isSafeInteger(tankLitres)||tankLitres<5000) throw new Error('Reservoir must hold at least 5,000 L for a full delivery truck');
  const slabs=footprint.slabs.map(rect),b={x1:Math.min(...slabs.map(s=>s.x1)),y1:Math.min(...slabs.map(s=>s.y1)),
    x2:Math.max(...slabs.map(s=>s.x2)),y2:Math.max(...slabs.map(s=>s.y2))};
  // 3 m storey: 16 risers, 8 per flight, 7 x 255 mm tread run. With the
  // 1.4 m arrival pad and 1 m landing this is a 4,585 mm dedicated bay;
  // 350 mm corner columns have a 4,235 mm axis span (< 14 ft preference).
  // Taller storeys need more risers: the bay grows by one tread per extra riser
  // per flight (190 mm max riser, 255 mm tread; stairProfile.js).
  const maxRise=Math.max(0,...levels.slice(1).map((l,i)=>l.elevationMm-levels[i].elevationMm));
  const perFlight=Math.ceil(Math.ceil(maxRise/190)/2);
  const coreWidth=2600,coreLength=Math.max(4585,1400+(perFlight-1)*255+1000+400);
  const x1=side==='east'?b.x2-coreWidth:b.x1;
  if(!['east','west'].includes(side))throw new Error('Only east/west continuous core reservations are implemented');
  const box=rect([x1,b.y1,x1+coreWidth,b.y1+coreLength]);
  if(areaSqM([box],slabs)>1e-9)throw new Error('Shared core does not fit within this footprint');
  if(!Array.isArray(levels)||!levels.length)throw new Error('Physical levels required');
  const siteEntry={axis:'horizontal',y:box.y1,x1:box.x1+700,x2:box.x2-700,
    clearWidthMm:1200,leafCount:2,material:'wood',
    status:'ground_entrance_reserved_external_landing_and_swing_unverified'};
  const flights=[];
  for(let i=0;i<levels.length-1;i++){
    const rise=levels[i+1].elevationMm-levels[i].elevationMm;
    flights.push({from:levels[i].id,to:levels[i+1].id,
      ...planHalfTurn({riseMm:rise,core:box,clearWidthMm:stairWidthMm,treadMm:255})});
  }
  const innerWidthMm=2100,innerLengthMm=3900,wetDepthMm=Math.ceil(tankLitres*1e6/(innerWidthMm*innerLengthMm));
  if(wetDepthMm>2000)throw new Error('Requested reservoir exceeds this under-stair reservation; choose a larger separate tank location');
  const reservoir={id:'ground-reservoir',location:'below-ground-stair-core',
    targetLitres:tankLitres,netVolumeLitres:innerWidthMm*innerLengthMm*wetDepthMm/1e6,
    innerWidthMm,innerLengthMm,wetDepthMm,freeboardMm:200,
    innerPlanBox:rect([box.x1+250,box.y1+500,box.x1+250+innerWidthMm,box.y1+500+innerLengthMm]),
    accessHatch:{box:rect([box.x1+1000,box.y2-1300,box.x1+1600,box.y2-700]),
      clearanceStatus:'requires_stair_and_structural_review'},
    warning:'Tank access, waterproofing, soil pressure and foundation separation require professional detailing.'};
  // A single-storey house has no flight yet: the core bay is its entrance hall
  // over the reservoir, kept free for a stair when floors are added later.
  const entryPad=flights.length?null:rect([box.x1+200,box.y1+200,box.x2-200,box.y1+1600]);
  return {id:`shared-core-${side}`,side,box,siteEntry,levelIds:levels.map(l=>l.id),flights,entryPad,
    ...(flights.length?{}:{futureStairReserved:true}),
    rentalEntries:levels.filter(l=>l.occupancy==='rental').map(l=>({levelId:l.id,from:'shared-landing',to:`${l.id}-unit-entry`})),
    reservoir,continuity:flights.length===levels.length-1};
}
module.exports={reserveCore};
