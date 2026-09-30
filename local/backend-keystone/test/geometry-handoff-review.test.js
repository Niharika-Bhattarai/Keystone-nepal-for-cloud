'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildWallModel, wallModelForLevel } = require('../lib/geometry/wallModel');
const { deriveLevelClearances, deriveOpeningClearance, deriveStairClearance, findNarrowStairs } = require('../lib/geometry/clearanceGeometry');
const { fitsRoom, validateFurnitureGeometry } = require('../lib/furnitureGeometry');
const { containsRect, unionArea } = require('../lib/geometry/rectBoolean');
const room = (id, x, y, w, h, extras = {}) => ({ id, type:'bedroom', x,y,w,h,...extras });

test('L and T recess walls are measured, composite internal seams are absent', () => {
  for (const parts of [
    [{x:0,y:0,w:10,h:20},{x:10,y:0,w:10,h:10}],
    [{x:0,y:0,w:30,h:10},{x:10,y:10,w:10,h:10}],
  ]) {
    const model = buildWallModel({ rooms:[room('composite',0,0,30,20,{parts})] });
    const perimeter = model.walls.reduce((sum,w)=>sum+w.lengthFt,0);
    assert.equal(perimeter, parts[0].w === 10 ? 80 : 100);
    assert.ok(model.walls.some(w=>w.orientation==='horizontal' && w.axisFt===10));
    assert.ok(model.walls.every(w=>w.exterior));
    assert.ok(Math.abs(model.partition.residualSqFt)<1e-7);
  }
});
test('junction solids and overlapping composite parts are counted once', () => {
  const model=buildWallModel({rooms:[
    room('a',0,0,10,20), room('b',10,0,10,10), room('c',10,10,10,10),
  ]});
  assert.equal(model.partition.nominalAreaSqFt,400);
  assert.ok(Math.abs(model.partition.residualSqFt)<1e-7);
  assert.equal(unionArea(model.wallSolids), model.wallSolids.reduce((sum,r)=>sum+r.w*r.h,0));
  const composite=buildWallModel({rooms:[room('same',0,0,15,10,{parts:[{x:0,y:0,w:10,h:10},{x:5,y:0,w:10,h:10}]})]});
  assert.equal(composite.partition.nominalAreaSqFt,150);
});
test('a short wall does not inset an entire composite-room side', () => {
  const living=room('living',0,0,10,20,{parts:[{x:0,y:0,w:10,h:20},{x:10,y:10,w:10,h:10}]});
  const model=buildWallModel({rooms:[living,room('bed',10,0,10,10)]});
  const clear=model.roomClear.find(r=>r.roomId==='living').parts;
  assert.equal(containsRect(clear,{x:9.8,y:12,w:0.4,h:2}),true,'the connected composite seam stays usable below the partition');
  assert.equal(containsRect(clear,{x:9.8,y:2,w:0.4,h:2}),false,'the real upper partition stays reserved');
});
test('open-concept public room boundaries do not invent solid partitions', () => {
  const model=buildWallModel({rooms:[room('k',0,0,10,10,{type:'kitchen',openConcept:true}),room('l',10,0,10,10,{type:'living_room',openConcept:true})]});
  assert.equal(model.walls.filter(w=>!w.exterior).length,0);
});
test('wall cache invalidates when the same level is resized in place', () => {
  const level={rooms:[room('a',0,0,10,10)]};
  const first=wallModelForLevel(level);
  assert.equal(first,wallModelForLevel(level));
  level.rooms[0].w=5;
  const second=wallModelForLevel(level);
  assert.notEqual(second,first);
  assert.equal(second.partition.nominalAreaSqFt,50);
});
test('explicit finished-face furniture validation never falls back after clear space collapses', () => {
  assert.equal(fitsRoom({x:1,y:1,w:2,h:2},room('a',0,0,10,10),[]),false);
  const level={finishedFaceGeometryVersion:1,rooms:[room('a',0,0,10,10)],furniture:[{id:'bed',roomId:'a',kind:'bed_single',x:7,y:1,w:2,h:4}]};
  assert.deepEqual(validateFurnitureGeometry(level),[]);
  level.rooms[0].w=5;
  assert.ok(validateFurnitureGeometry(level).some(e=>e.includes('outside room')));
});
test('a centred opening near the end of its own wall resolves the correct room pair', () => {
  const level={rooms:[room('a',0,0,10,10),room('b',10,0,10,6),room('c',10,6,10,4)],doors:[{a:'a',b:'b',x:10,y:4,width:3,dir:'vertical'}]};
  const measured=deriveLevelClearances(level,buildWallModel(level));
  assert.equal(measured.unhostedCount,0);
  const wall=buildWallModel(level).walls.find(w=>w.id===measured.doors[0].hostWallId);
  assert.deepEqual(wall.roomIds,['a','b']);
  level.doors[0].y=5.5;
  assert.equal(deriveLevelClearances(level,buildWallModel(level)).unhostedCount,1,'a door straddling two room pairs must not be assigned by greatest overlap');
});
test('sliding panels and window sashes do not pretend nominal width is clear passage', () => {
  for (const [opening,kind] of [[{width:8,slidingDoor:true},'door'],[{width:4},'window']]) {
    const result=deriveOpeningClearance(opening,null,kind);
    assert.equal(result.clearWidthFt,null);
    assert.equal(result.measurementStatus,'product_schedule_required');
  }
  assert.equal(deriveOpeningClearance({width:4,openThreshold:true},null,'door').clearWidthFt,4);
  const threshold=deriveOpeningClearance({width:3,x:1.5,openThreshold:true},{id:'host',startFt:0,endFt:3,assembly:{id:'interior',thicknessFt:0.375}},'door');
  assert.equal(threshold.roughOpeningWidthFt,null,'a leafless stair threshold does not imply a conventional door jamb');
  assert.equal(threshold.roughOpeningFitsHost,null);
});
test('a wide switchback core cannot conceal a narrow individual flight', () => {
  const stairs=room('stairs',0,0,8,14,{type:'stairs'});
  const model=buildWallModel({rooms:[stairs]});
  const layout={valid:true,flights:[
    {rect:{x:0.5,y:1,w:2.5,h:10},from:{x:1.75,y:1},to:{x:1.75,y:11}},
    {rect:{x:4.5,y:1,w:3,h:10},from:{x:6,y:11},to:{x:6,y:1}},
  ]};
  const result=deriveStairClearance(stairs,model,1,layout);
  assert.equal(result.nominalWidthIn,30);
  assert.ok(findNarrowStairs(result).some(e=>e.code==='STAIR_CLEAR_WIDTH_BELOW_MINIMUM'));
  assert.equal(deriveStairClearance(stairs,model).evaluated,false);
  assert.equal(findNarrowStairs(null)[0].code,'STAIR_CLEARANCE_NOT_EVALUABLE');
});
test('disconnected clear pieces cannot masquerade as a continuous stair width', () => {
  const stairs=room('stairs',0,0,6,12,{type:'stairs'});
  const model={roomClear:[{roomId:'stairs',parts:[{x:0,y:0,w:6,h:5},{x:0,y:7,w:6,h:5}]}],errors:[]};
  const result=deriveStairClearance(stairs,model,1,{valid:true,flights:[{rect:{x:1,y:1,w:4,h:10},from:{x:3,y:1},to:{x:3,y:11}}]});
  assert.equal(result.clearAboveHandrailFt,0);
  assert.equal(result.flights[0].fitsFinishedFaces,false);
});

test('an end wall is a coordination issue, not zero lateral stair width', () => {
  const stairs=room('stairs',0,0,8,12,{type:'stairs'});
  const model=buildWallModel({rooms:[stairs]});
  const result=deriveStairClearance(stairs,model,1,{valid:true,flights:[
    {rect:{x:1,y:0,w:3.5,h:10},from:{x:2.75,y:0},to:{x:2.75,y:10}},
  ]});
  assert.equal(result.clearAboveHandrailIn,42);
  assert.equal(result.meetsAboveHandrail,true);
  assert.deepEqual(findNarrowStairs(result).map(f=>f.code),['STAIR_WALL_COORDINATION_REQUIRED']);
});
test('partial upper translation moves composite parts and core exactly once without mutating input', () => {
  const { shiftUpperLevel } = require('../lib/residential/v2/orthogonalAssembler');
  const level={ rooms:[room('hall',0,0,10,10,{parts:[{x:0,y:0,w:10,h:4},{x:0,y:4,w:4,h:6}]})], stairCore:{x:10,y:4,w:7,h:12} };
  const original=structuredClone(level);
  const shifted=shiftUpperLevel(level,8);
  assert.deepEqual(level,original);
  assert.equal(shifted.rooms[0].x,8);
  assert.deepEqual(shifted.rooms[0].parts.map(p=>p.x),[8,8]);
  assert.equal(shifted.stairCore.x,18);
});
