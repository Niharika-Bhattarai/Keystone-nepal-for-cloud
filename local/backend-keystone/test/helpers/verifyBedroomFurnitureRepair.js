'use strict';

const assert = require('node:assert/strict');
const { validateEditedPlan } = require('../../lib/validateEditedPlan');
const { buildFloorPassageModel } = require('../../lib/geometry/floorPassageModel');
const { checkBedroomApproach } = require('../../lib/geometry/bedroomApproach');
const { createBedroomArchitecturalCheck } = require('../../lib/geometry/bedroomArchitecture');
const { containsRect, subtract } = require('../../lib/geometry/rectBoolean');
const { bedClearanceEnvelope, doorClearances, intersects } = require('../../lib/furnitureGeometry');

function verifyBedroomFurnitureRepair(input, result) {
  assert.equal(result.status, 'repaired');
  const expected = structuredClone(input.plan), level = expected.levels.find(l => l.level === input.options.levelNumber);
  const after = result.proposedPlan.levels.find(l => l.level === level.level);
  const bed = level.furniture.find(f => f.id === input.options.request.bedId);
  assert.equal(new Set(result.changes.map(c => c.furnitureId)).size, result.changes.length);
  for (const change of result.changes) {
    const item = level.furniture.find(f => f.id === change.furnitureId);
    assert.equal(item.roomId, bed.roomId);
    assert.ok(item.id === bed.id || item.kind === 'nightstand' || (input.options.coordinateDresser === true && item.kind === 'dresser'));
    assert.deepEqual([item.w, item.h].sort((a,b)=>a-b), [change.after.w, change.after.h].sort((a,b)=>a-b));
    assert.ok(Object.keys(change.after).every(k => ['x','y','w','h','rotation'].includes(k)));
    Object.assign(item, change.after);
  }
  if (expected.furniture) expected.furniture.find(f => f.level === level.level).items = structuredClone(level.furniture);
  assert.deepEqual(result.proposedPlan, expected);
  assert.deepEqual(validateEditedPlan(result.proposedPlan,input.survey),[]);
  const model = buildFloorPassageModel(after);
  assert.deepEqual(model, buildFloorPassageModel(input.plan.levels.find(l=>l.level===level.level)));
  assert.deepEqual(model.errors,[]); assert.ok(Math.abs(model.partition.residualSqFt)<1e-7);
  const room = after.rooms.find(r => r.id === bed.roomId), clear = model.roomClear.find(r => r.roomId === room.id).parts;
  const items = after.furniture.filter(f => f.roomId === room.id), zones = doorClearances(room, after);
  for (const [i,item] of items.entries()) {
    assert.ok(containsRect(clear,item)); assert.ok(!zones.some(z=>intersects(item,z)));
    assert.ok(!items.slice(0,i).some(other=>intersects(item,other,0.25)));
  }
  const envelope = bedClearanceEnvelope(items.find(f => f.id === bed.id),room);
  assert.ok(containsRect(clear,envelope));
  assert.ok(!items.filter(f=>f.kind==='dresser').some(f=>intersects(f,envelope)));
  const architecture = createBedroomArchitecturalCheck(after,room.id,bed.id,input.options.architecturePolicy);
  assert.equal(architecture.status,'ready');
  assert.deepEqual(architecture.check(items),result.architecturalValidation);
  assert.equal(result.architecturalValidation.status,'clear');
  const route = checkBedroomApproach(after,input.options.request);
  assert.equal(route.status,'clear'); assert.deepEqual(route,result.after);
  const allowed = new Set(route.allowedRoomIds);
  const free = subtract([...model.roomClear.filter(r=>allowed.has(r.roomId)).flatMap(r=>r.parts),
    ...model.openings.filter(o=>o.rooms.every(id=>allowed.has(id))).map(o=>o.clear)],after.furniture.filter(f=>allowed.has(f.roomId)));
  for(const side of route.sides.filter(s=>s.status==='clear')) for(let i=1;i<side.path.length;i++) {
    const a=side.path[i-1],b=side.path[i],radius=input.options.request.clearWidthFt/2;
    assert.ok(a.x===b.x||a.y===b.y);
    assert.ok(containsRect(free,{x:Math.min(a.x,b.x)-radius,y:Math.min(a.y,b.y)-radius,w:Math.abs(a.x-b.x)+2*radius,h:Math.abs(a.y-b.y)+2*radius}));
  }
  assert.equal(result.constructionVerified,false); assert.equal(result.doorSwingVerified,false);
}

module.exports = { verifyBedroomFurnitureRepair };
