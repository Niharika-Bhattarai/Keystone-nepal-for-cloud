'use strict';
const {rect,areaSqM}=require('./areaLedger');
const {exposedVerticalSegments,exposedHorizontalSegments}=require('./spatialReservations');

const MIN_DEPTH_MM=305;
const MAX_DEPTH_MM=610;
const EDGE_REMAINDER_MM=50;

// Geometric review reservation only. Projection into a setback is not proof
// that the municipality permits it or that a cantilever is engineered.
function reserveRainChajjas(footprint,site){
  const slabs=footprint.slabs.map(rect),parcel=rect(site),segments=[];
  for(const slab of slabs){
    for(const face of ['west','east'])segments.push(...exposedVerticalSegments(slab,slabs,face));
    for(const face of ['south','north'])segments.push(...exposedHorizontalSegments(slab,slabs,face));
  }
  const reservations=[],omitted=[];
  for(const segment of segments){
    const {face}=segment;
    const wallCoordinate=face==='west'||face==='east'?segment.x:segment.y;
    const available=face==='west'?wallCoordinate-parcel.x1:
      face==='east'?parcel.x2-wallCoordinate:
        face==='south'?wallCoordinate-parcel.y1:parcel.y2-wallCoordinate;
    const depthMm=Math.min(MAX_DEPTH_MM,Math.max(0,available-EDGE_REMAINDER_MM));
    if(depthMm<MIN_DEPTH_MM){omitted.push({face,segment,availableMm:available,
      reason:'less_than_305_mm_projection_remains_inside_plot'});continue;}
    const box=rect(face==='west'?[wallCoordinate-depthMm,segment.y1,wallCoordinate,segment.y2]:
      face==='east'?[wallCoordinate,segment.y1,wallCoordinate+depthMm,segment.y2]:
        face==='south'?[segment.x1,wallCoordinate-depthMm,segment.x2,wallCoordinate]:
          [segment.x1,wallCoordinate,segment.x2,wallCoordinate+depthMm]);
    if(areaSqM([box],[parcel])>1e-9||areaSqM([box],slabs)<areaSqM([box])-1e-9){
      omitted.push({face,segment,availableMm:available,
        reason:'projection_crosses_plot_or_another_floor_slab'});continue;}
    reservations.push({face,wallSegment:segment,box,depthMm,
      status:'geometric_projection_only_setback_area_drainage_and_structure_unverified'});
  }
  // Join perpendicular exposed strips at their common convex corner. Never
  // bridge a re-entrant void or extend past a flush parcel edge.
  const cornerReservations=[];
  for(const v of reservations.filter(r=>['west','east'].includes(r.face)))
    for(const h of reservations.filter(r=>['south','north'].includes(r.face))){
      const x=v.wallSegment.x,y=h.wallSegment.y;
      if(![v.wallSegment.y1,v.wallSegment.y2].includes(y)||
        ![h.wallSegment.x1,h.wallSegment.x2].includes(x))continue;
      const box=rect([v.box.x1,h.box.y1,v.box.x2,h.box.y2]);
      if(areaSqM([box],[parcel])>1e-9||
        Math.abs(areaSqM([box],slabs)-areaSqM([box]))>1e-9)continue;
      if(cornerReservations.some(r=>JSON.stringify(r.box)===JSON.stringify(box)))continue;
      cornerReservations.push({box,faces:[v.face,h.face],
        status:'corner_projection_setback_and_structure_unverified'});
    }
  return {preferredDepthRangeMm:[MIN_DEPTH_MM,MAX_DEPTH_MM],reservations,cornerReservations,omitted,
    status:'non_flush_exterior_review_geometry_only'};
}
module.exports={reserveRainChajjas,MIN_DEPTH_MM,MAX_DEPTH_MM};
