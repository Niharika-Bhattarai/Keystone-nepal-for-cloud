'use strict';
// Residential RC frame calculation for a Nepal spatial hypothesis, step by step:
// loads → seismic weight → NBC 105:2025 hazard and ESM base shear → stiffness,
// drift and torsion → irregularities → load combinations → member design →
// footings → NBC 205 eligibility. Every step carries its formula, the numbers
// substituted and the clause/page it comes from. This is a PRELIMINARY design
// aid for an engineer to verify; it is not a stamped structural design.
const {buildModel,gravity}=require('./model');
const {analyse}=require('./seismic');
const M=require('./members');
const S=require('./sections');
const {NBC105,ANNEX_A,NBC205,IS456,IS875,SOURCES}=require('./codeData');
const same=(p,q)=>Math.abs(p.x-q.x)<1e-3&&Math.abs(p.y-q.y)<1e-3;
const f=(n,d=2)=>Number.isFinite(n)?Number(n).toFixed(d):String(n);

// Trial frame sizes, smallest first: column (square) then beam b × D.
const COLUMN_TRIALS=[350,400,450,500];
const BEAM_TRIALS=[[230,355],[230,400],[300,400],[300,450],[350,450],[350,500]];

function irregularities(model,grav,an){
  const out=[],I=NBC105.irregularity,st=model.storeys;
  for(const dir of ['x','y']){const K=an.uls.map(s=>s.K[dir]);
    st.forEach((s,i)=>{if(i+1>=st.length)return;const above=K.slice(i+1,i+4);
      const r1=K[i]/K[i+1],avg=above.reduce((a,b)=>a+b,0)/above.length;
      const soft=r1<I.softStorey||(above.length===3&&K[i]/avg<I.softStorey3);
      out.push({kind:'soft storey',dir,storey:s.id,value:`K/K_above = ${f(r1)}${above.length===3?`, K/avg(3 above) = ${f(K[i]/avg)}`:''}`,irregular:soft,ref:NBC105.verticalIrregRef});});}
  grav.levels.forEach((l,i)=>{const nx=grav.levels[i+1];if(!nx||nx.top)return;// roof/penthouse excluded (5.4.1.5)
    const r=Math.max(l.W,nx.W)/Math.min(l.W,nx.W);
    out.push({kind:'mass',storey:`${l.id} / ${nx.id}`,value:`W ratio = ${f(r)}`,irregular:r>I.mass,ref:NBC105.verticalIrregRef});});
  const dims=st.map(s=>({x:Math.max(...s.columns.map(c=>c.x))-Math.min(...s.columns.map(c=>c.x)),y:Math.max(...s.columns.map(c=>c.y))-Math.min(...s.columns.map(c=>c.y))}));
  for(const dir of ['x','y'])st.forEach((s,i)=>{if(!st[i+1])return;const a=dims[i][dir],b=dims[i+1][dir];
    const r=Math.max(a,b)/Math.max(Math.min(a,b),0.01);
    out.push({kind:'vertical geometric',dir,storey:`${s.id} / ${st[i+1].id}`,value:`LFRS width ${f(a)} m vs ${f(b)} m (ratio ${f(r)})`,irregular:r>I.geometric,ref:NBC105.verticalIrregRef});});
  for(const dir of ['x','y'])for(const t of an.dirs[dir].torsion)
    out.push({kind:t.extreme?'extreme torsion':'torsion',dir,storey:t.storey,value:`Δmax/Δmin = ${f(t.ratio)}`,irregular:t.irregular,extreme:t.extreme,ref:NBC105.planIrregRef});
  st.forEach(s=>{if(s.boxes.length<2)return;// re-entrant: projections of a multi-box footprint
    const X=[Math.min(...s.boxes.map(b=>b.x1)),Math.max(...s.boxes.map(b=>b.x2))],Y=[Math.min(...s.boxes.map(b=>b.y1)),Math.max(...s.boxes.map(b=>b.y2))];
    const fill=s.areaSqM/((X[1]-X[0])*(Y[1]-Y[0]));
    out.push({kind:'re-entrant corner',storey:s.id,value:`footprint fills ${f(fill*100,0)} % of its bounding box`,irregular:fill<1-I.reentrant,ref:NBC105.planIrregRef});});
  grav.levels.forEach(l=>{if(!model.core||!l.above)return;
    const open=l.acc.stairDL>0?(model.core.x2-model.core.x1)*(model.core.y2-model.core.y1):0,r=open/(l.acc.area||1);
    out.push({kind:'diaphragm opening',storey:l.id,value:`stair opening ${f(r*100,0)} % of floor`,irregular:r>I.diaphragmOpening,ref:NBC105.planIrregRef});});
  return out;
}

function nbc205Eligibility(model,an){
  const g=model.candidate.grid,st=model.storeys,main=st.filter(s=>s.kind!=='partial');
  const xs=g.xSpansMm||[],ys=g.ySpansMm||[],A=xs.reduce((a,b)=>a+b,0)/1000,Bd=ys.reduce((a,b)=>a+b,0)/1000;
  const panels=[];for(const a of xs)for(const b of ys)panels.push(a*b/1e6);
  const full=st[0].areaSqM,partial=st.filter(s=>s.kind==='partial');
  const items=[
    ['bays',`${xs.length} × ${ys.length} bays (2–6 each way)`,xs.length>=2&&xs.length<=6&&ys.length>=2&&ys.length<=6],
    ['bay length',`max ${f(Math.max(...xs,...ys)/1000)} m, min ${f(Math.min(...xs,...ys)/1000)} m (2.1–4.5 m)`,Math.max(...xs,...ys)<=4500&&Math.min(...xs,...ys)>=2100],
    ['panel area',`max ${f(Math.max(...panels))} m² (≤ 13.5 m²)`,Math.max(...panels)<=13.5],
    ['plan ratio',`A/B = ${f(A/Bd)} (1/3 to 3)`,A<=3*Bd&&A>=Bd/3],
    ['slenderness',`H/A = ${f(an.H/A)}, H/B = ${f(an.H/Bd)} (≤ 3)`,an.H/A<=3&&an.H/Bd<=3],
    ['storeys',`${main.length} full storeys (≤ 3), H to main roof ${f(main.at(-1).z0+main.at(-1).h)} m (≤ 12 m)`,main.length<=3&&main.at(-1).z0+main.at(-1).h<=12],
    ['penthouse',partial.length?`${partial.map(p=>`${f(p.areaSqM/full*100,0)} % of typical floor, ${f(p.h)} m high`).join('; ')} (≤ 25 %, 2.4 m)`:'none',
      partial.every(p=>p.areaSqM<=0.25*full&&p.h<=2.4)],
    ['storey height',`max ${f(Math.max(...main.map(s=>s.h)))} m (≤ 3.2 m), lower ≥ upper`,main.every(s=>s.h<=3.2)&&main.every((s,i)=>!main[i+1]||s.h>=main[i+1].h)],
    ['coverage',`${f(full/0.09290304,0)} sq ft (≤ 1000 sq ft)`,full/0.09290304<=1000],
    ['occupancy','normal residential',true],
  ];
  return {eligible:items.every(i=>i[2]),items:items.map(([id,text,ok])=>({id,text,ok})),ref:NBC205.restrictions};
}

function design(candidate,brief,overrides={},{quick=false}={}){
  const model=buildModel(candidate,brief,overrides);
  const grav=gravity(model);
  const an=analyse(model,grav);
  const fck=an.fck,fy=model.inputs.fy;
  const td=M.takedown(model,grav);
  // Beams (all slab levels + plinth).
  const beams=[];
  model.diaphragms.forEach((d,i)=>{d.beams.forEach((b,j)=>{
    const E=an.dirs[b.axis].beamE.find(e=>e.beam.id===b.id);
    beams.push({level:grav.levels[i].id,...M.designBeam(model,b,grav.levels[i].perBeam[j],E,{fck,fy})});});});
  // Plinth (tie) beams carry the ground-storey walls; designed for gravity, with
  // the 2.2.5 B tie force reported separately.
  const segD=(p,b)=>{const dx=b.e.x-b.a.x,dy=b.e.y-b.a.y,L2=dx*dx+dy*dy,t=Math.max(0,Math.min(1,((p.x-b.a.x)*dx+(p.y-b.a.y)*dy)/L2));
    return Math.hypot(p.x-b.a.x-t*dx,p.y-b.a.y-t*dy);};
  const pbLoads=model.plinthBeams.map(pb=>({dl:0,ll:0,self:model.inputs.gammaRC*pb.b*pb.D*Math.max(pb.L-model.colB,0)}));
  for(const w of grav.walls[0].samples){let bi=-1,bd=0.3;model.plinthBeams.forEach((pb,i)=>{const dd=segD(w,pb);if(dd<bd){bd=dd;bi=i;}});
    if(bi>=0)pbLoads[bi].dl+=w.w;}
  model.plinthBeams.forEach((pb,i)=>beams.push({level:'plinth',...M.designBeam(model,pb,pbLoads[i],null,{fck,fy})}));
  if(quick){const drifts=['x','y'].flatMap(dir=>an.dirs[dir].drifts);
    return {quick:true,summary:{driftOk:drifts.every(d=>d.okULS&&d.okSLS),beamsOk:beams.every(b=>b.ok)},
      maxDrift:Math.max(...drifts.map(d=>d.ulsRatio)),maxSls:Math.max(...drifts.map(d=>d.slsRatio))};}
  // Columns per storey.
  const columns=[],details=[];
  model.storeys.forEach((s,si)=>{for(const c of s.columns){
    const P=td.storeys[si][c.id];
    const Mg={x:M.gravityColumnMoment(model,grav,si,c,'x'),y:M.gravityColumnMoment(model,grav,si,c,'y')};
    const E={};for(const dir of ['x','y']){const cm=an.dirs[dir].colM[si][c.id];E[dir]={P:Math.abs(an.dirs[dir].axialE[si][c.id]||0),M:Math.max(cm?.Mtop||0,cm?.Mbot||0),V:cm?.V||0};}
    const r=M.designColumn(model,{P,Mg,E,h:s.h,fck,fy,top:si===model.storeys.length-1});
    columns.push({storey:s.id,si,id:c.id,x:c.x,y:c.y,P,Mg,E,...r});
  }});
  // Strong column–weak beam and joints (Annex A 4.4).
  const joints=[];
  model.diaphragms.forEach((d,k)=>{const si=k;// storey below
    for(const c of model.storeys[si].columns){
      const below=columns.find(q=>q.si===si&&q.id===c.id),above=columns.find(q=>q.si===si+1&&q.id===c.id);
      for(const dir of ['x','y']){
        const bs=beams.filter(b=>b.level===grav.levels[k].id&&b.axis===dir).map(b=>({b,geo:d.beams.find(x=>x.id===b.id)}))
          .filter(o=>same(o.geo.a,c)||same(o.geo.e,c));
        if(!bs.length)continue;
        const Mb=Math.max(...[0,1].map(side=>bs.reduce((n,o,i)=>n+((i%2)===side?o.b.Mh:o.b.Ms),0)));
        const Pg=q=>(q.P.PD+0.3*q.P.PL)*1e3;
        const mc=q=>q&&q.chosen?S.uniaxialCapacity(Pg(q),q.B,q.B,q.chosen.rows,fck,fy).Mu/1e6:0;
        const Mc=mc(below)+mc(above),roof=!above;
        const faces=new Set(model.diaphragms[k].beams.filter(x=>same(x.a,c)||same(x.e,c)).map(x=>`${x.axis}${same(x.a,c)?'+':'-'}`)).size;
        const interior=bs.length>=2;
        const Ast1=Math.max(...bs.map(o=>o.b.topBars?.As||0)),Ast2=Math.max(...bs.map(o=>o.b.botBars?.As||0));
        const Vcol=(an.dirs[dir].colM[si][c.id]?.V||0)*1e3;
        const Vjh=interior?1.25*fy*(Ast1+Ast2)-Vcol:1.25*fy*Ast1-Vcol;
        const bc=model.colB*1000,bb=Math.min(...bs.map(o=>o.b.b)),bj=Math.min(bb,bc),Aej=bj*bc;
        const coef=faces>=4?1.5:faces===3?1.2:1.0,Vjc=coef*Aej*Math.sqrt(fck);
        const dbMax=Math.max(...bs.map(o=>Math.max(o.b.topBars?.dia||12,o.b.botBars?.dia||12)));
        const ldh=fy*dbMax/(4.85*Math.sqrt(fck)),avail=bc-model.inputs.coverColumnMm;
        joints.push({level:grav.levels[k].id,id:c.id,dir,roof,Mc,Mb,ratio:Mb?Mc/Mb:Infinity,scwbOk:roof||Mc>=1.2*Mb,
          faces,interior,Vjh:Vjh/1e3,Vjc:Vjc/1e3,jointOk:Vjc>=Vjh,Ajh:Vjc<Vjh?(Vjh-Vjc)/fy:0,
          ldh,avail,anchorOk:interior||ldh<=avail,minColumn:20*dbMax,minColumnOk:bc>=20*dbMax});
      }}});
  // Column detailing per storey (worst column in the storey).
  model.storeys.forEach((s,si)=>{const cs=columns.filter(c=>c.si===si);
    const worst=cs.reduce((a,b)=>(b.chosen?.As||1e9)>(a.chosen?.As||1e9)?b:a,cs[0]);
    details.push({storey:s.id,...M.columnDetailing(model,{h:s.h,fck,fy,chosen:worst?.chosen})});});
  // Footings.
  const sbc=Number(model.inputs.sbc)||100;
  const footings=model.storeys[0].columns.map(c=>{
    const P=td.base[c.id],Ex=Math.abs(an.dirs.x.axialE[0][c.id]||0),Ey=Math.abs(an.dirs.y.axialE[0][c.id]||0);
    const Mx=an.dirs.x.colM[0][c.id]?.Mbot||0,My=an.dirs.y.colM[0][c.id]?.Mbot||0;
    return {id:c.id,x:c.x,y:c.y,...M.designFooting(model,{P,E:Math.max(Ex,Ey),M:Math.max(Mx,My),fck,fy,sbc})};});
  const tieForce=0.1*Math.max(...footings.map(fo=>fo.seis));
  // Overall stability (2.1.3.1): overturning about the base edge, 0.9 DL resisting.
  const stability=['x','y'].map(dir=>{const G=an.dirs[dir].gov,Mo=G.dist.F.reduce((n,F,i)=>n+F*an.z[i],0);
    const xs=model.storeys[0].boxes,w=dir==='x'?Math.max(...xs.map(b=>b.x2))-Math.min(...xs.map(b=>b.x1)):Math.max(...xs.map(b=>b.y2))-Math.min(...xs.map(b=>b.y1));
    const Mr=0.9*an.W.reduce((a,b)=>a+b,0)*w/2;return {dir,Mo,Mr,fos:Mr/Mo,ok:Mr/Mo>=1.5,width:w};});
  const roofDisp=['x','y'].map(dir=>({dir,uls:an.dirs[dir].gov.disp.at(-1)*an.hz.Rmu*an.kd}));
  const irr=irregularities(model,grav,an);
  const elig=nbc205Eligibility(model,an);
  const drifts=['x','y'].flatMap(dir=>an.dirs[dir].drifts.map(d=>({dir,...d})));
  const summary={
    driftOk:drifts.every(d=>d.okULS&&d.okSLS),
    columnsOk:columns.every(c=>c.ok),beamsOk:beams.every(b=>b.ok),
    scwbOk:joints.every(j=>j.scwbOk),jointsOk:joints.every(j=>j.jointOk),
    extremeTorsion:irr.some(i=>i.extreme),irregular:irr.some(i=>i.irregular),
    floating:td.floating.length>0,esmOk:an.esm.ok||!irr.some(i=>i.irregular),stabilityOk:stability.every(s=>s.ok),
  };
  summary.pass=summary.driftOk&&summary.columnsOk&&summary.beamsOk&&summary.scwbOk&&!summary.extremeTorsion&&summary.stabilityOk&&!summary.floating;
  return {model,grav,an,td,beams,columns,joints,details,footings,tieForce,stability,roofDisp,irr,elig,drifts,summary,sbc,fck,fy};
}

// Size the frame: start from the owner/engineer sizes (or the drawing layout)
// and step up column and beam sizes until drift, member strength, strong-column
// and stability checks pass. Each trial is screened for drift and beams first.
function designStructure(candidate,brief,overrides={}){
  const locked=overrides.lockSizes===true;
  const c0=Number(overrides.columnMm)||candidate.grid.columnWidthMm||350;
  const b0=Number(overrides.beamWidthMm)||230,d0=Number(overrides.beamDepthMm)||355;
  let list=[{columnMm:c0,beamWidthMm:b0,beamDepthMm:d0}];
  if(!locked)for(const c of COLUMN_TRIALS)for(const [b,d] of BEAM_TRIALS){
    if(c<c0||b>c||(c===c0&&b<b0)||d<d0)continue;
    if(!list.some(t=>t.columnMm===c&&t.beamWidthMm===b&&t.beamDepthMm===d))list.push({columnMm:c,beamWidthMm:b,beamDepthMm:d});}
  // cheapest first: concrete in one column + one beam metre as a proxy
  list=[list[0],...list.slice(1).sort((p,q)=>(p.columnMm**2*3+p.beamWidthMm*p.beamDepthMm)-(q.columnMm**2*3+q.beamWidthMm*q.beamDepthMm))];
  const trials=[];let adopted=null;
  for(const t of list){
    const q=design(candidate,brief,{...overrides,...t},{quick:true});
    const row={...t,maxDrift:q.maxDrift,maxSls:q.maxSls,driftOk:q.summary.driftOk,beamsOk:q.summary.beamsOk};
    trials.push(row);
    if(!(q.summary.driftOk&&q.summary.beamsOk)&&t!==list.at(-1))continue;
    const r=design(candidate,brief,{...overrides,...t});
    row.full=r.summary;adopted=r;
    if(r.summary.pass)break;
  }
  return {...adopted,trials,locked,sources:SOURCES,refs:{NBC105,ANNEX_A,NBC205,IS456,IS875},
    status:'preliminary_calculation_requires_licensed_engineer_verification',
    generatedFor:candidate.id};
}

module.exports={designStructure,design,irregularities,nbc205Eligibility};
