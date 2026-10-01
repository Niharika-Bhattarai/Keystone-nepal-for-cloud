'use strict';
// Gravity takedown, load combinations and preliminary member design for the
// residential RC frame: beams, columns, joints and isolated footings, with the
// NBC 105:2025 Annex A ductile detailing checks. Member strength uses the IS 456
// limit-state formulas (not supplied in the repo — flagged in the report).
const S=require('./sections');
const {NBC105}=require('./codeData');
const {nearest}=require('./model');
const same=(p,q)=>Math.abs(p.x-q.x)<1e-3&&Math.abs(p.y-q.y)<1e-3;
const BAR_DIAS=[12,16,20,25];

// ---- gravity takedown ----
function takedown(model,grav){
  const inp=model.inputs,own=s=>inp.gammaRC*model.colB**2*Math.max(s.h-inp.slabMm/1000,0);
  const arriving=model.storeys.map(()=>new Map());// loads arriving on top of storey s columns
  grav.levels.forEach((l,i)=>{l.below.columns.forEach((c,j)=>arriving[i].set(c.id,{dl:l.perCol[j].dl,ll:l.perCol[j].ll}));});
  const floating=[],out=model.storeys.map(()=>({}));
  for(let s=model.storeys.length-1;s>=0;s--){
    for(const c of model.storeys[s].columns){
      const a=arriving[s].get(c.id)||{dl:0,ll:0},up=out[s+1]?.[c.id];
      out[s][c.id]={id:c.id,x:c.x,y:c.y,PD:a.dl+own(model.storeys[s])+(up?up.PD:0),PL:a.ll+(up?up.PL:0),ownWeight:own(model.storeys[s])};
    }
    // a column above with nothing below it
    if(s+1<model.storeys.length)for(const c of model.storeys[s+1].columns)if(!out[s][c.id])floating.push({storey:model.storeys[s+1].id,id:c.id});
  }
  // Footings: ground-storey walls on plinth beams and the plinth beams themselves.
  const base={};
  for(const c of model.storeys[0].columns)base[c.id]={...out[0][c.id]};
  const cols=model.storeys[0].columns;
  for(const w of grav.walls[0].samples){const i=nearest(w,cols);if(i>=0)base[cols[i].id].PD+=w.w;}
  for(const pb of model.plinthBeams){const wt=inp.gammaRC*pb.b*pb.D*Math.max(pb.L-model.colB,0);
    for(const end of [pb.a,pb.e]){const i=nearest(end,cols);if(i>=0)base[cols[i].id].PD+=wt/2;}}
  // equilibrium check: Σ footing loads vs Σ all gravity
  const total=grav.levels.reduce((n,l)=>n+l.acc.slabDL+l.acc.finishDL+l.acc.stairDL+l.acc.beams+l.acc.parapet+l.acc.tank+l.acc.wallOnSlab,0)
    +model.storeys.reduce((n,s)=>n+s.columns.length*own(s),0)+grav.walls[0].samples.reduce((n,w)=>n+w.w,0)
    +model.plinthBeams.reduce((n,pb)=>n+inp.gammaRC*pb.b*pb.D*Math.max(pb.L-model.colB,0),0);
  const sumBase=Object.values(base).reduce((n,b)=>n+b.PD,0);
  return {storeys:out,base,floating,equilibrium:{totalDL:total,sumFootingDL:sumBase}};
}

// ---- beams ----
function chooseBars(Areq,b,cover,link,{min=2,minDia=12}={}){
  const opts=[];
  for(const dia of BAR_DIAS)if(dia>=minDia)for(let n=min;n<=6;n++){
    const clear=(b-2*cover-2*link-n*dia)/(n-1||1);
    if(n>1&&clear<Math.max(dia,25))continue;
    opts.push({n,dia,As:n*S.area(dia)});
  }
  opts.sort((a,c)=>a.As-c.As||a.n-c.n);
  return opts.find(o=>o.As>=Areq)||null;
}
const label=o=>o?`${o.n}-${o.dia}φ`:'—';

function designBeam(model,beam,loads,E,{fck,fy}){
  const inp=model.inputs,b=beam.b*1000,D=beam.D*1000,link=8,cover=inp.coverBeamMm,d=D-cover-link-8;
  const L=beam.L,Lc=Math.max(L-model.colB,0.1);
  const wD=(loads.dl+(loads.self||0))/L,wL=loads.ll/L;// kN/m
  // IS 456 Table 12 coefficients (continuous beams, uniform load) — envelope used for all spans.
  const MhD=wD*L*L/10,MhL=wL*L*L/9,MsD=wD*L*L/12,MsL=wL*L*L/10;
  const ME=Math.max(E?.MA||0,E?.MB||0);
  const hog=Math.max(1.5*(MhD+MhL),1.2*MhD+1.5*MhL,MhD+0.3*MhL+ME);
  const sagSupport=Math.max(0,ME-0.9*MhD,ME-(MhD+0.3*MhL));
  const sagSpan=Math.max(1.5*(MsD+MsL),MsD+0.3*MsL+ME/2);
  const pmin=0.24*Math.sqrt(fck)/fy,Amin=Math.max(pmin*b*d,2*S.area(12)),Amax=0.025*b*d;
  const top=S.astForMoment(hog*1e6,b,d,fck,fy),bot=S.astForMoment(sagSpan*1e6,b,d,fck,fy),botS=S.astForMoment(sagSupport*1e6,b,d,fck,fy);
  const topReq=Math.max(top.Ast,Amin),botSupReq=Math.max(botS.Ast,0.5*topReq,Amin),botReq=Math.max(bot.Ast,botSupReq,0.25*topReq,Amin);
  const topBars=chooseBars(topReq,b,cover,link),botBars=chooseBars(Math.max(botReq,botSupReq),b,cover,link);
  const AsTop=topBars?.As||0,AsBot=botBars?.As||0;
  // Capacity design shear, Annex A eq 4.1.3.1–4.1.3.4 (1.0 DL + 0.5 LL, simply supported).
  const Mh=S.momentCapacity(AsTop,b,d,fck,fy)/1e6,Ms=S.momentCapacity(AsBot,b,d,fck,fy)/1e6;
  const Vg=(wD+0.5*wL)*Lc/2,Vcap=Vg+1.4*(Ms+Mh)/Lc;
  const Van=Math.max(1.5*0.6*(wD+wL)*L,(0.6*(wD+0.3*wL)*L)+(E?.V||0));
  const Vu=Math.max(Vcap,Van);
  const tv=Vu*1e3/(b*d),tc=S.tauC(100*AsTop/(b*d),fck),tmax=S.tauCMax(fck);
  const pick=dia=>{const Asv=2*S.area(dia),Vus=Math.max(Vu*1e3-tc*b*d,0);
    const sv=Vus>0?0.87*fy*Asv*d/Vus:Infinity,svMin=0.87*fy*Asv/(0.4*b);
    const end=Math.min(d/4,8*12,100,sv,svMin),mid=Math.min(d/2,sv,svMin);
    return {dia,end:Math.max(Math.floor(end/25)*25,0),mid:Math.floor(mid/25)*25,sv};};
  let links=pick(8);if(links.end<75)links=pick(10);
  const checks=[
    {id:'width',ok:b>=200,text:`b = ${b} mm ≥ 200 mm`,ref:'A 4.1.1(b)'},
    {id:'ratio',ok:b/D>=0.3,text:`b/D = ${(b/D).toFixed(2)} ≥ 0.3 (preferable)`,ref:'A 4.1.1(a)',advisory:true},
    {id:'depth',ok:D<=Lc*1000/4,text:`D = ${D} mm ≤ clear span/4 = ${Math.round(Lc*250)} mm`,ref:'A 4.1.1(c)'},
    {id:'rhoMax',ok:Math.max(AsTop,AsBot)<=Amax,text:`ρ ≤ 0.025`,ref:'A 4.1.2(c)'},
    {id:'bars',ok:!!topBars&&!!botBars&&!top.doubly,text:top.doubly?'Mu > Mu,lim — increase depth':'bars fit in the width',ref:'IS 456 G-1.1'},
    {id:'shear',ok:tv<=tmax,text:`τv = ${tv.toFixed(2)} ≤ τc,max = ${tmax} MPa`,ref:'IS 456 40.2.3'},
    {id:'links',ok:links.end>=75,text:`end-zone links ${links.dia}φ @ ${links.end} mm (≤ min(d/4, 8db, 100), ≥ 75)`,ref:'A 4.1.3(g)'},
  ];
  return {id:beam.id,axis:beam.axis,L,b,D,d,wD,wL,ME,hog,sagSpan,sagSupport,topReq,botReq,topBars,botBars,
    Mh,Ms,Vg,Vcap,Van,Vu,tv,tc,links,ok:checks.every(c=>c.ok||c.advisory),checks,top:label(topBars),bottom:label(botBars),
    lengths:{endZone:Math.round(2*d)}};
}

// ---- columns ----
function columnOptions(Ag){
  const out=[];
  for(const count of [8,12,16])for(const dia of BAR_DIAS){const As=count*S.area(dia),p=As/Ag;
    if(p>=0.01-1e-9&&p<=0.04)out.push({count,dia,As,p});}
  return out.sort((a,b)=>a.As-b.As||a.count-b.count);
}
function gravityColumnMoment(model,grav,s,c,dir){
  // One-cycle distribution of the unbalanced fixed-end moments at the column top
  // (slab s+1) to the column, by gross stiffness (beams far-end fixed).
  const d=model.diaphragms[s],l=grav.levels[s],bs=d.beams.filter(b=>b.axis===dir&&(same(b.a,c)||same(b.e,c)));
  const fem=bs.map(b=>{const i=d.beams.indexOf(b),pb=l.perBeam[i];return {left:same(b.e,c),D:(pb.dl+(pb.self||0))*b.L/12,L:pb.ll*b.L/12};});
  const sgn=f=>f.left?1:-1;
  const MD=Math.abs(fem.reduce((n,f)=>n+sgn(f)*f.D,0)),ML=Math.max(0,...fem.map(f=>f.L));
  const Ic=model.colB**4/12,hS=model.storeys[s].h,up=model.storeys[s+1];
  const kc=Ic/hS,kcu=up&&up.columns.some(q=>same(q,c))?Ic/up.h:0,kb=bs.reduce((n,b)=>n+b.b*b.D**3/12/b.L,0);
  const share=kc/(kc+kcu+kb||1);
  return {MD:MD*share,ML:ML*share};
}
function designColumn(model,{P,Mg,E,h,fck,fy,top}){
  const inp=model.inputs,B=model.colB*1000,Ag=B*B,link=8;
  const emin=Math.max(h*1000/500+B/30,20);
  const combos=[];
  const add=(name,Pu,Mx,My)=>combos.push({name,Pu,Mx:Math.max(Math.abs(Mx),Pu*emin/1000),My:Math.max(Math.abs(My),Pu*emin/1000)});
  add('1.5(DL+LL)',1.5*(P.PD+P.PL),1.5*(Mg.x.MD+Mg.x.ML),1.5*(Mg.y.MD+Mg.y.ML));
  add('1.2DL+1.5LL',1.2*P.PD+1.5*P.PL,1.2*Mg.x.MD+1.5*Mg.x.ML,1.2*Mg.y.MD+1.5*Mg.y.ML);
  for(const dir of ['x','y'])for(const sg of [1,-1]){
    const e=E[dir],o=dir==='x'?'y':'x';
    add(`DL+0.3LL${sg>0?'+':'−'}E${dir}`,P.PD+0.3*P.PL+sg*e.P,(dir==='x'?e.M:0)+Mg.x.MD+0.3*Mg.x.ML,(dir==='y'?e.M:0)+Mg.y.MD+0.3*Mg.y.ML);
    add(`0.9DL${sg>0?'+':'−'}E${dir}`,0.9*P.PD+sg*e.P,(dir==='x'?e.M:0)+0.9*Mg.x.MD,(dir==='y'?e.M:0)+0.9*Mg.y.MD);
    void o;
  }
  let chosen=null,worst=null;
  for(const opt of columnOptions(Ag)){
    const rows=S.barRows(B,inp.coverColumnMm,link,opt.dia,opt.count);
    let wr=null;
    for(const c of combos){const r=S.biaxial(c.Pu*1e3,c.Mx*1e6,c.My*1e6,B,B,rows,fck,fy);if(!wr||r.ratio>wr.ratio)wr={...r,combo:c};}
    if(wr.ratio<=1){chosen={...opt,rows};worst=wr;break;}
    worst=wr;
  }
  return {B,combos,chosen,worst,emin,ok:!!chosen,label:chosen?`${chosen.count}-${chosen.dia}φ (${(chosen.p*100).toFixed(2)} %)`:'exceeds 4 % — enlarge column'};
}

// Confinement and detailing for a column (Annex A 4.2–4.3).
function columnDetailing(model,{h,fck,fy,chosen,linkDia=8}){
  const B=model.colB*1000,cover=model.inputs.coverColumnMm,lcl=h*1000-model.inputs.slabMm;
  const lo=Math.ceil(Math.max(B,lcl/6,450)/25)*25,db=chosen?.dia||16;
  const s=Math.min(B/4,8*db,100);
  const core=B-2*cover,legs=Math.ceil(core/300),hLink=core/legs;// leg spacing ≤ 300 mm with cross-ties (A 4.2.3 d)
  const Acc=(B-2*cover)**2,Ag=B*B;
  const AshReq=Math.max(0.18*s*hLink*fck/fy*(Ag/Acc-1),0.05*s*hLink*fck/fy);
  const dia=[8,10,12].find(d=>S.area(d)>=AshReq)||12;
  const crossTie=legs>1;
  return {lo,s:Math.floor(s/5)*5,hLink,Acc,AshReq,dia,crossTie,midSpacing:Math.min(B/2,300),
    checks:[{ok:B>=300,text:`least dimension ${B} mm ≥ 300 mm`,ref:'A 4.2.1(b)'},
      {ok:(chosen?.count||0)>=8,text:'≥ 8 bars in a rectangular column',ref:'A 4.2.2(a)'},
      {ok:(chosen?.dia||0)>=12,text:'bar dia ≥ 12 mm',ref:'A 4.2.2(d)'}]};
}

// Isolated square footing under each column (service loads, NBC 105 3.7/3.8; IS 456 34 for thickness/steel).
function designFooting(model,{P,E,M,fck,fy,sbc}){
  const c=model.colB*1000,cover=model.inputs.coverFootingMm;
  const serv=P.PD+P.PL,seis=P.PD+0.3*P.PL+0.7*Math.abs(E);
  const need=(load,q,m=0)=>{for(let Bm=0.9;Bm<=5;Bm+=0.075){const A=Bm*Bm,w=1.1*load;
    const qmax=w/A+6*m/(Bm**3);if(qmax<=q)return {B:Math.round(Bm*1000),A,qmax};}return null;};
  const g=need(serv,sbc),s=need(seis,1.5*sbc,0.7*M);
  const Bmm=Math.max(g?.B||5000,s?.B||5000,1000),Bm=Bmm/1000;
  const Pu=1.5*serv,qu=Pu/(Bm*Bm)/1000;// N/mm²
  let Dmm=300,res=null;
  for(;Dmm<=900;Dmm+=25){const d=Dmm-cover-12;
    const punch=qu*(Bmm*Bmm-(c+d)**2)/(4*(c+d)*d),tp=0.25*Math.sqrt(fck);
    const a=(Bmm-c)/2-d,oneWay=a>0?qu*Bmm*a/(Bmm*d):0;
    const Mu=qu*Bmm*((Bmm-c)/2)**2/2,Ast=Math.max(S.astForMoment(Mu,Bmm,d,fck,fy).Ast,0.0012*Bmm*Dmm);
    const tc=S.tauC(100*Ast/(Bmm*d),fck);
    res={D:Dmm,d,punch,tp,oneWay,tc,Mu,Ast};
    if(punch<=tp&&oneWay<=tc)break;
  }
  const bar=[12,16].map(dia=>({dia,spacing:Math.min(Math.floor(S.area(dia)*Bmm/res.Ast/10)*10,300)})).find(o=>o.spacing>=100)||{dia:16,spacing:100};
  return {B:Bmm,serv,seis,qService:g?.qmax,qSeismic:s?.qmax,...res,bar,Pu};
}

module.exports={takedown,designBeam,designColumn,columnDetailing,designFooting,gravityColumnMoment,chooseBars,label,columnOptions};
