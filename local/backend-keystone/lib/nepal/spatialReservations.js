'use strict';
const {rect}=require('./areaLedger');

// This module reserves openings in an abstract wall line. It does not certify
// wall thickness, fire separation, door swing, legal light, or egress.
function sharedVerticalEdge(a,b) {
  const left=rect(a),right=rect(b);
  const x=left.x2===right.x1?left.x2:left.x1===right.x2?left.x1:null;
  if(x===null)return null;
  const y1=Math.max(left.y1,right.y1),y2=Math.min(left.y2,right.y2);
  return y2>y1?{x,y1,y2}:null;
}
function sharedHorizontalEdge(a,b) {
  const lower=rect(a),upper=rect(b);
  const y=lower.y2===upper.y1?lower.y2:lower.y1===upper.y2?lower.y1:null;
  if(y===null)return null;
  const x1=Math.max(lower.x1,upper.x1),x2=Math.min(lower.x2,upper.x2);
  return x2>x1?{y,x1,x2}:null;
}
function doorOnSharedEdge(a,b,{clearWidthMm=900,endClearanceMm=150,
  avoidBoxes=[],preferredCenterMm=null}={}) {
  const vertical=sharedVerticalEdge(a,b),edge=vertical||sharedHorizontalEdge(a,b);
  if(!edge)return null;
  const low=vertical?edge.y1:edge.x1,high=vertical?edge.y2:edge.x2;
  if(high-low<clearWidthMm+2*endClearanceMm)return null;
  const minimum=low+endClearanceMm,maximum=high-endClearanceMm-clearWidthMm;
  const preferred=preferredCenterMm??(low+high)/2;
  const blocked=avoidBoxes.map(rect).filter(box=>vertical?
    box.x1<=edge.x+51&&box.x2>=edge.x-51:
    box.y1<=edge.y+51&&box.y2>=edge.y-51)
    .map(box=>({start:(vertical?box.y1:box.x1)-50,end:(vertical?box.y2:box.x2)+50}));
  const starts=new Set([minimum,maximum,Math.max(minimum,Math.min(maximum,
    Math.round(preferred-clearWidthMm/2)))]);
  for(const box of blocked){starts.add(Math.max(minimum,Math.min(maximum,box.end)));
    starts.add(Math.max(minimum,Math.min(maximum,box.start-clearWidthMm)));}
  const y1=[...starts].filter(start=>blocked.every(box=>start+clearWidthMm<=box.start||start>=box.end))
    .sort((a,b)=>Math.abs(a+clearWidthMm/2-preferred)-
      Math.abs(b+clearWidthMm/2-preferred)||a-b)[0];
  if(y1===undefined)return null;
  return vertical?{axis:'vertical',x:edge.x,y1,y2:y1+clearWidthMm,
    clearWidthMm,status:'opening_reserved_swing_unverified'}:
    {axis:'horizontal',y:edge.y,x1:y1,x2:y1+clearWidthMm,
      clearWidthMm,status:'opening_reserved_swing_unverified'};
}
function exposedVerticalSegments(box,slabs,face) {
  if(!['east','west'].includes(face))throw new TypeError('Expected east or west face');
  const room=rect(box),building=slabs.map(rect),x=face==='east'?room.x2:room.x1;
  const cuts=new Set([room.y1,room.y2]);
  for(const slab of building){
    if(slab.y1>room.y1&&slab.y1<room.y2)cuts.add(slab.y1);
    if(slab.y2>room.y1&&slab.y2<room.y2)cuts.add(slab.y2);
  }
  const ys=[...cuts].sort((a,b)=>a-b),segments=[];
  for(let i=0;i<ys.length-1;i++){
    const y=(ys[i]+ys[i+1])/2,insideX=x+(face==='east'?0.5:-0.5);
    if(!building.some(s=>s.x1<=insideX&&insideX<s.x2&&s.y1<=y&&y<s.y2)){
      const previous=segments[segments.length-1];
      if(previous&&previous.y2===ys[i])previous.y2=ys[i+1];
      else segments.push({x,y1:ys[i],y2:ys[i+1],face});
    }
  }
  return segments;
}
function exposedHorizontalSegments(box,slabs,face) {
  if(!['north','south'].includes(face))throw new TypeError('Expected north or south face');
  const room=rect(box),building=slabs.map(rect),y=face==='north'?room.y2:room.y1;
  const cuts=new Set([room.x1,room.x2]);
  for(const slab of building){
    if(slab.x1>room.x1&&slab.x1<room.x2)cuts.add(slab.x1);
    if(slab.x2>room.x1&&slab.x2<room.x2)cuts.add(slab.x2);
  }
  const xs=[...cuts].sort((a,b)=>a-b),segments=[];
  for(let i=0;i<xs.length-1;i++){
    const x=(xs[i]+xs[i+1])/2,insideY=y+(face==='north'?0.5:-0.5);
    if(!building.some(s=>s.x1<=x&&x<s.x2&&s.y1<=insideY&&insideY<s.y2)){
      const previous=segments[segments.length-1];
      if(previous&&previous.x2===xs[i])previous.x2=xs[i+1];
      else segments.push({y,x1:xs[i],x2:xs[i+1],face});
    }
  }
  return segments;
}
function reserveWindow(box,slabs,face,requiredAreaSqM,
  {assumedClearHeightMm=1200,endClearanceMm=300,avoidBoxes=[]}={}) {
  if(!Number.isFinite(requiredAreaSqM)||requiredAreaSqM<=0)
    throw new TypeError('Positive provisional opening area required');
  const widthMm=Math.ceil(requiredAreaSqM*1e6/assumedClearHeightMm);
  const vertical=['east','west'].includes(face);
  const exposed=vertical?exposedVerticalSegments(box,slabs,face):exposedHorizontalSegments(box,slabs,face);
  const free=[];
  for(const segment of exposed){
    const coordinate=vertical?segment.x:segment.y;
    const start=(vertical?segment.y1:segment.x1)+endClearanceMm;
    const end=(vertical?segment.y2:segment.x2)-endClearanceMm;
    const blocks=avoidBoxes.map(rect).filter(b=>vertical?
      b.x1<=coordinate+229&&b.x2>=coordinate-229:
      b.y1<=coordinate+229&&b.y2>=coordinate-229)
      .map(b=>({start:(vertical?b.y1:b.x1)-50,end:(vertical?b.y2:b.x2)+50}))
      .sort((a,b)=>a.start-b.start);
    let cursor=start;
    for(const block of blocks){
      if(block.end<=cursor)continue;
      const availableEnd=Math.min(end,block.start);
      if(availableEnd-cursor>=widthMm)free.push({segment,start:cursor,end:availableEnd});
      cursor=Math.min(end,Math.max(cursor,block.end));
      if(cursor>=end)break;
    }
    if(end-cursor>=widthMm)free.push({segment,start:cursor,end});
  }
  const chosen=free.sort((a,b)=>(b.end-b.start)-(a.end-a.start))[0];
  if(!chosen)return null;
  const segment=chosen.segment;
  const start=chosen.start+Math.floor((chosen.end-chosen.start-widthMm)/2);
  return {axis:vertical?'vertical':'horizontal',face,
    ...(vertical?{x:segment.x,y1:start,y2:start+widthMm}:{y:segment.y,x1:start,x2:start+widthMm}),
    clearWidthMm:widthMm,assumedClearHeightMm,
    provisionalClearAreaSqM:widthMm*assumedClearHeightMm/1e6,
    status:'physical_exposure_reserved_legal_and_daylight_unverified'};
}
module.exports={sharedVerticalEdge,doorOnSharedEdge,exposedVerticalSegments,
  exposedHorizontalSegments,reserveWindow};
