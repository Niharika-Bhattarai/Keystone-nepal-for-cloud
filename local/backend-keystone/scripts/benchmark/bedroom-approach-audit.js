'use strict';

// Read-only companion to clear-route-audit. Inputs are that command's explicitly
// assumed level files. No schedules or furniture are changed by this audit.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {checkBedroomApproach}=require('../../lib/geometry/bedroomApproach');
const {buildFloorPassageModel}=require('../../lib/geometry/floorPassageModel');
const input=process.argv[2];
if(!input)throw new Error('Usage: node scripts/benchmark/bedroom-approach-audit.js <floor-passage-audit-directory> [output-directory]');
const backend=path.resolve(__dirname,'../..');
const out=path.resolve(process.argv[3]||path.join(backend,'../tmp/universal-coverage',`${new Date().toISOString().replace(/[:.]/g,'-')}-bedroom-approach-audit`));
fs.mkdirSync(out,{recursive:true});
const files=fs.readdirSync(input).filter(f=>f.endsWith('-assumed-level.json'));
if(!files.length)throw new Error('No labelled assumed-level JSON found.');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
const report={startedAt:new Date().toISOString(),source:path.resolve(input),sourceHashes:{},implementationHashes:{},results:[],
  scope:'Local hallway-side doorway approach to full bed-side square footprints. Explicit assumptions only; no door swings, whole-house access, stair or accessibility certification.'};
for(const file of ['lib/geometry/clearRoute.js','lib/geometry/bedroomApproach.js','lib/geometry/floorPassageModel.js','lib/geometry/openingIdentity.js','scripts/benchmark/bedroom-approach-audit.js'])report.implementationHashes[file]=sha(fs.readFileSync(path.join(backend,file)));
function draw(name,level,result){
  const m=buildFloorPassageModel(level),parts=m.roomClear.flatMap(r=>r.parts);
  const minX=Math.min(...parts.map(p=>p.x)),minY=Math.min(...parts.map(p=>p.y)),w=Math.max(...parts.map(p=>p.x+p.w))-minX,h=Math.max(...parts.map(p=>p.y+p.h))-minY;
  const rects=(items,color)=>items.map(p=>`<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" fill="${color}"/>`).join('');
  const paths=result.sides.filter(s=>s.status==='clear').map((s,i)=>{
    const color=i?'#3c59a1':'#137c52';
    const a=s.path[0],b=s.path.at(-1),r=result.clearWidthFt/2;
    return `<polyline points="${s.path.map(p=>`${p.x},${p.y}`).join(' ')}" fill="none" stroke="${color}" stroke-opacity="0.2" stroke-width="${r*2}" stroke-linecap="square" stroke-linejoin="miter"/><polyline points="${s.path.map(p=>`${p.x},${p.y}`).join(' ')}" fill="none" stroke="${color}" stroke-width="0.1"/><circle cx="${a.x}" cy="${a.y}" r="0.22" fill="${color}"/><rect x="${b.x-r}" y="${b.y-r}" width="${r*2}" height="${r*2}" fill="none" stroke="${color}" stroke-width="0.12"/>`;
  }).join('');
  const targets=result.sides.map(s=>{const p=s.targetRegion;return `<line x1="${p.x}" y1="${p.y}" x2="${p.x+p.w}" y2="${p.y+p.h}" stroke="${s.status==='clear'?'#146442':'#b24451'}" stroke-width="0.18"/>`;}).join('');
  fs.writeFileSync(path.join(out,name+'.svg'),`<svg xmlns="http://www.w3.org/2000/svg" width="1400" viewBox="${minX-1} ${minY-5} ${w+2} ${h+7}"><rect x="${minX-1}" y="${minY-5}" width="${w+2}" height="${h+7}" fill="#faf8f3"/><g font-family="sans-serif"><text x="${minX}" y="${minY-3.8}" font-size="0.7">${esc(name)}: both-side policy ${esc(result.status)}</text><text x="${minX}" y="${minY-2.7}" font-size="0.5">Local doorway-to-bed-side route under stated assumptions; furniture included.</text><text x="${minX}" y="${minY-1.8}" font-size="0.5">No door-swing, stair, whole-house or accessibility certification.</text><text x="${minX}" y="${minY-0.9}" font-size="0.5">${result.clearWidthFt*12} in square; start wholly in hallway; destination wholly alongside bed in bedroom</text>${rects(parts,'#e9e5dc')}${rects(m.wallSolids,'#303b40')}${rects(m.assemblyReservations,'#d69532')}${rects(m.passageParts,'#8ace9f')}${rects(level.furniture,'#b4aaa0')}${paths}${targets}</g></svg>`);
}
for(const file of files){
  const bytes=fs.readFileSync(path.join(input,file));report.sourceHashes[file]=sha(bytes);
  const level=JSON.parse(bytes),name=file.replace('-assumed-level.json','');
  for(const bed of level.furniture.filter(f=>String(f.kind).startsWith('bed_'))){
    const entries=level.doors.flatMap(d=>{
      const other=d.a===bed.roomId?d.b:d.b===bed.roomId?d.a:null;
      return level.rooms.some(r=>r.id===other&&r.type==='hallway')?[{entryOpeningId:d.id,fromRoomId:other}]:[];
    });
    if(entries.length!==1){report.results.push({floor:name,bedId:bed.id,status:'not_checked',reason:'Audit requires a unique direct hallway entry.'});continue;}
    for(const clearWidthFt of [2,2.5,3,3.5,4]){
      const request={...entries[0],bedId:bed.id,clearWidthFt};
      const either=checkBedroomApproach(level,{...request,sidePolicy:'either'}),both=checkBedroomApproach(level,{...request,sidePolicy:'both'});
      const id=`${name}-${bed.roomId}-${clearWidthFt*12}in`;
      report.results.push({name:id,floor:name,bedId:bed.id,request,either,both});
      if(clearWidthFt===2.5||clearWidthFt===3)draw(id,level,both);
    }
  }
}
report.sourceUnchanged=Object.entries(report.sourceHashes).every(([file,hash])=>sha(fs.readFileSync(path.join(input,file)))===hash);
report.finishedAt=new Date().toISOString();
report.summary={};
for(const width of [2,2.5,3,3.5,4]){
  report.summary[width*12+'in']={};
  for(const policy of ['either','both'])report.summary[width*12+'in'][policy]=report.results.filter(r=>r.request?.clearWidthFt===width).reduce((a,r)=>{a[r[policy].status]=(a[r[policy].status]||0)+1;return a;},{});
}
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
fs.writeFileSync(path.join(out,'index.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><title>Bed-side approach audit</title><style>body{font:16px system-ui;margin:24px;background:#faf8f3}img{width:100%;max-width:1300px}p{max-width:100ch}td,th{border:1px solid #ccc;padding:8px;text-align:left}table{border-collapse:collapse}</style><h1>Bed-side approach audit</h1><p>${esc(report.scope)} Widths are diagnostic inputs, not statutory minimums. Two successful paths demonstrate separate approaches, not simultaneous occupancy. <a href="report.json">Full evidence</a>.</p><table><tr><th>Floor / bed</th><th>Width</th><th>Either side</th><th>Both sides</th></tr>${report.results.map(r=>`<tr><td>${esc(r.floor)} / ${esc(r.bedId)}</td><td>${r.request?r.request.clearWidthFt*12+' in':'-'}</td><td>${esc(r.either?.status||r.status)}</td><td>${esc(r.both?.status||r.status)}</td></tr>`).join('')}</table>${report.results.filter(r=>[2.5,3].includes(r.request?.clearWidthFt)).map(r=>`<h2>${esc(r.name)}</h2><p>${esc(r.both.reason)}</p><img alt="${esc(r.name)}" src="${r.name}.svg">`).join('')}</html>`);
console.log(JSON.stringify({out,rows:report.results.length,summary:report.summary,sourceUnchanged:report.sourceUnchanged}));
if(!report.sourceUnchanged)process.exitCode=1;
