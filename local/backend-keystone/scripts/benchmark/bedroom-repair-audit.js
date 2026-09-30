'use strict';

const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {proposeBedroomApproachRepair}=require('../../lib/geometry/repairBedroomApproach');
const {buildFloorPassageModel}=require('../../lib/geometry/floorPassageModel');
const {containsRect,subtract}=require('../../lib/geometry/rectBoolean');
const {doorClearances}=require('../../lib/furnitureGeometry');
const {validateEditedPlan}=require('../../lib/validateEditedPlan');
const {renderPlanSvg}=require('../../lib/renderPlanSvg');
const backend=path.resolve(__dirname,'../..'),fixtures=path.join(backend,'test/fixtures/bedroom-approach-repair');
const args=process.argv.slice(2),rotate=args.includes('--rotate'),headSides=args.includes('--head-sides'),expandedSearch=!args.includes('--no-expanded');
const out=path.resolve(args.find(arg=>!arg.startsWith('--'))||path.join(backend,'../tmp/universal-coverage',new Date().toISOString().replace(/[:.]/g,'-')+'-bedroom-repair-audit'));
fs.mkdirSync(out,{recursive:true});
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const esc=x=>String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
const report={startedAt:new Date().toISOString(),backendHead:execFileSync('git',['rev-parse','HEAD'],{cwd:backend,encoding:'utf8'}).trim(),
  scope:'Opt-in furniture repair proposals under labelled wall/opening assumptions; no production activation or construction certification.',
  searchOptions:{allowQuarterTurns:rotate,nightstandPlacement:headSides?'head_sides':'preserve',expandedSearch},
  sourceHashes:{},fixtureHashes:{},results:[]};
for(const file of execFileSync('git',['ls-files','-co','--exclude-standard','lib','api'],{cwd:backend,encoding:'utf8'}).trim().split(/\r?\n/))report.sourceHashes[file]=sha(path.join(backend,file));
report.sourceHashes['scripts/benchmark/bedroom-repair-audit.js']=sha(__filename);

function roomDiagram(plan,request,name,approach){
  const level=plan.levels.find(l=>l.level===2),bed=level.furniture.find(f=>f.id===request.bedId),room=level.rooms.find(r=>r.id===bed.roomId);
  const model=buildFloorPassageModel(level),pad=2,minX=room.x-pad,minY=room.y-pad,w=room.w+pad*2,h=room.h+pad*2;
  const rectangles=(items,fill,extra='')=>items.map(p=>`<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" fill="${fill}" ${extra}/>`).join('');
  const zones=doorClearances(room,level).filter(z=>!z.sector);
  const route=(approach?.sides||[]).filter(s=>s.status==='clear').slice(0,1).map(s=>`<polyline points="${s.path.map(p=>`${p.x},${p.y}`).join(' ')}" fill="none" stroke="#087a59" stroke-width="${request.clearWidthFt}" stroke-opacity="0.18" stroke-linecap="square" stroke-linejoin="miter"/><polyline points="${s.path.map(p=>`${p.x},${p.y}`).join(' ')}" fill="none" stroke="#087a59" stroke-width="0.08"/>`).join('');
  const marks=level.furniture.filter(f=>f.roomId===room.id).map(f=>`<text x="${f.x+f.w/2}" y="${f.y+f.h/2}" text-anchor="middle" font-size="0.28">${esc(f.kind)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" viewBox="${minX} ${minY-2} ${w} ${h+2}"><defs><clipPath id="crop"><rect x="${minX}" y="${minY}" width="${w}" height="${h}"/></clipPath></defs><rect x="${minX}" y="${minY-2}" width="${w}" height="${h+2}" fill="#faf8f3"/><g font-family="sans-serif"><text x="${minX+0.3}" y="${minY-1.35}" font-size="0.36">${esc(name)}</text><text x="${minX+0.3}" y="${minY-0.65}" font-size="0.29">Assumed finished geometry; amber = existing door/closet approach zones</text><g clip-path="url(#crop)">${rectangles(model.roomClear.flatMap(r=>r.parts),'#ece7de')}${rectangles(model.wallSolids,'#303b40')}${rectangles(model.assemblyReservations,'#d69532')}${rectangles(model.passageParts,'#8ace9f')}${rectangles(zones,'#d69532','fill-opacity="0.2"')}${rectangles(level.furniture,'#b4aaa0')}${route}${marks}</g></g></svg>`;
}

for(const file of fs.readdirSync(fixtures).filter(f=>f.endsWith('-input.json'))){
  report.fixtureHashes[file]=sha(path.join(fixtures,file));
  const input=JSON.parse(fs.readFileSync(path.join(fixtures,file)));
  if(rotate||headSides)input.options={...input.options,allowQuarterTurns:rotate,nightstandPlacement:headSides?'head_sides':'preserve',maxCandidates:4000,maxRouteChecks:64};
  const snapshot=structuredClone(input),started=Date.now();
  const result=proposeBedroomApproachRepair(input.plan,input.survey,input.options);
  assert.deepEqual(input,snapshot);
  const summary={name:input.name,status:result.status,reason:result.reason,candidateCount:result.candidateCount,routeCheckCount:result.routeCheckCount,
    rejections:result.rejections,changes:result.changes||[],quarterTurns:result.quarterTurns,durationMs:Date.now()-started,independentErrors:[]};
  fs.writeFileSync(path.join(out,input.name+'-input.json'),JSON.stringify(input,null,2));
  fs.writeFileSync(path.join(out,input.name+'-result.json'),JSON.stringify(result,null,2));
  fs.writeFileSync(path.join(out,input.name+'-before.svg'),roomDiagram(input.plan,input.options.request,input.name+' / before',result.before));
  if(result.status==='repaired'){
    const plan=result.proposedPlan,level=plan.levels.find(l=>l.level===2),beforeLevel=input.plan.levels.find(l=>l.level===2);
    assert.deepEqual(validateEditedPlan(plan,input.survey),[]);
    const expected=structuredClone(input.plan),expectedLevel=expected.levels.find(l=>l.level===2);
    for(const change of result.changes)Object.assign(expectedLevel.furniture.find(f=>f.id===change.furnitureId),change.after);
    for(const change of result.changes)assert.deepEqual([change.before.w,change.before.h].sort((a,b)=>a-b),[change.after.w,change.after.h].sort((a,b)=>a-b));
    expected.furniture.find(f=>f.level===2).items=structuredClone(expectedLevel.furniture);assert.deepEqual(plan,expected);
    const beforeModel=buildFloorPassageModel(beforeLevel),model=buildFloorPassageModel(level);assert.deepEqual(model,beforeModel);
    const allowed=new Set(result.after.allowedRoomIds),free=subtract([
      ...model.roomClear.filter(r=>allowed.has(r.roomId)).flatMap(r=>r.parts),
      ...model.openings.filter(o=>o.rooms.every(id=>allowed.has(id))).map(o=>o.clear),
    ],level.furniture.filter(f=>allowed.has(f.roomId)));
    for(const side of result.after.sides.filter(s=>s.status==='clear'))for(let i=1;i<side.path.length;i++){
      const a=side.path[i-1],b=side.path[i],r=input.options.request.clearWidthFt/2;
      assert.ok(a.x===b.x||a.y===b.y);assert.ok(containsRect(free,{x:Math.min(a.x,b.x)-r,y:Math.min(a.y,b.y)-r,w:Math.abs(a.x-b.x)+r*2,h:Math.abs(a.y-b.y)+r*2}));
    }
    fs.writeFileSync(path.join(out,input.name+'-after.svg'),roomDiagram(plan,input.options.request,input.name+' / validated proposal',result.after));
    for(const style of ['normal','rendered'])for(const [label,source]of [['before',input.plan],['after',plan]]){
      fs.writeFileSync(path.join(out,`${input.name}-${label}-${style}.svg`),renderPlanSvg(structuredClone(source),{style}));
    }
    summary.fullPlanPreservationVerified=true;summary.sweptRoutesVerified=true;summary.physicalPartitionUnchanged=true;
  }else{
    assert.equal(result.proposedPlan,undefined);
    if(expandedSearch){
    const expandedOptions={...input.options,maxCandidates:10000,maxDisplacementFt:12,maxRouteChecks:128,gridStepFt:0.5};
    const expanded=proposeBedroomApproachRepair(input.plan,input.survey,expandedOptions);
    summary.expanded={status:expanded.status,candidateCount:expanded.candidateCount,routeCheckCount:expanded.routeCheckCount,reason:expanded.reason};
    // Expanded exploration is retained, never silently swapped for the bounded default result.
    fs.writeFileSync(path.join(out,input.name+'-expanded.json'),JSON.stringify({options:expandedOptions,result:expanded},null,2));
    }
  }
  report.results.push(summary);console.log(JSON.stringify(summary));
}
report.finishedAt=new Date().toISOString();
report.sourceAndFixturesUnchanged=Object.entries(report.sourceHashes).every(([file,hash])=>sha(path.join(backend,file))===hash)&&
  Object.entries(report.fixtureHashes).every(([file,hash])=>sha(path.join(fixtures,file))===hash);
assert.equal(report.sourceAndFixturesUnchanged,true);
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
fs.writeFileSync(path.join(out,'index.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><title>Bedroom repair proposals</title><style>body{font:16px system-ui;background:#faf8f3;margin:32px;line-height:1.5}p{max-width:100ch}.pair{display:flex;gap:16px;flex-wrap:wrap}.pair img{width:min(100%,650px)}a{color:#146442}</style><h1>Bedroom repair proposals</h1><p>${esc(report.scope)} Width/policy remain unchanged. Unresolved searches are not proof of infeasibility. <a href="report.json">Full evidence</a>.</p>${report.results.map(r=>`<h2>${esc(r.name)} — ${esc(r.status)}</h2><p>${esc(r.reason)}</p><p>${r.candidateCount} candidates; ${r.routeCheckCount} route checks. ${r.expanded?'Expanded exploration: '+esc(r.expanded.status)+'.':''}</p><div class="pair"><img alt="Before repair" src="${r.name}-before.svg">${r.status==='repaired'?`<img alt="Validated proposal" src="${r.name}-after.svg">`:''}</div>${r.status==='repaired'?`<p>Full sheets: <a href="${r.name}-after-normal.svg">Normal</a> / <a href="${r.name}-after-rendered.svg">Rendered</a>.</p>`:''}<p><a href="${r.name}-result.json">Result and proposed plan</a></p>`).join('')}</html>`);
console.log(out);
