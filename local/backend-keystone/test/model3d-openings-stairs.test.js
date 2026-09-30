'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { buildModel } = require('../lib/model3d');
const { openingPlan, stairPlan } = require('./helpers/openings-stairs-plan.cjs');
const options = { include: { roof: false, site: false, furniture: false } };
const close = (a, b) => assert.ok(Math.abs(a-b) < 1e-6, `${a} != ${b}`);
function points(model, level, mat) {
  const b = model.builder.nodes.get(`Level ${level}`)?.get(mat);
  return b ? Array.from({length:b.positions.length/3}, (_,i)=>b.positions.slice(i*3,i*3+3)) : [];
}

for (const vertical of [false,true]) {
  test(`window ${vertical?'vertical':'horizontal'} retains planned span and room sill/head in actual frames`,()=>{
    const m=buildModel(openingPlan(null,{},vertical),options), frame=points(m,1,'window-frame');
    close(Math.min(...frame.map(p=>p[1])),2.25);close(Math.max(...frame.map(p=>p[1])),8.25);
    const axis=vertical?2:0;close(Math.min(...frame.map(p=>p[axis])),-3);close(Math.max(...frame.map(p=>p[axis])),3);
    close(m.meta.windows[0].sill,2.25);close(m.meta.windows[0].head,8.25);
  });
  test(`sliding door ${vertical?'vertical':'horizontal'} stays in its eight-foot opening without a swing leaf`,()=>{
    const m=buildModel(openingPlan({slidingDoor:true,heightFt:8},null,vertical),options);
    assert.equal(points(m,1,'door-exterior').length,0);
    const glass=points(m,1,'glass');assert.ok(glass.length);
    const fixed=vertical?0:2,along=vertical?2:0;
    assert.ok(glass.every(p=>Math.abs(p[fixed]+10)<0.3 && p[along]>=-4 && p[along]<=4));
    assert.ok(Math.max(...glass.map(p=>p[1]))>7.5);
    close(m.meta.exteriorDoors[0].width,8);
  });
}
test('door leaf uses saved height; missing height uses room head, not a hard-coded 6.8 ft',()=>{
  for(const [door,head] of [[{width:4,heightFt:7.5},7.5],[{width:4},8]]) {
    const m=buildModel(openingPlan(door,null),options);
    close(Math.max(...points(m,1,'door-exterior').map(p=>p[1])),head-0.05);
  }
});
test('private room on the negative side receives the door swing',()=>{
  const p={levels:[{level:1,width:20,height:20,rooms:[
    {id:'bed',type:'bedroom',x:0,y:0,w:10,h:20},{id:'hall',type:'hallway',x:10,y:0,w:10,h:20}],
    doors:[{a:'hall',b:'bed',dir:'vertical',x:10,y:10,width:4}]}]};
  const leaf=points(buildModel(p,options),1,'door');assert.ok(leaf.length && leaf.every(v=>v[0]<0));
});
test('cased threshold stays open across its full span and emits no door leaf',()=>{
  const m=buildModel(openingPlan({openThreshold:true,width:8,heightFt:8},null),options);
  assert.equal(points(m,1,'door-exterior').length,0);
  assert.ok(!points(m,1,'wall-paint').some(p=>p[0]>-3.9&&p[0]<3.9&&Math.abs(p[2]+10)<0.31&&p[1]>0&&p[1]<8));
});


for(const kind of ['straight','quarter-turn','switchback']) test(`${kind} stairs preserve independent tread counts, heights and finished-floor datums`,()=>{
  const p=stairPlan(kind),m=buildModel(p,options),layout=p.levels[0].stairCore.layout;
  const bucket=m.builder.nodes.get('Level 1').get('stair');
  const solids=new Map();bucket.solids.forEach((id,i)=>{if(!solids.has(id))solids.set(id,[]);solids.get(id).push(bucket.positions.slice(i*3,i*3+3));});
  const surfaces=[...solids.values()].map(vs=>Math.max(...vs.map(v=>v[1])));
  for(const f of layout.flights) for(let i=1;i<f.risers;i++) assert.ok(surfaces.some(y=>Math.abs(y-f.fromZFt-i*layout.riserFt)<1e-6));
  assert.equal(solids.size,layout.flights.reduce((n,f)=>n+f.risers-1,0)+(kind==='straight'?0:1));
  for(const lv of [1,2]) close(Math.max(...points(m,lv,'floor-public').map(v=>v[1])),lv===1?0:10);
});
test('floor opening follows the actual next level ID, not lower level plus one',()=>{
  const p=stairPlan('straight',4),m=buildModel(p,options),r=p.levels[0].stairCore.layout.floorOpening;
  const b=m.builder.nodes.get('Level 4').get('slab');
  // No slab triangle may span the centre of the reserved hole.
  const x=r.x+r.w/2-16,z=r.y+r.h/2-16;
  const solids = new Map();
  b.solids.forEach((id,i)=>{if(!solids.has(id))solids.set(id,[]);solids.get(id).push(b.positions.slice(i*3,i*3+3));});
  for(const vs of solids.values()) {
    assert.ok(!(Math.min(...vs.map(v=>v[0]))<x&&Math.max(...vs.map(v=>v[0]))>x&&Math.min(...vs.map(v=>v[2]))<z&&Math.max(...vs.map(v=>v[2]))>z),'floor slab covers the stair opening');
  }
});
test('explicitly invalid or stale saved stairs are rejected instead of replaced or stretched',()=>{
  for(const corrupt of [p=>p.levels[0].stairCore.layout.valid=false,p=>p.levels[0].stairCore.layout.flights[0].risers++,p=>p.verticalModel.levels[1].floorZFt=11,p=>p.levels[1].rooms[0].x++]) {
    const p=stairPlan();corrupt(p);
    assert.throws(()=>buildModel(p,options),{code:'MODEL_STAIR_LAYOUT_INVALID'});
  }
});

test('elevations use the same saved window vertical dimensions as 3D',()=>{
  const {renderElevationForView}=require('../lib/renderElevationSvg');
  const p=openingPlan(null,{sillHeightFt:4,headHeightFt:7.5});
  p.frontEdge='top';
  const svg=['front','rear','left','right'].map(view=>renderElevationForView(p,{},view)).join('');
  assert.match(svg,/data-sill-ft="4" data-head-ft="7.5"/);
  const m=buildModel(p,options);close(m.meta.windows[0].sill,4);close(m.meta.windows[0].head,7.5);
});
test('invalid opening heights fail explicitly rather than drawing inverted frames or cutting above ceilings',()=>{
  for(const p of [openingPlan({heightFt:12},null),openingPlan(null,{sillHeightFt:7,headHeightFt:4})])
    assert.throws(()=>buildModel(p,options),{code:'MODEL_OPENING_INVALID'});
});
test('all elevation views render hinged, sliding and garage doors with saved heights',()=>{
  const {renderElevations}=require('../lib/renderElevationSvg');
  for(const kind of [{},{slidingDoor:true},{garageDoor:true}]) {
    const p=openingPlan({...kind,heightFt:8},null);
    const views=renderElevations(p,{});
    assert.ok(views.frontSvg && views.rearSvg && views.leftSvg && views.rightSvg);
    assert.match(Object.values(views).filter(v=>typeof v==='string').join(''),/data-opening="(?:entry-door|sliding-door|garage-door)"/);
  }
});

for(const kind of ['straight','quarter-turn','switchback']) for(const turns of [1,2,3]) test(`${kind} stair geometry at ${turns*90} degrees preserves flight direction, run, width and rise`,()=>{
  const p=stairPlan(kind);
  const point = v => {let q={...v};for(let i=0;i<turns;i++) q={...q,x:32-q.y,y:q.x};return q;};
  const box = r => {const a=point(r),b=point({x:r.x+r.w,y:r.y+r.h});return {...r,x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.abs(a.x-b.x),h:Math.abs(a.y-b.y)};};
  for(const l of p.levels) {
    l.rooms=l.rooms.map(box);const s=l.stairCore.layout;
    s.flights=s.flights.map(f=>({...f,rect:box(f.rect),from:point(f.from),to:point(f.to)}));
    s.landings=s.landings.map(box);s.floorOpening=box(s.floorOpening);
  }
  const m=buildModel(p,options),b=m.builder.nodes.get('Level 1').get('stair');
  const solids=new Map();b.solids.forEach((id,i)=>{if(!solids.has(id))solids.set(id,[]);solids.get(id).push(b.positions.slice(i*3,i*3+3));});
  const surfaces=[...solids.values()];
  for(const f of p.levels[0].stairCore.layout.flights) {
    const axis=Math.abs(f.to.x-f.from.x)>0?0:2,across=axis===0?2:0;
    const from=axis===0?f.from.x:f.from.y,to=axis===0?f.to.x:f.to.y,step=(to-from)/(f.risers-1);
    for(let i=0;i<f.risers-1;i++) {
      const top=f.fromZFt+(i+1)*(f.toZFt-f.fromZFt)/f.risers;
      const vs=surfaces.find(v=>Math.abs(Math.max(...v.map(v=>v[1]))-top)<1e-6);assert.ok(vs);
      const lo=Math.min(...vs.map(v=>v[axis])),hi=Math.max(...vs.map(v=>v[axis]));
      close(hi-lo,Math.abs(step)+0.08); // the existing modeled nosing
      close(Math.max(...vs.map(v=>v[across]))-Math.min(...vs.map(v=>v[across])),p.levels[0].stairCore.layout.flightWidthFt);
      close(step>0?hi:lo,from+(i+1)*step-16);
    }
  }
});
