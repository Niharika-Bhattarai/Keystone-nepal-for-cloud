'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {fitStairLayout,LIMITS}=require('../lib/stairLayout');
const {base}=require('../scripts/benchmark/generation-coverage');
const {invoke}=require('../scripts/benchmark/survey-delivery-audit');
const {validateEditedPlan}=require('../lib/validateEditedPlan');
const {renderPlanSvg}=require('../lib/renderPlanSvg');
const {roomArea}=require('../lib/planGeometry');

test('quarter-turn flight geometry adds up to the actual rise without shrinking treads',()=>{
  const layout=fitStairLayout({core:{x:14,y:16,w:6,h:14},lowerHall:{x:20,y:16,w:6,h:14},upperHall:{x:10,y:10,w:10,h:6},riseFt:10});
  assert.equal(layout.valid,true);
  assert.equal(layout.kind,'quarter-turn');
  assert.equal(layout.risers*layout.riserFt,10);
  assert.ok(layout.riserFt<=LIMITS.maxRiserFt);
  assert.ok(layout.treadFt>=LIMITS.minTreadFt);
  assert.equal(layout.flights.reduce((sum,f)=>sum+f.risers,0),layout.risers);
  for(const f of layout.flights) assert.ok(Math.abs(Math.hypot(f.to.x-f.from.x,f.to.y-f.from.y)-(f.risers-1)*layout.treadFt)<1e-6);
  assert.ok(layout.landings[0].w>=layout.flightWidthFt&&layout.landings[0].h>=layout.flightWidthFt);
});

test('a short core is rejected instead of compressing the same flight into twelve feet',()=>{
  const result=fitStairLayout({core:{x:0,y:0,w:6,h:12},lowerHall:{x:6,y:0,w:6,h:12},upperHall:{x:0,y:-6,w:6,h:6},riseFt:10});
  assert.equal(result.valid,false);
});

test('straight flights use external top and bottom landings and exact uniform risers',()=>{
  const result=fitStairLayout({core:{x:0,y:0,w:6,h:14},lowerHall:{x:0,y:14,w:6,h:6},upperHall:{x:0,y:-6,w:6,h:6},riseFt:10});
  assert.equal(result.valid,true);
  assert.equal(result.kind,'straight');
  assert.equal(result.flights.length,1);
  assert.equal(result.flights[0].toZFt,10);
});

test('a landing cannot occupy the missing corner of a composite hall',()=>{
  const core={x:0,y:0,w:6,h:14}, lowerHall={x:0,y:14,w:6,h:6};
  const upperHall={x:0,y:-6,w:6,h:6,parts:[{x:0,y:-6,w:6,h:2},{x:0,y:-4,w:1,h:4}]};
  assert.equal(fitStairLayout({core,lowerHall,upperHall,riseFt:10}).valid,false);
});

test('switchback fits a real turning landing and separated flights beside a short entry hall',()=>{
  const result=fitStairLayout({core:{x:0,y:0,w:7,h:12},lowerHall:{x:7,y:0,w:5,h:4},upperHall:{x:0,y:-6,w:7,h:6},riseFt:10});
  assert.equal(result.valid,true);assert.equal(result.kind,'switchback');
  const [first,second]=result.flights;
  assert.ok(first.rect.x-(second.rect.x+second.rect.w)>=.5);
  assert.ok(result.landings[0].h>=result.flightWidthFt);
  assert.ok(result.landings[1].h>=result.flightWidthFt);
  assert.ok(result.lowerEndpoint.y<=4);
  assert.equal(first.toZFt,second.fromZFt);assert.equal(second.toZFt,10);
});

for(const frontFacing of ['North','South','East','West']) test(`delivered ${frontFacing} stairs meet landings and arrows follow their actual travel`,async()=>{
  const survey={...base,frontFacing};
  const {status,body}=await invoke(survey);
  assert.equal(status,200);
  const plan=body.planSpec,lower=plan.levels[0],upper=plan.levels[1],layout=lower.stairCore.layout;
  assert.equal(layout.valid,true);
  assert.deepEqual(validateEditedPlan(plan,survey),[]);
  for(const level of plan.levels) assert.ok(Math.abs(level.rooms.reduce((sum,room)=>sum+roomArea(room),0)-level.width*level.height)<1e-6,'stair widening leaves no unassigned strip beside the upper landing');
  for(const [level,endpoint] of [[lower,layout.lowerEndpoint],[upper,layout.upperEndpoint]]) {
    const door=level.doors.find(d=>d.stairEndpoint);
    assert.ok(door);
    assert.equal(door.x,endpoint.x);assert.equal(door.y,endpoint.y);
    assert.equal(door.openThreshold,true);
  }
  assert.match(body.svg,/data-stair-kind="quarter-turn"/);
  assert.match(body.svg,/UP TO L2/);assert.match(body.svg,/DOWN TO L1/);
  const arrows=[...body.svg.matchAll(/<polyline class="stair-arrow" points="([^"]+)"/g)];
  assert.equal(arrows.length,2);
  const lowerPoints=arrows[0][1].split(' ').map(p=>p.split(',').map(Number));
  const upperPoints=arrows[1][1].split(' ').map(p=>p.split(',').map(Number));
  const lowerDelta=lowerPoints.at(-1).map((v,i)=>v-lowerPoints[0][i]);
  const upperDelta=upperPoints.at(-1).map((v,i)=>v-upperPoints[0][i]);
  lowerDelta.forEach((v,i)=>assert.ok(Math.abs(v+upperDelta[i])<1e-6));
  const saved=JSON.parse(JSON.stringify(plan));
  saved.levels.forEach(l=>delete l.stairCore.layout);
  assert.match(renderPlanSvg(saved),/data-stair-kind=/,'saved plans are fitted on drawing instead of using the old compressed symbol');
});

test('compact five-bedroom house gains validated v2 coverage and three alternatives',async()=>{
  const survey={...base,stories:'1 Story',bedrooms:'5 Bed',totalArea:'2400',garage:'None',masterLocation:'Level 1 (Main)'};
  const {status,body}=await invoke(survey);
  assert.equal(status,200);assert.equal(body.engine.generatorId,'architect_v2');
  assert.ok(body.alternatives.length>=2);assert.equal(body.diversityMetrics.valid,true);
  assert.deepEqual(validateEditedPlan(body.planSpec,survey),[]);
  assert.equal(body.planSpec.levels[0].rooms.filter(r=>['bedroom','primary_bedroom'].includes(r.type)).length,5);
});
