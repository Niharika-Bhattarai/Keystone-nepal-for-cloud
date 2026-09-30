'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalizeBrief}=require('../lib/nepal/normalizeBrief');
const {searchConcepts}=require('../lib/nepal/candidateSearch');

function concepts(file){
  const raw=structuredClone(require(`./fixtures/nepal/${file}.json`));
  for(const level of raw.buildingProgram.levels)
    level.specialRooms=level.specialRooms.filter(room=>room!=='puja');
  raw.buildingProgram.levels.at(-1).specialRooms.push('puja');
  const normalized=normalizeBrief(raw);
  assert.deepEqual(normalized.invalid,[]);
  assert.deepEqual(normalized.unsupported,[]);
  return searchConcepts(normalized.brief,{provisionalSetbacksMm:[1000,1000,1000,1000],
    workingCoverageLimit:0.7,maxCandidates:6}).candidates;
}

test('numbered review set contains ten measured layouts with top owner puja and honest column findings',()=>{
  const owner=concepts('rectangle-2_5'),rental=concepts('rental-3_5');
  assert.equal(owner.length,4);
  assert.equal(rental.length,6);
  assert.equal(new Set([...owner,...rental].map(c=>c.geometryHash)).size,10);
  for(const candidate of [...owner,...rental]){
    assert.ok(candidate.levels.at(-1).rooms.rooms.some(room=>room.type==='puja'));
    assert.equal(candidate.core.siteEntry.clearWidthMm,1200);
    assert.ok(candidate.validation.blockers.some(b=>b.code==='PARTIAL_TOP_TERRACE_ENCLOSURE_UNVERIFIED'));
  }
  assert.ok(rental.some(c=>c.order==='living-first'&&
    !c.validation.blockers.some(b=>b.code==='COLUMN_IN_ROOM_CLEAR_AREA')));
  assert.ok(owner.some(c=>c.order==='living-first'&&c.levels[0].rooms.parking&&
    !c.validation.blockers.some(b=>b.code==='COLUMN_IN_ROOM_CLEAR_AREA')));
});
