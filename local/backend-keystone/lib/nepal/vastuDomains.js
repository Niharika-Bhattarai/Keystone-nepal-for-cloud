'use strict';
const {rect}=require('./areaLedger');
function transform(point,bearingDegrees) {
  const a=bearingDegrees*Math.PI/180,nx=Math.cos(a),ny=Math.sin(a);
  return {east:point.x*ny-point.y*nx,north:point.x*nx+point.y*ny};
}
function corners(box) {const b=rect(box);return [{x:b.x1,y:b.y1},{x:b.x2,y:b.y1},
  {x:b.x2,y:b.y2},{x:b.x1,y:b.y2}];}
function clip(poly,axis,bound,keepGreater) {
  const inside=p=>keepGreater?p[axis]>=bound:p[axis]<=bound;
  const output=[];
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length],ai=inside(a),bi=inside(b);
    if(ai)output.push(a);
    if(ai!==bi){const t=(bound-a[axis])/(b[axis]-a[axis]);
      output.push({east:a.east+(b.east-a.east)*t,north:a.north+(b.north-a.north)*t});}
  }
  return output;
}
function area(poly) {let twice=0;for(let i=0;i<poly.length;i++){
  const a=poly[i],b=poly[(i+1)%poly.length];twice+=a.east*b.north-b.east*a.north;}
  return Math.abs(twice)/2;}
function zoneAreas(boxes,bearingDegrees,domainBoxes=boxes) {
  if(!Number.isFinite(bearingDegrees)||bearingDegrees<0||bearingDegrees>=360)
    throw new Error('Measured true-north bearing required');
  const domain=domainBoxes.flatMap(b=>corners(b)).map(p=>transform(p,bearingDegrees));
  const loE=Math.min(...domain.map(p=>p.east)),hiE=Math.max(...domain.map(p=>p.east));
  const loN=Math.min(...domain.map(p=>p.north)),hiN=Math.max(...domain.map(p=>p.north));
  if(!(hiE>loE&&hiN>loN))throw new Error('Nonempty Vaastu reference domain required');
  const out={};
  for(let n=0;n<3;n++)for(let e=0;e<3;e++){
    const e0=loE+(hiE-loE)*e/3,e1=loE+(hiE-loE)*(e+1)/3;
    const n0=loN+(hiN-loN)*n/3,n1=loN+(hiN-loN)*(n+1)/3;
    const key=(n===2?'N':n===0?'S':'')+(e===2?'E':e===0?'W':'')||'C';
    let squareMm=0;
    for(const box of boxes){let poly=corners(box).map(p=>transform(p,bearingDegrees));
      poly=clip(clip(clip(clip(poly,'east',e0,true),'east',e1,false),'north',n0,true),'north',n1,false);
      if(poly.length>=3)squareMm+=area(poly);
    }
    out[key]=squareMm/1e6;
  }
  return out;
}
function dominantZone(boxes,bearingDegrees,domainBoxes) {
  const zones=zoneAreas(boxes,bearingDegrees,domainBoxes);
  return Object.entries(zones).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0][0];
}
module.exports={transform,zoneAreas,dominantZone};
