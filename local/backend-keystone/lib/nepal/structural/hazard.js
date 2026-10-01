'use strict';
// Seismic hazard inputs from NBC 105:2025: zoning factor Z (Annex C), site soil
// type (Table 4-3 default for listed Kathmandu valley wards) and the elastic
// spectral shape Ch(T) for the Equivalent Static Method.
const {NBC105,annexCRows}=require('./codeData');

const TYPE_WORDS=[[/sub[-\s]?metropolitan( city)?|upa ?maha ?nagar ?palika/,'upamahanagarpalika'],
  [/metropolitan( city)?|maha ?nagar ?palika/,'mahanagarpalika'],
  [/rural municipality|gaun ?palika|gau ?palika/,'gaunpalika'],[/municipality|nagar ?palika/,'nagarpalika']];
function splitType(name){
  let s=String(name||'').toLowerCase();let type=null;
  for(const [re,t] of TYPE_WORDS)if(re.test(s)){type=t;s=s.replace(re,' ');break;}
  return {type,core:s};
}
// Romanised Nepali names are spelt many ways (Gokarneswor/Gokarneshwor,
// Manahara/Manahora): compare a reduced phonetic key.
function key(s){
  return String(s).toLowerCase().replace(/[^a-z]/g,'').replace(/sh/g,'s').replace(/w/g,'b').replace(/v/g,'b')
    .replace(/([bcdgjkpt])h/g,'$1').replace(/aa/g,'a').replace(/ee/g,'i').replace(/oo/g,'u').replace(/[aeiou]+$/,'')
    .replace(/[aeiou]/g,m=>m==='o'?'a':m);
}
function lev(a,b){
  const d=Array.from({length:a.length+1},(_,i)=>[i,...Array(b.length).fill(0)]);
  for(let j=1;j<=b.length;j++)d[0][j]=j;
  for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++)
    d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
  return d[a.length][b.length];
}
function similarity(a,b){if(!a||!b)return 0;return 1-lev(a,b)/Math.max(a.length,b.length);}

// Zoning factor for a municipality name (English or Nepali type word).
function zoneFactorFor(municipality,district){
  const rows=annexCRows();
  const {type,core}=splitType(municipality);
  const k=key(core);
  const scored=rows.map(r=>{
    const rt=splitType(r.localUnit);
    let s=similarity(k,key(rt.core));
    // Renamed units keep their old Annex C name (Pokhara → Pokhara Lekhnath).
    const qt=core.split(/\s+/).filter(Boolean).map(key),rtk=rt.core.split(/\s+/).filter(Boolean).map(key);
    if(qt.length&&qt.every(t=>rtk.includes(t)))s=Math.max(s,0.85);
    if(type&&rt.type!==type)s-=0.25;
    if(district&&key(district)!==key(r.district))s-=0.1;
    return {row:r,score:s};
  }).sort((a,b)=>b.score-a.score);
  const best=scored[0];
  if(!best||best.score<0.75)return {found:false,query:municipality,candidates:scored.slice(0,3).map(s=>s.row),ref:NBC105.zoneRef};
  return {found:true,Z:best.row.pga,row:best.row,confidence:Math.round(best.score*100)/100,
    ref:{source:'nbc105-2025',clause:`Annex C Table C-1 S.N. ${best.row.sn} (${best.row.district}, ${best.row.localUnit})`,page:best.row.page}};
}

function soilTypeFor(municipality,ward){
  const {core}=splitType(municipality);const k=key(core),w=Number(ward);
  for(const [name,wards] of NBC105.softSoilWards){
    const {core:nc}=splitType(name);
    if(similarity(k,key(nc))<0.8)continue;
    // Kathmandu/Lalitpur entries are the metropolitan cities only.
    if(/metropolitan/i.test(name)&&!/metropolitan|mahanagar/i.test(municipality))continue;
    if(wards==='all'||wards.includes(w))return {soil:'D',basis:'table_4_3_default',entry:name,ref:NBC105.softSoilRef};
    return {soil:null,basis:'listed_municipality_ward_not_listed',entry:name,ref:NBC105.softSoilRef};
  }
  return {soil:null,basis:'not_listed',ref:NBC105.softSoilRef};
}

// Ch(T) for the Equivalent Static Method: Ta = 0 (Table 4-1 note 1), so the
// rising branch disappears and the plateau starts at T = 0.
function spectralShape(T,soil,{method='ESM'}={}){
  const p=NBC105.spectral[soil];if(!p)throw new Error(`Unknown soil type ${soil}`);
  const Ta=method==='ESM'?0:p.Ta;
  if(T<Ta)return {value:1+(p.alpha-1)*T/Ta,branch:'T < Ta',params:{...p,Ta}};
  if(T<p.Tc)return {value:p.alpha,branch:'Ta ≤ T < Tc',params:{...p,Ta}};
  if(T<p.Td)return {value:p.alpha*p.Tc/T,branch:'Tc ≤ T < Td',params:{...p,Ta}};
  return {value:p.alpha*p.Tc*p.Td/(T*T),branch:'Td ≤ T ≤ 6 s',params:{...p,Ta}};
}

module.exports={zoneFactorFor,soilTypeFor,spectralShape,key,similarity};
