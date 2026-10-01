'use strict';
// Reinforced concrete section mechanics (limit state, IS 456:2000 stress
// block — the code NBC 205 cl 6.1(g)/7.3 refers to; IS 456 is NOT among the
// supplied files, so these clause formulas are shown for engineer verification).
// Units: N, mm, MPa.

const xuMaxRatio=fy=>fy>=500?0.46:fy>=415?0.48:0.53;
const muLimCoeff=(fy)=>{const k=xuMaxRatio(fy);return 0.36*k*(1-0.416*k);};// Mu,lim = coeff·fck·b·d²

function astForMoment(Mu,b,d,fck,fy){
  // Singly reinforced: Ast = 0.5 fck/fy [1 − √(1 − 4.6 Mu/(fck b d²))] b d.
  // Above Mu,lim: compression steel with fsc ≈ 0.87fy·0.95 (d'/d ≈ 0.1, SP 16 Table F, verify).
  const lim=muLimCoeff(fy)*fck*b*d*d;
  if(Mu<=lim){const t=1-4.6*Mu/(fck*b*d*d);return {Ast:0.5*fck/fy*(1-Math.sqrt(Math.max(t,0)))*b*d,Asc:0,lim,doubly:false};}
  const xu=xuMaxRatio(fy)*d,AstLim=0.36*fck*b*xu/(0.87*fy),fsc=Math.min(0.87*fy*0.95,412),dc=0.1*d;
  const Asc=(Mu-lim)/(fsc*(d-dc));
  return {Ast:AstLim+Asc*fsc/(0.87*fy),Asc,lim,doubly:true};
}
function momentCapacity(Ast,b,d,fck,fy){
  const xu=Math.min(0.87*fy*Ast/(0.36*fck*b),xuMaxRatio(fy)*d);
  return 0.87*fy*Math.min(Ast,0.36*fck*b*xu/(0.87*fy))*(d-0.416*xu);
}
// Design shear strength of concrete τc (IS 456 Table 19), from the formula the
// table is built on: τc = 0.85√(0.8fck)(√(1+5β) − 1)/(6β), β = 0.8fck/(6.89 pt) ≥ 1.
function tauC(pt,fck){
  const p=Math.max(0.15,Math.min(pt,3));const beta=Math.max(1,0.8*fck/(6.89*p));
  return 0.85*Math.sqrt(0.8*fck)*(Math.sqrt(1+5*beta)-1)/(6*beta);
}
const tauCMax=fck=>fck>=40?4.0:fck>=35?3.7:fck>=30?3.5:fck>=25?3.1:2.8;// Table 20

// Column section with bars on the four faces: rows of bars for bending about one axis.
function barRows(D,cover,link,dia,count){
  const perFace=count/4+1,c=D/2-cover-link-dia/2,A=Math.PI*dia*dia/4,rows=[];
  for(let i=0;i<perFace;i++){const y=-c+2*c*i/(perFace-1);
    rows.push({y,As:A*((i===0||i===perFace-1)?perFace:2)});}
  return rows;
}
// IS 456 parabola–rectangle block (0.446fck, εc0 0.002, εcu 0.0035; strain pivots
// at 3D/7 when the neutral axis is outside), bilinear steel (Es 2×10⁵, 0.87fy).
function sectionForces(xu,b,D,rows,fck,fy){
  const eps=y=>{const fromTop=D/2-y;// y measured from centroid, + toward compression face
    if(xu<=D)return 0.0035*(xu-fromTop)/xu;
    return 0.002*(xu-fromTop)/(xu-3*D/7);};
  const fc=e=>e<=0?0:e>=0.002?0.446*fck:0.446*fck*(2*e/0.002-(e/0.002)**2);
  const n=60;let P=0,M=0;
  for(let i=0;i<n;i++){const y=D/2-(i+0.5)*D/n,f=fc(eps(y))*b*D/n;P+=f;M+=f*y;}
  for(const r of rows){const e=eps(r.y);let fs=Math.max(-0.87*fy,Math.min(0.87*fy,2e5*e));
    if(e>0)fs-=fc(e);P+=fs*r.As;M+=fs*r.As*r.y;}
  return {P,M};
}
function uniaxialCapacity(Pu,b,D,rows,fck,fy){
  const Asc=rows.reduce((n,r)=>n+r.As,0),Pmax=0.4*fck*(b*D-Asc)+0.67*fy*Asc;// 39.3
  if(Pu>Pmax)return {Mu:0,Pmax,ok:false};
  let lo=1e-3*D,hi=20*D;
  const Pl=sectionForces(lo,b,D,rows,fck,fy).P;
  if(Pu<Pl){// net tension: interpolate to pure tension
    const T=-0.87*fy*Asc,Ml=sectionForces(lo,b,D,rows,fck,fy).M;return {Mu:Math.max(0,Ml*(Pu-T)/(Pl-T)),Pmax,ok:Pu>=T};}
  for(let i=0;i<60;i++){const mid=(lo+hi)/2;if(sectionForces(mid,b,D,rows,fck,fy).P<Pu)lo=mid;else hi=mid;}
  return {Mu:Math.abs(sectionForces((lo+hi)/2,b,D,rows,fck,fy).M),Pmax,ok:true};
}
// Biaxial check, IS 456 39.6: (Mux/Mux1)^αn + (Muy/Muy1)^αn ≤ 1.
function biaxial(Pu,Mux,Muy,b,D,rows,fck,fy){
  const Asc=rows.reduce((n,r)=>n+r.As,0),Puz=0.45*fck*(b*D-Asc)+0.75*fy*Asc;
  const cap=uniaxialCapacity(Pu,b,D,rows,fck,fy);
  if(!cap.ok||cap.Mu<=0)return {ratio:Infinity,cap,Puz,an:2};
  const r=Pu/Puz,an=r<=0.2?1:r>=0.8?2:1+(r-0.2)/0.6;
  return {ratio:(Mux/cap.Mu)**an+(Muy/cap.Mu)**an,cap,Puz,an};
}
const area=dia=>Math.PI*dia*dia/4;

module.exports={astForMoment,momentCapacity,tauC,tauCMax,barRows,sectionForces,uniaxialCapacity,biaxial,area,xuMaxRatio,muLimCoeff};
