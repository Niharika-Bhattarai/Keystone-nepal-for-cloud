'use strict';
// Review-only geometry gallery. It cannot be mistaken for a permit drawing.
const fs=require('node:fs');
const path=require('node:path');
const backend=path.join(__dirname,'..','backend-keystone');
const fixture=require(path.join(backend,'test','fixtures','nepal','rental-3_5.json'));
const {normalizeBrief}=require(path.join(backend,'lib','nepal','normalizeBrief'));
const {searchConcepts}=require(path.join(backend,'lib','nepal','candidateSearch'));
const result=searchConcepts(normalizeBrief(fixture).brief,{provisionalSetbacksMm:[1000,1000,1000,1000]});
const dest=path.join(__dirname,'..','runtime','nepal-hypotheses');fs.mkdirSync(dest,{recursive:true});
const palette={livingRoom:'#d4dcbf',kitchen:'#e9b88a',primaryBedroom:'#b6cce0',guestBedroom:'#b5d9df',
  bedroom:'#d4dfee',bathroom:'#d8d3d0',puja:'#efdca9'};
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function shape(box,fill,stroke='#424f53',width=2){return `<rect x="${box.x1}" y="${box.y1}" width="${box.x2-box.x1}" height="${box.y2-box.y1}" fill="${fill}" stroke="${stroke}" stroke-width="${width*20}"/>`;}
function markOpening(o,color){
  if(!o)return '';
  const line=o.axis==='vertical'?{x1:o.x,y1:o.y1,x2:o.x,y2:o.y2}:
    {x1:o.x1,y1:o.y,x2:o.x2,y2:o.y};
  const attrs=Object.entries(line).map(([k,v])=>`${k}="${v}"`).join(' ');
  return `<line ${attrs} stroke="#fff" stroke-width="140"/><line ${attrs} stroke="${color}" stroke-width="78"/>`;
}
function svg(candidate,level) {
  const site=candidate.envelope.site;
  const text=(x,y,label,size=280)=>`<text x="${x}" y="${y}" font-family="Arial" font-size="${size}" fill="#233238">${escape(label)}</text>`;
  const footprint=level.footprint.slabs.map(b=>shape(b,'#f4f2e8','#1f3239',3)).join('');
  const rooms=(level.rooms?.rooms||[]).map(r=>shape(r.box,palette[r.type]||'#dedbd1')+
    text(r.box.x1+120,r.box.y1+360,r.type,250)).join('');
  const openings=(level.rooms?.rooms||[]).map(r=>markOpening(r.doorReservation,'#ae643b')+
    markOpening(r.windowReservation,'#327d9d')).join('')+
    markOpening(level.rooms?.unitEntry?.doorReservation,'#ae643b');
  const corridor=level.rooms?shape(level.rooms.corridor,'#f1e9d2','#697575',1):'';
  const core=shape(candidate.core.box,'#c4c7c4','#182c34',3)+text(candidate.core.box.x1+220,candidate.core.box.y1+500,'SHARED STAIR',220);
  const tank=level.id===candidate.levels[0].id?shape(candidate.core.reservoir.innerPlanBox,'none','#26687a',2)+
    text(candidate.core.box.x1+250,candidate.core.box.y2-450,'8,000 L TANK BELOW',220):'';
  return `<svg viewBox="-600 -700 ${site.x2+1200} ${site.y2+1400}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Unverified ${escape(level.id)} spatial hypothesis"><rect x="-600" y="-700" width="${site.x2+1200}" height="${site.y2+1400}" fill="#fff"/>${shape(site,'none','#9aa9a4',2)}${footprint}${corridor}${rooms}${core}${tank}${openings}</svg>`;
}
const cards=result.candidates.map(candidate=>`<section><h2>${escape(candidate.id)}</h2><p>Unverified spatial hypothesis. ${candidate.validation.blockers.length} validation blockers.</p><div class="floors">${candidate.levels.map(level=>`<article><h3>${escape(level.id)}</h3>${svg(candidate,level)}</article>`).join('')}</div></section>`).join('');
const html=`<!doctype html><meta charset="utf-8"><title>Nepal hypotheses - not floor plans</title><style>body{font:16px Arial;color:#233238;background:#e9eee9;margin:24px}h1{font-size:28px}section{background:#fff;padding:20px;margin:20px 0}h2{font-size:19px}.floors{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}article{border:1px solid #bbc6c2;padding:10px}svg{width:100%;max-height:520px}small{color:#6c7571}</style><h1>Nepal spatial hypotheses</h1><p>Geometry review only. These are not generated architectural plans or permit drawings. Brown lines reserve clear door widths; blue lines reserve provisional physical window widths. Door swings, legal window exposure and structural member details are unverified.</p>${cards}`;
fs.writeFileSync(path.join(dest,'index.html'),html);
fs.writeFileSync(path.join(dest,'results.json'),JSON.stringify({attempts:result.attempts,variations:result.variations,
  candidates:result.candidates.map(c=>({id:c.id,validation:c.validation,score:c.score}))},null,2));
console.log(path.join(dest,'index.html'));
