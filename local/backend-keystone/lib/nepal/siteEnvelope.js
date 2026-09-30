'use strict';
const {rect,areaSqM}=require('./areaLedger');
function siteEnvelope(brief,{setbacksMm,reviewed=false}={}) {
  const vertices=brief?.site?.verticesMm;
  if (brief?.site?.shape!=='rectangle'||!Array.isArray(vertices)||vertices.length!==4)
    throw new Error('This footprint search requires a measured rectangular site');
  if (!Array.isArray(setbacksMm)||setbacksMm.length!==4||!setbacksMm.every(n=>Number.isSafeInteger(n)&&n>=0))
    throw new Error('Four explicit edge setbacks are required; no zero-setback inference is allowed');
  const xs=vertices.map(v=>v.xMm),ys=vertices.map(v=>v.yMm);
  const site=rect([Math.round(Math.min(...xs)),Math.round(Math.min(...ys)),
    Math.round(Math.max(...xs)),Math.round(Math.max(...ys))]);
  if (Math.abs(areaSqM([site])-brief.site.measuredAreaSqM)>0.02)
    throw new Error('Plot is not an axis-aligned measured rectangle at 1 mm precision');
  // Boundary order is south, east, north, west for the normalized rectangle.
  const [south,east,north,west]=setbacksMm;
  const buildable=rect([site.x1+west,site.y1+south,site.x2-east,site.y2-north]);
  return {site,buildable,setbacksMm,reviewed,legalStatus:reviewed?'reviewed_input':'provisional_unverified'};
}
function footprints(envelope,{compactRectangle=false}={}) {
  const b=envelope.buildable,w=b.x2-b.x1,h=b.y2-b.y1;
  if (w<6500||h<7500) return [];
  // On the compact reference parcel the 4,585 mm stair bay plus one other
  // bay must fit inside two <= 4,267 mm column-axis spans. A 400 mm north
  // Pullback makes the 9.25 m buildable length an 8.85 m, 3-axis plan.
  const rectangleSlab=compactRectangle&&h>8850&&h<=10000?
    rect([b.x1,b.y1,b.x2,b.y1+8850]):b;
  const nx=Math.floor(w*0.28/100)*100,ny=Math.floor(h*0.28/100)*100;
  // NBC 206:2024 p.17 gives 3 m x 3 m for a light-admitting normal-rise court.
  const courtW=Math.max(3000,Math.floor(w*0.28/100)*100);
  const courtD=Math.max(3000,Math.floor(h*0.35/100)*100);
  const courtLeft=b.x1+Math.floor((w-courtW)/2),courtRight=courtLeft+courtW;
  const cases=[
    {family:'rectangle',slabs:[rectangleSlab],voids:[]},
    {family:'L-northwest',slabs:[rect([b.x1,b.y1,b.x2,b.y2-ny]),rect([b.x1+nx,b.y2-ny,b.x2,b.y2])],voids:[]},
    {family:'L-northeast',slabs:[rect([b.x1,b.y1,b.x2,b.y2-ny]),rect([b.x1,b.y2-ny,b.x2-nx,b.y2])],voids:[]},
  ];
  if(courtW+5000<=w&&courtD+4000<=h)cases.push({family:'U-north-court',
    slabs:[rect([b.x1,b.y1,b.x2,b.y2-courtD]),rect([b.x1,b.y2-courtD,courtLeft,b.y2]),
      rect([courtRight,b.y2-courtD,b.x2,b.y2])],
    openCourt:rect([courtLeft,b.y2-courtD,courtRight,b.y2]),voids:[]});
  return cases.map(c=>({...c,areaSqM:areaSqM(c.slabs),envelopeStatus:envelope.legalStatus}));
}
function partialTopFootprint(full,core,targetAreaSqM,{preferredDepthMm=0}={}) {
  if(!Number.isFinite(targetAreaSqM)||targetAreaSqM<=0)throw new Error('Partial top floor needs a positive target area');
  const slabs=full.slabs.map(rect),c=rect(core.box);
  const x1=Math.min(...slabs.map(b=>b.x1)),x2=Math.max(...slabs.map(b=>b.x2));
  const y1=Math.min(...slabs.map(b=>b.y1)),y2=Math.max(...slabs.map(b=>b.y2));
  const width=preferredDepthMm?Math.max(c.x2-c.x1+1000,
    Math.ceil(targetAreaSqM*1e6/preferredDepthMm)):
    Math.max(c.x2-c.x1+1000,Math.ceil(Math.sqrt(targetAreaSqM*1e6)/100)*100);
  const height=Math.ceil(targetAreaSqM*1e6/width);
  const box=rect(core.side==='west'?[x1,y1,x1+width,y1+height]:[x2-width,y1,x2,y1+height]);
  if(box.y2>y2||areaSqM([box],slabs)>1e-9||areaSqM([c],[box])>1e-9)
    throw new Error('Partial top floor cannot contain the continuous stair within this footprint');
  return {family:`${full.family}-partial`,slabs:[box],voids:[],areaSqM:areaSqM([box]),
    envelopeStatus:full.envelopeStatus};
}
module.exports={siteEnvelope,footprints,partialTopFootprint};
