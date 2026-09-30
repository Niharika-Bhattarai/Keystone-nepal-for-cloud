'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkBedroomApproach } = require('../lib/geometry/bedroomApproach');
const { assignOpeningIds, bindOpeningSchedule } = require('../lib/geometry/openingIdentity');
const { buildFloorPassageModel } = require('../lib/geometry/floorPassageModel');
const { containsRect, subtract } = require('../lib/geometry/rectBoolean');
const rect = (x,y,w,h) => ({ x,y,w,h });

function fixture() {
  let level = assignOpeningIds({ level: 1, width: 24, height: 16, rooms: [
    { id:'hall', type:'hallway', ...rect(0,0,6,16) },
    { id:'bedroom', type:'bedroom', ...rect(6,0,18,16) },
  ], doors:[{ a:'hall', b:'bedroom', x:6, y:11, width:4, dir:'vertical' }], windows:[],
  furniture:[{ id:'bed', roomId:'bedroom', kind:'bed_queen', rotation:0, ...rect(12,2,5,7) }] });
  return bindOpeningSchedule(level, level.doors[0].id, { roughWidthFt:4.125, frameStartFt:0.0625,
    frameEndFt:0.0625, leafProjectionFt:0.125, leafSide:'start', basis:'Test geometry only' });
}
const req = (level, patch={}) => ({ entryOpeningId:level.doors[0].id, fromRoomId:'hall', bedId:'bed', clearWidthFt:3, ...patch });
function assertValidPaths(level, result) {
  const model=buildFloorPassageModel(level), hall=model.roomClear.find(r=>r.roomId==='hall').parts;
  const bedroom=model.roomClear.find(r=>r.roomId==='bedroom').parts;
  const free=subtract([...hall,...bedroom,...model.passageParts],level.furniture);
  const r=result.clearWidthFt/2;
  for(const side of result.sides.filter(s=>s.status==='clear')) {
    const first=side.path[0],last=side.path.at(-1),target=side.targetRegion;
    assert.ok(containsRect(hall,rect(first.x-r,first.y-r,r*2,r*2)));
    assert.ok(containsRect(bedroom,rect(last.x-r,last.y-r,r*2,r*2)));
    assert.ok(last.x>=target.x && last.x<=target.x+target.w && last.y>=target.y && last.y<=target.y+target.h);
    for(let i=1;i<side.path.length;i++){
      const a=side.path[i-1],b=side.path[i]; assert.ok(a.x===b.x||a.y===b.y);
      assert.ok(containsRect(free,rect(Math.min(a.x,b.x)-r,Math.min(a.y,b.y)-r,Math.abs(a.x-b.x)+r*2,Math.abs(a.y-b.y)+r*2)));
    }
  }
}

test('local doorway approach reaches actual bed sides rather than the occupied bed centre',()=>{
  const level=fixture(),before=structuredClone(level),result=checkBedroomApproach(level,req(level,{sidePolicy:'both'}));
  assert.equal(result.status,'clear');assert.deepEqual(result.accessibleSides,['west','east']);
  assert.equal(result.doorSwingChecked,false);assert.equal(result.constructionVerified,false);
  assertValidPaths(level,result);assert.deepEqual(level,before);
});

test('target search reaches an alternative along the same bed side when its middle is blocked',()=>{
  const level=fixture();level.furniture.push({id:'dresser',roomId:'bedroom',kind:'dresser',...rect(9,4,3,2)});
  const result=checkBedroomApproach(level,req(level,{sidePolicy:'both'}));
  assert.equal(result.status,'clear');
  const west=result.sides.find(s=>s.side==='west');
  assert.ok(west.path.at(-1).y>=7.5);
  assertValidPaths(level,result);
});

test('either-side policy accepts one reachable side while both-side policy rejects the blocked side',()=>{
  const level=fixture();level.furniture.push({id:'long-cabinet',roomId:'bedroom',kind:'cabinet',...rect(9,0.5,2.5,9)});
  const either=checkBedroomApproach(level,req(level));
  assert.equal(either.status,'clear');assert.deepEqual(either.accessibleSides,['east']);
  const both=checkBedroomApproach(level,req(level,{sidePolicy:'both'}));
  assert.equal(both.status,'blocked');assert.equal(both.sides.find(s=>s.side==='west').status,'blocked');
  assertValidPaths(level,either);
});

test('a doorway approach blocked by furniture is not replaced by a convenient remote hallway point',()=>{
  const level=fixture();level.furniture.push({id:'hall-cabinet',roomId:'hall',kind:'cabinet',...rect(2.5,8,3,6)});
  const result=checkBedroomApproach(level,req(level));
  assert.equal(result.status,'blocked');
  assert.ok(result.sides.every(s=>s.reason.includes('source approach')));
});

test('bed rotations use real long sides in each cardinal orientation',()=>{
  for(const rotation of [0,90,180,270]){
    const level=fixture();Object.assign(level.furniture[0],rotation%180?{rotation,x:11,y:4,w:7,h:5}:{rotation});
    const result=checkBedroomApproach(level,req(level,{sidePolicy:'both'}));
    assert.equal(result.status,'clear',String(rotation));
    assert.deepEqual(result.accessibleSides,rotation%180?['north','south']:['west','east']);
    assertValidPaths(level,result);
  }
});

test('horizontal entry uses the actual finished hallway face and keeps endpoints in their rooms',()=>{
  for (const turns of [1,2,3]) {
  let level=fixture();
  for (let turn=0;turn<turns;turn++) {
  // Rotate every physical rectangle and opening 90 degrees clockwise.
  for(const item of [...level.rooms,...level.furniture]){
    const {x,y,w,h}=item;Object.assign(item,{x:level.height-y-h,y:x,w:h,h:w});
  }
  const door=level.doors[0],{x,y}=door;Object.assign(door,{x:level.height-y,y:x,dir:door.dir==='vertical'?'horizontal':'vertical'});
  level.furniture[0].rotation=(level.furniture[0].rotation+90)%360;
  const width=level.width;level.width=level.height;level.height=width;
  }
  delete level.openingScheduleBook;assignOpeningIds(level);
  level=bindOpeningSchedule(level,level.doors[0].id,{roughWidthFt:4.125,frameStartFt:0.0625,frameEndFt:0.0625,
    leafProjectionFt:0.125,leafSide:'start',basis:'Rotated test geometry'});
  const result=checkBedroomApproach(level,req(level,{sidePolicy:'both'}));
  assert.equal(result.status,'clear');assert.equal(result.fromRegions[0].id,['north_approach','east_approach','south_approach'][turns-1]);assertValidPaths(level,result);
  }
});

test('nominal width, missing schedules and stale edits never manufacture a usable approach',()=>{
  const level=fixture();
  assert.equal(checkBedroomApproach(level,req(level,{clearWidthFt:4})).status,'blocked');
  const stale=structuredClone(level);stale.doors[0].y++;
  assert.equal(checkBedroomApproach(stale,req(stale)).status,'not_checked');
  delete level.openingScheduleBook;
  assert.equal(checkBedroomApproach(level,req(level)).status,'not_checked');
});

test('unknown bed orientation, malformed furniture and invalid ownership remain unverified',()=>{
  for(const edit of [l=>{delete l.furniture[0].rotation;},l=>{l.furniture[0].rotation=45;},
    l=>{l.furniture[0].w=-1;},l=>{l.furniture[0].roomId='hall';},l=>{l.furniture[0].x=5;},
    l=>{l.furniture.push({...l.furniture[0]});},l=>{delete l.furniture;},
    l=>{l.rooms.push(null);},l=>{l.doors.push(null);},l=>{l.rooms[0].parts=[null];}]){
    const level=fixture();edit(level);assert.equal(checkBedroomApproach(level,req(level)).status,'not_checked');
  }
});

test('another private bedroom cannot supply the entry route, and unknown policy or limits stay unverified',()=>{
  const level=fixture();level.rooms[0].type='bedroom';
  assert.equal(checkBedroomApproach(level,req(level)).status,'not_checked');
  level.rooms[0].type='hallway';
  assert.equal(checkBedroomApproach(level,req(level,{sidePolicy:'anywhere'})).status,'not_checked');
  assert.equal(checkBedroomApproach(level,req(level,{maxNodes:1})).status,'not_checked');
  assert.equal(checkBedroomApproach(level,req(level,{clearWidthFt:NaN})).status,'not_checked');
});
