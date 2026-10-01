'use strict';
// NBC 105:2025 Equivalent Static Method for a bare RC moment frame: hazard,
// period (empirical × 1.25 vs Rayleigh), base shear for ULS and SLS, vertical
// distribution, storey stiffness by the D-value (Muto) method with Table 3-1
// cracked sections, drifts, torsion and the frame's seismic member actions.
const {NBC105,IS1893}=require('./codeData');
const {zoneFactorFor,soilTypeFor,spectralShape}=require('./hazard');
const r3=n=>Math.round(n*1000)/1000;
const same=(p,q)=>Math.abs(p.x-q.x)<1e-3&&Math.abs(p.y-q.y)<1e-3;

function hazardInputs(model){
  const j=model.brief?.jurisdiction||{},inp=model.inputs,notes=[];
  let Z=Number(inp.Z),zone=null;
  if(!(Z>0)){zone=zoneFactorFor(j.municipality||'',j.district);
    if(!zone.found)throw Object.assign(new Error(`No NBC 105 Annex C zoning factor matches "${j.municipality}". Enter Z.`),{code:'ZONE_FACTOR_UNKNOWN',candidates:zone.candidates});
    Z=zone.Z;}
  let soils,soilBasis;
  if(inp.soil&&NBC105.spectral[inp.soil]){soils=[inp.soil];soilBasis={basis:'owner_or_engineer_input'};}
  else{const s=soilTypeFor(j.municipality||'',j.ward);soilBasis=s;
    if(s.soil)soils=[s.soil];
    else{soils=['C','D'];notes.push('Site soil type not established (no Vs,30/NSPT; site not in Table 4-3 default list). Both soil types C and D are calculated and the larger base shear governs until a soil investigation classifies the site (Table 4-2).');}}
  const I=NBC105.importance[inp.importanceClass]??1.0;
  return {Z,zone,soils,soilBasis,I,notes,...NBC105.rcFrame};
}

// D-values of every column in every storey for sway in direction dir.
function storeyStiffness(model,{fck,state='uls'}){
  const f=state==='uls'?NBC105.crackedULS:NBC105.crackedSLS;
  const Ec=5000*Math.sqrt(fck)*1000;// kN/m²
  const b=model.colB,Ic=b**4/12;
  return model.storeys.map((s,si)=>{
    const top=model.diaphragms[si],bot=si>0?model.diaphragms[si-1]:null;
    const Kc=f.column*Ic/s.h;
    const out={x:[],y:[]};
    for(const dir of ['x','y'])for(const c of s.columns){
      const kb=d=>d?d.beams.filter(bm=>bm.axis===dir&&(same(bm.a,c)||same(bm.e,c))).reduce((n,bm)=>n+f.beam*bm.b*bm.D**3/12/bm.L,0):0;
      const kTop=kb(top),kBot=kb(bot);
      let kbar,a;
      if(si===0){kbar=kTop/Kc;a=(0.5+kbar)/(2+kbar);}// fixed base
      else{kbar=(kTop+kBot)/(2*Kc);a=kbar/(2+kbar);}
      const D=a*12*Ec*f.column*Ic/s.h**3;
      out[dir].push({id:c.id,x:c.x,y:c.y,kbar,a,D,kTop,kBot});
    }
    const sum=dir=>out[dir].reduce((n,c)=>n+c.D,0);
    const Kx=sum('x'),Ky=sum('y');
    const xR=Ky?out.y.reduce((n,c)=>n+c.D*c.x,0)/Ky:0,yR=Kx?out.x.reduce((n,c)=>n+c.D*c.y,0)/Kx:0;
    const J=out.x.reduce((n,c)=>n+c.D*(c.y-yR)**2,0)+out.y.reduce((n,c)=>n+c.D*(c.x-xR)**2,0);
    return {storey:s.id,h:s.h,Ec,Ic,Kc,cols:out,K:{x:Kx,y:Ky},cr:{x:xR,y:yR},J};
  });
}

function distribution(W,z,V,T){
  const k=T<=0.5?1:T>=2.5?2:1+(T-0.5)/2;
  const wh=W.map((w,i)=>w*z[i]**k),sum=wh.reduce((a,b)=>a+b,0);
  return {k,F:wh.map(x=>x/sum*V),sumWh:sum};
}

function analyse(model,grav){
  const inp=model.inputs,hz=hazardInputs(model);
  const levels=grav.levels,W=levels.map(l=>l.W),z=levels.map(l=>l.z),Wt=W.reduce((a,b)=>a+b,0);
  const H=z.at(-1);
  const fck=inp.fck||(H>12?25:20);
  const Tbase=NBC105.kt.rcFrame*H**0.75,Temp=NBC105.periodAmplification*Tbase;
  const uls=storeyStiffness(model,{fck,state:'uls'}),sls=storeyStiffness(model,{fck,state:'sls'});
  const nS=model.storeys.length,kd=NBC105.kd[Math.min(nS,6)-1];
  const dirs={};
  for(const dir of ['x','y']){
    // Seismic coefficient for each candidate soil; Rayleigh period from the
    // elastic displacements under the ULS force pattern.
    const perSoil=hz.soils.map(soil=>{
      const run=T=>{
        const ch=spectralShape(T,soil),C=ch.value*hz.Z*hz.I,Cd=C/(hz.Rmu*hz.omegaU);
        const Cs=NBC105.slsFactor*C,CdS=Cs/hz.omegaS;
        const V=Cd*Wt,VS=CdS*Wt,dist=distribution(W,z,V,T),distS=distribution(W,z,VS,T);
        const shear=F=>F.map((_,i)=>F.slice(i).reduce((a,b)=>a+b,0));
        const Vs=shear(dist.F),VsS=shear(distS.F);
        const drift=uls.map((s,i)=>Vs[i]/s.K[dir]),driftS=sls.map((s,i)=>VsS[i]/s.K[dir]);
        const disp=drift.map((_,i)=>drift.slice(0,i+1).reduce((a,b)=>a+b,0));
        return {T,ch,C,Cd,Cs,CdS,V,VS,dist,distS,Vs,VsS,drift,driftS,disp};
      };
      const first=run(Temp);
      const num=W.reduce((n,w,i)=>n+w*first.disp[i]**2,0),den=9.81*first.dist.F.reduce((n,f,i)=>n+f*first.disp[i],0);
      const Tray=2*Math.PI*Math.sqrt(num/den);
      const T=Math.min(Temp,Tray);
      const res=run(T);
      return {soil,Tray,T,rayleigh:{num,den},...res};
    });
    const gov=perSoil.reduce((a,b)=>b.V>a.V?b:a);
    // Drift checks (5.5.1, 5.5.3, 6.5).
    const drifts=model.storeys.map((s,i)=>{
      const ulsD=gov.drift[i]*hz.Rmu*kd,slsD=gov.driftS[i]*kd;
      return {storey:s.id,h:s.h,elastic:gov.drift[i],uls:ulsD,ulsRatio:ulsD/s.h,sls:slsD,slsRatio:slsD/s.h,
        okULS:ulsD/s.h<=NBC105.driftLimit.uls,okSLS:slsD/s.h<=NBC105.driftLimit.sls};
    });
    // Torsion: storey shear acts at the resultant of the floor forces above at
    // their centres of mass; design eccentricity adds ±0.05 b (5.6).
    const other=dir==='x'?'y':'x';
    const torsion=model.storeys.map((s,i)=>{
      const st=uls[i],Fa=gov.dist.F.slice(i),La=levels.slice(i);
      const pos=Fa.reduce((n,f,j)=>n+f*La[j].cm[other],0)/Fa.reduce((a,b)=>a+b,0);
      const ext=s.boxes.reduce((e,b)=>({lo:Math.min(e.lo,b[other+'1']),hi:Math.max(e.hi,b[other+'2'])}),{lo:Infinity,hi:-Infinity});
      const bdim=ext.hi-ext.lo,cr=st.cr[other],e0=pos-cr,acc=NBC105.accidentalEccentricity*bdim;
      const V=gov.Vs[i],K=st.K[dir],cols=st.cols[dir];
      const coords=cols.map(c=>c[other]),lo=Math.min(...coords),hi=Math.max(...coords);
      const drAt=(e,at)=>V/K+V*e/st.J*(at-cr);
      const d1=drAt(e0,hi),d2=drAt(e0,lo),mx=Math.max(d1,d2),mn=Math.min(d1,d2);
      const ratio=mn>0?mx/mn:Infinity;
      // Column shears: direct + torsional, worst of e0 ± 0.05b, never below direct share.
      const colShear=cols.map(c=>{
        const direct=V*c.D/K,tors=e=>V*e*c.D*(c[other]-cr)/st.J;
        return {id:c.id,x:c.x,y:c.y,D:c.D,direct,V:Math.max(direct,...[e0+acc,e0-acc].map(e=>direct+tors(e)))};
      });
      return {storey:s.id,b:bdim,cmResultant:pos,cr,e0,acc,edPlus:e0+acc,edMinus:e0-acc,J:st.J,
        driftMax:mx,driftMin:mn,ratio,irregular:ratio>NBC105.irregularity.torsion,extreme:ratio>NBC105.irregularity.extremeTorsion,colShear};
    });
    // Column end moments (inflection at 0.6 h from the fixed base in the ground
    // storey, mid-height above) and beam moments from joint equilibrium,
    // shared by beam stiffness; beam shears give the frame's seismic column axial.
    const colM=torsion.map((t,i)=>{const y0=i===0?0.6:0.5,h=model.storeys[i].h;
      return Object.fromEntries(t.colShear.map(c=>[c.id,{V:c.V,Mbot:c.V*y0*h,Mtop:c.V*(1-y0)*h}]));});
    const beamE=new Map(),axialE=model.storeys.map(()=>({}));
    model.diaphragms.forEach((d,k)=>{// k: storey below index
      const below=colM[k],above=colM[k+1]||{};
      for(const c of model.storeys[k].columns){
        const Mj=(below[c.id]?.Mtop||0)+(above[c.id]?.Mbot||0);
        const bs=d.beams.filter(bm=>bm.axis===dir&&(same(bm.a,c)||same(bm.e,c)));
        const ks=bs.map(bm=>bm.b*bm.D**3/12/bm.L),sk=ks.reduce((a,b)=>a+b,0);
        bs.forEach((bm,i)=>{const m=sk?Mj*ks[i]/sk:0,e=beamE.get(bm.id)||{beam:bm,MA:0,MB:0,level:d.k};
          if(same(bm.a,c))e.MA+=m;else e.MB+=m;beamE.set(bm.id,e);});
      }
    });
    for(const e of beamE.values())e.V=(e.MA+e.MB)/e.beam.L;
    // Sway toward +dir: beam shear pulls the start (a) column up and pushes the end (e) down.
    model.storeys.forEach((s,si)=>{for(const c of s.columns){let P=0;
      for(const e of beamE.values()){if(e.level<=si)continue;
        if(same(e.beam.a,c))P-=e.V;else if(same(e.beam.e,c))P+=e.V;}
      axialE[si][c.id]=P;}});
    dirs[dir]={perSoil,gov,drifts,torsion,colM,beamE:[...beamE.values()],axialE};
  }
  // ESM applicability (3.2.1).
  const Tmax=Math.max(dirs.x.gov.T,dirs.y.gov.T);
  const esm={H,ok:H<=15||Tmax<0.5,basis:H<=15?'H ≤ 15 m (3.2.1 i)':Tmax<0.5?'T < 0.5 s (3.2.1 ii)':'requires regular structure and H < 40 m (3.2.1 iii) — checked with irregularities'};
  // IS 1893 cross-check (information only; NBC 105 governs).
  const dim=dir=>{const xs=model.storeys[0].boxes;return dir==='x'?Math.max(...xs.map(b=>b.x2))-Math.min(...xs.map(b=>b.x1)):Math.max(...xs.map(b=>b.y2))-Math.min(...xs.map(b=>b.y1));};
  const isCheck=['x','y'].map(dir=>{
    const d=dim(dir),Tinf=0.09*H/Math.sqrt(d),Tbare=0.075*H**0.75;
    const soil=dirs[dir].gov.soil,type=soil==='D'?'III':soil==='C'?'II':'I';
    const sa=T=>type==='I'?(T<0.4?2.5:T<4?1/T:0.25):type==='II'?(T<0.55?2.5:T<4?1.36/T:0.34):(T<0.67?2.5:T<4?1.67/T:0.42);
    const Ah=hz.Z*hz.I*sa(Tinf)/5;
    return {dir,d,Tinfill:Tinf,Tbare,soilType:type,SaG:sa(Tinf),AhUsingNbcZ:Ah,nbcCd:dirs[dir].gov.Cd};
  });
  return {hz,fck,H,Tbase,Temp,W,z,Wt,kd,uls,sls,dirs,esm,isCheck,refs:{is:IS1893}};
}

module.exports={analyse,hazardInputs,storeyStiffness,distribution};
