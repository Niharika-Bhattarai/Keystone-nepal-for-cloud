'use strict';
const {rect,areaSqM}=require('./areaLedger');
const {exposedVerticalSegments,exposedHorizontalSegments}=require('./spatialReservations');
const {INTERIOR_WALL_MM,EXTERIOR_WALL_MM}=require('./constructionProfile');

function sharedEdge(a,b){
  const x=a.x2===b.x1?a.x2:a.x1===b.x2?a.x1:null;
  if(x!==null){const start=Math.max(a.y1,b.y1),end=Math.min(a.y2,b.y2);
    if(end>start)return {axis:'vertical',line:x,start,end};}
  const y=a.y2===b.y1?a.y2:a.y1===b.y2?a.y1:null;
  if(y!==null){const start=Math.max(a.x1,b.x1),end=Math.min(a.x2,b.x2);
    if(end>start)return {axis:'horizontal',line:y,start,end};}
  return null;
}
function wallBox(wall,start,end){
  const t=wall.thicknessMm;
  if(wall.axis==='vertical'){
    const x1=wall.kind==='exterior'?(wall.face==='west'?wall.line:wall.line-t):wall.line-t/2;
    return rect([x1,start,x1+t,end]);
  }
  const y1=wall.kind==='exterior'?(wall.face==='south'?wall.line:wall.line-t):wall.line-t/2;
  return rect([start,y1,end,y1+t]);
}
function openingOnWall(opening,wall){
  if(opening.axis!==wall.axis)return null;
  const line=opening.axis==='vertical'?opening.x:opening.y;
  if(line!==wall.line)return null;
  const start=opening.axis==='vertical'?opening.y1:opening.x1;
  const end=opening.axis==='vertical'?opening.y2:opening.x2;
  const overlapStart=Math.max(start,wall.start),overlapEnd=Math.min(end,wall.end);
  return overlapEnd>overlapStart?{start:overlapStart,end:overlapEnd,opening}:null;
}
function buildWallGeometry({footprint,rooms,corridor,core,grid,unitEntryDoor,
  circulationPortal=null,siteEntryDoor=null,openParking=null,
  openBalcony=null,balconyDoor=null,crossHall=null,crossHallPortal=null}){
  const slabs=footprint.slabs.map(rect),zones=[...rooms.map(r=>rect(r.box)),
    ...(corridor?[rect(corridor)]:[]),
    ...(crossHall?[rect(crossHall)]:[]),rect(core.box)];
  const parking=openParking?rect(openParking):null;
  const openZones=[parking,openBalcony?rect(openBalcony):null].filter(Boolean);
  const wallMap=new Map();
  function add(wall){
    const key=[wall.kind,wall.axis,wall.line,wall.start,wall.end].join(':');
    if(!wallMap.has(key))wallMap.set(key,{...wall,id:`W-${wallMap.size+1}`});
  }
  function addSiteWall(wall){
    let intervals=[[wall.start,wall.end]];
    for(const open of openZones){
      const cut=wall.axis==='vertical'&&[open.x1,open.x2].includes(wall.line)?
        [open.y1,open.y2]:wall.axis==='horizontal'&&
        [open.y1,open.y2].includes(wall.line)?[open.x1,open.x2]:null;
      if(cut)intervals=intervals.flatMap(([start,end])=>[
        ...(start<cut[0]?[[start,Math.min(end,cut[0])]]:[]),
        ...(end>cut[1]?[[Math.max(start,cut[1]),end]]:[])]);
    }
    for(const [start,end] of intervals)if(end>start)add({...wall,start,end});
  }
  for(const slab of slabs){
    for(const face of ['west','east'])for(const s of exposedVerticalSegments(slab,slabs,face))
      addSiteWall({kind:'exterior',axis:'vertical',face,line:s.x,start:s.y1,end:s.y2,
        thicknessMm:EXTERIOR_WALL_MM});
    for(const face of ['south','north'])for(const s of exposedHorizontalSegments(slab,slabs,face))
      addSiteWall({kind:'exterior',axis:'horizontal',face,line:s.y,start:s.x1,end:s.x2,
        thicknessMm:EXTERIOR_WALL_MM});
  }
  for(const open of openZones)for(const zone of zones){
    const edge=sharedEdge(zone,open);
    if(!edge)continue;
    const face=edge.axis==='vertical'?
      (zone.x2===open.x1?'east':'west'):
      (zone.y2===open.y1?'north':'south');
    add({kind:'exterior',...edge,face,thicknessMm:EXTERIOR_WALL_MM});
  }
  for(let i=0;i<zones.length;i++)for(let j=i+1;j<zones.length;j++){
    const edge=sharedEdge(zones[i],zones[j]);
    if(edge)add({kind:'interior',...edge,thicknessMm:INTERIOR_WALL_MM});
  }
  const openings=[...rooms.flatMap(room=>[room.doorReservation,room.serviceExitDoor,
    ...(room.windowReservations||[room.windowReservation])].filter(Boolean)),
    ...(unitEntryDoor?[unitEntryDoor]:[]),...(circulationPortal?[circulationPortal]:[]),
    ...(crossHallPortal?[crossHallPortal]:[]),
    ...(balconyDoor?[balconyDoor]:[]),
    ...(siteEntryDoor?[siteEntryDoor]:[])];
  const walls=[...wallMap.values()].map(wall=>{
    const cuts=openings.map(o=>openingOnWall(o,wall)).filter(Boolean)
      .sort((a,b)=>a.start-b.start||a.end-b.end);
    const solidBoxes=[],openingBoxes=[];let cursor=wall.start;
    for(const cut of cuts){
      if(cut.start>cursor)solidBoxes.push(wallBox(wall,cursor,cut.start));
      if(cut.end>cursor)openingBoxes.push({...cut,box:wallBox(wall,Math.max(cursor,cut.start),cut.end)});
      cursor=Math.max(cursor,cut.end);
    }
    if(cursor<wall.end)solidBoxes.push(wallBox(wall,cursor,wall.end));
    return {...wall,solidBoxes,openingBoxes};
  });
  const exteriorFace=(box,face)=>{
    if(openZones.some(open=>sharedEdge(box,open)?.axis===
      (['west','east'].includes(face)?'vertical':'horizontal')&&
      (face==='west'&&box.x1===open.x2||face==='east'&&box.x2===open.x1||
        face==='south'&&box.y1===open.y2||face==='north'&&box.y2===open.y1)))
      return true;
    const segments=['west','east'].includes(face)?exposedVerticalSegments(box,slabs,face):
      exposedHorizontalSegments(box,slabs,face);
    return segments.length>0;
  };
  for(const room of rooms){
    const box=rect(room.box);
    const clearBox=rect([
      box.x1+(exteriorFace(box,'west')?EXTERIOR_WALL_MM:INTERIOR_WALL_MM/2),
      box.y1+(exteriorFace(box,'south')?EXTERIOR_WALL_MM:INTERIOR_WALL_MM/2),
      box.x2-(exteriorFace(box,'east')?EXTERIOR_WALL_MM:INTERIOR_WALL_MM/2),
      box.y2-(exteriorFace(box,'north')?EXTERIOR_WALL_MM:INTERIOR_WALL_MM/2)]);
    room.clearBox=clearBox;
    room.clearAreaSqM=areaSqM([clearBox]);
  }
  const columnWallConflicts=[];
  for(const wall of walls.filter(w=>w.kind==='interior'))for(const column of grid.columns){
    const half=column.widthMm/2,axis=wall.axis==='vertical'?column.xMm:column.yMm;
    const along=wall.axis==='vertical'?column.yMm:column.xMm;
    if(Math.abs(wall.line-axis)<half-wall.thicknessMm/2&&
      wall.end>along-half&&wall.start<along+half)
      columnWallConflicts.push({wallId:wall.id,columnId:column.id});
  }
  const openingColumnConflicts=[];
  for(const wall of walls)for(const hole of wall.openingBoxes)for(const column of grid.columns){
    const h=column.widthMm/2,c=rect([column.xMm-h,column.yMm-h,column.xMm+h,column.yMm+h]);
    if(Math.min(c.x2,hole.box.x2)>Math.max(c.x1,hole.box.x1)&&
      Math.min(c.y2,hole.box.y2)>Math.max(c.y1,hole.box.y1))
      openingColumnConflicts.push({wallId:wall.id,columnId:column.id,opening:hole.opening});
  }
  return {walls,nominalInteriorWallMm:INTERIOR_WALL_MM,nominalExteriorWallMm:EXTERIOR_WALL_MM,
    corridorClearWidthMm:corridor?corridor.x2-corridor.x1-INTERIOR_WALL_MM:
      crossHall?crossHall.y2-crossHall.y1-INTERIOR_WALL_MM:0,
    columnWallConflicts,openingColumnConflicts,
    status:'nominal_wall_reservations_openings_and_structure_not_detailed'};
}
module.exports={buildWallGeometry,sharedEdge};
