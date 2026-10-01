'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalizeBrief}=require('../lib/nepal/normalizeBrief');
const {searchConcepts}=require('../lib/nepal/candidateSearch');
const {furnishLevel}=require('../lib/nepal/furniture');
const {sanitaryPlan}=require('../lib/nepal/sanitary');
const {roofPlan}=require('../lib/nepal/drawingSet');
const {exportCandidateGeometry}=require('../lib/nepal/geometryExport');

function cases(){
  const out=[];
  for(const file of ['rental-3_5','rectangle-2_5']){const brief=normalizeBrief(require(`./fixtures/nepal/${file}.json`)).brief;
    const r=searchConcepts(brief,{provisionalSetbacksMm:[1000,1000,1000,1000],workingCoverageLimit:0.7,maxCandidates:3});
    for(const c of r.candidates)out.push({brief,c});
    for(const c of r.parkingProgramVariant?.candidates.slice(0,2)||[])out.push({brief:r.parkingProgramVariant.brief,c});}
  return out;
}
// Does segment a-b cross the open interior of box (shrunk by 1 mm)?
function crosses(a,b,box){
  const s={x1:box.x1+1,y1:box.y1+1,x2:box.x2-1,y2:box.y2-1};
  for(let i=0;i<=40;i++){const t=i/40,x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t;if(x>s.x1&&x<s.x2&&y>s.y1&&y<s.y2)return true;}
  return false;
}

test('every wet room drains to a stack that reaches the ground, and drains avoid the reservoir and rooms',()=>{
  for(const {c} of cases()){
    const san=sanitaryPlan(c,l=>furnishLevel(l,{columns:c.grid.columns}));
    for(const level of c.levels)for(const room of (level.rooms?.rooms||[]).filter(r=>['bathroom','kitchen'].includes(r.type))){
      const st=san.stacks.find(s=>s.id===room.stackId);
      assert.ok(st,`${c.id} ${room.id} has a stack`);
      assert.equal(st.kind,room.type==='bathroom'?'SP':'WP');
      assert.ok(st.levels.includes(level.id));
    }
    assert.equal(san.chambers.length,san.stacks.length);
    const reservoir=c.core.reservoir.innerPlanBox,slab=c.levels[0].footprint.slabs;
    for(const run of san.runs){
      const pts=run.points;
      for(let i=0;i+1<pts.length;i++){
        assert.ok(!crosses(pts[i],pts[i+1],reservoir),`${c.id} ${run.from} crosses the reservoir`);
        // Only the short stub into the septic tank may run under the ground slab.
        const stub=(run.to==='tank'&&i===pts.length-2)||(run.from==='tank'&&i===0);
        if(!stub)for(const s of slab)assert.ok(!crosses(pts[i],pts[i+1],s),`${c.id} ${run.from} runs under the building`);
      }
    }
    for(const ch of san.chambers)assert.ok(!(Math.min(ch.box.x2,san.tank.box.x2)>Math.max(ch.box.x1,san.tank.box.x1)&&
      Math.min(ch.box.y2,san.tank.box.y2)>Math.max(ch.box.y1,san.tank.box.y1)),`${c.id} ${ch.id} on tank`);
    assert.ok(san.findings.some(f=>f.code==='SEWAGE_RESERVOIR_SEPARATION_REVIEW'));
    assert.equal(san.tank.sizeStatus,'indicative_size_by_engineer');
  }
});

test('roof regions are exactly the uncovered slab of each level, with outlets clear of the stair cover',()=>{
  for(const {brief,c} of cases()){
    const roof=roofPlan(c,exportCandidateGeometry(c,brief));
    const area=bs=>bs.reduce((n,b)=>n+(b.x2-b.x1)*(b.y2-b.y1),0);
    c.levels.forEach((level,i)=>{
      const region=roof.regions.find(r=>r.levelId===level.id);
      const up=c.levels[i+1]?.footprint.slabs||[];
      const covered=level.footprint.slabs.reduce((n,s)=>n+up.reduce((m,u)=>m+Math.max(0,Math.min(s.x2,u.x2)-Math.max(s.x1,u.x1))*
        Math.max(0,Math.min(s.y2,u.y2)-Math.max(s.y1,u.y1)),0),0);
      const expect=area(level.footprint.slabs)-covered;
      assert.ok(Math.abs((region?area(region.boxes):0)-expect)<1,`${c.id} ${level.id}`);
    });
    const core=c.core.box;
    for(const o of roof.outlets)assert.ok(!(o.x>core.x1&&o.x<core.x2&&o.y>core.y1&&o.y<core.y2),`${c.id} RWP${o.n} under stair cover`);
    assert.ok(roof.regions.at(-1).top);
  }
});
