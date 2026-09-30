'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { findClearRoute, checkLevelClearRoute } = require('../lib/geometry/clearRoute');
const { assignOpeningIds, bindOpeningSchedule } = require('../lib/geometry/openingIdentity');
const { containsRect, subtract } = require('../lib/geometry/rectBoolean');
const rect = (x,y,w,h) => ({ x,y,w,h });
const request = (clearWidthFt, from = { x: 2, y: 5 }, to = { x: 18, y: 5 }) => ({ from, to, clearWidthFt });

test('whole union supports a route across decomposition seams and overlapping parts', () => {
  const parts = [rect(0,0,10,10), rect(10,0,10,10), rect(2,2,12,6)];
  const before = structuredClone(parts);
  const result = findClearRoute(parts, request(3));
  assert.equal(result.status, 'clear');
  assert.deepEqual(result.path, [request(3).from, request(3).to]);
  assert.equal(result.constructionVerified, false);
  assert.deepEqual(parts, before);
});

test('a narrow neck blocks a large footprint despite connected rooms and a generous bounding box', () => {
  const parts = [rect(0,0,8,10), rect(8,4,4,2), rect(12,0,8,10)];
  assert.equal(findClearRoute(parts, request(2)).status, 'clear');
  assert.equal(findClearRoute(parts, request(2.0001)).status, 'blocked');
});

test('an L shaped route turns within actual clear polygons and cannot cut its missing quadrant', () => {
  const parts = [rect(0,0,12,4), rect(8,0,4,12)];
  const req = request(3, { x: 2, y: 2 }, { x: 10, y: 10 });
  const result = findClearRoute(parts, req);
  assert.equal(result.status, 'clear');
  assert.ok(result.path.length >= 3);
  for (let i = 1; i < result.path.length; i++) {
    const a = result.path[i-1], b = result.path[i], r = req.clearWidthFt / 2;
    assert.ok(a.x === b.x || a.y === b.y);
    assert.ok(containsRect(parts, rect(Math.min(a.x,b.x)-r, Math.min(a.y,b.y)-r,
      Math.abs(a.x-b.x)+r*2, Math.abs(a.y-b.y)+r*2)));
  }
});

test('obstacles cause a real detour, with every swept segment contained in free floor', () => {
  const parts = [rect(0,0,20,10)], obstacles = [rect(8,3,4,4)];
  const result = findClearRoute(parts, { ...request(2), obstacles });
  assert.equal(result.status, 'clear');
  assert.ok(result.path.length > 2);
  const free = subtract(parts, obstacles);
  for (let i = 1; i < result.path.length; i++) {
    const a = result.path[i-1], b = result.path[i];
    assert.ok(containsRect(free, rect(Math.min(a.x,b.x)-1, Math.min(a.y,b.y)-1,
      Math.abs(a.x-b.x)+2, Math.abs(a.y-b.y)+2)));
  }
});

test('thin full-height barriers cannot be skipped by the route search', () => {
  assert.equal(findClearRoute([rect(0,0,20,10)], { ...request(2), obstacles: [rect(9.123,0,0.0001,10)] }).status, 'blocked');
});

test('search limits, invalid geometry and absent dimensions remain unverified', () => {
  for (const req of [{ ...request(2), maxNodes: 1 }, { ...request(NaN) },
    { ...request(-2) }, { ...request(2), obstacles: [rect(0,0,-1,2)] }]) {
    const result = findClearRoute([rect(0,0,20,10)], req);
    assert.equal(result.status, 'not_checked');
    assert.equal(result.path.length, 0);
  }
  assert.equal(findClearRoute([], request(2)).status, 'not_checked');
  assert.equal(findClearRoute([rect(0,0,20,10)], request(6)).status, 'blocked');
  assert.equal(findClearRoute([rect(0,0,20,10)], request(2, { x: 5,y: 5 }, { x: 5,y: 5 })).status, 'clear');
});

function levelFixture() {
  return assignOpeningIds({ level: 1, width: 20, height: 10, rooms: [
    { id: 'hall', type: 'hallway', ...rect(0,0,10,10) },
    { id: 'bed', type: 'bedroom', ...rect(10,0,10,10) },
  ], doors: [{ a: 'hall', b: 'bed', x: 10, y: 5, width: 3, dir: 'vertical' }], windows: [], furniture: [] });
}
function boundFixture() {
  const level = levelFixture();
  return bindOpeningSchedule(level, level.doors[0].id, { roughWidthFt: 3.125,
    frameStartFt: 0.0625, frameEndFt: 0.0625, leafProjectionFt: 0.125, leafSide: 'start', basis: 'Test-only assumed schedule' });
}
const floorRequest = width => ({ ...request(width), allowedRoomIds: ['hall','bed'] });

test('nominal three-foot door cannot pass a three-foot footprint after frame and leaf deductions', () => {
  const level = boundFixture();
  const good = checkLevelClearRoute(level, floorRequest(2.5));
  assert.equal(good.status, 'clear'); assert.equal(good.furnitureChecked, true);
  assert.equal(good.doorSwingChecked, false); assert.equal(good.constructionVerified, false);
  assert.equal(checkLevelClearRoute(level, floorRequest(3)).status, 'blocked');
});

test('unscheduled, invalid and edited schedules never yield a positive route result', () => {
  assert.equal(checkLevelClearRoute(levelFixture(), floorRequest(2)).status, 'not_checked');
  const level = boundFixture(); level.doors[0].y++;
  const result = checkLevelClearRoute(level, floorRequest(2));
  assert.equal(result.status, 'not_checked'); assert.ok(result.errors.length);
});

test('furniture obstructs the route and missing furniture cannot silently count as empty', () => {
  const level = boundFixture();
  level.furniture.push({ id: 'blocker', roomId: 'hall', kind: 'cabinet', ...rect(6,0,2,10) });
  assert.equal(checkLevelClearRoute(level, floorRequest(2)).status, 'blocked');
  const shellOnly = checkLevelClearRoute(level, { ...floorRequest(2), includeFurniture: false });
  assert.equal(shellOnly.status, 'clear'); assert.equal(shellOnly.furnitureChecked, false);
  delete level.furniture;
  assert.equal(checkLevelClearRoute(level, floorRequest(2)).status, 'not_checked');
  level.furniture = [{ ...rect(6,0,2,10), roomId: 'unknown' }];
  assert.equal(checkLevelClearRoute(level, floorRequest(2)).status, 'not_checked');
});

test('room scope is explicit and stair floors are never treated as flat traversable polygons', () => {
  const level = boundFixture();
  for (const allowedRoomIds of [undefined, [], ['hall','hall'], ['hall','missing']]) {
    assert.equal(checkLevelClearRoute(level, { ...request(2), allowedRoomIds }).status, 'not_checked');
  }
  level.rooms[1].type = 'stairs';
  assert.equal(checkLevelClearRoute(level, floorRequest(2)).status, 'not_checked');
  assert.equal(checkLevelClearRoute(null, floorRequest(2)).status, 'not_checked');
  level.rooms.push(null);
  assert.equal(checkLevelClearRoute(level, floorRequest(2)).status, 'not_checked');
  const malformed=boundFixture();malformed.rooms[0].parts=[null];
  assert.equal(checkLevelClearRoute(malformed, floorRequest(2)).status, 'not_checked');
});

test('restricted room scope cannot use unapproved rooms as a shortcut', () => {
  const level = boundFixture();
  assert.equal(checkLevelClearRoute(level, { ...floorRequest(2), allowedRoomIds: ['hall'] }).status, 'blocked');
});

test('region search finds an interior target between obstacles when its ends and middle are blocked', () => {
  const parts=[rect(0,0,20,12)],obstacles=[rect(14,0,6,2),rect(14,5,6,7)];
  const result=findClearRoute(parts,{from:{x:2,y:3.5},targetRegions:[{id:'side',x:17,y:1,w:0,h:10}],clearWidthFt:2,obstacles});
  assert.equal(result.status,'clear');assert.equal(result.targetId,'side');
  assert.ok(result.path.at(-1).y>=3 && result.path.at(-1).y<=4);
});

test('multiple sources can include obstructed approaches without discarding the feasible one',()=>{
  const result=findClearRoute([rect(0,0,20,10)],{
    fromRegions:[{id:'blocked',...rect(1,1,0,0)},{id:'free',...rect(3,6,0,2)}],
    targetRegions:[{id:'destination',...rect(17,6,0,2)}],clearWidthFt:2,obstacles:[rect(0,0,4,4)],
  });
  assert.equal(result.status,'clear');assert.equal(result.sourceId,'free');
});

test('endpoint floor constraints prevent an approach footprint borrowing space from an adjacent room',()=>{
  const parts=[rect(0,0,20,10)];
  const base={from:{x:2,y:5},targetRegions:[{id:'outside-edge',x:10.5,y:5,w:0,h:0}],clearWidthFt:3};
  assert.equal(findClearRoute(parts,base).status,'clear');
  assert.equal(findClearRoute(parts,{...base,targetFloorParts:[rect(10,0,10,10)]}).status,'blocked');
  assert.equal(findClearRoute(parts,{...base,fromFloorParts:[]}).status,'blocked');
  const alternative={...base,targetRegions:[{id:'inside-edge',x:10.5,y:5,w:4,h:0}],targetFloorParts:[rect(10,0,10,10)]};
  assert.equal(findClearRoute(parts,alternative).status,'clear');
  assert.ok(findClearRoute(parts,alternative).path.at(-1).x>=11.5);
});

test('invalid or ambiguous endpoint contracts are not checked',()=>{
  const parts=[rect(0,0,20,10)],region={id:'goal',x:18,y:5,w:0,h:0};
  for(const patch of [
    {targetRegions:[region]},
    {to:undefined,targetRegions:[]},
    {to:undefined,targetRegions:[region,region]},
    {to:undefined,targetRegions:[{...region,w:-1}]},
    {to:undefined,targetRegions:[{...region,id:''}]},
    {from:undefined,fromRegions:null},
    {targetFloorParts:[rect(0,0,NaN,2)]},
  ]) assert.equal(findClearRoute(parts,{...request(2),...patch}).status,'not_checked');
});
