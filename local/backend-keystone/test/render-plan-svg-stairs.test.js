"use strict";
const test=require('node:test');
const assert=require('node:assert/strict');
const {renderPlanSvg,resolveDrawableStairGeometry}=require('../lib/renderPlanSvg');
const {fitStairLayout}=require('../lib/stairLayout');
const core={x:0,y:0,w:6,h:14};
const stair={...core,id:'stairs',type:'stairs'};
const fitted=fitStairLayout({core,lowerHall:{x:6,y:0,w:6,h:14},upperHall:{x:0,y:-6,w:6,h:6},riseFt:10});

test('missing stair data is identified instead of drawing compressed or invented treads',()=>{
  const level={level:1,width:20,height:20,rooms:[stair],doors:[],windows:[],stairCore:{roomId:'stairs',vertical:{runFt:18,stepCount:22}}};
  assert.equal(resolveDrawableStairGeometry(level,stair),null);
  const svg=renderPlanSvg({levels:[level]});
  assert.match(svg,/STAIR DATA NEEDED/);
  assert.doesNotMatch(svg,/class="stair-riser"/);
});

test('fitted flights retain identical tread and arrow geometry in normal and rendered views',()=>{
  assert.equal(fitted.valid,true);
  const level={level:1,width:20,height:20,rooms:[stair],doors:[],windows:[],stairCore:{roomId:'stairs',layout:fitted}};
  assert.equal(resolveDrawableStairGeometry(level,stair),fitted);
  const normal=renderPlanSvg({levels:[level]}),rendered=renderPlanSvg({levels:[level]},{style:'rendered'});
  const elements=svg=>svg.match(/<(?:line|polyline|polygon)[^>]*class="stair-(?:riser|arrow|arrow-head)"[^>]*>/g);
  assert.deepEqual(elements(normal),elements(rendered));
  assert.equal((normal.match(/class="stair-riser"/g)||[]).length,fitted.risers);
});

test('a failed physical fit is visible and never replaced by a compressed symbol',()=>{
  const level={level:1,width:20,height:20,rooms:[stair],doors:[],windows:[],stairCore:{roomId:'stairs',layout:{valid:false}}};
  const svg=renderPlanSvg({levels:[level]});
  assert.match(svg,/STAIR NEEDS REFIT/);
  assert.doesNotMatch(svg,/class="stair-riser"/);
});

for (const riseFt of [9,10,11]) test(`drawn treads and landings retain model scale at ${riseFt} ft floor rise`,()=>{
  const core={x:0,y:0,w:7,h:14};
  const layout=fitStairLayout({core,lowerHall:{x:7,y:0,w:5,h:14},upperHall:{x:0,y:-6,w:7,h:6},riseFt});
  assert.equal(layout.valid,true);
  const level={level:1,width:20,height:20,rooms:[{...core,id:'stairs',type:'stairs'}],doors:[],windows:[],stairCore:{roomId:'stairs',layout}};
  const svg=renderPlanSvg({levels:[level]});
  const attrs=tag=>Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]+)"/g)].map(m=>[m[1],Number(m[2])]));
  const runs=[...svg.matchAll(/<rect class="stair-run"[^>]*>/g)].map(m=>attrs(m[0]));
  const risers=[...svg.matchAll(/<line class="stair-riser"[^>]*>/g)].map(m=>attrs(m[0]));
  let offset=0;
  runs.forEach((run,i)=>{
    const flight=layout.flights[i],lines=risers.slice(offset,offset+flight.risers);offset+=flight.risers;
    assert.ok(Math.abs(run.width-18*flight.rect.w)<1e-6);
    assert.ok(Math.abs(run.height-18*flight.rect.h)<1e-6);
    for(let j=1;j<lines.length;j++) assert.ok(Math.abs(Math.hypot(lines[j].x1-lines[j-1].x1,lines[j].y1-lines[j-1].y1)-18*layout.treadFt)<1e-6,'Drawn going must equal physical going at the plan scale');
  });
  const pads=[...svg.matchAll(/<rect class="stair-landing"[^>]*>/g)].map(m=>attrs(m[0]));
  assert.equal(pads.length,layout.landings.length);
  pads.forEach((pad,i)=>{
    assert.ok(Math.abs(pad.width-18*layout.landings[i].w)<1e-6);
    assert.ok(Math.abs(pad.height-18*layout.landings[i].h)<1e-6);
  });
});
