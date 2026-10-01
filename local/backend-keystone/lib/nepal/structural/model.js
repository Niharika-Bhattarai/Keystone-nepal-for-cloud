'use strict';
// Structural model of a Nepal spatial hypothesis for the residential RC frame
// calculation: storeys, diaphragms (slab levels), columns, beams, walls and
// the gravity loads on each, from the same geometry the drawings use.
// Units inside: kN, m (inputs in mm are converted once here).
const {exportCandidateGeometry}=require('../geometryExport');
const {structuralLayout}=require('../drawingSet');

const CELL=0.1;// m, sampling step for tributary areas and wall lengths
const r3=n=>Math.round(n*1000)/1000;
const boxM=b=>({x1:b.x1/1000,y1:b.y1/1000,x2:b.x2/1000,y2:b.y2/1000});
const inBox=(p,b,t=1e-6)=>p.x>=b.x1-t&&p.x<=b.x2+t&&p.y>=b.y1-t&&p.y<=b.y2+t;
const inAny=(p,boxes,t)=>boxes.some(b=>inBox(p,b,t));
const area=b=>(b.x2-b.x1)*(b.y2-b.y1);
const CIRCULATION=/corridor|stair|landing|hall|lobby|passage|balcony|foyer/i;

function defaultInputs(candidate,layout){
  const columnMm=candidate.grid.columnWidthMm||350;
  return {fck:null,fy:500,columnMm,beamWidthMm:layout.beamTypes[0]?.widthMm||230,beamDepthMm:null,
    slabMm:layout.slabThicknessMm||125,stairWaistMm:150,gammaRC:25,gammaBrick:18.85,plasterPerFace:0.255,
    floorFinish:1.0,roofFinish:1.5,stairFinish:1.0,
    liveRoom:2.0,liveCirculation:3.0,liveRoof:1.5,liveRoofInaccessible:0.75,
    parapetMm:1000,parapetThicknessMm:229,tankLitres:1000,
    coverBeamMm:25,coverColumnMm:40,coverFootingMm:50,sbc:null,soil:null,Z:null,importanceClass:'I',
    plinthBeamMm:{b:230,D:350},penthouseLimit:0.25};
}

// Nearest-point assignment: returns index of the nearest of `pts` to p.
function nearest(p,pts){let best=-1,d=Infinity;
  pts.forEach((q,i)=>{const dd=(p.x-q.x)**2+(p.y-q.y)**2;if(dd<d-1e-12){d=dd;best=i;}});return best;}
function segDist(p,s){const dx=s.x2-s.x1,dy=s.y2-s.y1,L2=dx*dx+dy*dy;
  let t=L2?((p.x-s.x1)*dx+(p.y-s.y1)*dy)/L2:0;t=Math.max(0,Math.min(1,t));
  return Math.hypot(p.x-(s.x1+t*dx),p.y-(s.y1+t*dy));}

function buildModel(candidate,brief,overrides={}){
  const geometry=exportCandidateGeometry(candidate,brief);
  const layout=structuralLayout(candidate);
  const inp={...defaultInputs(candidate,layout),...Object.fromEntries(Object.entries(overrides).filter(([,v])=>v!=null&&v!==''))};
  const colB=inp.columnMm/1000;
  const storeys=candidate.levels.map((level,s)=>{
    const g=geometry.levels[s];
    const boxes=level.footprint.slabs.map(boxM);
    const columns=candidate.grid.columns.filter(c=>inAny({x:c.xMm/1000,y:c.yMm/1000},boxes,1e-3))
      .map(c=>({id:c.id,x:c.xMm/1000,y:c.yMm/1000}));
    return {index:s,id:level.id,kind:level.kind,z0:g.elevationMm/1000,h:g.storeyHeightMm/1000,boxes,columns,
      areaSqM:boxes.reduce((n,b)=>n+area(b),0),
      rooms:(level.rooms?.rooms||[]).map(r=>({type:r.type,box:boxM(r.box)})),
      corridor:level.rooms?.corridor?boxM(level.rooms.corridor):null,
      walls:(level.walls?.walls||[]).map(w=>({id:w.id,kind:w.kind,t:w.thicknessMm/1000,axis:w.axis,
        solid:w.solidBoxes.map(boxM),openings:w.openingBoxes.map(o=>({box:boxM(o.box),
          door:!!(o.opening?.leafCount||o.opening?.from||/portal/.test(o.opening?.status||'')),
          heightM:(o.opening?.assumedClearHeightMm||(o.opening?.leafCount||o.opening?.from?2100:1200))/1000}))})),
      wallsAssumed:!(level.walls?.walls||[]).length};
  });
  const n=storeys.length;
  const core=candidate.core?boxM(candidate.core.box):null,coreLevels=new Set(candidate.core?.levelIds||[]);
  // Beam geometry per slab level: the drawing set's preliminary layout, kept only
  // where both supporting columns exist in the storey below and the slab is there.
  const beamDepthOf=b=>(inp.beamDepthMm||layout.beamTypes.find(t=>t.id===b.type)?.depthMm||355)/1000;
  const diaphragms=[];
  for(let k=1;k<=n;k++){
    const below=storeys[k-1],above=storeys[k]||null;
    const at=new Set(below.columns.map(c=>`${r3(c.x)},${r3(c.y)}`));
    const beams=layout.beams.map(b=>{
      const a=b.axis==='x'?{x:b.from/1000,y:b.line/1000}:{x:b.line/1000,y:b.from/1000};
      const e=b.axis==='x'?{x:b.to/1000,y:b.line/1000}:{x:b.line/1000,y:b.to/1000};
      // Annex A 4.1.1(c): D ≤ clear span/4. Short bays get a shallower beam (not
      // below 300 mm); a bay too short even for that is reported as a layout issue.
      const L=Math.hypot(e.x-a.x,e.y-a.y),maxD=Math.floor((L-colB)*1000/4/25)*25/1000;
      return {axis:b.axis,a,e,L,b:inp.beamWidthMm/1000,D:Math.min(beamDepthOf(b),Math.max(maxD,0.3)),type:b.type};
    }).filter(b=>at.has(`${r3(b.a.x)},${r3(b.a.y)}`)&&at.has(`${r3(b.e.x)},${r3(b.e.y)}`)&&
      inAny({x:(b.a.x+b.e.x)/2,y:(b.a.y+b.e.y)/2},below.boxes,1e-3));
    beams.forEach((b,i)=>{b.id=`D${k}-B${i+1}`;});
    diaphragms.push({k,z:below.z0+below.h,id:above?`floor of ${above.id}`:`roof of ${below.id}`,
      boxes:below.boxes,beams,below,above,top:k===n});
  }
  const plinthBeams=layout.beams.map((b,i)=>{
    const a=b.axis==='x'?{x:b.from/1000,y:b.line/1000}:{x:b.line/1000,y:b.from/1000};
    const e=b.axis==='x'?{x:b.to/1000,y:b.line/1000}:{x:b.line/1000,y:b.to/1000};
    return {id:`PB${i+1}`,axis:b.axis,a,e,L:Math.hypot(e.x-a.x,e.y-a.y),b:inp.plinthBeamMm.b/1000,D:inp.plinthBeamMm.D/1000};});
  return {candidate,brief,geometry,layout,inputs:inp,storeys,diaphragms,plinthBeams,core,coreLevels,colB,n};
}

// ---- gravity loads ----
// Area loads (kN/m²) at a point of diaphragm k: dead and live, with the reason.
function areaLoadAt(model,d,p){
  const inp=model.inputs,above=d.above;
  const covered=above&&inAny(p,above.boxes,1e-6);
  // Stair flights replace the slab where the stair rises from the storey below to the one above.
  const stair=!!(above&&model.core&&inBox(p,model.core)&&model.coreLevels.has(d.below.id)&&model.coreLevels.has(above.id));
  if(stair){
    // Waist slab + steps per plan area: γ(t·√(R²+T²)/T + R/2); riser/tread from the stair profile.
    const fl=model.candidate.core.flights?.[0]||{},R=(fl.riserMm||175)/1000,T=(fl.treadMm||250)/1000;
    const dl=inp.gammaRC*(inp.stairWaistMm/1000*Math.hypot(R,T)/T+R/2)+inp.stairFinish;
    return {dl,ll:inp.liveCirculation,kind:'stair',slab:false};
  }
  const slab=inp.gammaRC*inp.slabMm/1000;
  if(!covered)return {dl:slab+inp.roofFinish,ll:inp.liveRoof,kind:'roof',slab:true,roof:true};
  const room=above.rooms.find(r=>inBox(p,r.box));
  const circ=(above.corridor&&inBox(p,above.corridor))||(room&&CIRCULATION.test(room.type));
  return {dl:slab+inp.floorFinish,ll:circ?inp.liveCirculation:inp.liveRoom,kind:circ?'circulation':'room',slab:true};
}

function wallSamples(model,storey){
  // Each wall as 0.1 m samples carrying kN: masonry γ·t·height + plaster both faces.
  const inp=model.inputs,out=[];
  const beamD=Math.max(...model.diaphragms[storey.index]?.beams.map(b=>b.D)||[0.355],0.3);
  const hw=Math.max(storey.h-beamD,0.5);
  const perM2=t=>inp.gammaBrick*t+2*inp.plasterPerFace;
  const push=(box,axis,t,height,kind)=>{
    const L=axis==='vertical'?box.y2-box.y1:box.x2-box.x1,steps=Math.max(1,Math.round(L/CELL)),w=perM2(t)*height*L/steps;
    for(let i=0;i<steps;i++){const f=(i+0.5)/steps;
      out.push({x:axis==='vertical'?(box.x1+box.x2)/2:box.x1+f*(box.x2-box.x1),y:axis==='vertical'?box.y1+f*(box.y2-box.y1):(box.y1+box.y2)/2,w,kind});}
  };
  if(storey.wallsAssumed){
    // No wall layout on this storey (e.g. partial top floor): 9" perimeter walls
    // with 30 % openings, stated as an assumption in the report.
    for(const b of storey.boxes){
      for(const [box,axis] of [[{x1:b.x1,y1:b.y1,x2:b.x2,y2:b.y1},'horizontal'],[{x1:b.x1,y1:b.y2,x2:b.x2,y2:b.y2},'horizontal'],
        [{x1:b.x1,y1:b.y1,x2:b.x1,y2:b.y2},'vertical'],[{x1:b.x2,y1:b.y1,x2:b.x2,y2:b.y2},'vertical']])push(box,axis,0.229,hw*0.7,'assumed');
    }
    return {samples:out,hw,assumed:true};
  }
  for(const w of storey.walls){
    for(const s of w.solid)push(s,w.axis,w.t,hw,w.kind);
    for(const o of w.openings){const rest=o.door?Math.max(hw-o.heightM,0):Math.max(hw-o.heightM,0);
      if(rest>0)push(o.box,w.axis,w.t,rest,w.kind);}
  }
  return {samples:out,hw,assumed:false};
}

function parapetSamples(model,d){
  // Exposed roof edges of this slab (not under the storey above) get a parapet.
  const inp=model.inputs,out=[],w=(inp.gammaBrick*inp.parapetThicknessMm/1000+2*inp.plasterPerFace)*inp.parapetMm/1000*CELL;
  for(const b of d.boxes){
    const edges=[[b.x1,b.y1,b.x2,b.y1],[b.x1,b.y2,b.x2,b.y2],[b.x1,b.y1,b.x1,b.y2],[b.x2,b.y1,b.x2,b.y2]];
    for(const [x1,y1,x2,y2] of edges){const L=Math.hypot(x2-x1,y2-y1),steps=Math.round(L/CELL);
      for(let i=0;i<steps;i++){const f=(i+0.5)/steps,p={x:x1+f*(x2-x1),y:y1+f*(y2-y1)};
        // outer boundary only, and not where the storey above has its wall
        const outward={x:p.x+(y2===y1?0:(x1===b.x1?-0.01:0.01)),y:p.y+(x2===x1?0:(y1===b.y1?-0.01:0.01))};
        if(inAny(outward,d.boxes))continue;
        if(d.above&&inAny(p,d.above.boxes,0.02))continue;
        out.push({x:p.x,y:p.y,w});}}
  }
  return out;
}

// Gravity loads of every diaphragm: totals, centre of mass, and the share of each
// column below (nearest-column tributary), beams (nearest-beam, i.e. 45° yield
// lines) and walls.
function gravity(model){
  const inp=model.inputs,colArea=model.colB**2;
  const walls=model.storeys.map(s=>wallSamples(model,s));
  const levels=model.diaphragms.map(d=>{
    const cols=d.below.columns,beams=d.beams;
    const acc={slabDL:0,finishDL:0,stairDL:0,LL:0,LLseismic:0,beams:0,parapet:0,tank:0,area:0,roofArea:0,
      colHalfBelow:0,colHalfAbove:0,wallHalfBelow:0,wallHalfAbove:0,wallOnSlab:0};
    const perCol=cols.map(()=>({dl:0,ll:0})),perBeam=beams.map(()=>({dl:0,ll:0}));
    let mx=0,my=0,mw=0;const addMass=(p,w)=>{mx+=p.x*w;my+=p.y*w;mw+=w;};
    const toBeam=(p,dl,ll)=>{if(!beams.length)return;let bi=0,bd=Infinity;
      beams.forEach((b,i)=>{const dd=segDist(p,{x1:b.a.x,y1:b.a.y,x2:b.e.x,y2:b.e.y});if(dd<bd){bd=dd;bi=i;}});
      perBeam[bi].dl+=dl;perBeam[bi].ll+=ll;};
    for(const b of d.boxes){
      const nx=Math.round((b.x2-b.x1)/CELL),ny=Math.round((b.y2-b.y1)/CELL),cx=(b.x2-b.x1)/nx,cy=(b.y2-b.y1)/ny,a=cx*cy;
      for(let i=0;i<nx;i++)for(let j=0;j<ny;j++){
        const p={x:b.x1+(i+0.5)*cx,y:b.y1+(j+0.5)*cy},q=areaLoadAt(model,d,p);
        const dl=q.dl*a,ll=q.ll*a;acc.area+=a;if(q.roof)acc.roofArea+=a;
        if(q.kind==='stair')acc.stairDL+=dl;else{acc.slabDL+=inp.gammaRC*inp.slabMm/1000*a;acc.finishDL+=dl-inp.gammaRC*inp.slabMm/1000*a;}
        acc.LL+=ll;const llS=q.roof?0:0.3*ll;acc.LLseismic+=llS;
        addMass(p,dl+llS);
        const c=nearest(p,cols);if(c>=0){perCol[c].dl+=dl;perCol[c].ll+=ll;}
        toBeam(p,dl,ll);
      }
    }
    // Beams: web below slab, clear length between column faces.
    const bw=beams.map(b=>inp.gammaRC*b.b*Math.max(b.D-inp.slabMm/1000,0)*Math.max(b.L-model.colB,0));
    beams.forEach((b,i)=>{acc.beams+=bw[i];addMass({x:(b.a.x+b.e.x)/2,y:(b.a.y+b.e.y)/2},bw[i]);
      perBeam[i].self=bw[i];
      for(const end of [b.a,b.e]){const c=nearest(end,cols);if(c>=0)perCol[c].dl+=bw[i]/2;}});
    // Walls of the storey above sit on this slab/beams; half its weight (and half
    // the storey-below walls) is seismic mass here.
    if(d.above){for(const s of walls[d.above.index].samples){acc.wallOnSlab+=s.w;acc.wallHalfAbove+=s.w/2;addMass(s,s.w/2);
      const c=nearest(s,cols);if(c>=0)perCol[c].dl+=s.w;toBeam(s,s.w,0);}}
    for(const s of walls[d.below.index].samples){acc.wallHalfBelow+=s.w/2;addMass(s,s.w/2);}
    // Columns: half of the storey below and above.
    const hc=s=>inp.gammaRC*colArea*Math.max(s.h-inp.slabMm/1000,0);
    for(const c of d.below.columns){acc.colHalfBelow+=hc(d.below)/2;addMass(c,hc(d.below)/2);}
    if(d.above)for(const c of d.above.columns){acc.colHalfAbove+=hc(d.above)/2;addMass(c,hc(d.above)/2);}
    const par=parapetSamples(model,d);
    for(const s of par){acc.parapet+=s.w;addMass(s,s.w);const c=nearest(s,cols);if(c>=0)perCol[c].dl+=s.w;toBeam(s,s.w,0);}
    if(d.top&&inp.tankLitres>0){
      // Overhead tank on the top roof over the stair core: water + ~10 % shell.
      const w=inp.tankLitres*9.81/1000*1.1,p=model.core?{x:(model.core.x1+model.core.x2)/2,y:(model.core.y1+model.core.y2)/2}:{x:0,y:0};
      acc.tank=w;addMass(p,w);const c=nearest(p,cols);if(c>=0)perCol[c].dl+=w;toBeam(p,w,0);
    }
    const DL=acc.slabDL+acc.finishDL+acc.stairDL+acc.beams+acc.parapet+acc.tank+acc.wallHalfBelow+acc.wallHalfAbove+acc.colHalfBelow+acc.colHalfAbove;
    return {...d,acc,W:DL+acc.LLseismic,DL,cm:{x:mx/mw,y:my/mw},perCol,perBeam,parapetLengthM:par.length*CELL};
  });
  return {levels,walls};
}

module.exports={buildModel,gravity,wallSamples,areaLoadAt,defaultInputs,inBox,inAny,nearest};
