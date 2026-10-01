'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {zoneAreas,dominantZone}=require('../lib/nepal/vastuDomains');
const {vastuFindings}=require('../lib/nepal/vastuAllocator');
const {normalizeBrief}=require('../lib/nepal/normalizeBrief');
const {searchConcepts}=require('../lib/nepal/candidateSearch');
const site=[[0,0,9000,9000]];
test('true north rotates room geography without rotating the building',()=>{
  const room=[[6000,6000,9000,9000]];
  assert.equal(dominantZone(room,90,site),'NE');
  assert.equal(dominantZone(room,0,site),'NW'); // +x is north and +y is west at this bearing.
});
test('clipped L-shaped floor does not invent area in its missing corner',()=>{
  const floor=[[0,0,9000,6000],[3000,6000,9000,9000]];
  const areas=zoneAreas(floor,90,site);
  assert.equal(areas.NW,0);
  assert.equal(Object.values(areas).reduce((s,v)=>s+v,0),72);
});
test('kitchen/puja preferences are measured as zone overlap, not a decorative score',()=>{
  const results=vastuFindings([{id:'k',type:'kitchen',box:[6000,0,9000,3000]},
    {id:'p',type:'puja',box:[6000,6000,9000,9000]}],{bearingDegrees:90,domainBoxes:site});
  assert.equal(results[0].preferredShare,1);
  assert.equal(results[1].preferredShare,1);
});
test('rental brief yields distinct spatial hypotheses without claiming valid floor plans',()=>{
  const brief=normalizeBrief(require('./fixtures/nepal/rental-3_5.json')).brief;
  const result=searchConcepts(brief,{provisionalSetbacksMm:[1000,1000,1000,1000]});
  assert.equal(result.candidates.length,3);
  assert.equal(new Set(result.candidates.map(c=>c.geometryHash)).size,3);
  assert.equal(result.variations.length,3);
  assert.ok(result.variations.every(pair=>pair.changes.length>0));
  assert.equal(result.generationAvailable,false);
  assert.ok(result.candidates.every(c=>c.validation.blockers.some(b=>b.code==='MUNICIPAL_RULES_UNVERIFIED')));
  assert.ok(result.candidates.every(c=>!c.validation.blockers.some(b=>b.code==='ROOM_SIZE_BELOW_PROVISIONAL_NBC206')));
  assert.ok(result.candidates.every(c=>c.core.reservoir.vastuFinding.type==='undergroundReservoir'));
  assert.ok(result.candidates.some(c=>c.vastuConflicts.some(x=>x.ruleId==='V20')));
  for(const candidate of result.candidates){
    assert.deepEqual(candidate.levels.slice(0,2).map(l=>l.rooms.rooms.filter(r=>r.type==='kitchen').length),[1,1]);
    assert.ok(candidate.levels[2].rooms.rooms.some(r=>r.type==='guestBedroom'));
    assert.ok(candidate.levels[2].rooms.rooms.some(r=>r.type==='puja'));
    const kitchen=candidate.levels[0].rooms.rooms.find(r=>r.type==='kitchen');
    assert.equal(kitchen.provisionalNaturalLightOpeningSqM,kitchen.areaSqM/8);
  }
  assert.ok(result.attempts.some(a=>a.status==='rejected'&&a.id.includes('U-north-court')));
});
test('overconstrained partial top rejects all candidates with reasons instead of deleting a floor',()=>{
  const raw=structuredClone(require('./fixtures/nepal/rental-3_5.json'));
  raw.buildingProgram.levels[3].targetArea={value:8,unit:'sq_m'};
  const brief=normalizeBrief(raw).brief;
  const result=searchConcepts(brief,{provisionalSetbacksMm:[1000,1000,1000,1000]});
  assert.equal(result.candidates.length,0);
  // 4 footprint families x 2 core sides x 5 room orders (incl. two zone-first orders).
  assert.equal(result.attempts.length,40);
  assert.ok(result.attempts.every(a=>a.status==='rejected'&&a.reason));
});
