'use strict';
// Planning frame for a surveyed (drawn) plot. The footprint search works on an
// axis-aligned rectangle, so a polygon plot is turned until its road edge runs
// along +x at the bottom, and the largest rectangle that fits inside the
// boundary becomes the planning site. The real boundary, its area and the
// rotation are kept on the brief so drawings show the actual plot. Setbacks are
// applied from the rectangle, so every distance to the real boundary is at
// least the working setback.
const CELL_MM=50;

function signedArea(p){let a=0;for(let i=0;i<p.length;i++){const q=p[(i+1)%p.length];a+=p[i].xMm*q.yMm-q.xMm*p[i].yMm;}return a/2;}
function inside(pt,poly){let c=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];
    if((a.yMm>pt.y)!==(b.yMm>pt.y)&&pt.x<(b.xMm-a.xMm)*(pt.y-a.yMm)/(b.yMm-a.yMm)+a.xMm)c=!c;}
  return c;}

// Largest axis-aligned rectangle of fully-inside cells (histogram method).
function largestRectangle(poly){
  const xs=poly.map(p=>p.xMm),ys=poly.map(p=>p.yMm);
  const x0=Math.min(...xs),y0=Math.min(...ys),nx=Math.ceil((Math.max(...xs)-x0)/CELL_MM),ny=Math.ceil((Math.max(...ys)-y0)/CELL_MM);
  const e=0.5,ok=Array.from({length:ny},(_,j)=>Array.from({length:nx},(_,i)=>{
    const cx=x0+i*CELL_MM,cy=y0+j*CELL_MM;
    return [[e,e],[CELL_MM-e,e],[e,CELL_MM-e],[CELL_MM-e,CELL_MM-e],[CELL_MM/2,CELL_MM/2]].every(([u,v])=>inside({x:cx+u,y:cy+v},poly));}));
  const h=new Array(nx).fill(0);let best={area:0};
  for(let j=0;j<ny;j++){
    for(let i=0;i<nx;i++)h[i]=ok[j][i]?h[i]+1:0;
    const st=[];
    for(let i=0;i<=nx;i++){const cur=i<nx?h[i]:0;
      while(st.length&&h[st.at(-1)]>=cur){const top=st.pop(),height=h[top],left=st.length?st.at(-1)+1:0,width=i-left;
        // Prefer the larger area; on ties the rectangle nearer the road (lower y).
        const area=height*width;if(area>best.area){best={area,i1:left,i2:i,j1:j-height+1,j2:j+1};}}
      st.push(i);}
  }
  if(!best.area)return null;
  return {x1:x0+best.i1*CELL_MM,y1:y0+best.j1*CELL_MM,x2:x0+best.i2*CELL_MM,y2:y0+best.j2*CELL_MM};
}

function planningBrief(brief){
  const site=brief?.site;
  if(site?.shape!=='surveyedPolygon'||!Array.isArray(site.verticesMm)||site.verticesMm.length<3)return brief;
  let poly=site.verticesMm.map(v=>({xMm:v.xMm,yMm:v.yMm}));
  const front=site.frontageEdges?.[0]||{edgeIndex:0};
  let road=front.edgeIndex,n=poly.length;
  // Counter-clockwise order keeps the plot on the left of each edge.
  if(signedArea(poly)<0){poly=poly.slice().reverse();road=(n-2-road+n)%n;}
  const a=poly[road],b=poly[(road+1)%n],theta=Math.atan2(b.yMm-a.yMm,b.xMm-a.xMm);
  const c=Math.cos(-theta),s=Math.sin(-theta);
  let rot=poly.map(p=>({xMm:(p.xMm-a.xMm)*c-(p.yMm-a.yMm)*s,yMm:(p.xMm-a.xMm)*s+(p.yMm-a.yMm)*c}));
  const r=largestRectangle(rot);
  const thetaDeg=theta*180/Math.PI;
  const plotAreaSqM=Math.abs(signedArea(poly))/1e6;
  if(!r)return {...brief,site:{...site,planningFit:{status:'no_rectangle_fits',plotAreaSqM}}};
  // Rectangle at the origin, rounded inward to 10 mm.
  const w=Math.floor((r.x2-r.x1)/10)*10,d=Math.floor((r.y2-r.y1)/10)*10;
  rot=rot.map(p=>({xMm:Math.round(p.xMm-r.x1),yMm:Math.round(p.yMm-r.y1)}));
  const verticesMm=[{xMm:0,yMm:0},{xMm:w,yMm:0},{xMm:w,yMm:d},{xMm:0,yMm:d}];
  const bearing=((site.north.bearingDegrees-thetaDeg)%360+360)%360;
  const roadBoundary=site.boundaries?.[front.edgeIndex];
  const touchesRoad=r.y1<=CELL_MM*2;
  return {...brief,site:{...site,shape:'rectangle',verticesMm,measuredAreaSqM:w*d/1e6,
    north:{...site.north,bearingDegrees:Math.round(bearing*100)/100},
    frontageEdges:[{...front,edgeIndex:0}],
    boundaries:[0,1,2,3].map(i=>({edgeIndex:i,neighbor:i===0?(roadBoundary?.neighbor||'road'):'unknown',neighborHeightMm:null,
      neighborHasWindows:null,proposedSetbackMm:i===0?roadBoundary?.proposedSetbackMm??null:null,note:''})),
    plotPolygonMm:rot,plotAreaSqM,
    planningFit:{status:'largest_inscribed_rectangle',rotationDegrees:Math.round(thetaDeg*100)/100,
      rectangleMm:[w,d],rectangleAreaSqM:w*d/1e6,plotAreaSqM,usedShare:w*d/1e6/plotAreaSqM,touchesRoadEdge:touchesRoad,
      note:`Planned on the largest rectangle inside the drawn plot (${(w/1000).toFixed(2)} × ${(d/1000).toFixed(2)} m, ${Math.round(w*d/1e6/plotAreaSqM*100)} % of ${plotAreaSqM.toFixed(1)} m²), turned ${Math.round(thetaDeg)}° so the road edge is at the bottom. Setbacks are measured from this rectangle; coverage is reported against the rectangle (conservative).`}}};
}

module.exports={planningBrief,largestRectangle};
