'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalizeBrief}=require('../lib/nepal/normalizeBrief');
const {searchConcepts}=require('../lib/nepal/candidateSearch');
const {renderDrawingSet,buildOpeningSchedule,structuralLayout,ftin,rapd}=require('../lib/nepal/drawingSet');

const top=file=>{const brief=normalizeBrief(require(`./fixtures/nepal/${file}.json`)).brief;
  return {brief,candidate:searchConcepts(brief,{provisionalSetbacksMm:[1000,1000,1000,1000],
    workingCoverageLimit:0.7,maxCandidates:1}).candidates[0]};};

test('unit conversions match the sample drawings conventions',()=>{
  assert.equal(ftin(304.8),'1\'-0"');assert.equal(ftin(2100),'6\'-11"');assert.equal(ftin(900),'2\'-11"');
  // 1 ropani = 16 aana = 508.74 m²; 1 aana = 31.80 m².
  assert.equal(rapd(508.737),'1-0-0-0');assert.equal(rapd(31.796),'0-1-0-0');
});

test('drawing set follows the sample sheet list and never fills professional fields',()=>{
  const {brief,candidate}=top('rental-3_5');
  const set=renderDrawingSet(candidate,brief,{option:'Option 1',date:'2026-10-01'});
  assert.deepEqual(set.sheets.map(s=>s.no),['AR-00','AR-01','AR-02','AR-03','AR-04','AR-05','AR-06','AR-07',
    'SN-01','SN-02','ST-01']);
  for(const title of ['SITE PLAN','AREA STATEMENT','DRAWING LIST','OPENING SCHEDULE','SECTION AT X-X','ELEVATION',
    'ROOF PLAN','STAIR COVER (MUMTY)','GROUND DRAINAGE PLAN','SEPTIC TANK','SOAK PIT','STACK SCHEDULE','SANITARY — 1:',
    'COLUMN &amp; BEAM LAYOUT','STRUCTURE NOTES','PROFESSIONAL REVIEW REQUIRED'])assert.ok(set.html.includes(title),title);
  assert.equal((set.html.match(/FOR REVIEW ONLY — NOT FOR CONSTRUCTION OR PERMIT/g)||[]).length,set.sheets.length);
  assert.equal((set.html.match(/CHECKED BY: —/g)||[]).length,set.sheets.length);
  assert.equal((set.html.match(/NEC NO\.: — {3}SIGNATURE: —/g)||[]).length,set.sheets.length);
  assert.ok(set.html.includes('Kathmandu Metropolitan City, Ward 10'));
});

test('opening schedule counts every door and window the engine reserved, and only those',()=>{
  const {candidate}=top('rental-3_5');
  const schedule=buildOpeningSchedule(candidate);
  let doors=0,windows=0;
  for(const l of candidate.levels)for(const w of l.walls?.walls||[])for(const o of w.openingBoxes){
    if(o.opening===candidate.core.siteEntry)continue;// scheduled separately as MD
    if(o.opening?.leafCount)doors++;else if(o.opening?.assumedClearHeightMm)windows++;}
  const sum=kind=>schedule.rows.filter(r=>r.kind===kind).reduce((n,r)=>n+r.count,0);
  assert.equal(sum('door'),doors);assert.equal(sum('window'),windows);assert.equal(sum('main'),1);
  assert.deepEqual(new Set(schedule.rows.map(r=>r.tag)).size,schedule.rows.length);
  assert.ok(schedule.rows.filter(r=>r.kind==='window').every(r=>r.sillMm===900));
});

test('structural layout puts beams only between existing columns and sizes them by the sample rule',()=>{
  const {candidate}=top('rental-3_5');
  const st=structuralLayout(candidate),at=new Set(candidate.grid.columns.map(c=>`${c.xMm},${c.yMm}`));
  assert.ok(st.beams.length>0);
  for(const b of st.beams){
    const ends=b.axis==='x'?[`${b.from},${b.line}`,`${b.to},${b.line}`]:[`${b.line},${b.from}`,`${b.line},${b.to}`];
    assert.ok(ends.every(e=>at.has(e)));
    const t=st.beamTypes.find(x=>x.id===b.type);
    assert.ok(t.depthMm>=b.spanMm/12&&t.depthMm>=300&&t.depthMm%25===0);
  }
  assert.equal(st.status,'preliminary_layout_not_structural_design');
  assert.ok(st.slabThicknessMm>=125);
});
