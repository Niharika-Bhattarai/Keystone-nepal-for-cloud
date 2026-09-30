'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalizeBrief}=require('../lib/nepal/normalizeBrief');
const {searchConcepts}=require('../lib/nepal/candidateSearch');
const {exportCandidateGeometry}=require('../lib/nepal/geometryExport');

test('3D geometry export keeps engine walls, openings, elevations and honesty status',()=>{
  const brief=normalizeBrief(require('./fixtures/nepal/rental-3_5.json')).brief;
  const candidate=searchConcepts(brief,{provisionalSetbacksMm:[1000,1000,1000,1000],
    workingCoverageLimit:0.7,maxCandidates:1}).candidates[0];
  const g=JSON.parse(JSON.stringify(exportCandidateGeometry(candidate,brief)));
  assert.equal(g.designStatus,'spatial_hypothesis_not_a_floor_plan');
  assert.equal(g.eligibility,'unverified_concept_only');
  assert.deepEqual(g.levels.map(l=>l.elevationMm),brief.buildingProgram.levels.map(l=>l.elevationMm));
  assert.deepEqual(g.findings.map(f=>f.code),candidate.validation.blockers.map(b=>b.code));
  for(const [i,level] of g.levels.entries()){
    const source=candidate.levels[i];
    assert.deepEqual(level.rooms.map(r=>r.id),(source.rooms?.rooms||[]).map(r=>r.id));
    assert.equal(level.walls.length,source.walls?.walls.length||0);
    // Every exported opening is one of the engine's cut intervals, classified.
    for(const wall of level.walls)for(const o of wall.openings)assert.ok(['door','window'].includes(o.kind));
  }
  const openings=g.levels.flatMap(l=>l.walls.flatMap(w=>w.openings));
  assert.ok(openings.some(o=>o.kind==='door')&&openings.some(o=>o.kind==='window'));
  assert.ok(g.unverified.includes('RC frame design'));
});
