'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {boundarySegments,validateOpeningGeometry,finalizeOpenings}=require('../lib/openingGeometry');
const {placeOpenings}=require('../lib/placeOpenings');

test('opening validation checks complete spans rather than matching center points',()=>{
 const level={level:1,rooms:[{id:'entry',x:0,y:0,w:12,h:12}],doors:[{a:'entry',b:'__exterior__',dir:'horizontal',x:4,y:0,width:3}],windows:[{dir:'horizontal',x:6,y:0,width:4}]};
 assert.ok(validateOpeningGeometry(level).some(e=>e.includes('Opening overlap')));
 finalizeOpenings(level,level.doors,level.windows);
 assert.equal(level.doors.length,1); assert.equal(level.windows.length,1);
 assert.deepEqual(validateOpeningGeometry(level),[]);
});

test('a door cannot span a shorter shared wall even when its center is on both boundaries',()=>{
 const level={level:1,rooms:[{id:'a',x:0,y:0,w:8,h:8},{id:'b',x:8,y:6,w:8,h:8}],doors:[{a:'a',b:'b',dir:'vertical',x:8,y:7,width:3}]};
 assert.ok(validateOpeningGeometry(level).some(e=>e.includes('exceeds its wall')));
 finalizeOpenings(level,level.doors,[]);
 assert.equal(level.doors.length,0);
});

test('composite room boundaries exclude internal seams and expose recessed exterior walls',()=>{
 const room={id:'l',parts:[{x:0,y:0,w:6,h:12},{x:6,y:0,w:6,h:6}]};
 const segments=boundarySegments(room,[room],true);
 assert.ok(!segments.some(s=>s.dir==='vertical'&&s.fixed===6&&s.start<6));
 assert.ok(segments.some(s=>s.dir==='horizontal'&&s.fixed===6&&s.start===6&&s.end===12));
 const level={level:1,rooms:[room],windows:[{roomId:'l',dir:'horizontal',x:9,y:6,width:4}]};
 assert.deepEqual(validateOpeningGeometry(level),[]);
});

test('a neighboring room blocks exterior glazing on a shared wall',()=>{
 const a={id:'a',x:0,y:0,w:10,h:10},b={id:'b',x:10,y:0,w:10,h:10};
 const level={level:1,rooms:[a,b],windows:[{roomId:'a',dir:'vertical',x:10,y:5,width:4}]};
 assert.ok(validateOpeningGeometry(level).some(e=>e.includes('exceeds its wall')));
});

test('privacy-first placement keeps exterior bedroom windows and remains deterministic',()=>{
 const plan={levels:[{level:1,width:24,height:12,rooms:[{id:'entry',type:'entry',x:0,y:0,w:12,h:12},{id:'bed',type:'bedroom',x:12,y:0,w:12,h:12}]}]};
 const survey={naturalLight:'Privacy first (fewer windows)',frontFacing:'South'};
 placeOpenings(plan,survey);
 assert.ok(plan.levels[0].windows.some(w=>w.roomId==='bed'));
 assert.deepEqual(validateOpeningGeometry(plan.levels[0]),[]);
 const first=JSON.stringify(plan);placeOpenings(plan,survey);assert.equal(JSON.stringify(plan),first);
});

test('wide doors fit their full width and garage openings retain wall at jambs',()=>{
 const plan={levels:[{level:1,width:26,height:20,rooms:[{id:'g',type:'garage',x:0,y:0,w:14,h:20},{id:'e',type:'entry',x:14,y:0,w:12,h:20}]}]};
 placeOpenings(plan,{accessibilityNeeds:'Wide doorways',frontFacing:'North'});
 const level=plan.levels[0];
 assert.equal(level.doors.find(d=>d.garageDoor).width,9);
 assert.ok(level.doors.filter(d=>!d.garageDoor).every(d=>d.width===4));
 assert.deepEqual(validateOpeningGeometry(level),[]);
});
