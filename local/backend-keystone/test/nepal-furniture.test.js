'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalizeBrief}=require('../lib/nepal/normalizeBrief');
const {searchConcepts}=require('../lib/nepal/candidateSearch');
const {furnishLevel,roomOpenings}=require('../lib/nepal/furniture');
const {structuralLayout}=require('../lib/nepal/drawingSet');
const overlap=(a,b)=>Math.min(a.x2,b.x2)-Math.max(a.x1,b.x1)>1&&Math.min(a.y2,b.y2)-Math.max(a.y1,b.y1)>1;

for(const file of ['rental-3_5','rectangle-2_5'])test(`furniture fits inside rooms, clear of doors, columns and each other (${file})`,()=>{
  const brief=normalizeBrief(require(`./fixtures/nepal/${file}.json`)).brief;
  for(const c of searchConcepts(brief,{provisionalSetbacksMm:[1000,1000,1000,1000],workingCoverageLimit:0.7,maxCandidates:6}).candidates){
    const beams=structuralLayout(c).beams;
    for(const level of c.levels){
      const {items,misfits}=furnishLevel(level,{bearingDegrees:brief.site.north.bearingDegrees,beams,columns:c.grid.columns});
      assert.deepEqual(misfits,[],`${c.id} ${level.id}`);
      for(const room of level.rooms?.rooms||[]){
        const mine=items.filter(i=>i.roomId===room.id),clear=room.clearBox||room.box,ops=roomOpenings(room,level);
        for(const it of mine){
          assert.ok(it.box.x1>=clear.x1-1&&it.box.x2<=clear.x2+1&&it.box.y1>=clear.y1-1&&it.box.y2<=clear.y2+1,`${it.kind} outside ${room.id}`);
          for(const o of ops.filter(o=>o.keepOut))assert.ok(!overlap(it.box,o.keepOut),`${it.kind} in door zone of ${room.id}`);
          for(const col of c.grid.columns){const h=col.widthMm/2;
            assert.ok(!overlap(it.box,{x1:col.xMm-h,y1:col.yMm-h,x2:col.xMm+h,y2:col.yMm+h}),`${it.kind} on column ${col.id}`);}
          // beds back onto solid wall: no window on the headboard wall segment (V27)
          if(/Bed$/.test(it.kind)&&!it.headboard){const along=it.wall==='south'||it.wall==='north'?[it.box.x1,it.box.x2]:[it.box.y1,it.box.y2];
            assert.ok(!ops.some(o=>o.edge===it.wall&&Math.min(along[1],o.to)-Math.max(along[0],o.from)>1),`${it.kind} headboard on opening`);}
        }
        for(let i=0;i<mine.length;i++)for(let j=i+1;j<mine.length;j++)assert.ok(!overlap(mine[i].box,mine[j].box),`${mine[i].kind}/${mine[j].kind} in ${room.id}`);
        const kinds=mine.map(i=>i.kind);
        if(room.type==='bathroom')assert.ok(kinds.includes('wc')&&kinds.includes('basin'),room.id);
        if(room.type==='kitchen')assert.ok(['stove','sink','counter'].every(k=>kinds.includes(k)),room.id);
        if(/[bB]edroom$/.test(room.type))assert.ok(kinds.some(k=>/Bed$/.test(k)),room.id);
        if(room.type==='puja')assert.ok(kinds.includes('altar'));
      }
    }
  }
});

test('Vaastu wall rules are applied and reported per item',()=>{
  const brief=normalizeBrief(require('./fixtures/nepal/rental-3_5.json')).brief;
  const c=searchConcepts(brief,{provisionalSetbacksMm:[1000,1000,1000,1000],workingCoverageLimit:0.7,maxCandidates:1}).candidates[0];
  const items=c.levels.flatMap(l=>furnishLevel(l,{bearingDegrees:0,columns:c.grid.columns}).items);
  const rules=new Set(items.filter(i=>i.vastu).map(i=>i.vastu.ruleId));
  for(const id of ['V22','V24','V25','V35','V34'])assert.ok(rules.has(id),id);
  for(const it of items.filter(i=>i.vastu))assert.equal(it.vastu.met,it.vastu.preferred.includes(it.wallCompass));
  // At bearing 0 the plan's south edge faces east: the altar (V34) is on it.
  const altar=items.find(i=>i.kind==='altar');assert.equal(altar.wallCompass,'E');
});
