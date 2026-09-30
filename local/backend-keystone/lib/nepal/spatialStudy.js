'use strict';
const path=require('node:path');
const {spawn}=require('node:child_process');
function runSpatialStudy(candidates,{timeoutMs=90000}={}){
  return new Promise((resolve,reject)=>{
    const script=path.resolve(__dirname,'../../..','planner/spatial_study.py');
    const child=spawn('python',[script],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='',settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);
      error?reject(error):resolve(value);};
    const timer=setTimeout(()=>{child.kill();finish(new Error('Polygon search time limit reached; no infeasibility claim is made.'));},timeoutMs);
    child.on('error',error=>finish(error));
    child.stdin.on('error',error=>finish(error));
    child.stdout.on('data',data=>{stdout+=data;if(stdout.length>12000000){child.kill();finish(new Error('Polygon output exceeded local review limit.'));}});
    child.stderr.on('data',data=>{stderr=(stderr+data).slice(-4000);});
    child.on('close',code=>{
      try{const result=JSON.parse(stdout);if(code||result.error)throw new Error(result.error||stderr);
        finish(null,result);}catch(error){finish(new Error(`Polygon study unavailable: ${error.message}. Install local/planner/requirements.txt in the local Python environment.`));}
    });
    child.stdin.end(JSON.stringify({candidates}));
  });
}
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function rings(g){if(!g)return [];if(g.type==='Polygon')return [g.coordinates];
  if(g.type==='MultiPolygon')return g.coordinates;return [];}
function pathFor(g){return rings(g).map(p=>p.map(r=>r.map(([x,y],i)=>`${i?'L':'M'}${x},${-y}`).join(' ')+'Z').join(' ')).join(' ');}
function draw(g,fill,stroke='#30464c',width=25){return `<path d="${pathFor(g)}" fill="${fill}" fill-rule="evenodd" stroke="${stroke}" stroke-width="${width}"/>`;}
function line(g,color,width=55){if(g.type==='MultiLineString')return g.coordinates.map(coordinates=>line({coordinates},color,width)).join('');return `<polyline points="${g.coordinates.map(([x,y])=>`${x},${-y}`).join(' ')}" fill="none" stroke="${color}" stroke-width="${width}"/>`;}
function renderSpatialStudy(result){
  const sections=result.studies.map(s=>{
    const coords=s.site.coordinates[0],maxX=Math.max(...coords.map(p=>p[0])),maxY=Math.max(...coords.map(p=>p[1]));
    return `<section><h2>${esc(s.candidateId)}</h2><p>Projecting balconies: ${s.balconyCount}; irregular rooms: ${s.irregularRoomCount}; void: ${esc(s.voidUse||s.courtStatus)} (${esc(s.voidApproval||'no void placed')}). Projected slab/balcony coverage: ${(s.projectedCoverageRatio*100).toFixed(1)}% (legal treatment unresolved).</p><p>Original concept issues and new clear-space findings remain open. This is a measured polygon study, not a validated house.</p><div class="floors">${s.levels.map(l=>{
      let svg=draw(s.site,'#f5f4ed','#879993');
      svg+=draw(l.slab,'#ece9dc');
      if(l.unassignedPolygon)svg+=draw(l.unassignedPolygon,'#f4c7ac','#b4774c',20);
      if(s.court){svg+=draw(s.court,'#d8eadf','#46735b');svg+=draw(s.courtClearCore,'none','#77a28a',15);}
      for(const b of l.balconies){svg+=draw(b.shape,'#dfece6','#46735b',20);svg+=line(b.guard,'#46735b',65);}
      for(const r of l.rooms){svg+=draw(r.polygon,r.type==='bathroom'?'#ebe5df':r.type==='kitchen'?'#f1dec4':'#e3eaf0','none');
        if(r.functionalZone)svg+=draw(r.functionalZone,'none','#a7b1ab',12);
        const [x,y]=r.labelPoint;
        svg+=`<text x="${x}" y="${-y}" font-size="155" text-anchor="middle">${esc(r.type)} · ${r.clearAreaSqM.toFixed(1)} m² clear</text>`;}
      svg+=draw(l.wallSolids,'#293e44','none');
      for(const o of l.openings)svg+=line(o.geometry,o.kind.includes('window')?'#3384a0':'#b46b39');
      const stair=s.core.flights?.find(f=>f.from===l.id)||s.core.flights?.find(f=>f.to===l.id);
      for(const f of stair?.flights||[])for(let i=0;i<f.riserCount;i++){
        const y=f.box.y1+i*f.treadMm;
        svg+=line({coordinates:[[f.box.x1,y],[f.box.x2,y]]},'#718583',18);
      }
      const c=s.core.box;svg+=`<text x="${(c.x1+c.x2)/2}" y="${-(c.y1+c.y2)/2}" text-anchor="middle" font-size="190">SHARED STAIR</text>`;
      for(const col of l.columns||[])svg+=`<rect x="${col.xMm-col.widthMm/2}" y="${-col.yMm-col.widthMm/2}" width="${col.widthMm}" height="${col.widthMm}" fill="#40565b"/>`;
      return `<article><h3>${esc(l.id)}</h3><svg viewBox="-400 ${-maxY-400} ${maxX+800} ${maxY+800}">${svg}</svg><p>${l.issues.map(i=>esc(i.code+': '+i.roomId)).join('; ')||'Sampled functional rectangles fit; furniture/egress still unverified.'}</p></article>`;
    }).join('')}</div><details><summary>Court search rejection reasons and original findings</summary><pre>${esc(JSON.stringify({court:s.courtAttempts,original:s.originalFindings},null,2))}</pre></details><p>${s.unresolved.map(esc).join(' · ')}</p></section>`;
  }).join('');
  return `<!doctype html><html><meta charset="utf-8"><title>Nepal polygon spatial study</title><style>body{font:15px/1.5 Arial;background:#eef0eb;color:#213a40;margin:24px}section{background:white;padding:20px;margin:24px 0}.floors{display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:20px}article{border:1px solid #bcc9c0;padding:12px}svg{width:100%}pre{white-space:pre-wrap}@media print{section{break-after:page}.floors{grid-template-columns:1fr 1fr}}</style><h1>Balconies, vertical courts and polygon rooms</h1><p>Local architectural study. Peach: unassigned space; brown: openings; blue: windows; green: proposed outdoor slab/court; thin inner outline: sampled functional rectangle. Enclosed boundaries remain solid except at actual openings. A projection that fits the plot is not automatically legally allowed. The search also tries a 4.5 ft square bathroom/service shaft (owner working assumption, approval unverified); its windows receive no habitable-room daylight credit.</p>${sections}</html>`;
}
module.exports={runSpatialStudy,renderSpatialStudy};
