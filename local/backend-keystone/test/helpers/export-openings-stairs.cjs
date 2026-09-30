'use strict';
// Diagnostic fixtures; no claim that these partial room sets are house proposals.
const fs=require('node:fs'),path=require('node:path');
const {buildModel,toGlb}=require('../../lib/model3d');
const {openingPlan,stairPlan}=require('./openings-stairs-plan.cjs');
const out=path.resolve(process.argv[2]);fs.mkdirSync(out,{recursive:true});
const cases=[];
function save(name,plan,extra) {
  const model=buildModel(plan,{include:{roof:false,site:false,furniture:false}});
  fs.writeFileSync(path.join(out,name+'.glb'),toGlb(model,{withSolids:true}));
  fs.writeFileSync(path.join(out,name+'.json'),JSON.stringify({plan,meta:model.meta}));
  cases.push({name,...extra});
}
for(const vertical of [false,true]) {
  const p=openingPlan({slidingDoor:true,heightFt:8},{},vertical);
  const w=p.levels[0].windows[0];if(vertical)w.x=20;else w.y=20;
  save('openings-'+(vertical?'vertical':'horizontal'),p,{kind:'openings',vertical});
}
for(const kind of ['straight','quarter-turn','switchback']) {
  const p=stairPlan(kind),layout=p.levels[0].stairCore.layout;
  save(kind,p,{kind:'stairs',flights:layout.flights,hole:layout.floorOpening});
}
fs.writeFileSync(path.join(out,'fixtures.json'),JSON.stringify(cases,null,2));
