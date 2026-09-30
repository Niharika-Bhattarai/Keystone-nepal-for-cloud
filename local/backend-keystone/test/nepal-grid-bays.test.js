'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {frameGrid,MAX_PLANNING_BAY_SPAN_MM,PREFERRED_MIN_BAY_SPAN_MM}=require('../lib/nepal/frameGrid');
const {roomGridCrossings,MAIN_GRID_ROOM_TYPES}=require('../lib/nepal/validateNepalPlan');
const {normalizeBrief}=require('../lib/nepal/normalizeBrief');
const {searchConcepts}=require('../lib/nepal/candidateSearch');

const footprint={family:'rectangle',slabs:[[1000,1000,10250,10250]]};
test('planning grid inserts an axis before a corridor-anchored bay exceeds 14 ft',()=>{
  const grid=frameGrid(footprint,{protectedCorridor:[3600,1000,4600,10250]});
  assert.equal(PREFERRED_MIN_BAY_SPAN_MM,3048);
  assert.equal(MAX_PLANNING_BAY_SPAN_MM,4267);
  assert.ok(grid.xAxesMm.length>=5);
  assert.ok(grid.maxAdjacentAxisSpanMm<=4267);
  assert.ok([...grid.xSpansMm,...grid.ySpansMm].every(span=>span<=4267));
  assert.equal(grid.spanStatus,'adjacent_planning_axes_only_not_engineered_beams');
  assert.throws(()=>frameGrid(footprint,{targetSpanMm:4268}),/planning span/);
});

test('grid-cell crossing check distinguishes an interior structural line from an edge line',()=>{
  const grid={xAxesMm:[150,3500,6850],yAxesMm:[150,3500],columnWidthMm:300};
  assert.deepEqual(roomGridCrossings({box:{x1:0,y1:0,x2:3400,y2:3400}},grid),
    {xAxesMm:[],yAxesMm:[]});
  assert.deepEqual(roomGridCrossings({box:{x1:0,y1:0,x2:7000,y2:3400}},grid),
    {xAxesMm:[3500],yAxesMm:[]});
});

test('reference owner plan reports rooms crossing bays instead of claiming four-column rooms',()=>{
  const brief=normalizeBrief(require('./fixtures/nepal/rectangle-2_5.json')).brief;
  const result=searchConcepts(brief,{provisionalSetbacksMm:[1000,1000,1000,1000],
    workingCoverageLimit:0.7});
  assert.equal(result.candidates.length,3);
  for(const candidate of result.candidates){
    assert.ok(candidate.grid.maxAdjacentAxisSpanMm<=4267);
    // Every main room that an axis crosses is reported, and nothing else is.
    const reported=candidate.validation.blockers.filter(b=>b.code==='MAIN_ROOM_GRID_CELL_NOT_MET')
      .flatMap(e=>e.rooms.map(r=>r.roomId)).sort();
    const measured=candidate.levels.flatMap(l=>(l.rooms?.rooms||[]).filter(r=>
      MAIN_GRID_ROOM_TYPES.has(r.type)).filter(r=>{const c=roomGridCrossings(r,candidate.grid);
      return c.xAxesMm.length||c.yAxesMm.length;}).map(r=>r.id)).sort();
    assert.deepEqual(reported,measured,candidate.id);
  }
  // The east-core plan's primary bedroom still spans two bays and says so.
  const east=result.candidates.find(c=>c.id==='rectangle-east-living-first');
  assert.ok(east.validation.blockers.some(b=>b.code==='MAIN_ROOM_GRID_CELL_NOT_MET'&&
    b.rooms.some(r=>r.roomId.includes('primaryBedroom'))));
});
